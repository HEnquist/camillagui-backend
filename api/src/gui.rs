//! The frontend build, embedded in the binary and served under `/gui/`.

use crate::api::AppState;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use rust_embed::Embed;
use std::borrow::Cow;
use std::sync::Arc;

#[derive(Embed)]
#[folder = "../frontend/build"]
struct Frontend;

/// The stylesheet users edit to restyle the GUI. A copy next to
/// `camillagui.yml` is served in place of the embedded one.
const STYLE_OVERRIDE: &str = "css-variables.css";

pub async fn file(State(app): State<Arc<AppState>>, Path(path): Path<String>) -> Response {
    let path = if path.is_empty() {
        "index.html".to_string()
    } else {
        path
    };
    let data: Cow<'static, [u8]> = match read_override(&app, &path).await {
        Some(data) => Cow::Owned(data),
        None => match Frontend::get(&path) {
            Some(file) => file.data,
            None => return StatusCode::NOT_FOUND.into_response(),
        },
    };
    let mime = mime_guess(&path);
    // HTML and CSS must not be cached, or a browser keeps running the old
    // frontend after an upgrade. The rest have content hashes in their names.
    let lower = path.to_lowercase();
    let cache = if lower.ends_with(".html") || lower.ends_with(".css") {
        "no-cache"
    } else {
        "public, max-age=3600"
    };
    (
        [
            (header::CONTENT_TYPE, mime),
            (header::CACHE_CONTROL, cache.to_string()),
        ],
        data,
    )
        .into_response()
}

async fn read_override(app: &AppState, path: &str) -> Option<Vec<u8>> {
    if path != STYLE_OVERRIDE {
        return None;
    }
    let file = app.settings.settings_folder.join(STYLE_OVERRIDE);
    tokio::fs::read(&file).await.ok()
}

/// The type of an embedded file. The style override has an embedded original too.
fn mime_guess(path: &str) -> String {
    Frontend::get(path)
        .map(|file| file.metadata.mimetype().to_string())
        .unwrap_or_else(|| "application/octet-stream".to_string())
}
