//! The `/api` handlers, each in the OpenAPI spec, and the redirect to the GUI.

use crate::camilla::{CamillaClient, DspError, to_json};
use crate::coeffs::CoeffDefaults;
use crate::events::{self, SubscribeError};
use crate::extract::{Json, Multipart, Path as UrlPath, Query};
use crate::files::{self, ConfigContext, Details, FileInfo};
use crate::paths::{self, file_in_folder};
use crate::settings::{self, GuiConfig, Settings};
use crate::status::Status;
use crate::status::StatusCache;
use crate::validate::{self, DeviceTypeLists, DeviceTypes, Severity, ValidationIssue};
use crate::wav::WavInfo;
use crate::{coeffs, convolver, eqapo, legacy, wav, yaml};
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Redirect, Response};
use camilladsp_config::config::{
    CaptureDevice, Configuration, ConvParameters, Filter, FiniteF32, FiniteF64, Mixer, PathElement,
    PipelineStep, PlaybackDevice, Processor, Resampler,
};
use camilladsp_config::protocol::{
    AudioDeviceDescriptor, Fader, SpectrumData, SpectrumSubscription, StateUpdate, VuLevels,
    VuSubscription,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use utoipa::{IntoParams, ToSchema};

pub struct AppState {
    pub settings: Settings,
    pub camilla: Arc<CamillaClient>,
    pub status: Arc<StatusCache>,
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

const NO_STORE: (header::HeaderName, &str) = (header::CACHE_CONTROL, "no-store");

/// The body of every error response.
#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorBody {
    /// What went wrong, to show to the user.
    pub message: String,
    /// When CamillaDSP refused a command, the name of its error, for example
    /// `ProcessingNotRunningError`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
}

// Describes a binary body in the spec, where a `Vec<u8>` would be an array of
// numbers.
/// Raw bytes, not JSON.
#[derive(ToSchema)]
#[schema(value_type = String, format = Binary)]
#[allow(dead_code, reason = "only describes a body in the spec")]
pub struct Binary(Vec<u8>);

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

type ApiResult = Result<Response, ApiError>;

fn json_response(value: impl serde::Serialize) -> Response {
    ([NO_STORE], axum::Json(value)).into_response()
}

fn text_response(text: impl Into<String>) -> Response {
    ([NO_STORE], text.into()).into_response()
}

fn no_content() -> ApiResult {
    Ok((StatusCode::NO_CONTENT, [NO_STORE]).into_response())
}

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
#[utoipa::path(get, path = "/status", responses((status = 200, body = Status)))]
pub async fn get_status(State(app): Shared) -> Response {
    let status = app.status.refresh(&app.camilla).await;
    json_response(status)
}

/// The processing state, as a stream of `state` events.
///
/// The stream has its own subscription, which ends when the browser closes
/// the stream. It starts with the current state.
#[utoipa::path(
    get,
    path = "/state",
    responses(
        (status = 200, content_type = "text/event-stream", body = StateUpdate,
            description = "A `state` event with the current state, then one for each change"),
        (status = 503, description = "CamillaDSP cannot be reached", body = ErrorBody),
    )
)]
pub async fn get_state(State(app): Shared) -> ApiResult {
    event_stream_response(events::state_stream(&app.camilla).await)
}

/// The VU levels, as a stream of `levels` events.
///
/// The stream has its own subscription, which ends when the browser closes
/// the stream. Smoothing and rate come from the settings.
#[utoipa::path(
    get,
    path = "/levels",
    responses(
        (status = 200, content_type = "text/event-stream", body = VuLevels,
            description = "A `levels` event for each update from CamillaDSP"),
        (status = 503, description = "CamillaDSP cannot be reached, or the level stream is \
            disabled in the settings", body = ErrorBody),
    )
)]
pub async fn get_levels(State(app): Shared) -> ApiResult {
    if !app.settings.enable_level_stream {
        return Err(unavailable("Level stream is disabled"));
    }
    let smoothing_ms = app.settings.level_smoothing_ms.max(0.0) as f32;
    let subscription = VuSubscription {
        max_rate: app.settings.level_max_update_hz.max(0.0) as f32,
        attack: 0.1 * smoothing_ms,
        release: smoothing_ms,
    };
    event_stream_response(events::level_stream(app.camilla.url(), subscription).await)
}

/// The spectrum, as a stream of `spectrum` events.
///
/// The stream has its own subscription, which ends when the browser closes
/// the stream. The parameters come in the query string, since an EventSource
/// can only GET.
#[utoipa::path(
    get,
    path = "/spectrum",
    params(SpectrumSubscription),
    responses(
        (status = 200, content_type = "text/event-stream", body = SpectrumData,
            description = "A `spectrum` event for each update from CamillaDSP"),
        (status = 503, description = "Processing is not running (with the result \
            `ProcessingNotRunningError`), CamillaDSP cannot be reached, or the level stream is \
            disabled in the settings", body = ErrorBody),
    )
)]
pub async fn get_spectrum(
    State(app): Shared,
    Query(params): Query<SpectrumSubscription>,
) -> ApiResult {
    if !app.settings.enable_level_stream {
        return Err(unavailable("Spectrum stream is disabled"));
    }
    event_stream_response(events::spectrum_stream(app.camilla.url(), params).await)
}

fn event_stream_response(stream: Result<impl IntoResponse, SubscribeError>) -> ApiResult {
    match stream {
        Ok(stream) => {
            let mut response = stream.into_response();
            let headers = response.headers_mut();
            headers.insert(
                header::ACCESS_CONTROL_ALLOW_ORIGIN,
                HeaderValue::from_static("*"),
            );
            // Tells nginx not to buffer the stream, which would hold the events back.
            headers.insert("x-accel-buffering", HeaderValue::from_static("no"));
            Ok(response)
        }
        Err(SubscribeError::ProcessingNotRunning) => Err(unavailable("Processing is not running")
            .with_result("ProcessingNotRunningError".to_string())),
        Err(SubscribeError::Other(message)) => Err(unavailable(message)),
    }
}

// ── Volume and faders ──────────────────────────────────────────────────────

/// The main volume, in dB.
#[utoipa::path(
    get,
    path = "/param/volume",
    responses(
        (status = 200, body = f32),
        (status = "default", description = "CamillaDSP cannot be reached, or refused", body = ErrorBody),
    )
)]
pub async fn get_volume(State(app): Shared) -> ApiResult {
    Ok(json_response(app.camilla.volume().await?))
}

/// Set the main volume, in dB.
#[utoipa::path(
    post,
    path = "/param/volume",
    request_body = f32,
    responses(
        (status = 204, description = "Set"),
        (status = "default", description = "CamillaDSP cannot be reached, or refused", body = ErrorBody),
    )
)]
pub async fn set_volume(State(app): Shared, Json(volume): Json<f32>) -> ApiResult {
    app.camilla.set_volume(volume).await?;
    no_content()
}

/// Whether the main volume is muted.
#[utoipa::path(
    get,
    path = "/param/mute",
    responses(
        (status = 200, body = bool),
        (status = "default", description = "CamillaDSP cannot be reached, or refused", body = ErrorBody),
    )
)]
pub async fn get_mute(State(app): Shared) -> ApiResult {
    Ok(json_response(app.camilla.mute().await?))
}

/// Mute or unmute the main volume.
#[utoipa::path(
    post,
    path = "/param/mute",
    request_body = bool,
    responses(
        (status = 204, description = "Set"),
        (status = "default", description = "CamillaDSP cannot be reached, or refused", body = ErrorBody),
    )
)]
pub async fn set_mute(State(app): Shared, Json(mute): Json<bool>) -> ApiResult {
    app.camilla.set_mute(mute).await?;
    no_content()
}

/// Every fader, the main volume first, then the aux faders from 1 up.
#[utoipa::path(
    get,
    path = "/param/faders",
    responses(
        (status = 200, body = Vec<Fader>),
        (status = "default", description = "CamillaDSP cannot be reached, or refused", body = ErrorBody),
    )
)]
pub async fn get_faders(State(app): Shared) -> ApiResult {
    Ok(json_response(app.camilla.faders().await?))
}

/// Set the volume of a fader, in dB.
#[utoipa::path(
    post,
    path = "/param/faders/{index}/volume",
    params(("index" = usize, Path, description = "The fader, 0 for the main volume")),
    request_body = f32,
    responses(
        (status = 204, description = "Set"),
        (status = "default", description = "CamillaDSP cannot be reached, or refused", body = ErrorBody),
    )
)]
pub async fn set_fader_volume(
    State(app): Shared,
    UrlPath(index): UrlPath<usize>,
    Json(volume): Json<f32>,
) -> ApiResult {
    app.camilla.set_fader_volume(index, volume).await?;
    no_content()
}

/// Mute or unmute a fader.
#[utoipa::path(
    post,
    path = "/param/faders/{index}/mute",
    params(("index" = usize, Path, description = "The fader, 0 for the main volume")),
    request_body = bool,
    responses(
        (status = 204, description = "Set"),
        (status = "default", description = "CamillaDSP cannot be reached, or refused", body = ErrorBody),
    )
)]
pub async fn set_fader_mute(
    State(app): Shared,
    UrlPath(index): UrlPath<usize>,
    Json(mute): Json<bool>,
) -> ApiResult {
    app.camilla.set_fader_mute(index, mute).await?;
    no_content()
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
    request_body = CoeffsRequest,
    responses(
        (status = 200, content_type = "application/octet-stream", body = inline(Binary)),
        (status = 400, description = "The filter reads no file, or the file could not be read", body = ErrorBody),
        (status = 403, description = "The file is outside the configured folders", body = ErrorBody),
        (status = 404, description = "There is no such file", body = ErrorBody),
    )
)]
pub async fn conv_coefficients(
    State(app): Shared,
    Json(request): Json<CoeffsRequest>,
) -> ApiResult {
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
        // The options come from the name as written, tokens and all, so they
        // are collected before the tokens are replaced.
        let file_names = files::list_file_names(&settings.coeff_dir);
        let options = coeffs::filter_plot_options(&file_names, filename);
        let absolute =
            paths::coeff_path_to_absolute(filename, &settings.config_dir, &settings.coeff_dir);
        *filename = coeffs::replace_tokens(&absolute, samplerate, channels);
        if !Path::new(filename.as_str()).is_file() {
            return Err(not_found("Filter coefficient file not found"));
        }
        let (values, as_f32) = coeffs::read_coefficients(&parameters).map_err(bad_request)?;
        let body = coeffs::frame_coefficients(options, &values, as_f32);
        Ok((
            [NO_STORE, (header::CONTENT_TYPE, "application/octet-stream")],
            body,
        )
            .into_response())
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
        (status = 200, body = WavInfo),
        (status = 403, description = "The file is outside audiofiles_dir", body = ErrorBody),
        (status = 404, description = "The file is not a wav file CamillaDSP can read", body = ErrorBody),
    )
)]
pub async fn get_wav_info(State(app): Shared, Query(query): Query<WavInfoQuery>) -> ApiResult {
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
    match wav::read_info(&path) {
        Some(info) => Ok(json_response(info)),
        None => Err(not_found(format!(
            "'{filename}' is not a wav file CamillaDSP can read"
        ))),
    }
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct CoeffDefaultsQuery {
    /// The coefficient file, relative to config_dir.
    file: String,
}

/// Sensible parameters for a Conv filter reading a coefficient file, from
/// the file's extension.
#[utoipa::path(
    get,
    path = "/defaultsforcoeffs",
    params(CoeffDefaultsQuery),
    responses((status = 200, body = CoeffDefaults))
)]
pub async fn get_defaults_for_coeffs(
    State(app): Shared,
    Query(query): Query<CoeffDefaultsQuery>,
) -> Response {
    let absolute = paths::make_absolute(&query.file, &app.settings.config_dir);
    json_response(coeffs::defaults_for_filter(&absolute))
}

// ── The active config ──────────────────────────────────────────────────────

/// The config CamillaDSP runs, with the file paths as CamillaDSP has them.
#[utoipa::path(
    get,
    path = "/getconfig",
    responses(
        (status = 200, body = Option<Configuration>, description = "The config, null if CamillaDSP has none"),
        (status = "default", description = "CamillaDSP cannot be reached, or sent a config the GUI \
            cannot read", body = ErrorBody),
    )
)]
pub async fn get_config(State(app): Shared) -> ApiResult {
    Ok(json_response(app.camilla.config().await?))
}

/// Refuse a config with paths outside the configured folders, unless
/// absolute paths are allowed.
fn check_config_paths(app: &AppState, config: &Value) -> Result<(), ApiError> {
    if app.settings.allow_absolute_paths {
        return Ok(());
    }
    let offenders = paths::paths_outside_folders(
        config,
        &app.settings.coeff_dir,
        app.audiofiles_dir(),
        &app.settings.config_dir,
    );
    if offenders.is_empty() {
        return Ok(());
    }
    let list: Vec<String> = offenders.iter().map(|p| format!("'{p}'")).collect();
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
    request_body = ConfigBody,
    responses(
        (status = 204, description = "Applied"),
        (status = 403, description = "The config has paths outside the configured folders", body = ErrorBody),
        (status = 422, description = "The body is not a config, or CamillaDSP refused it", body = ErrorBody),
        (status = "default", description = "CamillaDSP cannot be reached", body = ErrorBody),
    )
)]
pub async fn set_config(State(app): Shared, Json(body): Json<ConfigBody>) -> ApiResult {
    let config = config_for_dsp(&app, &body.config)?;
    match app.camilla.set_config(&config).await {
        Ok(()) => no_content(),
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
        (status = 204, description = "Stopped"),
        (status = 400, description = "CamillaDSP refused", body = ErrorBody),
        (status = "default", description = "CamillaDSP cannot be reached", body = ErrorBody),
    )
)]
pub async fn stop_processing(State(app): Shared) -> ApiResult {
    match app.camilla.stop().await {
        Ok(()) => no_content(),
        Err(DspError::Command { result, message }) => Err(bad_request(message).with_result(result)),
        Err(err) => Err(err.into()),
    }
}

/// Check a config without applying it, with the file paths as the GUI has
/// them.
///
/// The body is meant to be a config, but any JSON is taken, since a config
/// that does not parse is reported as an issue like any other.
#[utoipa::path(
    post,
    path = "/validateconfig",
    request_body = Configuration,
    responses(
        (status = 200, body = Vec<ValidationIssue>, description = "Every issue, none if the config is valid"),
        (status = "default", description = "The body is not JSON", body = ErrorBody),
    )
)]
pub async fn validate_config(State(app): Shared, Json(config): Json<Value>) -> ApiResult {
    let config = with_absolute_paths(&app, config);
    let types = app.device_types();
    // Validation reads every coefficient file, which can take a while.
    let issues = blocking(move || Ok(validate::validate(config, &types))).await?;
    log::debug!("Validated config: {issues:?}");
    Ok(json_response(issues))
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

/// A config read from a file, as the GUI wants it: optional fields filled in,
/// coefficient files in coeff_dir as bare names and the rest relative to
/// config_dir, and audio files in audiofiles_dir as bare names.
fn config_for_gui(app: &AppState, parsed: yaml::Parsed) -> Result<Configuration, String> {
    check_finite(&parsed)?;
    let mut config = parsed.value;
    paths::make_config_filter_paths_relative(
        &mut config,
        &app.settings.config_dir,
        &app.settings.coeff_dir,
    );
    paths::make_audio_file_paths_bare(&mut config, app.audiofiles_dir());
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
    /// Bring a config for an older CamillaDSP up to date.
    #[serde(default)]
    #[param(required = false)]
    migrate: bool,
}

/// A config file, with the file paths relative to the configured folders.
#[utoipa::path(
    get,
    path = "/getconfigfile",
    params(ConfigFileQuery),
    responses(
        (status = 200, body = Configuration),
        (status = 400, description = "The file is not a config the GUI can use, or could not be \
            migrated", body = ErrorBody),
        (status = 404, description = "There is no such file", body = ErrorBody),
    )
)]
pub async fn get_config_file(
    State(app): Shared,
    Query(query): Query<ConfigFileQuery>,
) -> ApiResult {
    let ConfigFileQuery { name, migrate } = query;
    let path = file_in_folder(&app.settings.config_dir, &name).map_err(bad_request)?;
    let types = app.device_types();
    blocking(move || {
        let config = if migrate {
            read_and_migrate(&app, &path, &name, &types)?
        } else {
            read_config_for_gui(&app, &path).map_err(|err| err.for_file(&name))?
        };
        Ok(json_response(config))
    })
    .await
}

/// Read an older config, bring it up to date, and check that the result is valid.
fn read_and_migrate(
    app: &AppState,
    path: &Path,
    name: &str,
    types: &DeviceTypes,
) -> Result<Configuration, ApiError> {
    let parsed = read_yaml_file(path).map_err(|err| err.for_file(name))?;
    check_finite(&parsed).map_err(bad_request)?;
    let mut config = parsed.value;
    if !config.is_object() {
        return Err(bad_request(
            "Migration failed: input is not a valid CamillaDSP config object.",
        ));
    }
    legacy::migrate_legacy_config(&mut config);
    let settings = &app.settings;
    paths::make_config_filter_paths_relative(
        &mut config,
        &settings.config_dir,
        &settings.coeff_dir,
    );
    let issues = validate::validate(with_absolute_paths(app, config.clone()), types);
    let blocking_errors: Vec<String> = issues
        .iter()
        .filter(|issue| issue.severity == Severity::Error)
        .map(|issue| {
            let location: Vec<String> = issue
                .path
                .iter()
                .map(|element| match element {
                    PathElement::Key(key) => key.clone(),
                    PathElement::Index(index) => index.to_string(),
                })
                .collect();
            let location = if location.is_empty() {
                "config".to_string()
            } else {
                location.join("/")
            };
            format!("- {location}: {}", issue.message)
        })
        .collect();
    if !blocking_errors.is_empty() {
        return Err(bad_request(format!(
            "Migration failed: migrated config validation reported problems:\n{}",
            blocking_errors.join("\n")
        )));
    }
    paths::make_audio_file_paths_bare(&mut config, app.audiofiles_dir());
    validate::parse(config).map_err(bad_request)
}

/// The default config file, `default_config` in the settings, with the file
/// paths relative to the configured folders.
#[utoipa::path(
    get,
    path = "/getdefaultconfigfile",
    responses(
        (status = 200, body = Configuration),
        (status = 404, description = "No default config is set, or the file is missing", body = ErrorBody),
        (status = 500, description = "The file is not a config the GUI can use", body = ErrorBody),
    )
)]
pub async fn get_default_config_file(State(app): Shared) -> ApiResult {
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
        Ok(json_response(config))
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
    request_body = SaveConfigBody,
    responses(
        (status = 204, description = "Saved"),
        (status = 400, description = "The file name is not valid", body = ErrorBody),
        (status = 403, description = "The config has paths outside the configured folders", body = ErrorBody),
        (status = "default", description = "The file could not be written", body = ErrorBody),
    )
)]
pub async fn save_config_file(State(app): Shared, Json(body): Json<SaveConfigBody>) -> ApiResult {
    let SaveConfigBody { config, filename } = body;
    let config = config_for_dsp(&app, &config)?;
    let path = file_in_folder(&app.settings.config_dir, &filename).map_err(bad_request)?;
    std::fs::write(&path, yaml::dump(&config))
        .map_err(|err| internal(format!("Could not save {filename}: {err}")))?;
    no_content()
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
/// The fields of camilladsp-config's `Devices`, every one optional and left
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
    request_body = ImportText,
    responses(
        (status = 200, body = ConfigFragment),
        (status = 400, description = "The text is not YAML, or not part of a config", body = ErrorBody),
    )
)]
pub async fn yaml_to_json(Json(body): Json<ImportText>) -> ApiResult {
    let parsed = yaml::parse(&body.text).map_err(|err| bad_request(err.to_string()))?;
    check_finite(&parsed).map_err(bad_request)?;
    let mut loaded = parsed.value;
    legacy::migrate_legacy_config(&mut loaded);
    let fragment = ConfigFragment::parse(loaded).map_err(bad_request)?;
    Ok(json_response(fragment))
}

/// Translate a Convolver config.
#[utoipa::path(
    post,
    path = "/convolvertojson",
    request_body = ImportText,
    responses(
        (status = 200, body = ConfigFragment),
        (status = 400, description = "The text is not a Convolver config", body = ErrorBody),
    )
)]
pub async fn translate_convolver_to_json(Json(body): Json<ImportText>) -> ApiResult {
    let translated = convolver::translate(&body.text).map_err(bad_request)?;
    let fragment = ConfigFragment::parse(translated).map_err(internal)?;
    Ok(json_response(fragment))
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
    request_body = EqApoImport,
    responses(
        (status = 200, body = ConfigFragment),
        (status = "default", description = "The body is not valid", body = ErrorBody),
    )
)]
pub async fn translate_eqapo_to_json(Json(body): Json<EqApoImport>) -> ApiResult {
    let translated = eqapo::EqApo::new(body.channels).translate(&body.text);
    let fragment = ConfigFragment::parse(translated).map_err(internal)?;
    Ok(json_response(fragment))
}

// ── Startup and the active config file ─────────────────────────────────────

async fn is_online(camilla: &CamillaClient) -> bool {
    camilla.state().await.is_ok()
}

/// Run a shell command, like `os.popen` and `os.system`.
async fn run_shell(command: &str) -> std::io::Result<String> {
    let mut cmd = if cfg!(windows) {
        let mut cmd = tokio::process::Command::new("cmd");
        cmd.arg("/C").arg(command);
        cmd
    } else {
        let mut cmd = tokio::process::Command::new("sh");
        cmd.arg("-c").arg(command);
        cmd
    };
    let output = cmd.output().await?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
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
        let path = files::read_statefile_config_path(statefile);
        return files::verify_path_in_config_dir(path.as_deref(), &settings.config_dir);
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
                if let Err(err) = files::update_statefile_config_path(statefile, path) {
                    log::error!("{err}");
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
    if let Some(on_set) = &settings.on_set_active_config {
        let command = on_set.replace("{}", &format!("\"{path}\""));
        log::debug!("Running command: {command}");
        if let Err(err) = run_shell(&command).await {
            log::error!("Failed to run on_set_active_config command: {err}");
        }
    }
    Ok(())
}

#[derive(Serialize, ToSchema)]
pub struct ActiveConfigFile {
    /// The file name of the active config, null when there is none, or it is
    /// not in config_dir.
    #[serde(rename = "configFileName")]
    #[schema(required)]
    config_file_name: Option<String>,
}

/// The active config file, the one CamillaDSP loads when it starts.
#[utoipa::path(
    get,
    path = "/getactiveconfigfilename",
    responses((status = 200, body = ActiveConfigFile))
)]
pub async fn get_active_config_name(State(app): Shared) -> Response {
    let config_file_name = active_config_name(&app).await;
    json_response(ActiveConfigFile { config_file_name })
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
    request_body = ActiveConfigBody,
    responses(
        (status = 204, description = "Set"),
        (status = 400, description = "The file name is not valid", body = ErrorBody),
        (status = "default", description = "CamillaDSP refused", body = ErrorBody),
    )
)]
pub async fn set_active_config_name(
    State(app): Shared,
    Json(body): Json<ActiveConfigBody>,
) -> ApiResult {
    let path = file_in_folder(&app.settings.config_dir, &body.name).map_err(bad_request)?;
    set_active_config_path(&app, &paths::to_string(&path)).await?;
    no_content()
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
    #[serde(rename = "configFileName")]
    #[schema(required)]
    pub config_file_name: Option<String>,
}

/// The config to load into the GUI when it starts: the one in CamillaDSP if
/// there is one, otherwise the active config file, otherwise the default one.
#[utoipa::path(
    get,
    path = "/getstartconfig",
    responses(
        (status = 200, body = StartConfig),
        (status = 404, description = "There is no config to start with", body = ErrorBody),
        (status = 500, description = "No config file could be read", body = ErrorBody),
    )
)]
pub async fn get_config_at_gui_start(State(app): Shared) -> ApiResult {
    // An unreadable config is logged by the client.
    if let Ok(Some(config)) = app.camilla.config().await {
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
        return Ok(json_response(StartConfig {
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
                    return Ok(json_response(StartConfig {
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
        (status = 200, body = Vec<FileInfo>),
        (status = 404, description = "No audiofiles_dir is set", body = ErrorBody),
    )
)]
pub async fn get_files(State(app): Shared, UrlPath(kind): UrlPath<FileKind>) -> ApiResult {
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
            FileKind::Coeff => files::list_files(&folder, Details::default(), None),
            FileKind::Audiofile => {
                let details = Details {
                    wav: true,
                    ..Default::default()
                };
                files::list_files(&folder, details, None)
            }
        };
        Ok(json_response(files))
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

/// The uploaded files, in the order they came.
async fn uploaded_files(
    mut multipart: axum::extract::Multipart,
) -> Result<Vec<(String, Bytes)>, ApiError> {
    let mut files = Vec::new();
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|err| bad_request(err.to_string()))?
    {
        if field.name() != Some("files") {
            continue;
        }
        let filename = field.file_name().unwrap_or_default().to_string();
        let data = field
            .bytes()
            .await
            .map_err(|err| bad_request(err.to_string()))?;
        files.push((filename, data));
    }
    Ok(files)
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
        (status = 204, description = "Stored"),
        (status = 400, description = "A file name is not valid", body = ErrorBody),
        (status = 404, description = "No audiofiles_dir is set", body = ErrorBody),
        (status = 500, description = "The folder does not exist, or a file could not be written", body = ErrorBody),
    )
)]
pub async fn upload_files(
    State(app): Shared,
    UrlPath(kind): UrlPath<FileKind>,
    Multipart(multipart): Multipart,
) -> ApiResult {
    let folder = kind.folder(&app)?;
    files::require_directory(&folder).map_err(internal)?;
    let transform: fn(&[u8]) -> Vec<u8> = match kind {
        FileKind::Config => files::sanitize_uploaded_config,
        FileKind::Coeff | FileKind::Audiofile => <[u8]>::to_vec,
    };
    for (filename, data) in uploaded_files(multipart).await? {
        let path = file_in_folder(&folder, &filename).map_err(bad_request)?;
        tokio::fs::write(&path, transform(&data))
            .await
            .map_err(|err| internal(format!("Could not save {filename}: {err}")))?;
    }
    no_content()
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
    request_body = FileNames,
    responses(
        (status = 204, description = "Deleted"),
        (status = 404, description = "No audiofiles_dir is set", body = ErrorBody),
        (status = "default", description = "A file could not be deleted", body = ErrorBody),
    )
)]
pub async fn delete_files(
    State(app): Shared,
    UrlPath(kind): UrlPath<FileKind>,
    Json(body): Json<FileNames>,
) -> ApiResult {
    let folder = kind.folder(&app)?;
    files::delete_files(&folder, &body.names).map_err(internal)?;
    no_content()
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
    request_body = RenameBody,
    responses(
        (status = 204, description = "Renamed"),
        (status = 400, description = "A file name is not valid, the new name is taken, or the \
            file could not be renamed", body = ErrorBody),
        (status = 404, description = "No audiofiles_dir is set", body = ErrorBody),
    )
)]
pub async fn rename_file(
    State(app): Shared,
    UrlPath(kind): UrlPath<FileKind>,
    Json(body): Json<RenameBody>,
) -> ApiResult {
    let folder = kind.folder(&app)?;
    files::rename_file(&folder, &body.source, &body.target).map_err(bad_request)?;
    no_content()
}

/// Some of the files in a folder, as a zip file.
#[utoipa::path(
    post,
    path = "/files/{kind}/zip",
    params(("kind" = FileKind, Path)),
    request_body = FileNames,
    responses(
        (status = 200, content_type = "application/octet-stream", body = inline(Binary)),
        (status = 404, description = "No audiofiles_dir is set", body = ErrorBody),
        (status = "default", description = "A file could not be read", body = ErrorBody),
    )
)]
pub async fn zip_files(
    State(app): Shared,
    UrlPath(kind): UrlPath<FileKind>,
    Json(body): Json<FileNames>,
) -> ApiResult {
    let folder = kind.folder(&app)?;
    let zip = blocking(move || files::zip_of_files(&folder, &body.names).map_err(internal)).await?;
    let zip_name = match kind {
        FileKind::Config => "configs.zip",
        FileKind::Coeff => "coeffs.zip",
        FileKind::Audiofile => "audiofiles.zip",
    };
    let disposition = format!("attachment; filename={zip_name}");
    Ok((
        [
            (header::CONTENT_DISPOSITION, disposition),
            (header::CONTENT_TYPE, "application/octet-stream".to_string()),
        ],
        zip,
    )
        .into_response())
}

// ── GUI settings and the log ───────────────────────────────────────────────

/// The GUI settings: `gui-config.yml`, and the few settings from
/// `camillagui.yml` that the frontend needs.
#[utoipa::path(get, path = "/guiconfig", responses((status = 200, body = GuiConfig)))]
pub async fn get_gui_config(State(app): Shared) -> Response {
    let config = settings::gui_config(&app.settings);
    log::debug!("GUI config: {config:?}");
    json_response(config)
}

/// CamillaDSP's log file, `log_file` in the settings.
#[utoipa::path(
    get,
    path = "/logfile",
    responses(
        (status = 200, content_type = "text/plain", body = String),
        (status = 404, description = "No log file is set, or it cannot be read", body = ErrorBody),
    )
)]
pub async fn get_log_file(State(app): Shared) -> ApiResult {
    let Some(path) = app.settings.log_file.as_deref() else {
        return Err(not_found("Please configure a valid 'log_file' path"));
    };
    match tokio::fs::read_to_string(settings::expand_home(Path::new(path))).await {
        Ok(text) => Ok(text_response(text)),
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
        (status = 200, body = Vec<AvailableDevice>),
        (status = "default", description = "CamillaDSP refused", body = ErrorBody),
    )
)]
pub async fn get_devices(
    State(app): Shared,
    UrlPath((direction, backend)): UrlPath<(Direction, String)>,
) -> ApiResult {
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
    Ok(json_response(devices))
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
        (status = 200, body = AudioDeviceDescriptor),
        (status = 400, description = "No device is given, or CamillaDSP refused", body = ErrorBody),
        (status = 503, description = "CamillaDSP cannot be reached", body = ErrorBody),
    )
)]
pub async fn get_device_capabilities(
    State(app): Shared,
    UrlPath((direction, backend)): UrlPath<(Direction, String)>,
    Query(query): Query<DeviceQuery>,
) -> ApiResult {
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
            Ok(json_response(&*capabilities))
        }
        Err(err) => match app.status.capabilities(capture, &backend, &device) {
            Some(cached) => {
                log::debug!(
                    "Failed to fetch the capabilities of {backend}/{device}, returning cached data"
                );
                Ok(json_response(&*cached))
            }
            None => match err {
                DspError::Command { message, .. } => Err(bad_request(message)),
                DspError::Io(message) => Err(unavailable(message)),
            },
        },
    }
}

/// The device types CamillaDSP supports. They cannot change while it runs, so
/// this comes from the cache.
#[utoipa::path(
    get,
    path = "/backends",
    responses(
        (status = 200, body = Option<DeviceTypeLists>, description = "Null until CamillaDSP has \
            been reached"),
    )
)]
pub async fn get_backends(State(app): Shared) -> Response {
    json_response(app.status.device_types())
}

#[cfg(test)]
mod tests {
    use super::*;
    use camilladsp_config::config::Devices;
    use serde_json::json;

    /// Every field of `Devices`, destructured without `..`, so that a field
    /// added in camilladsp-config fails to compile here until the fragment
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
}
