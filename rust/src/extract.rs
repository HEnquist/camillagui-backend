//! axum's `Json`, `Query` and `Path` extractors, with their rejections turned
//! into `ApiError`s, so that a request that does not parse gets the same JSON
//! error body as every other error.

use crate::api::ApiError;
use axum::extract::{FromRequest, FromRequestParts, Request};
use axum::http::request::Parts;
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
