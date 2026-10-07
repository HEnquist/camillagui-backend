//! The OpenAPI spec of `/api`, generated from the typed handlers and served at
//! `/api/openapi.json`. A copy is committed as `api/openapi.json`, which the
//! frontend generates its API and config types from, and a test checks that
//! the copy is current.

use crate::api::{Direction, FileKind};
use crate::coeffs::CoeffsHeader;
use axum::http::header;
use axum::response::{IntoResponse, Response};
use camilladsp_schema::config::Configuration;
use std::sync::LazyLock;
use utoipa::OpenApi;

/// The config is listed on its own, since the frontend uses its type
/// everywhere, not only where an endpoint sends or takes one. So are the path
/// parameters, which are not added by the routes that use them, and the
/// header inside the binary `/api/convcoeffs` reply.
#[derive(OpenApi)]
#[openapi(
    info(
        title = "CamillaGUI",
        version = "internal",
        description = "The API between the CamillaGUI backend and its frontend. It is internal \
            to the GUI and changes with it, so it has no version of its own."
    ),
    components(schemas(Configuration, FileKind, Direction, CoeffsHeader))
)]
pub struct ApiDoc;

static SPEC: LazyLock<String> = LazyLock::new(|| render(&crate::api().1));

/// The spec as pretty printed JSON, the way the committed copy has it.
pub fn render(spec: &utoipa::openapi::OpenApi) -> String {
    let mut text = spec.to_pretty_json().expect("the spec serializes");
    text.push('\n');
    text
}

pub async fn get_spec() -> Response {
    ([(header::CONTENT_TYPE, "application/json")], SPEC.as_str()).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn committed_spec_is_current() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("openapi.json");
        let generated = render(&crate::api().1);
        if std::env::var_os("UPDATE_OPENAPI").is_some() {
            std::fs::write(&path, &generated).expect("api/openapi.json is writable");
            return;
        }
        let committed = std::fs::read_to_string(&path).unwrap_or_default();
        assert!(
            committed == generated,
            "api/openapi.json is not what the code generates. Rewrite it with \
             `UPDATE_OPENAPI=1 cargo test committed_spec_is_current` in api/, then run \
             `npm run generate-api` in frontend/."
        );
    }

    fn collect_refs(value: &serde_json::Value, refs: &mut Vec<String>) {
        match value {
            serde_json::Value::Object(map) => {
                if let Some(serde_json::Value::String(target)) = map.get("$ref") {
                    refs.push(target.clone());
                }
                map.values().for_each(|v| collect_refs(v, refs));
            }
            serde_json::Value::Array(items) => items.iter().for_each(|v| collect_refs(v, refs)),
            _ => {}
        }
    }

    /// A response body type missing from `named_bodies!` in `reply.rs` does not
    /// compile, but a schema it refers to could still be left out.
    #[test]
    fn every_reference_resolves() {
        let spec = serde_json::to_value(crate::api().1).unwrap();
        let mut refs = Vec::new();
        collect_refs(&spec, &mut refs);
        let schemas = spec["components"]["schemas"].as_object().unwrap();
        let missing: Vec<&String> = refs
            .iter()
            .filter(|target| {
                let name = target.trim_start_matches("#/components/schemas/");
                !schemas.contains_key(name)
            })
            .collect();
        assert!(missing.is_empty(), "unresolved references: {missing:?}");
    }
}
