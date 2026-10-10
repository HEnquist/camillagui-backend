//! The `/api` handlers, each in the OpenAPI spec, and the redirect to the GUI.

use crate::camilla::{CamillaClient, DspError, to_json};
use crate::coeffs::CoeffDefaults;
use crate::events::{self, EventPayloads, SubscribeError};
use crate::extract::{Form, Json, Multipart, Path as UrlPath, Query};
use crate::files::{self, CoeffDetailsCache, ConfigContext, Details, FileInfo};
use crate::paths::{self, file_in_folder};
use crate::reply::{Binary, BodyWriter, EventStream, NO_STORE, NoContent, Reply, Text};
use crate::settings::{self, GuiConfig, Settings};
use crate::status::Status;
use crate::status::StatusCache;
use crate::validate::{self, DeviceTypeLists, DeviceTypes, ValidationIssue};
use crate::wav::WavInfo;
use crate::{coeffs, convolver, eqapo, legacy, wav, yaml};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Redirect, Response};
use camilladsp_schema::config::{
    CaptureDevice, Configuration, ConvParameters, Filter, FiniteF32, FiniteF64, Mixer, PathElement,
    PipelineStep, PlaybackDevice, Processor, Resampler,
};
use camilladsp_schema::protocol::{
    AudioDeviceDescriptor, Fader, SpectrumSide, SpectrumSubscription, VuSubscription,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::AsyncWriteExt;
use utoipa::{IntoParams, ToSchema};

pub struct AppState {
    pub settings: Settings,
    pub camilla: Arc<CamillaClient>,
    pub status: Arc<StatusCache>,
    pub coeff_details: CoeffDetailsCache,
}

impl AppState {
    fn device_types(&self) -> DeviceTypes {
        DeviceTypes {
            dsp: self.status.device_types(),
            settings_capture: self.settings.supported_capture_types.clone(),
            settings_playback: self.settings.supported_playback_types.clone(),
        }
    }

    fn audiofiles_dir(&self) -> Option<&Path> {
        self.settings.audiofiles_dir.as_deref()
    }
}

type Shared = State<Arc<AppState>>;

/// The body of every error response.
#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorBody {
    /// What went wrong, to show to the user.
    pub message: String,
    /// When CamillaDSP refused a command, the name of its error, for example
    /// `ProcessingNotRunningError`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub result: Option<String>,
}

/// An error response: a status, and an `ErrorBody`.
#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    body: ErrorBody,
}

impl ApiError {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        ApiError {
            status,
            body: ErrorBody {
                message: message.into(),
                result: None,
            },
        }
    }

    fn with_result(mut self, result: String) -> Self {
        self.body.result = Some(result);
        self
    }
}

fn bad_request(text: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, text)
}

fn not_found(text: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, text)
}

fn internal(text: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, text)
}

fn unavailable(text: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::SERVICE_UNAVAILABLE, text)
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, [NO_STORE], axum::Json(self.body)).into_response()
    }
}

/// Talking to CamillaDSP failed: it could not be reached, or it refused.
impl From<DspError> for ApiError {
    fn from(err: DspError) -> Self {
        match err {
            DspError::Io(message) => unavailable(message),
            DspError::Command { result, message } => internal(message).with_result(result),
        }
    }
}

/// What a handler answers. Its type is what the spec says the handler sends,
/// see `reply.rs`.
type ApiResult<T> = Result<T, ApiError>;

/// Run blocking file work off the async threads.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, ApiError> + Send + 'static,
) -> Result<T, ApiError> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|err| internal(err.to_string()))?
}

// ── Status and events ──────────────────────────────────────────────────────

pub async fn get_gui_index() -> Redirect {
    Redirect::to("/gui/index.html")
}

/// The values the GUI polls for, and the versions.
///
/// CamillaDSP is asked at most once a second, however many browsers poll.
#[utoipa::path(get, path = "/status")]
pub async fn get_status(State(app): Shared) -> Reply<Status> {
    Reply(app.status.refresh(&app.camilla).await)
}

/// What an event stream carries besides the state. The spectrum takes the
/// fields of CamillaDSP's SpectrumSubscription, and is left out without a
/// `side`.
#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct EventsQuery {
    /// Send the VU levels, as `levels` events. Smoothing and rate come from
    /// the settings.
    #[param(nullable = false)]
    levels: Option<bool>,
    /// The side to send the spectrum of, as `spectrum` events. No spectrum
    /// without it.
    #[param(inline, nullable = false)]
    side: Option<SpectrumSide>,
    /// The channel of the spectrum, all channels averaged without it.
    #[param(nullable = false)]
    channel: Option<usize>,
    /// The lower edge of the spectrum in Hz, needed with a `side`.
    #[param(nullable = false)]
    min_freq: Option<f64>,
    /// The upper edge of the spectrum in Hz, needed with a `side`.
    #[param(nullable = false)]
    max_freq: Option<f64>,
    /// The number of spectrum bins, needed with a `side`.
    #[param(nullable = false)]
    n_bins: Option<usize>,
    /// The most spectra a second, as fast as CamillaDSP makes them without it.
    #[param(nullable = false)]
    max_rate: Option<f32>,
}

impl EventsQuery {
    /// The parts to send. The levels and the spectrum are left out when the
    /// level stream is disabled in the settings, after the query is checked.
    fn parts(self, settings: &Settings) -> Result<events::Parts, ApiError> {
        let spectrum = match self.side {
            None => None,
            Some(side) => {
                let (Some(min_freq), Some(max_freq), Some(n_bins)) =
                    (self.min_freq, self.max_freq, self.n_bins)
                else {
                    return Err(bad_request(
                        "A spectrum needs `min_freq`, `max_freq` and `n_bins`",
                    ));
                };
                Some(SpectrumSubscription {
                    side,
                    channel: self.channel,
                    min_freq,
                    max_freq,
                    n_bins,
                    max_rate: self.max_rate,
                })
            }
        };
        if !settings.enable_level_stream {
            return Ok(events::Parts::default());
        }
        let levels = self.levels.unwrap_or(false).then(|| {
            let smoothing_ms = settings.level_smoothing_ms.max(0.0) as f32;
            VuSubscription {
                max_rate: settings.level_max_update_hz.max(0.0) as f32,
                attack: 0.1 * smoothing_ms,
                release: smoothing_ms,
            }
        });
        Ok(events::Parts { levels, spectrum })
    }
}

/// The processing state, and the VU levels and the spectrum when asked for,
/// as one stream of server-sent events, so that a GUI tab holds one of the
/// browser's few connections to the backend.
///
/// It starts with a `state` event with the current state, then has one for
/// each change, and ends when CamillaDSP goes away. The `levels` and
/// `spectrum` events come as CamillaDSP sends them, and a spectrum refused
/// while processing is stopped starts once it runs. A `heartbeat` event
/// comes every two seconds. The parameters come in the query string, since an
/// EventSource can only GET, and changing them means opening a new stream.
/// The data of each event is in `EventPayloads`, by event name.
#[utoipa::path(
    get,
    path = "/events",
    params(EventsQuery),
    responses(
        (status = 400, description = "A spectrum is missing a parameter", body = ErrorBody),
        (status = 503, description = "CamillaDSP cannot be reached", body = ErrorBody),
    )
)]
pub async fn get_events(
    State(app): Shared,
    Query(query): Query<EventsQuery>,
) -> ApiResult<EventStream<EventPayloads>> {
    let parts = query.parts(&app.settings)?;
    events::events(&app.camilla, parts)
        .await
        .map_err(|err| match err {
            SubscribeError::ProcessingNotRunning => unavailable("Processing is not running"),
            SubscribeError::Refused(message) | SubscribeError::Other(message) => {
                unavailable(message)
            }
        })
}

// ── Volume and faders ──────────────────────────────────────────────────────

// A JSON number or boolean would be `text/plain` in the spec if the request
// body were left to be inferred from the `Json` argument, so those say what
// they are.

/// The main volume, in dB.
#[utoipa::path(
    get,
    path = "/param/volume",
    responses(
        (status = "default", description = "CamillaDSP cannot be reached, or refused", body = ErrorBody),
    )
)]
pub async fn get_volume(State(app): Shared) -> ApiResult<Reply<f32>> {
    Ok(Reply(app.camilla.volume().await?))
}

/// Set the main volume, in dB.
#[utoipa::path(
    post,
    path = "/param/volume",
    request_body(content = f32, content_type = "application/json"),
    responses(
        (status = "default", description = "CamillaDSP cannot be reached, or refused", body = ErrorBody),
    )
)]
pub async fn set_volume(State(app): Shared, Json(volume): Json<f32>) -> ApiResult<NoContent> {
    app.camilla.set_volume(volume).await?;
    Ok(NoContent)
}

/// Whether the main volume is muted.
#[utoipa::path(
    get,
    path = "/param/mute",
    responses(
        (status = "default", description = "CamillaDSP cannot be reached, or refused", body = ErrorBody),
    )
)]
pub async fn get_mute(State(app): Shared) -> ApiResult<Reply<bool>> {
    Ok(Reply(app.camilla.mute().await?))
}

/// Mute or unmute the main volume.
#[utoipa::path(
    post,
    path = "/param/mute",
    request_body(content = bool, content_type = "application/json"),
    responses(
        (status = "default", description = "CamillaDSP cannot be reached, or refused", body = ErrorBody),
    )
)]
pub async fn set_mute(State(app): Shared, Json(mute): Json<bool>) -> ApiResult<NoContent> {
    app.camilla.set_mute(mute).await?;
    Ok(NoContent)
}

/// Every fader, the main volume first, then the aux faders from 1 up.
#[utoipa::path(
    get,
    path = "/param/faders",
    responses(
        (status = "default", description = "CamillaDSP cannot be reached, or refused", body = ErrorBody),
    )
)]
pub async fn get_faders(State(app): Shared) -> ApiResult<Reply<Vec<Fader>>> {
    Ok(Reply(app.camilla.faders().await?))
}

/// Set the volume of a fader, in dB.
#[utoipa::path(
    post,
    path = "/param/faders/{index}/volume",
    params(("index" = usize, Path, description = "The fader, 0 for the main volume")),
    request_body(content = f32, content_type = "application/json"),
    responses(
        (status = "default", description = "CamillaDSP cannot be reached, or refused", body = ErrorBody),
    )
)]
pub async fn set_fader_volume(
    State(app): Shared,
    UrlPath(index): UrlPath<usize>,
    Json(volume): Json<f32>,
) -> ApiResult<NoContent> {
    app.camilla.set_fader_volume(index, volume).await?;
    Ok(NoContent)
}

/// Mute or unmute a fader.
#[utoipa::path(
    post,
    path = "/param/faders/{index}/mute",
    params(("index" = usize, Path, description = "The fader, 0 for the main volume")),
    request_body(content = bool, content_type = "application/json"),
    responses(
        (status = "default", description = "CamillaDSP cannot be reached, or refused", body = ErrorBody),
    )
)]
pub async fn set_fader_mute(
    State(app): Shared,
    UrlPath(index): UrlPath<usize>,
    Json(mute): Json<bool>,
) -> ApiResult<NoContent> {
    app.camilla.set_fader_mute(index, mute).await?;
    Ok(NoContent)
}

// ── Coefficients ───────────────────────────────────────────────────────────

#[derive(Deserialize, ToSchema)]
pub struct CoeffsRequest {
    /// The parameters of a Raw or Wav Conv filter, with the file path as the
    /// GUI has it.
    parameters: ConvParameters,
    /// For the `$samplerate$` token in the file name.
    samplerate: usize,
    /// For the `$channels$` token in the file name.
    channels: usize,
}

/// The coefficients of a Conv filter that reads them from a file, and which
/// samplerate and channel variants of that file exist. The GUI evaluates
/// filters itself; this exists because only the server can reach the files.
///
/// Not JSON: a little endian u32 giving the length of a JSON `CoeffsHeader`,
/// that header, padding to the next multiple of 8, and then the samples, in
/// the width the header gives.
#[utoipa::path(
    post,
    path = "/convcoeffs",
    responses(
        (status = 400, description = "The filter reads no file, or the file could not be read", body = ErrorBody),
        (status = 403, description = "The file is outside the configured folders", body = ErrorBody),
        (status = 404, description = "There is no such file", body = ErrorBody),
    )
)]
pub async fn conv_coefficients(
    State(app): Shared,
    Json(request): Json<CoeffsRequest>,
) -> ApiResult<Binary> {
    let CoeffsRequest {
        mut parameters,
        samplerate,
        channels,
    } = request;
    blocking(move || {
        let filename = match &mut parameters {
            ConvParameters::Raw(raw) => &mut raw.filename,
            ConvParameters::Wav(wav) => &mut wav.filename,
            _ => {
                return Err(bad_request(
                    "Only a Raw or Wav Conv filter reads a coefficient file",
                ));
            }
        };
        if filename.is_empty() {
            return Err(bad_request("Conv filter has no coefficient file name"));
        }
        let settings = &app.settings;
        if !settings.allow_absolute_paths
            && !paths::path_is_safe(
                filename,
                Some(&settings.coeff_dir),
                Some(&settings.config_dir),
            )
        {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                format!(
                    "Coeff path '{filename}' is outside the configured coeff_dir. \
                     Set allow_absolute_paths: true in camillagui.yml to allow this."
                ),
            ));
        }
        let absolute =
            paths::coeff_path_to_absolute(filename, &settings.config_dir, &settings.coeff_dir);
        // The options come from the name as written, tokens and all, so they
        // are collected before the tokens are replaced. They are the files next
        // to it, which is not coeff_dir when the path has a folder in it.
        let folder = Path::new(&absolute).parent().unwrap_or(&settings.coeff_dir);
        let file_names = files::list_file_names(folder);
        let options = coeffs::filter_plot_options(&file_names, &absolute);
        *filename = coeffs::replace_tokens(&absolute, samplerate, channels);
        if !Path::new(filename.as_str()).is_file() {
            return Err(not_found("Filter coefficient file not found"));
        }
        let (values, as_f32) = coeffs::read_coefficients(&parameters).map_err(bad_request)?;
        Ok(Binary::new(coeffs::frame_coefficients(
            options, &values, as_f32,
        )))
    })
    .await
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct WavInfoQuery {
    /// A file name in audiofiles_dir, or a path.
    filename: String,
}

/// The header of a wav file.
#[utoipa::path(
    get,
    path = "/wavinfo",
    params(WavInfoQuery),
    responses(
        (status = 403, description = "The file is outside audiofiles_dir", body = ErrorBody),
        (status = 404, description = "The file is not a wav file CamillaDSP can read", body = ErrorBody),
    )
)]
pub async fn get_wav_info(
    State(app): Shared,
    Query(query): Query<WavInfoQuery>,
) -> ApiResult<Reply<WavInfo>> {
    let WavInfoQuery { filename } = query;
    let audiofiles_dir = app.audiofiles_dir();
    if !app.settings.allow_absolute_paths
        && !paths::path_is_safe(&filename, audiofiles_dir, audiofiles_dir)
    {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            format!(
                "Audio path '{filename}' is outside the configured audiofiles_dir. \
                 Set allow_absolute_paths: true in camillagui.yml to allow this."
            ),
        ));
    }
    // A bare name is a file in audiofiles_dir, where the DSP will look for it too.
    let path = match audiofiles_dir {
        Some(dir) => PathBuf::from(paths::make_absolute(&filename, dir)),
        None => PathBuf::from(&filename),
    };
    blocking(move || match wav::read_info(&path) {
        Some(info) => Ok(Reply(info)),
        None => Err(not_found(format!(
            "'{filename}' is not a wav file CamillaDSP can read"
        ))),
    })
    .await
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct CoeffDefaultsQuery {
    /// The coefficient file, relative to config_dir.
    file: String,
}

/// Sensible parameters for a Conv filter reading a coefficient file, from
/// the file's extension.
#[utoipa::path(get, path = "/defaultsforcoeffs", params(CoeffDefaultsQuery))]
pub async fn get_defaults_for_coeffs(
    State(app): Shared,
    Query(query): Query<CoeffDefaultsQuery>,
) -> Reply<CoeffDefaults> {
    let absolute = paths::make_absolute(&query.file, &app.settings.config_dir);
    Reply(coeffs::defaults_for_filter(&absolute))
}

// ── The active config ──────────────────────────────────────────────────────

/// The config CamillaDSP runs, null if it has none. The file paths are
/// relative to the configured folders, as for a config file.
#[utoipa::path(
    get,
    path = "/getconfig",
    responses(
        (status = "default", description = "CamillaDSP cannot be reached, or sent a config the GUI \
            cannot read", body = ErrorBody),
    )
)]
pub async fn get_config(State(app): Shared) -> ApiResult<Reply<Option<Configuration>>> {
    let config = match app.camilla.config().await? {
        Some(config) => Some(dsp_config_for_gui(&app, &config).map_err(internal)?),
        None => None,
    };
    Ok(Reply(config))
}

/// The paths in a config from the frontend that are outside the configured
/// folders, none if absolute paths are allowed.
fn paths_outside_folders(app: &AppState, config: &Value) -> Vec<paths::OutsidePath> {
    if app.settings.allow_absolute_paths {
        return Vec::new();
    }
    paths::paths_outside_folders(
        config,
        &app.settings.coeff_dir,
        app.audiofiles_dir(),
        &app.settings.config_dir,
    )
}

/// Refuse a config with paths outside the configured folders, unless
/// absolute paths are allowed.
fn check_config_paths(app: &AppState, config: &Value) -> Result<(), ApiError> {
    let offenders = paths_outside_folders(app, config);
    if offenders.is_empty() {
        return Ok(());
    }
    let list: Vec<String> = offenders
        .iter()
        .map(|p| format!("'{}'", p.filename))
        .collect();
    Err(ApiError::new(
        StatusCode::FORBIDDEN,
        format!(
            "The config contains paths outside the configured directories: {}. \
             Set allow_absolute_paths: true in camillagui.yml to allow this.",
            list.join(", ")
        ),
    ))
}

/// A config from the frontend with every file path made absolute, as
/// CamillaDSP needs it.
fn with_absolute_paths(app: &AppState, mut config: Value) -> Value {
    paths::make_config_filter_paths_absolute(
        &mut config,
        &app.settings.config_dir,
        &app.settings.coeff_dir,
    );
    paths::make_audio_file_paths_absolute(&mut config, app.audiofiles_dir());
    config
}

/// A config from the frontend made ready for CamillaDSP, with every file path
/// absolute. Refused if it has paths outside the configured folders, unless
/// absolute paths are allowed.
fn config_for_dsp(app: &AppState, config: &Configuration) -> Result<Value, ApiError> {
    let config = to_json(config);
    check_config_paths(app, &config)?;
    Ok(with_absolute_paths(app, config))
}

#[derive(Deserialize, ToSchema)]
pub struct ConfigBody {
    /// With the file paths as the GUI has them, relative to the configured folders.
    config: Configuration,
}

/// Apply a config.
#[utoipa::path(
    post,
    path = "/setconfig",
    responses(
        (status = 403, description = "The config has paths outside the configured folders", body = ErrorBody),
        (status = 422, description = "The body is not a config, or CamillaDSP refused it", body = ErrorBody),
        (status = "default", description = "CamillaDSP cannot be reached", body = ErrorBody),
    )
)]
pub async fn set_config(State(app): Shared, Json(body): Json<ConfigBody>) -> ApiResult<NoContent> {
    let config = config_for_dsp(&app, &body.config)?;
    match app.camilla.set_config(&config).await {
        Ok(()) => Ok(NoContent),
        Err(DspError::Command { result, message }) => {
            Err(ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, message).with_result(result))
        }
        Err(err) => Err(err.into()),
    }
}

/// Stop processing.
#[utoipa::path(
    post,
    path = "/stop",
    responses(
        (status = 400, description = "CamillaDSP refused", body = ErrorBody),
        (status = "default", description = "CamillaDSP cannot be reached", body = ErrorBody),
    )
)]
pub async fn stop_processing(State(app): Shared) -> ApiResult<NoContent> {
    match app.camilla.stop().await {
        Ok(()) => Ok(NoContent),
        Err(DspError::Command { result, message }) => Err(bad_request(message).with_result(result)),
        Err(err) => Err(err.into()),
    }
}

/// Check a config without applying it, with the file paths as the GUI has
/// them. Answers every issue, none if the config is valid.
///
/// The body is meant to be a config, but any JSON is taken, since a config
/// that does not parse is reported as an issue like any other. This is the
/// one request body the spec does not take from the handler.
#[utoipa::path(
    post,
    path = "/validateconfig",
    request_body = Configuration,
    responses(
        (status = "default", description = "The body is not JSON", body = ErrorBody),
    )
)]
pub async fn validate_config(
    State(app): Shared,
    Json(config): Json<Value>,
) -> ApiResult<Reply<Vec<ValidationIssue>>> {
    // A path that setconfig would refuse is an error here, and is blanked so
    // that validation does not open the file.
    let outside = paths_outside_folders(&app, &config);
    let mut config = with_absolute_paths(&app, config);
    for offender in &outside {
        if let Some(filename) = paths::value_at_mut(&mut config, &offender.location) {
            *filename = Value::String(String::new());
        }
    }
    let types = app.device_types();
    // Validation reads every coefficient file, which can take a while.
    let mut issues = blocking(move || Ok(validate::validate(config, &types))).await?;
    for offender in outside {
        let path: Vec<PathElement> = offender.location.iter().map(PathElement::from).collect();
        // Whatever validation said about the blanked name.
        issues.retain(|issue| issue.path != path);
        issues.push(ValidationIssue {
            path,
            message: format!(
                "The path '{}' is outside the configured directories. \
                 Set allow_absolute_paths: true in camillagui.yml to allow this.",
                offender.filename
            ),
        });
    }
    log::debug!("Validated config: {issues:?}");
    Ok(Reply(issues))
}

// ── Config files ───────────────────────────────────────────────────────────

enum ReadError {
    NotFound,
    Unreadable(String),
    /// Not YAML, or not a config the GUI can use.
    Invalid(String),
}

impl ReadError {
    fn message(&self) -> String {
        match self {
            ReadError::NotFound => "File not found".to_string(),
            ReadError::Unreadable(msg) | ReadError::Invalid(msg) => msg.clone(),
        }
    }

    /// The error response for a file the frontend asked for by name.
    fn for_file(self, name: &str) -> ApiError {
        match self {
            ReadError::NotFound => not_found(format!("Config file '{name}' not found.")),
            ReadError::Unreadable(msg) => {
                bad_request(format!("Unable to read config file '{name}': {msg}"))
            }
            ReadError::Invalid(msg) => bad_request(msg),
        }
    }
}

fn read_yaml_file(path: &Path) -> Result<yaml::Parsed, ReadError> {
    let text = std::fs::read_to_string(path).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => ReadError::NotFound,
        _ => ReadError::Unreadable(err.to_string()),
    })?;
    yaml::parse(&text).map_err(|err| ReadError::Invalid(err.to_string()))
}

/// Refuse YAML that had NaN or infinity in it. JSON cannot carry those, and
/// CamillaDSP accepts neither.
fn check_finite(parsed: &yaml::Parsed) -> Result<(), String> {
    if parsed.nonfinite.is_empty() {
        Ok(())
    } else {
        Err(yaml::nonfinite_message(&parsed.nonfinite))
    }
}

/// A config read from a file, as the GUI wants it, migrated first if it is for
/// an older CamillaDSP. It only has to parse, any errors left in it are fixed
/// in the GUI.
fn config_for_gui(app: &AppState, parsed: yaml::Parsed) -> Result<Configuration, String> {
    check_finite(&parsed)?;
    let mut config = parsed.value;
    legacy::migrate_if_older(&mut config);
    with_relative_paths(app, config)
}

/// The config CamillaDSP runs, as the GUI wants it, the same as for a file.
fn dsp_config_for_gui(app: &AppState, config: &Configuration) -> Result<Configuration, String> {
    with_relative_paths(app, to_json(config))
}

/// A config as the GUI wants it: optional fields filled in, coefficient files
/// in coeff_dir as bare names and the rest relative to config_dir, and audio
/// files in audiofiles_dir relative to it.
fn with_relative_paths(app: &AppState, mut config: Value) -> Result<Configuration, String> {
    paths::make_config_filter_paths_relative(
        &mut config,
        &app.settings.config_dir,
        &app.settings.coeff_dir,
    );
    paths::make_audio_file_paths_relative(&mut config, app.audiofiles_dir());
    validate::parse(config)
}

fn read_config_for_gui(app: &AppState, path: &Path) -> Result<Configuration, ReadError> {
    config_for_gui(app, read_yaml_file(path)?).map_err(ReadError::Invalid)
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ConfigFileQuery {
    /// The file name, in config_dir.
    name: String,
}

/// A config file, migrated if it is for an older CamillaDSP, with the file
/// paths relative to the configured folders.
#[utoipa::path(
    get,
    path = "/getconfigfile",
    params(ConfigFileQuery),
    responses(
        (status = 400, description = "The file is not a config the GUI can use", body = ErrorBody),
        (status = 404, description = "There is no such file", body = ErrorBody),
    )
)]
pub async fn get_config_file(
    State(app): Shared,
    Query(query): Query<ConfigFileQuery>,
) -> ApiResult<Reply<Configuration>> {
    let ConfigFileQuery { name } = query;
    let path = file_in_folder(&app.settings.config_dir, &name).map_err(bad_request)?;
    blocking(move || {
        let config = read_config_for_gui(&app, &path).map_err(|err| err.for_file(&name))?;
        Ok(Reply(config))
    })
    .await
}

/// The default config file, `default_config` in the settings, with the file
/// paths relative to the configured folders.
#[utoipa::path(
    get,
    path = "/getdefaultconfigfile",
    responses(
        (status = 404, description = "No default config is set, or the file is missing", body = ErrorBody),
        (status = 500, description = "The file is not a config the GUI can use", body = ErrorBody),
    )
)]
pub async fn get_default_config_file(State(app): Shared) -> ApiResult<Reply<Configuration>> {
    let Some(path) = app.settings.default_config.clone().filter(|p| p.is_file()) else {
        return Err(not_found("No default config"));
    };
    blocking(move || {
        let config = read_config_for_gui(&app, &path).map_err(|err| {
            log::error!(
                "Failed to get default config file, error: {}",
                err.message()
            );
            internal(err.message())
        })?;
        Ok(Reply(config))
    })
    .await
}

#[derive(Deserialize, ToSchema)]
pub struct SaveConfigBody {
    /// With the file paths as the GUI has them, relative to the configured folders.
    config: Configuration,
    /// The file name, in config_dir.
    filename: String,
}

/// Save a config to a file in config_dir, with absolute paths so that
/// CamillaDSP can use it at startup without the GUI.
#[utoipa::path(
    post,
    path = "/saveconfigfile",
    responses(
        (status = 400, description = "The file name is not valid", body = ErrorBody),
        (status = 403, description = "The config has paths outside the configured folders", body = ErrorBody),
        (status = "default", description = "The file could not be written", body = ErrorBody),
    )
)]
pub async fn save_config_file(
    State(app): Shared,
    Json(body): Json<SaveConfigBody>,
) -> ApiResult<NoContent> {
    let SaveConfigBody { config, filename } = body;
    let config = config_for_dsp(&app, &config)?;
    let path = file_in_folder(&app.settings.config_dir, &filename).map_err(bad_request)?;
    blocking(move || {
        std::fs::write(&path, yaml::dump(&config))
            .map_err(|err| internal(format!("Could not save {filename}: {err}")))?;
        Ok(NoContent)
    })
    .await
}

// ── Imports ────────────────────────────────────────────────────────────────

/// Part of a config, as an import gives it: any of the sections, with any of
/// the device settings.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ConfigFragment {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub devices: Option<DevicesFragment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub mixers: Option<HashMap<String, Mixer>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub filters: Option<HashMap<String, Filter>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub processors: Option<HashMap<String, Processor>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub pipeline: Option<Vec<PipelineStep>>,
}

/// Any of the device settings, since an import may have only some of them.
/// The fields of camilladsp-schema's `Devices`, every one optional and left
/// out when the import does not have it.
#[derive(Debug, Default, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DevicesFragment {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<usize>, minimum = 1, nullable = false)]
    pub samplerate: Option<NonZeroUsize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<usize>, minimum = 1, nullable = false)]
    pub chunksize: Option<NonZeroUsize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub queuelimit: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub silence_threshold: Option<FiniteF64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub silence_timeout_s: Option<FiniteF64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub capture: Option<CaptureDevice>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub playback: Option<PlaybackDevice>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub enable_rate_adjust: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub target_level: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub adjust_interval_s: Option<FiniteF32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub resampler: Option<Resampler>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<usize>, minimum = 1, nullable = false)]
    pub capture_samplerate: Option<NonZeroUsize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub stop_on_rate_change: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub rate_measure_interval_s: Option<FiniteF32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub volume_ramp_time_ms: Option<FiniteF32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub volume_limit: Option<FiniteF32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub multithreaded: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub worker_threads: Option<usize>,
}

impl ConfigFragment {
    /// Parse a fragment, with the optional fields filled in, or say where it
    /// went wrong.
    fn parse(value: Value) -> Result<Self, String> {
        serde_path_to_error::deserialize(value).map_err(|err| {
            let path = err.path().to_string();
            if path == "." {
                err.into_inner().to_string()
            } else {
                format!("{path}: {}", err.into_inner())
            }
        })
    }
}

#[derive(Deserialize, ToSchema)]
pub struct ImportText {
    /// The text of the file to import from.
    text: String,
}

/// Read a YAML file to import from, which may be just part of a config,
/// migrating it from older versions of CamillaDSP if needed.
#[utoipa::path(
    post,
    path = "/ymltojson",
    responses(
        (status = 400, description = "The text is not YAML, or not part of a config", body = ErrorBody),
    )
)]
pub async fn yaml_to_json(Json(body): Json<ImportText>) -> ApiResult<Reply<ConfigFragment>> {
    let parsed = yaml::parse(&body.text).map_err(|err| bad_request(err.to_string()))?;
    check_finite(&parsed).map_err(bad_request)?;
    let mut loaded = parsed.value;
    legacy::migrate_if_older(&mut loaded);
    let fragment = ConfigFragment::parse(loaded).map_err(bad_request)?;
    Ok(Reply(fragment))
}

/// Translate a Convolver config.
#[utoipa::path(
    post,
    path = "/convolvertojson",
    responses(
        (status = 400, description = "The text is not a Convolver config", body = ErrorBody),
    )
)]
pub async fn translate_convolver_to_json(
    Json(body): Json<ImportText>,
) -> ApiResult<Reply<ConfigFragment>> {
    let translated = convolver::translate(&body.text).map_err(bad_request)?;
    let fragment = ConfigFragment::parse(translated).map_err(bad_request)?;
    Ok(Reply(fragment))
}

#[derive(Deserialize, ToSchema)]
pub struct EqApoImport {
    /// The text of the Equalizer APO config.
    text: String,
    /// The number of channels, which decides what the channel names map to.
    channels: i64,
}

/// Translate an Equalizer APO config.
#[utoipa::path(
    post,
    path = "/eqapotojson",
    responses(
        (status = "default", description = "The body is not valid", body = ErrorBody),
    )
)]
pub async fn translate_eqapo_to_json(
    Json(body): Json<EqApoImport>,
) -> ApiResult<Reply<ConfigFragment>> {
    let translated = eqapo::EqApo::new(body.channels).translate(&body.text);
    let fragment = ConfigFragment::parse(translated).map_err(bad_request)?;
    Ok(Reply(fragment))
}

// ── Startup and the active config file ─────────────────────────────────────

async fn is_online(camilla: &CamillaClient) -> bool {
    camilla.state().await.is_ok()
}

/// Run a shell command, like `os.popen` and `os.system`.
async fn run_shell(command: &str) -> std::io::Result<String> {
    run_shell_with_arg(command, None).await
}

/// Run a shell command, with `arg` as `$1` on Unix. cmd has no positional
/// arguments, so on Windows `arg` must already be in `command`.
async fn run_shell_with_arg(command: &str, arg: Option<&str>) -> std::io::Result<String> {
    #[cfg(windows)]
    let mut cmd = {
        debug_assert!(arg.is_none(), "cmd has no positional arguments");
        let mut cmd = tokio::process::Command::new("cmd");
        cmd.raw_arg(cmd_arguments(command));
        cmd
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut cmd = tokio::process::Command::new("sh");
        cmd.arg("-c").arg(command).arg("sh").args(arg);
        cmd
    };
    let output = cmd.output().await?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// The arguments for cmd that run `command` as it is written.
///
/// They go on the command line raw, since the usual argv quoting would turn
/// the quotes in `command` into `\"`, which cmd does not understand. With `/S`,
/// cmd strips the first and last quote and runs what is between them, whatever
/// quotes `command` has of its own.
#[cfg_attr(not(windows), allow(dead_code))]
fn cmd_arguments(command: &str) -> String {
    format!("/S /C \"{command}\"")
}

/// Quote a path for a cmd command line, so cmd passes it on as one argument
/// and expands nothing in it.
///
/// Inside quotes cmd still expands `%NAME%`, and `%CMDCMDLINE%` expands to a
/// text with quotes in it, which would end the quoting early. So the quotes
/// are escaped too, and cmd sees no quoted part at all: every character that
/// means anything to it gets a `^`, which cmd removes when it runs the command.
/// A `^` in front of each `%` also leaves no variable name for cmd to expand,
/// since every name would end with `^`.
fn cmd_quote(path: &str) -> String {
    let mut quoted = String::from("^\"");
    for c in path.chars() {
        if matches!(c, '(' | ')' | '%' | '!' | '^' | '"' | '<' | '>' | '&' | '|') {
            quoted.push('^');
        }
        quoted.push(c);
    }
    quoted.push_str("^\"");
    quoted
}

/// Run the on_set_active_config command, with `{}` standing for the quoted
/// config path.
///
/// On Unix the path is passed to `sh` as `$1` and `{}` becomes `"$1"`, so the
/// shell never parses the file name and `$(...)` in it stays text. On Windows
/// the path is quoted in place, see `cmd_quote`.
async fn run_on_set_active_config(template: &str, path: &str) -> std::io::Result<String> {
    log::debug!("Running command: {template}, with path '{path}'");
    if cfg!(windows) {
        run_shell(&template.replace("{}", &cmd_quote(path))).await
    } else {
        run_shell_with_arg(&template.replace("{}", "\"$1\""), Some(path)).await
    }
}

/// The file name of the active config, if it is in config_dir.
async fn active_config_name(app: &AppState) -> Option<String> {
    let settings = &app.settings;
    if let Some(on_get) = &settings.on_get_active_config {
        log::debug!("Running command: {on_get}");
        return match run_shell(on_get).await {
            Ok(output) => {
                let result = output.trim();
                log::debug!("Command result: {result}");
                files::verify_path_in_config_dir(Some(result), &settings.config_dir)
            }
            Err(err) => {
                log::error!("Failed to run on_get_active_config command: {err}");
                None
            }
        };
    }
    if is_online(&app.camilla).await {
        if matches!(app.camilla.state_file_path().await, Ok(Some(_))) {
            let path = app.camilla.config_file_path().await.ok().flatten();
            let name = files::verify_path_in_config_dir(path.as_deref(), &settings.config_dir);
            log::debug!("Config path from statefile: {name:?}");
            return name;
        }
        log::error!(
            "CamillaDSP runs without state file and is unable to persistently store config file path"
        );
        return None;
    }
    if let Some(statefile) = &settings.statefile_path {
        log::debug!("Getting config from statefile: {}", statefile.display());
        let statefile = statefile.clone();
        let config_dir = settings.config_dir.clone();
        return blocking(move || {
            let path = files::read_statefile_config_path(&statefile);
            Ok(files::verify_path_in_config_dir(
                path.as_deref(),
                &config_dir,
            ))
        })
        .await
        .ok()
        .flatten();
    }
    log::error!(
        "The backend config has no state file and is unable to persistently store config file path"
    );
    None
}

/// Persistently make a config file the active one.
async fn set_active_config_path(app: &AppState, path: &str) -> Result<(), ApiError> {
    let settings = &app.settings;
    if !is_online(&app.camilla).await {
        match &settings.statefile_path {
            Some(statefile) => {
                log::debug!("Update config file path in statefile to '{path}'");
                let (statefile, path) = (statefile.clone(), path.to_string());
                let written = tokio::task::spawn_blocking(move || {
                    files::update_statefile_config_path(&statefile, &path)
                })
                .await;
                match written {
                    Ok(Err(err)) => log::error!("{err}"),
                    Err(err) => log::error!("{err}"),
                    Ok(Ok(())) => {}
                }
            }
            None => log::error!(
                "The backend config has no state file and is unable to persistently store config file path"
            ),
        }
    } else if matches!(app.camilla.state_file_path().await, Ok(Some(_))) {
        log::debug!("Send set config file path command with '{path}'");
        app.camilla.set_config_file_path(path.to_string()).await?;
    } else {
        log::error!(
            "CamillaDSP runs without state file and is unable to persistently store config file path"
        );
    }
    if let Some(on_set) = &settings.on_set_active_config
        && let Err(err) = run_on_set_active_config(on_set, path).await
    {
        log::error!("Failed to run on_set_active_config command: {err}");
    }
    Ok(())
}

#[derive(Serialize, ToSchema)]
pub struct ActiveConfigFile {
    /// The file name of the active config, null when there is none, or it is
    /// not in config_dir.
    #[schema(required)]
    config_file_name: Option<String>,
}

/// The active config file, the one CamillaDSP loads when it starts.
#[utoipa::path(get, path = "/getactiveconfigfilename")]
pub async fn get_active_config_name(State(app): Shared) -> Reply<ActiveConfigFile> {
    let config_file_name = active_config_name(&app).await;
    Reply(ActiveConfigFile { config_file_name })
}

#[derive(Deserialize, ToSchema)]
pub struct ActiveConfigBody {
    /// The file name, in config_dir.
    name: String,
}

/// Make a config file the active one, the one CamillaDSP loads when it
/// starts.
#[utoipa::path(
    post,
    path = "/setactiveconfigfile",
    responses(
        (status = 400, description = "The file name is not valid", body = ErrorBody),
        (status = "default", description = "CamillaDSP refused", body = ErrorBody),
    )
)]
pub async fn set_active_config_name(
    State(app): Shared,
    Json(body): Json<ActiveConfigBody>,
) -> ApiResult<NoContent> {
    let path = file_in_folder(&app.settings.config_dir, &body.name).map_err(bad_request)?;
    set_active_config_path(&app, &paths::to_string(&path)).await?;
    Ok(NoContent)
}

/// Where the config the GUI starts with came from.
#[derive(Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ConfigSource {
    /// The config CamillaDSP runs.
    Dsp,
    /// The active config file.
    Active,
    /// The default config file.
    Default,
}

#[derive(Serialize, ToSchema)]
pub struct StartConfig {
    pub config: Configuration,
    pub source: ConfigSource,
    /// The file the config came from, null if it is not known.
    #[schema(required)]
    pub config_file_name: Option<String>,
}

/// The config to load into the GUI when it starts: the one in CamillaDSP if
/// there is one, otherwise the active config file, otherwise the default one.
#[utoipa::path(
    get,
    path = "/getstartconfig",
    responses(
        (status = 404, description = "There is no config to start with", body = ErrorBody),
        (status = 500, description = "No config file could be read", body = ErrorBody),
    )
)]
pub async fn get_config_at_gui_start(State(app): Shared) -> ApiResult<Reply<StartConfig>> {
    // An unreadable config is logged by the client.
    let dsp_config = match app.camilla.config().await {
        Ok(Some(config)) => dsp_config_for_gui(&app, &config)
            .inspect_err(|err| log::error!("Failed to read the config from CamillaDSP: {err}"))
            .ok(),
        _ => None,
    };
    if let Some(config) = dsp_config {
        let mut name = active_config_name(&app).await;
        if name.is_none() {
            name = app
                .camilla
                .config_file_path()
                .await
                .ok()
                .flatten()
                .map(|path| paths::basename(&path))
                .filter(|n| !n.is_empty());
        }
        return Ok(Reply(StartConfig {
            config,
            source: ConfigSource::Dsp,
            config_file_name: name,
        }));
    }

    let settings = &app.settings;
    let mut candidates = Vec::new();
    if let Some(active) = active_config_name(&app).await {
        let path = settings.config_dir.join(&active);
        if path.is_file() {
            candidates.push((path, ConfigSource::Active, active));
        }
    }
    if let Some(default) = settings.default_config.as_ref().filter(|p| p.is_file()) {
        let name = paths::basename(&paths::to_string(default));
        candidates.push((default.clone(), ConfigSource::Default, name));
    }
    if candidates.is_empty() {
        return Err(not_found("No active or default config"));
    }
    blocking(move || {
        let mut first_error = None;
        for (path, source, name) in candidates {
            let config = read_yaml_file(&path).and_then(|parsed| {
                if legacy::identify_version(&parsed.value) != Some(legacy::CURRENT_VERSION) {
                    return Ok(None);
                }
                config_for_gui(&app, parsed)
                    .map(Some)
                    .map_err(ReadError::Invalid)
            });
            match config {
                Err(err) => {
                    log::error!(
                        "Failed to get startup config from file {}, error: {}",
                        path.display(),
                        err.message()
                    );
                    first_error.get_or_insert(err.message());
                }
                Ok(Some(config)) => {
                    return Ok(Reply(StartConfig {
                        config,
                        source,
                        config_file_name: Some(name),
                    }));
                }
                Ok(None) => {
                    log::warn!("Ignoring startup config {name}, not valid for current GUI version");
                }
            }
        }
        match first_error {
            Some(err) => Err(internal(err)),
            None => Err(not_found(
                "No startup config is valid for the current GUI version",
            )),
        }
    })
    .await
}

// ── File folders ───────────────────────────────────────────────────────────

fn require_audiofiles_dir(app: &AppState) -> Result<PathBuf, ApiError> {
    app.settings
        .audiofiles_dir
        .clone()
        .ok_or_else(|| not_found("audiofiles_dir is not configured"))
}

/// One of the folders the GUI keeps files in.
#[derive(Clone, Copy, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    /// config_dir.
    Config,
    /// coeff_dir.
    Coeff,
    /// audiofiles_dir.
    Audiofile,
}

impl FileKind {
    fn folder(self, app: &AppState) -> Result<PathBuf, ApiError> {
        match self {
            FileKind::Config => Ok(app.settings.config_dir.clone()),
            FileKind::Coeff => Ok(app.settings.coeff_dir.clone()),
            FileKind::Audiofile => require_audiofiles_dir(app),
        }
    }
}

/// The files in a folder, sorted by name.
#[utoipa::path(
    get,
    path = "/files/{kind}",
    params(("kind" = FileKind, Path)),
    responses(
        (status = 404, description = "No audiofiles_dir is set", body = ErrorBody),
    )
)]
pub async fn get_files(
    State(app): Shared,
    UrlPath(kind): UrlPath<FileKind>,
) -> ApiResult<Reply<Vec<FileInfo>>> {
    let folder = kind.folder(&app)?;
    let types = app.device_types();
    blocking(move || {
        let files = match kind {
            FileKind::Config => {
                let settings = &app.settings;
                let context = ConfigContext {
                    config_dir: &settings.config_dir,
                    coeff_dir: &settings.coeff_dir,
                    audiofiles_dir: app.audiofiles_dir(),
                    device_types: &types,
                };
                let details = Details {
                    config: true,
                    ..Default::default()
                };
                files::list_files(&folder, details, Some(&context))
            }
            FileKind::Coeff => {
                let mut files = files::list_files(&folder, Details::default(), None);
                app.coeff_details.fill(&folder, &mut files);
                files
            }
            FileKind::Audiofile => {
                let details = Details {
                    wav: true,
                    ..Default::default()
                };
                files::list_files(&folder, details, None)
            }
        };
        Ok(Reply(files))
    })
    .await
}

/// A fingerprint of each folder, as an opaque string that changes whenever a
/// file in the folder is added, removed, renamed or rewritten.
#[derive(Debug, Serialize, ToSchema)]
pub struct FolderFingerprints {
    pub config: String,
    pub coeff: String,
    /// Left out when no audiofiles_dir is set.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    pub audiofile: Option<String>,
}

/// The fingerprints of the folders, for noticing changes made behind the GUI's
/// back. Polling these is cheap, since only the file names, sizes and times
/// are read, so a folder is listed again only when it changed.
///
/// A poll rather than an event stream, since a browser has only six
/// connections to the backend for all its tabs, and an open stream holds one.
#[utoipa::path(get, path = "/files/fingerprints")]
pub async fn get_file_fingerprints(State(app): Shared) -> ApiResult<Reply<FolderFingerprints>> {
    blocking(move || {
        let of = |folder: &Path| format!("{:016x}", files::fingerprint(folder));
        let settings = &app.settings;
        Ok(Reply(FolderFingerprints {
            config: of(&settings.config_dir),
            coeff: of(&settings.coeff_dir),
            audiofile: settings.audiofiles_dir.as_deref().map(of),
        }))
    })
    .await
}

/// Files to upload, as `multipart/form-data`.
#[derive(ToSchema)]
#[allow(dead_code, reason = "only describes the form in the spec")]
pub struct UploadForm {
    /// The files, each with its file name. A file of the same name is
    /// replaced.
    #[schema(value_type = Vec<String>, format = Binary)]
    files: Vec<Vec<u8>>,
}

/// The hidden name an upload of `filename` is written to before it is renamed
/// into place. The process id and a counter keep it unique, also when two
/// backends share a folder.
fn partial_name(filename: &str) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!(".{filename}.{}.{n}.part", std::process::id())
}

/// Write one uploaded file to `path`, which must not exist. Coefficient and audio files are streamed
/// to disk as they arrive, configs are read whole to sanitize them.
async fn save_upload(
    kind: FileKind,
    mut field: axum::extract::multipart::Field<'_>,
    path: &Path,
    filename: &str,
) -> Result<(), ApiError> {
    let read_error = |err: axum::extract::multipart::MultipartError| bad_request(err.to_string());
    let write_error = |err: std::io::Error| internal(format!("Could not save {filename}: {err}"));
    let mut create = tokio::fs::OpenOptions::new();
    create.write(true).create_new(true);
    if let FileKind::Config = kind {
        let data = field.bytes().await.map_err(read_error)?;
        let content = files::sanitize_uploaded_config(&data);
        let mut file = create.open(path).await.map_err(write_error)?;
        file.write_all(&content).await.map_err(write_error)?;
        return file.flush().await.map_err(write_error);
    }
    let mut file = create.open(path).await.map_err(write_error)?;
    while let Some(chunk) = field.chunk().await.map_err(read_error)? {
        file.write_all(&chunk).await.map_err(write_error)?;
    }
    file.flush().await.map_err(write_error)
}

/// Store files in a folder. Uploaded configs have their coefficient and audio
/// file paths reduced to bare file names, so that configs from other machines
/// work here.
#[utoipa::path(
    post,
    path = "/files/{kind}/upload",
    params(("kind" = FileKind, Path)),
    request_body(content = UploadForm, content_type = "multipart/form-data"),
    responses(
        (status = 400, description = "A file name is not valid", body = ErrorBody),
        (status = 404, description = "No audiofiles_dir is set", body = ErrorBody),
        (status = 500, description = "The folder does not exist, or a file could not be written", body = ErrorBody),
    )
)]
pub async fn upload_files(
    State(app): Shared,
    UrlPath(kind): UrlPath<FileKind>,
    Multipart(mut multipart): Multipart,
) -> ApiResult<NoContent> {
    let folder = kind.folder(&app)?;
    files::require_directory(&folder).map_err(internal)?;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|err| bad_request(err.to_string()))?
    {
        if field.name() != Some("files") {
            continue;
        }
        let filename = field.file_name().unwrap_or_default().to_string();
        let path = file_in_folder(&folder, &filename).map_err(bad_request)?;
        // Written to a hidden file next to it and renamed into place when
        // complete, so a failed upload leaves an existing file as it was.
        // The name is unique per upload, so concurrent uploads of one file
        // do not write into each other's partial file.
        let partial = file_in_folder(&folder, &partial_name(&filename)).map_err(bad_request)?;
        let mut saved = save_upload(kind, field, &partial, &filename).await;
        if saved.is_ok() {
            saved = tokio::fs::rename(&partial, &path)
                .await
                .map_err(|err| internal(format!("Could not save {filename}: {err}")));
        }
        if saved.is_err() {
            let _ = tokio::fs::remove_file(&partial).await;
        }
        saved?;
    }
    Ok(NoContent)
}

#[derive(Deserialize, ToSchema)]
pub struct FileNames {
    /// File names, in the folder.
    names: Vec<String>,
}

/// Delete files from a folder.
#[utoipa::path(
    post,
    path = "/files/{kind}/delete",
    params(("kind" = FileKind, Path)),
    responses(
        (status = 404, description = "No audiofiles_dir is set", body = ErrorBody),
        (status = "default", description = "A file could not be deleted", body = ErrorBody),
    )
)]
pub async fn delete_files(
    State(app): Shared,
    UrlPath(kind): UrlPath<FileKind>,
    Json(body): Json<FileNames>,
) -> ApiResult<NoContent> {
    let folder = kind.folder(&app)?;
    blocking(move || {
        files::delete_files(&folder, &body.names).map_err(internal)?;
        Ok(NoContent)
    })
    .await
}

#[derive(Deserialize, ToSchema)]
pub struct RenameBody {
    /// The file name, in the folder.
    source: String,
    /// The new file name, in the same folder.
    target: String,
}

/// Rename a file in a folder.
#[utoipa::path(
    post,
    path = "/files/{kind}/rename",
    params(("kind" = FileKind, Path)),
    responses(
        (status = 400, description = "A file name is not valid, the new name is taken, or the \
            file could not be renamed", body = ErrorBody),
        (status = 404, description = "No audiofiles_dir is set", body = ErrorBody),
    )
)]
pub async fn rename_file(
    State(app): Shared,
    UrlPath(kind): UrlPath<FileKind>,
    Json(body): Json<RenameBody>,
) -> ApiResult<NoContent> {
    let folder = kind.folder(&app)?;
    blocking(move || {
        files::rename_file(&folder, &body.source, &body.target).map_err(bad_request)?;
        Ok(NoContent)
    })
    .await
}

/// Some of the files in a folder, as a zip file to save.
///
/// The body is a form, as the browser posts it, so that the browser saves
/// the zip as it arrives. The zip is made as it is sent. The files are
/// checked first, and an error after the zip started cuts it short.
#[utoipa::path(
    post,
    path = "/files/{kind}/zip",
    params(("kind" = FileKind, Path)),
    responses(
        (status = 400, description = "A file name is not valid, or a file could not be read",
            body = ErrorBody),
        (status = 404, description = "No audiofiles_dir is set", body = ErrorBody),
    )
)]
pub async fn zip_files(
    State(app): Shared,
    UrlPath(kind): UrlPath<FileKind>,
    Form(body): Form<FileNames>,
) -> ApiResult<Binary> {
    let folder = kind.folder(&app)?;
    let files =
        blocking(move || files::files_to_zip(&folder, &body.names).map_err(bad_request)).await?;
    let (zip_name, method) = match kind {
        FileKind::Config => ("configs.zip", zip::CompressionMethod::Deflated),
        FileKind::Coeff => ("coeffs.zip", zip::CompressionMethod::Deflated),
        FileKind::Audiofile => ("audiofiles.zip", zip::CompressionMethod::Stored),
    };
    let (mut writer, body) = BodyWriter::new();
    tokio::task::spawn_blocking(move || {
        if let Err(err) = files::write_zip(&files, method, &mut writer) {
            log::warn!("The download of {zip_name} stopped: {err}");
            writer.fail(err);
        }
    });
    Ok(Binary::attachment(body, zip_name))
}

// ── GUI settings and the log ───────────────────────────────────────────────

/// The GUI settings: `gui-config.yml`, and the few settings from
/// `camillagui.yml` that the frontend needs.
#[utoipa::path(get, path = "/guiconfig")]
pub async fn get_gui_config(State(app): Shared) -> Reply<GuiConfig> {
    let config = settings::gui_config(&app.settings);
    log::debug!("GUI config: {config:?}");
    Reply(config)
}

/// CamillaDSP's log file, `log_file` in the settings.
#[utoipa::path(
    get,
    path = "/logfile",
    responses(
        (status = 404, description = "No log file is set, or it cannot be read", body = ErrorBody),
    )
)]
pub async fn get_log_file(State(app): Shared) -> ApiResult<Text> {
    let Some(path) = app.settings.log_file.as_deref() else {
        return Err(not_found("Please configure a valid 'log_file' path"));
    };
    match tokio::fs::read_to_string(settings::expand_home(Path::new(path))).await {
        Ok(text) => Ok(Text(text)),
        Err(err) => {
            log::error!("Unable to read logfile at {path}: {err}");
            Err(not_found(format!(
                "Please configure CamillaDSP to log to: {path}"
            )))
        }
    }
}

// ── Devices ────────────────────────────────────────────────────────────────

/// Which side of CamillaDSP a device is on.
#[derive(Clone, Copy, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Capture,
    Playback,
}

/// A device CamillaDSP can use.
#[derive(Serialize, ToSchema)]
pub struct AvailableDevice {
    /// What a config calls it.
    name: String,
    /// A readable name.
    description: String,
}

/// The devices of a device type, or the ones read earlier while CamillaDSP
/// cannot be reached.
#[utoipa::path(
    get,
    path = "/devices/{direction}/{backend}",
    params(
        ("direction" = Direction, Path),
        ("backend" = String, Path, description = "The device type, for example `Alsa`"),
    ),
    responses(
        (status = "default", description = "CamillaDSP refused", body = ErrorBody),
    )
)]
pub async fn get_devices(
    State(app): Shared,
    UrlPath((direction, backend)): UrlPath<(Direction, String)>,
) -> ApiResult<Reply<Vec<AvailableDevice>>> {
    let capture = matches!(direction, Direction::Capture);
    let result = if capture {
        app.camilla.capture_devices(&backend).await
    } else {
        app.camilla.playback_devices(&backend).await
    };
    let devices = match result {
        Ok(devices) => devices,
        Err(DspError::Io(_)) => {
            log::debug!("CamillaDSP is offline, returning the {backend} devices from cache");
            app.status
                .device_list(capture, &backend)
                .unwrap_or_default()
        }
        Err(err) => return Err(err.into()),
    };
    let devices: Vec<AvailableDevice> = devices
        .into_iter()
        .map(|(name, description)| AvailableDevice { name, description })
        .collect();
    Ok(Reply(devices))
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct DeviceQuery {
    /// The device, as a config names it.
    device: String,
}

/// The capabilities of a device, or the ones read earlier if CamillaDSP
/// cannot give them now.
#[utoipa::path(
    get,
    path = "/devices/{direction}/{backend}/capabilities",
    params(
        ("direction" = Direction, Path),
        ("backend" = String, Path, description = "The device type, for example `Alsa`"),
        DeviceQuery,
    ),
    responses(
        (status = 400, description = "No device is given, or CamillaDSP refused", body = ErrorBody),
        (status = 503, description = "CamillaDSP cannot be reached", body = ErrorBody),
    )
)]
pub async fn get_device_capabilities(
    State(app): Shared,
    UrlPath((direction, backend)): UrlPath<(Direction, String)>,
    Query(query): Query<DeviceQuery>,
) -> ApiResult<Reply<Arc<AudioDeviceDescriptor>>> {
    let device = query.device;
    if device.is_empty() {
        return Err(bad_request("No device is given"));
    }
    let capture = matches!(direction, Direction::Capture);
    let result = if capture {
        app.camilla
            .capture_device_capabilities(&backend, &device)
            .await
    } else {
        app.camilla
            .playback_device_capabilities(&backend, &device)
            .await
    };
    match result {
        Ok(capabilities) => {
            let capabilities = Arc::new(capabilities);
            app.status
                .store_capabilities(capture, &backend, &device, capabilities.clone());
            Ok(Reply(capabilities))
        }
        Err(err) => match app.status.capabilities(capture, &backend, &device) {
            Some(cached) => {
                log::debug!(
                    "Failed to fetch the capabilities of {backend}/{device}, returning cached data"
                );
                Ok(Reply(cached))
            }
            None => match err {
                DspError::Command { message, .. } => Err(bad_request(message)),
                DspError::Io(message) => Err(unavailable(message)),
            },
        },
    }
}

/// The device types CamillaDSP supports, null until it has been reached. They
/// cannot change while it runs, so this comes from the cache.
#[utoipa::path(get, path = "/backends")]
pub async fn get_backends(State(app): Shared) -> Reply<Option<DeviceTypeLists>> {
    Reply(app.status.device_types())
}

#[cfg(test)]
mod tests {
    use super::*;
    use camilladsp_schema::config::Devices;
    use serde_json::json;

    fn event_parts(query: &str, enable_level_stream: bool) -> Result<events::Parts, ApiError> {
        let uri = format!("/api/events?{query}").parse().unwrap();
        let axum::extract::Query(query) =
            axum::extract::Query::<EventsQuery>::try_from_uri(&uri).expect("the query parses");
        let settings: Settings = serde_json::from_value(json!({
            "config_dir": "configs",
            "coeff_dir": "coeffs",
            "enable_level_stream": enable_level_stream,
            "level_smoothing_ms": 100.0,
            "level_max_update_hz": 30.0,
        }))
        .unwrap();
        query.parts(&settings)
    }

    #[test]
    fn events_query_without_parameters_is_only_the_state() {
        let parts = event_parts("", true).unwrap();
        assert!(parts.levels.is_none());
        assert!(parts.spectrum.is_none());
        let parts = event_parts("levels=false", true).unwrap();
        assert!(parts.levels.is_none());
    }

    #[test]
    fn events_query_asks_for_the_levels_with_the_settings() {
        let levels = event_parts("levels=true", true).unwrap().levels.unwrap();
        assert_eq!(levels.max_rate, 30.0);
        assert_eq!(levels.attack, 10.0);
        assert_eq!(levels.release, 100.0);
    }

    #[test]
    fn events_query_asks_for_the_spectrum() {
        let query = "levels=true&side=capture&channel=1&min_freq=20&max_freq=20000&n_bins=100";
        let parts = event_parts(query, true).unwrap();
        assert!(parts.levels.is_some());
        let spectrum = parts.spectrum.unwrap();
        assert_eq!(spectrum.side, SpectrumSide::Capture);
        assert_eq!(spectrum.channel, Some(1));
        assert_eq!((spectrum.min_freq, spectrum.max_freq), (20.0, 20000.0));
        assert_eq!(spectrum.n_bins, 100);
        assert_eq!(spectrum.max_rate, None);
        // No channel averages them all.
        let query = "side=playback&min_freq=20&max_freq=20000&n_bins=100&max_rate=10";
        let spectrum = event_parts(query, true).unwrap().spectrum.unwrap();
        assert_eq!(spectrum.channel, None);
        assert_eq!(spectrum.max_rate, Some(10.0));
    }

    #[test]
    fn events_query_spectrum_needs_its_range() {
        let err = event_parts("side=playback&min_freq=20&max_freq=20000", true).unwrap_err();
        assert_eq!(err.status, StatusCode::BAD_REQUEST);
        // The parameters mean nothing without a side.
        let parts = event_parts("min_freq=20&max_freq=20000&n_bins=100", true).unwrap();
        assert!(parts.spectrum.is_none());
    }

    #[test]
    fn events_query_has_no_levels_or_spectrum_when_disabled() {
        let query = "levels=true&side=playback&min_freq=20&max_freq=20000&n_bins=100";
        let parts = event_parts(query, false).unwrap();
        assert!(parts.levels.is_none());
        assert!(parts.spectrum.is_none());
        // The query is still checked.
        let err = event_parts("side=playback", false).unwrap_err();
        assert_eq!(err.status, StatusCode::BAD_REQUEST);
    }

    /// Every field of `Devices`, destructured without `..`, so that a field
    /// added in camilladsp-schema fails to compile here until the fragment
    /// has it too.
    fn fragment_of(devices: Devices) -> DevicesFragment {
        let Devices {
            samplerate,
            chunksize,
            queuelimit,
            silence_threshold,
            silence_timeout_s,
            capture,
            playback,
            enable_rate_adjust,
            target_level,
            adjust_interval_s,
            resampler,
            capture_samplerate,
            stop_on_rate_change,
            rate_measure_interval_s,
            volume_ramp_time_ms,
            volume_limit,
            multithreaded,
            worker_threads,
        } = devices;
        DevicesFragment {
            samplerate: Some(samplerate),
            chunksize: Some(chunksize),
            queuelimit,
            silence_threshold,
            silence_timeout_s,
            capture: Some(capture),
            playback: Some(playback),
            enable_rate_adjust,
            target_level,
            adjust_interval_s,
            resampler,
            capture_samplerate,
            stop_on_rate_change,
            rate_measure_interval_s,
            volume_ramp_time_ms,
            volume_limit,
            multithreaded,
            worker_threads,
        }
    }

    #[test]
    fn devices_fragment_has_the_fields_of_devices() {
        let devices = json!({
            "samplerate": 44100,
            "chunksize": 1024,
            "queuelimit": 2,
            "silence_threshold": -60,
            "silence_timeout_s": 3,
            "capture": {"type": "Stdin", "channels": 2, "format": "S16_LE"},
            "playback": {"type": "Stdout", "channels": 2, "format": "S16_LE"},
            "enable_rate_adjust": true,
            "target_level": 512,
            "adjust_interval_s": 5,
            "resampler": {"type": "AsyncPoly", "interpolation": "Cubic"},
            "capture_samplerate": 48000,
            "stop_on_rate_change": true,
            "rate_measure_interval_s": 2,
            "volume_ramp_time_ms": 100,
            "volume_limit": 0,
            "multithreaded": true,
            "worker_threads": 4,
        });
        let full: Devices = serde_json::from_value(devices.clone()).unwrap();
        let fragment: DevicesFragment = serde_json::from_value(devices).unwrap();
        assert_eq!(fragment, fragment_of(full));
    }

    #[test]
    fn devices_fragment_takes_some_settings_and_sends_only_those() {
        let fragment: DevicesFragment =
            serde_json::from_value(json!({"samplerate": 96000})).unwrap();
        assert_eq!(to_json(&fragment), json!({"samplerate": 96000}));
        let unknown = serde_json::from_value::<DevicesFragment>(json!({"samplerat": 96000}));
        assert!(unknown.is_err());
    }

    fn import_eqapo(text: &str) -> Value {
        let translated = eqapo::EqApo::new(2).translate(text);
        to_json(&ConfigFragment::parse(translated).unwrap())
    }

    #[test]
    fn eqapo_import_skips_unknown_channels() {
        let conf = import_eqapo("Channel: 2 C\nFilter: ON HP Fc 30 Hz\n");
        assert_eq!(conf["pipeline"][0]["channels"], json!([1]));
        assert_eq!(conf["pipeline"][0]["names"], json!(["Filter_1"]));
        assert_eq!(conf["filters"]["Filter_1"]["parameters"]["freq"], 30.0);
    }

    #[test]
    fn eqapo_import_skips_filters_with_expressions() {
        let conf = import_eqapo(
            "Filter: ON PK Fc `2*a` Hz Gain 1 dB Q 2\nFilter: ON PK Fc 50 Hz Gain 1 dB Q 2\n\
             Preamp: `a` dB\nDelay: `a` ms\nCopy: L=`a`*R R=R+`a`*L\n",
        );
        let filters = conf["filters"].as_object().unwrap();
        assert_eq!(filters.keys().collect::<Vec<_>>(), ["Filter_1"]);
        assert_eq!(filters["Filter_1"]["parameters"]["freq"], 50.0);
        let mapping = &conf["mixers"]["Copy_1"]["mapping"];
        assert_eq!(mapping.as_array().unwrap().len(), 1);
        assert_eq!(mapping[0]["dest"], 1);
        assert_eq!(mapping[0]["sources"][0]["channel"], 1);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn on_set_active_config_passes_the_path_as_text() {
        let path = "/configs/x$(echo injected)`echo injected`\"; echo injected; \".yml";
        let output = run_on_set_active_config("printf '%s' {}", path)
            .await
            .unwrap();
        assert_eq!(output, path);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn on_set_active_config_without_placeholder() {
        let output = run_on_set_active_config("printf done", "/configs/a.yml")
            .await
            .unwrap();
        assert_eq!(output, "done");
    }

    /// cmd hands a config file name on as text, to its own commands and to
    /// other programs: nothing in it ends the quoting, expands a variable or
    /// runs anything.
    #[cfg(windows)]
    #[tokio::test]
    async fn on_set_active_config_passes_the_path_to_cmd_as_text() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("active.yml");
        let copy = format!(r#"copy /Y {{}} "{}""#, target.display());
        for name in [
            "a b.yml",
            "a&echo injected&.yml",
            "a & echo injected.yml",
            "a|b.yml",
            "%PATH%.yml",
            "%CMDCMDLINE%.yml",
            "a^b^^c.yml",
            "(a) b).yml",
            "a!PATH!.yml",
            "a;b,c=d.yml",
            "a'b`c$d @e.yml",
        ] {
            // `|` cannot be in a Windows file name, so that one is not copied.
            let path = dir.path().join(name);
            let path = path.to_str().unwrap();
            if !name.contains('|') {
                std::fs::write(path, name).unwrap();
                let output = run_on_set_active_config(&copy, path).await.unwrap();
                assert!(!output.contains("injected"), "{name}: {output}");
                assert_eq!(
                    std::fs::read_to_string(&target).unwrap_or_default(),
                    name,
                    "{name}: {output}"
                );
                let output = run_on_set_active_config("findstr /m . {}", path)
                    .await
                    .unwrap();
                assert_eq!(output, format!("{path}\r\n"), "{name}");
            }
            let output = run_on_set_active_config("echo {}", path).await.unwrap();
            assert_eq!(output, format!("\"{path}\"\r\n"), "{name}");
        }
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn on_set_active_config_without_placeholder_in_cmd() {
        let output = run_on_set_active_config("echo done", r"C:\configs\a.yml")
            .await
            .unwrap();
        assert_eq!(output, "done\r\n");
    }

    #[test]
    fn cmd_quote_escapes_what_cmd_would_parse() {
        assert_eq!(
            cmd_quote(r"C:\my configs\a.yml"),
            r#"^"C:\my configs\a.yml^""#
        );
        assert_eq!(
            cmd_quote(r"C:\c\%CMDCMDLINE%&x|y^z(1)!.yml"),
            r#"^"C:\c\^%CMDCMDLINE^%^&x^|y^^z^(1^)^!.yml^""#
        );
    }

    #[test]
    fn cmd_arguments_keep_the_command_as_written() {
        let template = r#""C:\my tools\set.exe" {} & echo done"#;
        let command = template.replace("{}", &cmd_quote(r"C:\c\a b.yml"));
        assert_eq!(
            cmd_arguments(&command),
            r#"/S /C ""C:\my tools\set.exe" ^"C:\c\a b.yml^" & echo done""#
        );
    }
}
