//! axum's `Json`, `Query` and `Path` extractors, and a `Form`, with their
//! rejections turned into `ApiError`s, so that a request that does not parse
//! gets the same JSON error body as every other error.

use crate::api::ApiError;
use axum::body::Bytes;
use axum::extract::{FromRequest, FromRequestParts, Request};
use axum::http::request::Parts;
use axum::http::{StatusCode, header};
use axum::response::IntoResponse;
use serde::de::DeserializeOwned;

fn rejected(rejection: impl IntoResponse + ToString) -> ApiError {
    let message = rejection.to_string();
    ApiError::new(rejection.into_response().status(), message)
}

/// A JSON request body. Unlike the old raw body parsing, it needs a
/// `Content-Type: application/json`, which openapi-fetch always sends.
pub struct Json<T>(pub T);

impl<S: Send + Sync, T: DeserializeOwned> FromRequest<S> for Json<T> {
    type Rejection = ApiError;

    async fn from_request(request: Request, state: &S) -> Result<Self, ApiError> {
        match axum::Json::<T>::from_request(request, state).await {
            Ok(axum::Json(value)) => Ok(Json(value)),
            Err(rejection) => Err(rejected(rejection)),
        }
    }
}

/// An `application/x-www-form-urlencoded` request body, as a browser posts a
/// form. Unlike axum's `Form`, a field given more than once fills a `Vec`.
pub struct Form<T>(pub T);

impl<S: Send + Sync, T: DeserializeOwned> FromRequest<S> for Form<T> {
    type Rejection = ApiError;

    async fn from_request(request: Request, state: &S) -> Result<Self, ApiError> {
        let is_form = request
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("application/x-www-form-urlencoded"));
        if !is_form {
            return Err(ApiError::new(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "Expected request with `Content-Type: application/x-www-form-urlencoded`",
            ));
        }
        let body = Bytes::from_request(request, state)
            .await
            .map_err(rejected)?;
        serde_html_form::from_bytes(&body).map(Form).map_err(|err| {
            ApiError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("Failed to deserialize form body: {err}"),
            )
        })
    }
}

pub struct Query<T>(pub T);

impl<S: Send + Sync, T: DeserializeOwned> FromRequestParts<S> for Query<T> {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, ApiError> {
        match axum::extract::Query::<T>::from_request_parts(parts, state).await {
            Ok(axum::extract::Query(value)) => Ok(Query(value)),
            Err(rejection) => Err(rejected(rejection)),
        }
    }
}

/// A `multipart/form-data` request body.
pub struct Multipart(pub axum::extract::Multipart);

impl<S: Send + Sync> FromRequest<S> for Multipart {
    type Rejection = ApiError;

    async fn from_request(request: Request, state: &S) -> Result<Self, ApiError> {
        axum::extract::Multipart::from_request(request, state)
            .await
            .map(Multipart)
            .map_err(rejected)
    }
}

pub struct Path<T>(pub T);

impl<S: Send + Sync, T: DeserializeOwned + Send> FromRequestParts<S> for Path<T> {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, ApiError> {
        match axum::extract::Path::<T>::from_request_parts(parts, state).await {
            Ok(axum::extract::Path(value)) => Ok(Path(value)),
            Err(rejection) => Err(rejected(rejection)),
        }
    }
}
