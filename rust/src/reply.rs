//! What the handlers answer when they succeed, typed, so that the spec of a
//! route comes from its handler's return type. With utoipa's
//! `auto_into_responses`, a handler returning `ApiResult<Reply<Status>>` is
//! documented as answering a `Status`, and a handler returning anything that
//! does not say what it sends does not compile. The errors are still listed in
//! `#[utoipa::path]`, since which ones a handler can give is not in its type.

use crate::api::{ActiveConfigFile, ApiError, AvailableDevice, ConfigFragment, StartConfig};
use crate::coeffs;
use crate::files::FileInfo;
use crate::settings::GuiConfig;
use crate::status::Status;
use crate::validate::{DeviceTypeLists, ValidationIssue};
use crate::wav::WavInfo;
use axum::http::{HeaderName, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use camilladsp_config::config::Configuration;
use camilladsp_config::protocol::{
    AudioDeviceDescriptor, Fader, SpectrumData, StateUpdate, VuLevels,
};
use serde::Serialize;
use std::collections::BTreeMap;
use std::marker::PhantomData;
use std::sync::Arc;
use utoipa::openapi::schema::{ArrayBuilder, ObjectBuilder, OneOfBuilder, Schema, Type};
use utoipa::openapi::{Content, Ref, RefOr, response::Response as SpecResponse};
use utoipa::{IntoResponses, PartialSchema, ToSchema};

/// Nothing the backend answers is to be cached, it all changes.
pub const NO_STORE: (HeaderName, &str) = (header::CACHE_CONTROL, "no-store");

/// How a type appears as a body in the spec.
pub trait BodySchema {
    fn body_schema() -> RefOr<Schema>;
}

/// A type with a schema of its own, which a body refers to. `schemas()` lists
/// them, with the schemas they refer to in turn, for the spec's components.
macro_rules! named_bodies {
    ($($ty:ty),* $(,)?) => {
        $(
            impl BodySchema for $ty {
                fn body_schema() -> RefOr<Schema> {
                    Ref::from_schema_name(<$ty as ToSchema>::name()).into()
                }
            }
        )*

        /// The schemas the bodies refer to.
        pub fn schemas() -> Vec<(String, RefOr<Schema>)> {
            let mut schemas = Vec::new();
            $(
                schemas.push((<$ty as ToSchema>::name().into_owned(), <$ty as PartialSchema>::schema()));
                <$ty as ToSchema>::schemas(&mut schemas);
            )*
            schemas
        }
    };
}

named_bodies!(
    ActiveConfigFile,
    AudioDeviceDescriptor,
    AvailableDevice,
    coeffs::CoeffDefaults,
    ConfigFragment,
    Configuration,
    DeviceTypeLists,
    Fader,
    FileInfo,
    GuiConfig,
    SpectrumData,
    StartConfig,
    StateUpdate,
    Status,
    ValidationIssue,
    VuLevels,
    WavInfo,
);

/// A type written out where it is used.
macro_rules! inline_bodies {
    ($($ty:ty),* $(,)?) => {
        $(
            impl BodySchema for $ty {
                fn body_schema() -> RefOr<Schema> {
                    <$ty as PartialSchema>::schema()
                }
            }
        )*
    };
}

inline_bodies!(bool, f32, String);

impl<T: BodySchema> BodySchema for Vec<T> {
    fn body_schema() -> RefOr<Schema> {
        ArrayBuilder::new().items(T::body_schema()).into()
    }
}

impl<T: BodySchema> BodySchema for Option<T> {
    fn body_schema() -> RefOr<Schema> {
        OneOfBuilder::new()
            .item(T::body_schema())
            .item(ObjectBuilder::new().schema_type(Type::Null))
            .into()
    }
}

impl<T: BodySchema> BodySchema for Arc<T> {
    fn body_schema() -> RefOr<Schema> {
        T::body_schema()
    }
}

/// A success response. Its description is left empty, which utoipa leaves out
/// of the spec: what the response means is in the handler's doc comment, and
/// a generic text would only repeat the status code.
fn response(
    status: StatusCode,
    content: Option<(&str, RefOr<Schema>)>,
) -> BTreeMap<String, RefOr<SpecResponse>> {
    let mut builder = utoipa::openapi::ResponseBuilder::new();
    if let Some((content_type, schema)) = content {
        builder = builder.content(content_type, Content::new(Some(schema)));
    }
    BTreeMap::from([(status.as_u16().to_string(), builder.build().into())])
}

/// The errors are documented by each handler, which knows which it gives.
impl IntoResponses for ApiError {
    fn responses() -> BTreeMap<String, RefOr<SpecResponse>> {
        BTreeMap::new()
    }
}

/// A JSON body.
pub struct Reply<T>(pub T);

impl<T: Serialize> IntoResponse for Reply<T> {
    fn into_response(self) -> Response {
        ([NO_STORE], axum::Json(self.0)).into_response()
    }
}

impl<T: BodySchema> IntoResponses for Reply<T> {
    fn responses() -> BTreeMap<String, RefOr<SpecResponse>> {
        response(StatusCode::OK, Some(("application/json", T::body_schema())))
    }
}

/// Done, nothing to say.
pub struct NoContent;

impl IntoResponse for NoContent {
    fn into_response(self) -> Response {
        (StatusCode::NO_CONTENT, [NO_STORE]).into_response()
    }
}

impl IntoResponses for NoContent {
    fn responses() -> BTreeMap<String, RefOr<SpecResponse>> {
        response(StatusCode::NO_CONTENT, None)
    }
}

/// Plain text.
pub struct Text(pub String);

impl IntoResponse for Text {
    fn into_response(self) -> Response {
        ([NO_STORE], self.0).into_response()
    }
}

impl IntoResponses for Text {
    fn responses() -> BTreeMap<String, RefOr<SpecResponse>> {
        response(StatusCode::OK, Some(("text/plain", String::schema())))
    }
}

/// Raw bytes, optionally as a file to save.
pub struct Binary {
    bytes: Vec<u8>,
    attachment: Option<String>,
}

impl Binary {
    pub fn new(bytes: Vec<u8>) -> Self {
        Binary {
            bytes,
            attachment: None,
        }
    }

    /// Bytes the browser offers to save under this name.
    pub fn attachment(bytes: Vec<u8>, name: &str) -> Self {
        Binary {
            bytes,
            attachment: Some(format!("attachment; filename={name}")),
        }
    }
}

impl IntoResponse for Binary {
    fn into_response(self) -> Response {
        let mut response = (
            [NO_STORE, (header::CONTENT_TYPE, "application/octet-stream")],
            self.bytes,
        )
            .into_response();
        if let Some(disposition) = self.attachment
            && let Ok(value) = HeaderValue::from_str(&disposition)
        {
            response
                .headers_mut()
                .insert(header::CONTENT_DISPOSITION, value);
        }
        response
    }
}

impl IntoResponses for Binary {
    fn responses() -> BTreeMap<String, RefOr<SpecResponse>> {
        // A `Vec<u8>` would be an array of numbers.
        let schema = ObjectBuilder::new()
            .schema_type(Type::String)
            .format(Some(utoipa::openapi::SchemaFormat::KnownFormat(
                utoipa::openapi::KnownFormat::Binary,
            )))
            .description(Some("Raw bytes, not JSON."));
        response(
            StatusCode::OK,
            Some(("application/octet-stream", schema.into())),
        )
    }
}

/// A stream of server-sent events, each with a `T` as its data. OpenAPI cannot
/// describe a stream, so the spec gives the type of one event.
pub struct EventStream<T> {
    response: Response,
    event: PhantomData<T>,
}

impl<T> EventStream<T> {
    pub fn new(sse: impl IntoResponse) -> Self {
        let mut response = sse.into_response();
        let headers = response.headers_mut();
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            HeaderValue::from_static("*"),
        );
        // Tells nginx not to buffer the stream, which would hold the events back.
        headers.insert("x-accel-buffering", HeaderValue::from_static("no"));
        EventStream {
            response,
            event: PhantomData,
        }
    }
}

impl<T> IntoResponse for EventStream<T> {
    fn into_response(self) -> Response {
        self.response
    }
}

impl<T: BodySchema> IntoResponses for EventStream<T> {
    fn responses() -> BTreeMap<String, RefOr<SpecResponse>> {
        response(
            StatusCode::OK,
            Some(("text/event-stream", T::body_schema())),
        )
    }
}
