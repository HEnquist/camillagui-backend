//! CamillaGUI backend in Rust. A spike that serves `/api/status`, `/api/events`
//! and `/api/validateconfig`, plus the embedded frontend.

mod cdsp;
mod events;
mod gui;
mod settings;
mod status;
mod validate;

use axum::Router;
use axum::extract::State;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use clap::Parser;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Parser)]
#[command(about = "Backend for the CamillaDSP web GUI")]
struct Args {
    /// The backend config file.
    #[arg(short, long, default_value = "camillagui.yml")]
    config: PathBuf,
    /// Logging level: error, warn, info, debug or trace.
    #[arg(short, long, default_value = "warn")]
    log_level: String,
}

struct AppState {
    settings: settings::Settings,
    cdsp: cdsp::CdspClient,
    status: Arc<status::StatusCache>,
    levels: Option<Arc<events::LevelStream>>,
}

type Shared = State<Arc<AppState>>;

const NO_STORE: (header::HeaderName, &str) = (header::CACHE_CONTROL, "no-store");

async fn get_status(State(app): Shared) -> Response {
    let status = app.status.refresh(&app.cdsp).await;
    ([NO_STORE], axum::Json(status)).into_response()
}

async fn get_events(State(app): Shared) -> Response {
    match &app.levels {
        None => (StatusCode::SERVICE_UNAVAILABLE, [NO_STORE], "Event stream is disabled")
            .into_response(),
        Some(levels) => {
            let mut response = levels.subscribe().into_response();
            response.headers_mut().insert(
                header::ACCESS_CONTROL_ALLOW_ORIGIN,
                HeaderValue::from_static("*"),
            );
            response
        }
    }
}

async fn validate_config(State(app): Shared, axum::Json(config): axum::Json<Value>) -> Response {
    let config_dir = app.settings.config_dir.clone();
    let coeff_dir = app.settings.coeff_dir.clone();
    // Validation reads every coefficient file, which can take a while.
    let result = tokio::task::spawn_blocking(move || {
        validate::validate(config, &config_dir, &coeff_dir)
    })
    .await;
    match result {
        Ok(None) => ([NO_STORE], "OK").into_response(),
        Ok(Some(issues)) => {
            log::debug!("Config has errors: {issues}");
            (StatusCode::NOT_ACCEPTABLE, [NO_STORE], axum::Json(issues)).into_response()
        }
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response(),
    }
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    env_logger::Builder::new()
        .parse_filters(&args.log_level)
        .init();

    let settings = match settings::Settings::load(&args.config) {
        Ok(settings) => settings,
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(1);
        }
    };
    let cdsp = cdsp::CdspClient::new(&settings.camilla_host, settings.camilla_port);
    let status = Arc::new(status::StatusCache::new());
    let levels = settings.enable_level_stream.then(|| {
        events::LevelStream::new(
            cdsp.url(),
            status.clone(),
            settings.level_smoothing_ms,
            settings.level_max_update_hz,
        )
    });
    if let Some(levels) = &levels {
        tokio::spawn(levels.clone().run());
    }
    let bind = format!("{}:{}", settings.bind_address, settings.port);
    let app = Arc::new(AppState {
        settings,
        cdsp,
        status,
        levels,
    });

    let router = Router::new()
        .route("/api/status", get(get_status))
        .route("/api/events", get(get_events))
        .route("/api/validateconfig", post(validate_config))
        .route("/", get(gui::index))
        .route("/gui/{*path}", get(gui::file))
        .with_state(app);

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
