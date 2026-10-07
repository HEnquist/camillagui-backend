//! The backend of the CamillaDSP web GUI: the `/api` the frontend talks to,
//! the frontend itself, embedded in the binary, and the config, coefficient
//! and audio file folders.

mod api;
mod camilla;
mod coeffs;
mod convolver;
mod eqapo;
mod events;
mod extract;
mod files;
#[cfg(test)]
mod filter_variants;
mod gui;
mod legacy;
mod openapi;
mod paths;
mod settings;
mod status;
mod validate;
mod wav;
mod yaml;

use api::AppState;
use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::get;
use clap::Parser;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tower_http::services::ServeDir;
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

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

/// The `/api` routes. They are registered with `routes!`, which puts them in
/// the spec as well, all but the spec itself.
fn api_routes() -> OpenApiRouter<Arc<AppState>> {
    OpenApiRouter::new()
        .routes(routes!(api::get_levels))
        .routes(routes!(api::get_status))
        .routes(routes!(api::get_state))
        .routes(routes!(api::get_spectrum))
        .routes(routes!(api::get_volume, api::set_volume))
        .routes(routes!(api::get_mute, api::set_mute))
        .routes(routes!(api::get_faders))
        .routes(routes!(api::set_fader_volume))
        .routes(routes!(api::set_fader_mute))
        .routes(routes!(api::get_config))
        .routes(routes!(api::set_config))
        .routes(routes!(api::stop_processing))
        .routes(routes!(api::validate_config))
        .routes(routes!(api::get_config_at_gui_start))
        .routes(routes!(api::get_active_config_name))
        .routes(routes!(api::set_active_config_name))
        .routes(routes!(api::get_default_config_file))
        .routes(routes!(api::get_config_file))
        .routes(routes!(api::save_config_file))
        .routes(routes!(api::yaml_to_json))
        .routes(routes!(api::translate_convolver_to_json))
        .routes(routes!(api::translate_eqapo_to_json))
        .routes(routes!(api::conv_coefficients))
        .routes(routes!(api::get_wav_info))
        .routes(routes!(api::get_defaults_for_coeffs))
        .routes(routes!(api::get_files))
        .routes(routes!(api::upload_files))
        .routes(routes!(api::delete_files))
        .routes(routes!(api::rename_file))
        .routes(routes!(api::zip_files))
        .routes(routes!(api::get_gui_config))
        .routes(routes!(api::get_log_file))
        .routes(routes!(api::get_devices))
        .routes(routes!(api::get_device_capabilities))
        .routes(routes!(api::get_backends))
        .route("/openapi.json", get(openapi::get_spec))
}

/// The `/api` router, and the spec of its typed routes.
pub fn api() -> (Router<Arc<AppState>>, utoipa::openapi::OpenApi) {
    OpenApiRouter::with_openapi(openapi::ApiDoc::openapi())
        .nest("/api", api_routes())
        .split_for_parts()
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
    let mut router = api()
        .0
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
    let bind = format!("{}:{}", settings.bind_address, settings.port);
    let app = Arc::new(AppState {
        settings,
        camilla,
        status,
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
