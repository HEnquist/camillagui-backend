//! The `/api` handlers, the counterpart of `backend/views.py`. The responses
//! are the same as the Python backend's, so the frontend does not change.

use crate::camilla::{CamillaClient, DspError, to_json};
use crate::events::{Publisher, SpectrumStream, SubscribeError};
use crate::files::{self, ConfigContext, Details};
use crate::paths::{self, file_in_folder};
use crate::settings::{self, Settings};
use crate::status::StatusCache;
use crate::validate::{self, DeviceTypes};
use crate::{coeffs, convolver, eqapo, legacy, wav, yaml};
use axum::body::Bytes;
use axum::extract::{Multipart, Path as UrlPath, Query, State};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Redirect, Response};
use camilladsp_config::protocol::SpectrumSubscription;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub struct AppState {
    pub settings: Settings,
    pub camilla: Arc<CamillaClient>,
    pub status: Arc<StatusCache>,
    pub publisher: Publisher,
    /// `None` when `enable_level_stream` is off.
    pub spectrum: Option<SpectrumStream>,
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

/// An error response: a status and a plain text message.
#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    text: String,
}

impl ApiError {
    pub fn new(status: StatusCode, text: impl Into<String>) -> Self {
        ApiError {
            status,
            text: text.into(),
        }
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
        (self.status, [NO_STORE], self.text).into_response()
    }
}

/// Talking to CamillaDSP failed. pycamilladsp raised these into the Python
/// handlers, which did not catch them, so they ended up as 500.
impl From<DspError> for ApiError {
    fn from(err: DspError) -> Self {
        internal(err.to_string())
    }
}

type ApiResult = Result<Response, ApiError>;

fn json_response(value: impl serde::Serialize) -> Response {
    ([NO_STORE], axum::Json(value)).into_response()
}

fn text_response(text: impl Into<String>) -> Response {
    ([NO_STORE], text.into()).into_response()
}

fn ok() -> ApiResult {
    Ok(text_response("OK"))
}

/// Parse a JSON body. The frontend does not always send a content type, and
/// the Python backend did not ask for one, so this does not either.
fn parse_body<T: DeserializeOwned>(body: &Bytes) -> Result<T, ApiError> {
    serde_json::from_slice(body).map_err(|err| bad_request(format!("Invalid request body: {err}")))
}

fn query_param<'a>(query: &'a HashMap<String, String>, name: &str) -> Result<&'a str, ApiError> {
    query
        .get(name)
        .map(String::as_str)
        .ok_or_else(|| bad_request(format!("Missing required query parameter '{name}'")))
}

/// Run blocking file work off the async threads.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, ApiError> + Send + 'static,
) -> Result<T, ApiError> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|err| internal(err.to_string()))?
}

/// Send a config parsed from YAML, refusing it if it had NaN or infinity in
/// it. JSON cannot carry those, and CamillaDSP accepts neither.
fn config_json_response(parsed_nonfinite: &[String], data: Value) -> ApiResult {
    if !parsed_nonfinite.is_empty() {
        return Err(bad_request(yaml::nonfinite_message(parsed_nonfinite)));
    }
    Ok(json_response(data))
}

// ── Status and events ──────────────────────────────────────────────────────

pub async fn get_gui_index() -> Redirect {
    Redirect::to("/gui/index.html")
}

pub async fn get_status(State(app): Shared) -> Response {
    let status = app.status.refresh(&app.camilla).await;
    json_response(status)
}

pub async fn get_events(State(app): Shared) -> ApiResult {
    if !app.settings.enable_level_stream {
        return Err(unavailable("Event stream is disabled"));
    }
    let mut response = app.publisher.subscribe().into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    // Tells nginx not to buffer the stream, which would hold the events back.
    headers.insert("x-accel-buffering", HeaderValue::from_static("no"));
    Ok(response)
}

pub async fn subscribe_spectrum(State(app): Shared, body: Bytes) -> ApiResult {
    let Some(spectrum) = &app.spectrum else {
        return Err(unavailable("Spectrum stream is disabled"));
    };
    let params: SpectrumSubscription = parse_body(&body)?;
    match spectrum.subscribe(params).await {
        Ok(()) => Ok(json_response(json!({}))),
        Err(SubscribeError::ProcessingNotRunning) => Ok((
            StatusCode::SERVICE_UNAVAILABLE,
            [NO_STORE],
            axum::Json(json!({"result": "ProcessingNotRunningError"})),
        )
            .into_response()),
        Err(SubscribeError::Other(message)) => Err(unavailable(message)),
    }
}

pub async fn unsubscribe_spectrum(State(app): Shared) -> Response {
    if let Some(spectrum) = &app.spectrum {
        spectrum.unsubscribe().await;
    }
    json_response(json!({}))
}

// ── Parameters ─────────────────────────────────────────────────────────────

/// A float the way Python's `str` writes it, with a `.0` on whole numbers.
/// CamillaDSP sends f32 values as their shortest decimal text, which is what
/// Python read and printed, so an f32 is printed as an f32 and not widened.
fn py_float(value: impl std::fmt::Debug) -> String {
    format!("{value:?}")
}

/// An f32 as the f64 Python got from parsing its shortest decimal text.
fn as_python_f64(value: f32) -> f64 {
    format!("{value:?}").parse().unwrap_or(f64::from(value))
}

fn py_bool(value: bool) -> &'static str {
    if value { "True" } else { "False" }
}

pub async fn get_param(State(app): Shared, UrlPath(name): UrlPath<String>) -> ApiResult {
    let camilla = &app.camilla;
    let text = match name.as_str() {
        "volume" => py_float(camilla.volume().await?),
        "mute" => py_bool(camilla.mute().await?).to_string(),
        "signalrange" => py_float(camilla.signal_range().await?),
        "signalrangedb" => {
            let range = as_python_f64(camilla.signal_range().await?);
            if range > 0.0 {
                py_float(20.0 * (range / 2.0).log10())
            } else {
                "-1000".to_string()
            }
        }
        "capturerateraw" => camilla.capture_rate().await?.to_string(),
        "updateinterval" => camilla.update_interval().await?.to_string(),
        "configname" => camilla
            .config_file_path()
            .await?
            .unwrap_or_else(|| "None".to_string()),
        "configraw" => camilla.config_yaml().await?,
        "processingload" => py_float(camilla.processing_load().await?),
        "resamplerload" => py_float(camilla.resampler_load().await?),
        _ => return Err(not_found(format!("Unknown parameter {name}"))),
    };
    Ok(text_response(text))
}

pub async fn get_param_json(State(app): Shared, UrlPath(name): UrlPath<String>) -> ApiResult {
    match name.as_str() {
        "faders" => Ok(json_response(app.camilla.faders().await?)),
        _ => Err(not_found(format!("Unknown parameter {name}"))),
    }
}

pub async fn get_list_param(State(app): Shared, UrlPath(name): UrlPath<String>) -> ApiResult {
    let result = match name.as_str() {
        "capturesignalpeak" => to_json(&app.camilla.capture_signal_peak().await?),
        "playbacksignalpeak" => to_json(&app.camilla.playback_signal_peak().await?),
        // What the Python backend sent for anything else.
        _ => json!("[]"),
    };
    Ok(json_response(result))
}

fn parse_bool(value: &str) -> Result<bool, ApiError> {
    match value.to_lowercase().as_str() {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err(bad_request(format!("Invalid boolean value {value}"))),
    }
}

fn parse_number<T: std::str::FromStr>(value: &str) -> Result<T, ApiError> {
    value
        .trim()
        .parse()
        .map_err(|_| bad_request(format!("Invalid value {value}")))
}

pub async fn set_param(
    State(app): Shared,
    UrlPath(name): UrlPath<String>,
    value: String,
) -> ApiResult {
    let camilla = &app.camilla;
    match name.as_str() {
        "volume" => camilla.set_volume(parse_number(&value)?).await?,
        "mute" => camilla.set_mute(parse_bool(&value)?).await?,
        "updateinterval" => camilla.set_update_interval(parse_number(&value)?).await?,
        "configname" => camilla.set_config_file_path(value).await?,
        "configraw" => camilla.set_config_yaml(value).await?,
        _ => {}
    }
    ok()
}

pub async fn set_param_index(
    State(app): Shared,
    UrlPath((name, index)): UrlPath<(String, String)>,
    value: String,
) -> ApiResult {
    let index: usize = parse_number(&index)?;
    match name.as_str() {
        "volume" => {
            app.camilla
                .set_fader_volume(index, parse_number(&value)?)
                .await?
        }
        "mute" => {
            app.camilla
                .set_fader_mute(index, parse_bool(&value)?)
                .await?
        }
        _ => {}
    }
    ok()
}

// ── Coefficients ───────────────────────────────────────────────────────────

/// The coefficients of a Conv filter that reads them from a file, and which
/// samplerate and channel variants of that file exist. The GUI evaluates
/// filters itself; this exists because only the server can reach the files.
pub async fn conv_coefficients(State(app): Shared, body: Bytes) -> ApiResult {
    let content: Value = parse_body(&body)?;
    blocking(move || {
        let mut filter = content.get("config").cloned().unwrap_or_default();
        let parameters = filter.get("parameters").cloned().unwrap_or_default();
        let subtype = parameters.get("type").and_then(Value::as_str);
        if !matches!(subtype, Some("Raw" | "Wav")) {
            return Err(bad_request(format!(
                "Conv subtype '{}' reads no coefficient file",
                subtype.unwrap_or("None")
            )));
        }
        let filename = match parameters.get("filename").and_then(Value::as_str) {
            Some(name) if !name.is_empty() => name.to_string(),
            _ => return Err(bad_request("Conv filter has no coefficient file name")),
        };
        let settings = &app.settings;
        if !settings.allow_absolute_paths
            && !paths::path_is_safe(
                &filename,
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
        paths::convert_filter_path(&mut filter, &|path| {
            paths::coeff_path_to_absolute(path, &settings.config_dir, &settings.coeff_dir)
        });
        // The options come from the name as written, tokens and all, so they
        // are collected before the tokens are replaced.
        let file_names = files::list_file_names(&settings.coeff_dir);
        let options = coeffs::filter_plot_options(&file_names, &filename);
        let samplerate = content.get("samplerate").cloned().unwrap_or_default();
        let channels = content.get("channels").cloned().unwrap_or_default();
        coeffs::replace_tokens_in_filter(&mut filter, &samplerate, &channels);
        let resolved = filter["parameters"]["filename"]
            .as_str()
            .unwrap_or_default();
        if !Path::new(resolved).is_file() {
            return Err(not_found("Filter coefficient file not found"));
        }
        let (values, as_f32) =
            coeffs::read_coefficients(&filter["parameters"]).map_err(bad_request)?;
        let body = coeffs::frame_coefficients(&options, &values, as_f32);
        Ok((
            [NO_STORE, (header::CONTENT_TYPE, "application/octet-stream")],
            body,
        )
            .into_response())
    })
    .await
}

pub async fn get_wav_info(
    State(app): Shared,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult {
    let filename = query_param(&query, "filename")?.to_string();
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
    Ok(json_response(wav::read_info(&path)))
}

pub async fn get_defaults_for_coeffs(
    State(app): Shared,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult {
    let file = query_param(&query, "file")?;
    let absolute = paths::make_absolute(file, &app.settings.config_dir);
    Ok(json_response(coeffs::defaults_for_filter(&absolute)))
}

// ── The active config ──────────────────────────────────────────────────────

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

#[derive(serde::Deserialize)]
struct ConfigBody {
    config: Value,
}

pub async fn set_config(State(app): Shared, body: Bytes) -> ApiResult {
    let ConfigBody { config } = parse_body(&body)?;
    check_config_paths(&app, &config)?;
    let config = with_absolute_paths(&app, config);
    match app.camilla.set_config(&config).await {
        Ok(()) => ok(),
        Err(DspError::Command { message, .. }) => {
            Err(ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, message))
        }
        // CamillaDSP is not there, so at least tell what it would have said.
        Err(DspError::Io(_)) => {
            let types = app.device_types();
            let issues = blocking(move || Ok(validate::validate(config, &types))).await?;
            if issues.is_empty() {
                ok()
            } else {
                Ok(json_response(issues))
            }
        }
    }
}

pub async fn stop_processing(State(app): Shared) -> ApiResult {
    match app.camilla.stop().await {
        Ok(()) => ok(),
        Err(err @ DspError::Command { .. }) => Err(bad_request(err.to_string())),
        Err(err) => Err(err.into()),
    }
}

pub async fn validate_config(State(app): Shared, body: Bytes) -> ApiResult {
    let config: Value = parse_body(&body)?;
    let config = with_absolute_paths(&app, config);
    let types = app.device_types();
    // Validation reads every coefficient file, which can take a while.
    let issues = blocking(move || Ok(validate::validate(config, &types))).await?;
    if issues.is_empty() {
        log::debug!("Validated config, ok");
        return ok();
    }
    log::debug!("Config has errors: {issues:?}");
    Ok((StatusCode::NOT_ACCEPTABLE, [NO_STORE], axum::Json(issues)).into_response())
}

// ── Config files ───────────────────────────────────────────────────────────

enum ReadError {
    NotFound,
    Unreadable(String),
    Yaml(String),
}

/// A config file as the GUI wants it: optional fields filled in, coefficient
/// files in coeff_dir as bare names and the rest relative to config_dir, and
/// audio files in audiofiles_dir as bare names.
fn read_config_for_gui(app: &AppState, path: &Path) -> Result<yaml::Parsed, ReadError> {
    let text = std::fs::read_to_string(path).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => ReadError::NotFound,
        _ => ReadError::Unreadable(err.to_string()),
    })?;
    let parsed = yaml::parse(&text).map_err(|err| ReadError::Yaml(err.to_string()))?;
    let mut config = validate::with_defaults(parsed.value);
    paths::make_config_filter_paths_relative(
        &mut config,
        &app.settings.config_dir,
        &app.settings.coeff_dir,
    );
    paths::make_audio_file_paths_bare(&mut config, app.audiofiles_dir());
    Ok(yaml::Parsed {
        value: config,
        nonfinite: parsed.nonfinite,
    })
}

impl ReadError {
    fn message(&self) -> String {
        match self {
            ReadError::NotFound => "File not found".to_string(),
            ReadError::Unreadable(msg) | ReadError::Yaml(msg) => msg.clone(),
        }
    }
}

pub async fn get_config_file(
    State(app): Shared,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult {
    let name = query_param(&query, "name")?.to_string();
    let migrate = matches!(
        query.get("migrate").map(|m| m.to_lowercase()).as_deref(),
        Some("true" | "1" | "yes")
    );
    let path = file_in_folder(&app.settings.config_dir, &name).map_err(bad_request)?;
    let types = app.device_types();
    blocking(move || {
        let parsed = if migrate {
            read_and_migrate(&app, &path, &name, &types)?
        } else {
            read_config_for_gui(&app, &path).map_err(|err| match err {
                ReadError::NotFound => not_found(format!("Config file '{name}' not found.")),
                ReadError::Unreadable(msg) => {
                    bad_request(format!("Unable to read config file '{name}': {msg}"))
                }
                ReadError::Yaml(msg) => bad_request(msg),
            })?
        };
        config_json_response(&parsed.nonfinite, parsed.value)
    })
    .await
}

/// Read an older config, bring it up to date, and check that the result is valid.
fn read_and_migrate(
    app: &AppState,
    path: &Path,
    name: &str,
    types: &DeviceTypes,
) -> Result<yaml::Parsed, ApiError> {
    let text = std::fs::read_to_string(path).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => not_found(format!("Config file '{name}' not found.")),
        _ => bad_request(format!("Unable to read config file '{name}': {err}")),
    })?;
    let parsed = yaml::parse(&text).map_err(|err| bad_request(err.to_string()))?;
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
        .filter(|issue| issue[2] == "error")
        .map(|issue| {
            let location: Vec<String> = issue[0]
                .as_array()
                .into_iter()
                .flatten()
                .map(|p| match p {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                })
                .collect();
            let location = if location.is_empty() {
                "config".to_string()
            } else {
                location.join("/")
            };
            format!("- {location}: {}", issue[1].as_str().unwrap_or_default())
        })
        .collect();
    if !blocking_errors.is_empty() {
        return Err(bad_request(format!(
            "Migration failed: migrated config validation reported problems:\n{}",
            blocking_errors.join("\n")
        )));
    }
    paths::make_audio_file_paths_bare(&mut config, app.audiofiles_dir());
    Ok(yaml::Parsed {
        value: config,
        nonfinite: parsed.nonfinite,
    })
}

pub async fn get_default_config_file(State(app): Shared) -> ApiResult {
    let Some(path) = app.settings.default_config.clone().filter(|p| p.is_file()) else {
        return Err(not_found("No default config"));
    };
    blocking(move || {
        let parsed = read_config_for_gui(&app, &path).map_err(|err| {
            log::error!(
                "Failed to get default config file, error: {}",
                err.message()
            );
            internal(err.message())
        })?;
        config_json_response(&parsed.nonfinite, parsed.value)
    })
    .await
}

#[derive(serde::Deserialize)]
struct SaveBody {
    config: Value,
    filename: String,
}

/// Save a config to a file in config_dir, with absolute paths so that
/// CamillaDSP can use it at startup without the GUI.
pub async fn save_config_file(State(app): Shared, body: Bytes) -> ApiResult {
    let SaveBody { config, filename } = parse_body(&body)?;
    check_config_paths(&app, &config)?;
    let config = with_absolute_paths(&app, config);
    let path = file_in_folder(&app.settings.config_dir, &filename).map_err(bad_request)?;
    std::fs::write(&path, yaml::dump(&config))
        .map_err(|err| internal(format!("Could not save {filename}: {err}")))?;
    ok()
}

pub async fn config_to_yml(body: Bytes) -> ApiResult {
    let content: Value = parse_body(&body)?;
    Ok(text_response(yaml::dump(&content)))
}

/// Parse a YAML config and send it as JSON with its optional fields filled in.
pub async fn parse_and_validate_yml_config_to_json(text: String) -> ApiResult {
    match yaml::parse(&text) {
        Ok(parsed) => {
            let config = validate::with_defaults(parsed.value);
            config_json_response(&parsed.nonfinite, config)
        }
        // The Python backend sent null for a config it could not parse.
        Err(_) => Ok(json_response(Value::Null)),
    }
}

/// Parse YAML, which may be just part of a config, migrating it from older
/// versions of CamillaDSP if needed.
pub async fn yaml_to_json(text: String) -> ApiResult {
    let parsed = yaml::parse(&text).map_err(|err| bad_request(err.to_string()))?;
    let mut loaded = parsed.value;
    legacy::migrate_legacy_config(&mut loaded);
    config_json_response(&parsed.nonfinite, loaded)
}

pub async fn translate_convolver_to_json(text: String) -> ApiResult {
    let translated = convolver::translate(&text).map_err(bad_request)?;
    Ok(json_response(translated))
}

pub async fn translate_eqapo_to_json(
    Query(query): Query<HashMap<String, String>>,
    text: String,
) -> ApiResult {
    let channels: i64 = query
        .get("channels")
        .ok_or_else(|| bad_request("Missing required query parameter 'channels'"))?
        .parse()
        .map_err(|err| bad_request(format!("Invalid channel count: {err}")))?;
    Ok(json_response(eqapo::EqApo::new(channels).translate(&text)))
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

pub async fn get_active_config_name(State(app): Shared) -> Response {
    let name = active_config_name(&app).await;
    json_response(json!({"configFileName": name}))
}

#[derive(serde::Deserialize)]
struct NameBody {
    name: String,
}

pub async fn set_active_config_name(State(app): Shared, body: Bytes) -> ApiResult {
    let NameBody { name } = parse_body(&body)?;
    let path = file_in_folder(&app.settings.config_dir, &name).map_err(bad_request)?;
    set_active_config_path(&app, &paths::to_string(&path)).await?;
    ok()
}

/// The config to load into the GUI when it starts: the one in CamillaDSP if
/// there is one, otherwise the active config file, otherwise the default one.
pub async fn get_config_at_gui_start(State(app): Shared) -> ApiResult {
    let dsp_config = app.camilla.config().await.ok().filter(|c| !c.is_null());
    if let Some(config) = dsp_config {
        if legacy::identify_version(&config) == Some(legacy::CURRENT_VERSION) {
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
            let mut data = json!({"config": config, "source": "dsp"});
            if let Some(name) = name {
                data["configFileName"] = json!(name);
            }
            return Ok(json_response(data));
        }
        log::warn!("Ignoring startup config from DSP, not valid for current GUI version");
    }

    let settings = &app.settings;
    let mut candidates = Vec::new();
    if let Some(active) = active_config_name(&app).await {
        let path = settings.config_dir.join(&active);
        if path.is_file() {
            candidates.push((path, "active", active));
        }
    }
    if let Some(default) = settings.default_config.as_ref().filter(|p| p.is_file()) {
        let name = paths::basename(&paths::to_string(default));
        candidates.push((default.clone(), "default", name));
    }
    if candidates.is_empty() {
        return Err(not_found("No active or default config"));
    }
    blocking(move || {
        let mut first_error = None;
        for (path, source, name) in candidates {
            match read_config_for_gui(&app, &path) {
                Err(err) => {
                    log::error!(
                        "Failed to get startup config from file {}, error: {}",
                        path.display(),
                        err.message()
                    );
                    first_error.get_or_insert(err.message());
                }
                Ok(parsed) => {
                    if legacy::identify_version(&parsed.value) == Some(legacy::CURRENT_VERSION) {
                        let data = json!({
                            "configFileName": name,
                            "config": parsed.value,
                            "source": source,
                        });
                        return config_json_response(&parsed.nonfinite, data);
                    }
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

pub async fn get_stored_configs(State(app): Shared) -> ApiResult {
    let types = app.device_types();
    blocking(move || {
        let settings = &app.settings;
        let context = ConfigContext {
            config_dir: &settings.config_dir,
            coeff_dir: &settings.coeff_dir,
            audiofiles_dir: app.audiofiles_dir(),
            device_types: &types,
        };
        let details = Details {
            stats: true,
            config: true,
            wav: false,
        };
        Ok(json_response(files::list_files(
            &settings.config_dir,
            details,
            Some(&context),
        )))
    })
    .await
}

pub async fn get_stored_coeffs(State(app): Shared) -> ApiResult {
    blocking(move || {
        let details = Details {
            stats: true,
            ..Default::default()
        };
        Ok(json_response(files::list_files(
            &app.settings.coeff_dir,
            details,
            None,
        )))
    })
    .await
}

pub async fn get_stored_audiofiles(State(app): Shared) -> ApiResult {
    let dir = require_audiofiles_dir(&app)?;
    blocking(move || {
        let details = Details {
            stats: true,
            wav: true,
            ..Default::default()
        };
        Ok(json_response(files::list_files(&dir, details, None)))
    })
    .await
}

/// The uploaded files, in the order of their `file0`, `file1`, ... fields.
async fn uploaded_files(mut multipart: Multipart) -> Result<Vec<(String, Bytes)>, ApiError> {
    let mut fields = HashMap::new();
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|err| bad_request(err.to_string()))?
    {
        let name = field.name().unwrap_or_default().to_string();
        let filename = field.file_name().unwrap_or_default().to_string();
        let data = field
            .bytes()
            .await
            .map_err(|err| bad_request(err.to_string()))?;
        fields.insert(name, (filename, data));
    }
    let mut files = Vec::new();
    for i in 0.. {
        match fields.remove(&format!("file{i}")) {
            Some(file) => files.push(file),
            None => break,
        }
    }
    Ok(files)
}

async fn store_files(
    folder: &Path,
    multipart: Multipart,
    transform: fn(&[u8]) -> Vec<u8>,
) -> ApiResult {
    files::require_directory(folder).map_err(internal)?;
    let uploaded = uploaded_files(multipart).await?;
    let count = uploaded.len();
    for (filename, data) in uploaded {
        let path = file_in_folder(folder, &filename).map_err(bad_request)?;
        tokio::fs::write(&path, transform(&data))
            .await
            .map_err(|err| internal(format!("Could not save {filename}: {err}")))?;
    }
    Ok(([NO_STORE], format!("Saved {count} file(s)")).into_response())
}

pub async fn store_configs(State(app): Shared, multipart: Multipart) -> ApiResult {
    store_files(
        &app.settings.config_dir,
        multipart,
        files::sanitize_uploaded_config,
    )
    .await
}

pub async fn store_coeffs(State(app): Shared, multipart: Multipart) -> ApiResult {
    store_files(&app.settings.coeff_dir, multipart, <[u8]>::to_vec).await
}

pub async fn store_audiofiles(State(app): Shared, multipart: Multipart) -> ApiResult {
    let dir = require_audiofiles_dir(&app)?;
    store_files(&dir, multipart, <[u8]>::to_vec).await
}

async fn delete_from(folder: PathBuf, body: Bytes) -> ApiResult {
    let names: Vec<String> = parse_body(&body)?;
    files::delete_files(&folder, &names).map_err(internal)?;
    Ok(text_response("ok"))
}

pub async fn delete_configs(State(app): Shared, body: Bytes) -> ApiResult {
    delete_from(app.settings.config_dir.clone(), body).await
}

pub async fn delete_coeffs(State(app): Shared, body: Bytes) -> ApiResult {
    delete_from(app.settings.coeff_dir.clone(), body).await
}

pub async fn delete_audiofiles(State(app): Shared, body: Bytes) -> ApiResult {
    delete_from(require_audiofiles_dir(&app)?, body).await
}

fn rename_in(folder: &Path, query: &HashMap<String, String>) -> ApiResult {
    let source = query_param(query, "source")?;
    let target = query_param(query, "target")?;
    files::rename_file(folder, source, target).map_err(bad_request)?;
    ok()
}

pub async fn rename_config_file(
    State(app): Shared,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult {
    rename_in(&app.settings.config_dir, &query)
}

pub async fn rename_coeff_file(
    State(app): Shared,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult {
    rename_in(&app.settings.coeff_dir, &query)
}

pub async fn rename_audio_file(
    State(app): Shared,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult {
    rename_in(&require_audiofiles_dir(&app)?, &query)
}

async fn zip_from(folder: PathBuf, body: Bytes, zip_name: &'static str) -> ApiResult {
    let names: Vec<String> = parse_body(&body)?;
    let zip = blocking(move || files::zip_of_files(&folder, &names).map_err(internal)).await?;
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

pub async fn download_configs_zip(State(app): Shared, body: Bytes) -> ApiResult {
    zip_from(app.settings.config_dir.clone(), body, "configs.zip").await
}

pub async fn download_coeffs_zip(State(app): Shared, body: Bytes) -> ApiResult {
    zip_from(app.settings.coeff_dir.clone(), body, "coeffs.zip").await
}

pub async fn download_audiofiles_zip(State(app): Shared, body: Bytes) -> ApiResult {
    zip_from(require_audiofiles_dir(&app)?, body, "audiofiles.zip").await
}

// ── GUI settings and the log ───────────────────────────────────────────────

pub async fn get_gui_config(State(app): Shared) -> Response {
    let settings = &app.settings;
    let mut config = settings::gui_config_or_defaults(settings.gui_config_file.as_deref());
    let coeff_dir = paths::relpath(&settings.coeff_dir, &settings.config_dir).join("");
    config.insert("coeff_dir".into(), json!(paths::to_string(&coeff_dir)));
    config.insert(
        "supported_capture_types".into(),
        json!(settings.supported_capture_types),
    );
    config.insert(
        "supported_playback_types".into(),
        json!(settings.supported_playback_types),
    );
    config.insert(
        "can_update_active_config".into(),
        json!(settings.can_update_active_config),
    );
    config.insert(
        "audiofiles_supported".into(),
        json!(settings.audiofiles_dir.is_some()),
    );
    config.insert(
        "allow_absolute_paths".into(),
        json!(settings.allow_absolute_paths),
    );
    log::debug!("GUI config: {config:?}");
    json_response(config)
}

pub async fn get_log_file(State(app): Shared) -> Response {
    let log_file = app.settings.log_file.as_deref();
    if let Some(path) = log_file {
        match tokio::fs::read_to_string(settings::expand_home(Path::new(path))).await {
            Ok(text) => return text_response(text),
            Err(_) => log::error!("Unable to read logfile at {path}"),
        }
    }
    let message = match log_file {
        Some(path) => format!("Please configure CamillaDSP to log to: {path}"),
        None => "Please configure a valid 'log_file' path".to_string(),
    };
    text_response(message)
}

// ── Devices ────────────────────────────────────────────────────────────────

async fn device_list(app: &AppState, backend: &str, capture: bool) -> ApiResult {
    let (result, cache_key) = if capture {
        (
            app.camilla.capture_devices(backend).await,
            "capture_devices",
        )
    } else {
        (
            app.camilla.playback_devices(backend).await,
            "playback_devices",
        )
    };
    match result {
        Ok(devices) => Ok(json_response(devices)),
        Err(DspError::Io(_)) => {
            log::debug!("CamillaDSP is offline, returning {cache_key} from cache");
            let cached = app.status.get(cache_key).get(backend).cloned();
            Ok(json_response(cached.unwrap_or_else(|| json!([]))))
        }
        Err(err) => Err(err.into()),
    }
}

pub async fn get_capture_devices(
    State(app): Shared,
    UrlPath(backend): UrlPath<String>,
) -> ApiResult {
    device_list(&app, &backend, true).await
}

pub async fn get_playback_devices(
    State(app): Shared,
    UrlPath(backend): UrlPath<String>,
) -> ApiResult {
    device_list(&app, &backend, false).await
}

/// The capabilities of a device, or the ones read earlier if CamillaDSP
/// cannot give them now.
async fn device_capabilities(
    app: &AppState,
    backend: &str,
    query: &HashMap<String, String>,
    capture: bool,
) -> ApiResult {
    let device = query
        .get("device")
        .filter(|d| !d.is_empty())
        .ok_or_else(|| bad_request("Missing required query parameter 'device'"))?;
    let (result, cache_key) = if capture {
        (
            app.camilla
                .capture_device_capabilities(backend, device)
                .await,
            "capture_device_capabilities",
        )
    } else {
        (
            app.camilla
                .playback_device_capabilities(backend, device)
                .await,
            "playback_device_capabilities",
        )
    };
    match result {
        Ok(capabilities) => {
            let capabilities = to_json(&capabilities);
            app.status
                .store_nested(cache_key, backend, device, capabilities.clone());
            Ok(json_response(capabilities))
        }
        Err(err) => match app.status.get_nested(cache_key, backend, device) {
            Some(cached) => {
                log::debug!(
                    "Failed to fetch {cache_key} for {backend}/{device}, returning cached data"
                );
                Ok(json_response(cached))
            }
            None => match err {
                DspError::Command { message, .. } => Err(bad_request(message)),
                DspError::Io(message) => Err(unavailable(message)),
            },
        },
    }
}

pub async fn get_capture_device_capabilities(
    State(app): Shared,
    UrlPath(backend): UrlPath<String>,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult {
    device_capabilities(&app, &backend, &query, true).await
}

pub async fn get_playback_device_capabilities(
    State(app): Shared,
    UrlPath(backend): UrlPath<String>,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult {
    device_capabilities(&app, &backend, &query, false).await
}

/// The device types CamillaDSP supports. They cannot change while it runs, so
/// this comes from the cache.
pub async fn get_backends(State(app): Shared) -> Response {
    json_response(app.status.get("backends"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn floats_print_like_python() {
        assert_eq!(py_float(-20.0f32), "-20.0");
        assert_eq!(py_float(0.2f32), "0.2");
        assert_eq!(as_python_f64(0.2f32), 0.2f64);
    }
}
