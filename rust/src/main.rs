//! The backend of the CamillaDSP web GUI: the `/api` the frontend talks to,
//! the frontend itself, embedded in the binary, and the config, coefficient
//! and audio file folders.

mod api;
mod camilla;
mod coeffs;
mod convolver;
mod eqapo;
mod events;
mod files;
#[cfg(test)]
mod filter_variants;
mod gui;
mod legacy;
mod paths;
mod settings;
mod status;
mod validate;
mod wav;
mod yaml;

use api::AppState;
use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};
use clap::Parser;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tower_http::services::ServeDir;

#[derive(Parser)]
#[command(about = "Backend for the CamillaDSP web GUI", version)]
struct Args {
    /// The backend config file. Defaults to config/camillagui.yml next to the executable.
    #[arg(short, long)]
    config: Option<PathBuf>,
    /// Logging level: error, warn, info, debug or trace.
    #[arg(short, long, default_value = "warn")]
    log_level: String,
}

/// Uploads can be large audio files.
const MAX_UPLOAD_SIZE: usize = 1024 * 1024 * 1024;

fn api_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/events", get(api::get_events))
        .route("/status", get(api::get_status))
        .route("/getparam/{name}", get(api::get_param))
        .route("/getparamjson/{name}", get(api::get_param_json))
        .route("/getlistparam/{name}", get(api::get_list_param))
        .route("/setparam/{name}", post(api::set_param))
        .route("/setparamindex/{name}/{index}", post(api::set_param_index))
        .route("/convcoeffs", post(api::conv_coefficients))
        .route("/getconfig", get(api::get_config))
        .route("/setconfig", post(api::set_config))
        .route("/stop", post(api::stop_processing))
        .route("/spectrum/subscribe", post(api::subscribe_spectrum))
        .route("/spectrum/unsubscribe", post(api::unsubscribe_spectrum))
        .route("/getstartconfig", get(api::get_config_at_gui_start))
        .route("/getactiveconfigfilename", get(api::get_active_config_name))
        .route("/getdefaultconfigfile", get(api::get_default_config_file))
        .route("/setactiveconfigfile", post(api::set_active_config_name))
        .route("/configtoyml", post(api::config_to_yml))
        .route(
            "/ymlconfigtojsonconfig",
            post(api::parse_and_validate_yml_config_to_json),
        )
        .route("/ymltojson", post(api::yaml_to_json))
        .route("/convolvertojson", post(api::translate_convolver_to_json))
        .route("/eqapotojson", post(api::translate_eqapo_to_json))
        .route("/validateconfig", post(api::validate_config))
        .route("/wavinfo", get(api::get_wav_info))
        .route("/storedconfigs", get(api::get_stored_configs))
        .route("/storedcoeffs", get(api::get_stored_coeffs))
        .route("/storedaudiofiles", get(api::get_stored_audiofiles))
        .route("/defaultsforcoeffs", get(api::get_defaults_for_coeffs))
        .route("/uploadconfigs", post(api::store_configs))
        .route("/uploadcoeffs", post(api::store_coeffs))
        .route("/uploadaudiofiles", post(api::store_audiofiles))
        .route("/deleteconfigs", post(api::delete_configs))
        .route("/deletecoeffs", post(api::delete_coeffs))
        .route("/deleteaudiofiles", post(api::delete_audiofiles))
        .route("/renameconfig", post(api::rename_config_file))
        .route("/renamecoeff", post(api::rename_coeff_file))
        .route("/renamewav", post(api::rename_audio_file))
        .route("/downloadconfigszip", post(api::download_configs_zip))
        .route("/downloadcoeffszip", post(api::download_coeffs_zip))
        .route("/downloadaudiofileszip", post(api::download_audiofiles_zip))
        .route("/guiconfig", get(api::get_gui_config))
        .route("/getconfigfile", get(api::get_config_file))
        .route("/saveconfigfile", post(api::save_config_file))
        .route("/logfile", get(api::get_log_file))
        .route("/capturedevices/{backend}", get(api::get_capture_devices))
        .route("/playbackdevices/{backend}", get(api::get_playback_devices))
        .route(
            "/capturedevicecapabilities/{backend}",
            get(api::get_capture_device_capabilities),
        )
        .route(
            "/playbackdevicecapabilities/{backend}",
            get(api::get_playback_device_capabilities),
        )
        .route("/backends", get(api::get_backends))
}

/// Serve a folder, or warn and carry on if it does not exist. Without it the
/// GUI still works, it just has no files of that kind until it is created.
fn add_folder(
    router: Router<Arc<AppState>>,
    prefix: &str,
    folder: &Path,
    setting: &str,
) -> Router<Arc<AppState>> {
    if folder.is_dir() {
        router.nest_service(prefix, ServeDir::new(folder))
    } else {
        log::warn!(
            "The directory {}, set as {setting}, does not exist. Create it and restart the backend to use it.",
            folder.display()
        );
        router
    }
}

pub fn build_router(app: Arc<AppState>) -> Router {
    let settings = &app.settings;
    let mut router = Router::new()
        .nest("/api", api_routes())
        .route("/", get(api::get_gui_index))
        .route("/gui/{*path}", get(gui::file));
    router = add_folder(router, "/config", &settings.config_dir, "config_dir");
    router = add_folder(router, "/coeff", &settings.coeff_dir, "coeff_dir");
    if let Some(audiofiles_dir) = &settings.audiofiles_dir {
        router = add_folder(router, "/audiofiles", audiofiles_dir, "audiofiles_dir");
    }
    router
        .layer(DefaultBodyLimit::max(MAX_UPLOAD_SIZE))
        .with_state(app)
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    env_logger::Builder::new()
        .parse_filters(&args.log_level)
        .init();

    let config_path = args
        .config
        .unwrap_or_else(|| settings::default_config_folder().join("camillagui.yml"));
    let settings = match settings::Settings::load(&config_path) {
        Ok(settings) => settings,
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(1);
        }
    };
    if settings.ssl_certificate.is_some() || settings.ssl_private_key.is_some() {
        // Serving plain HTTP when HTTPS was asked for would be worse than not starting.
        eprintln!(
            "HTTPS is no longer built into the backend, use a reverse proxy such as nginx or Caddy \
             for it, see \"HTTPS\" in the README. Then remove ssl_certificate and ssl_private_key \
             from {}.",
            config_path.display()
        );
        std::process::exit(1);
    }

    let camilla = Arc::new(camilla::CamillaClient::new(
        &settings.camilla_host,
        settings.camilla_port,
    ));
    let status = Arc::new(status::StatusCache::new());
    let publisher = events::Publisher::new();
    let spectrum = if settings.enable_level_stream {
        let levels = events::LevelStream::new(
            camilla.url(),
            status.clone(),
            publisher.clone(),
            settings.level_smoothing_ms,
            settings.level_max_update_hz,
        );
        tokio::spawn(levels.run());
        Some(events::SpectrumStream::new(
            camilla.url(),
            publisher.clone(),
        ))
    } else {
        None
    };
    let bind = format!("{}:{}", settings.bind_address, settings.port);
    let app = Arc::new(AppState {
        settings,
        camilla,
        status,
        publisher,
        spectrum,
    });
    let router = build_router(app);

    let listener = match tokio::net::TcpListener::bind(&bind).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("Could not listen on {bind}: {err}");
            std::process::exit(1);
        }
    };
    log::info!("Listening on {bind}");
    // No graceful shutdown: it would wait for every open event stream to end.
    axum::serve(listener, router).await.expect("server error");
}
