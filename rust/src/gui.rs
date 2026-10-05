//! The frontend build, embedded in the binary and served under `/gui/`.

use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Redirect, Response};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "../frontend/build"]
struct Frontend;

pub async fn index() -> Redirect {
    Redirect::to("/gui/index.html")
}

pub async fn file(axum::extract::Path(path): axum::extract::Path<String>) -> Response {
    let path = if path.is_empty() { "index.html".to_string() } else { path };
    let Some(file) = Frontend::get(&path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mime = file.metadata.mimetype().to_string();
    // HTML and CSS must not be cached, or a browser keeps running the old
    // frontend after an upgrade. The rest have content hashes in their names.
    let lower = path.to_lowercase();
    let cache = if lower.ends_with(".html") || lower.ends_with(".css") {
        "no-cache"
    } else {
        "public, max-age=3600"
    };
    (
        [(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, cache.to_string())],
        file.data,
    )
        .into_response()
}
