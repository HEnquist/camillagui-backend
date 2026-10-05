//! A minimal request/response client for CamillaDSP's websocket API.
//!
//! The framing is written out by hand here. Session A3 moves the protocol types
//! into camilladsp-config, after which this uses `WsCommand` and `WsReply`.

use futures_util::{SinkExt, StreamExt};
use serde_json::{Map, Value, json};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

pub type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(1);
const REPLY_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug)]
pub enum CdspError {
    /// Not connected, or the connection failed.
    Io(String),
    /// CamillaDSP answered, but with an error.
    Command(String),
}

impl std::fmt::Display for CdspError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CdspError::Io(msg) | CdspError::Command(msg) => write!(f, "{msg}"),
        }
    }
}

/// One parsed reply: name, result, value and message.
pub struct Reply {
    pub name: String,
    pub result: String,
    pub value: Value,
    pub message: Option<String>,
}

pub async fn connect(url: &str) -> Result<Ws, CdspError> {
    match tokio::time::timeout(CONNECT_TIMEOUT, tokio_tungstenite::connect_async(url)).await {
        Ok(Ok((ws, _))) => Ok(ws),
        Ok(Err(err)) => Err(CdspError::Io(err.to_string())),
        Err(_) => Err(CdspError::Io("Timed out connecting to CamillaDSP".to_string())),
    }
}

pub fn format_command(command: &str, args: Value) -> String {
    let mut message = Map::new();
    message.insert("command".to_string(), json!(command));
    if let Value::Object(args) = args {
        message.extend(args);
    }
    Value::Object(message).to_string()
}

pub fn parse_reply(raw: &str) -> Result<Reply, CdspError> {
    let invalid = || CdspError::Io(format!("Invalid response received: {raw}"));
    let mut reply: Map<String, Value> = serde_json::from_str(raw).map_err(|_| invalid())?;
    let name = match reply.remove("reply") {
        Some(Value::String(name)) => name,
        _ => return Err(invalid()),
    };
    if name == "Invalid" {
        let error = reply.remove("error").and_then(|e| e.as_str().map(String::from));
        return Err(CdspError::Command(error.unwrap_or_else(|| "Command not recognized".into())));
    }
    let result = match reply.remove("result") {
        Some(Value::String(result)) => result,
        _ => return Err(invalid()),
    };
    Ok(Reply {
        name,
        result,
        value: reply.remove("value").unwrap_or(Value::Null),
        message: reply.remove("message").and_then(|m| m.as_str().map(String::from)),
    })
}

/// Read the next text frame, skipping pings and the like.
pub async fn next_text(ws: &mut Ws) -> Result<String, CdspError> {
    loop {
        match ws.next().await {
            Some(Ok(Message::Text(text))) => return Ok(text.to_string()),
            Some(Ok(Message::Binary(data))) => {
                return String::from_utf8(data.to_vec())
                    .map_err(|_| CdspError::Io("Non-UTF-8 binary message".into()));
            }
            Some(Ok(Message::Close(_))) | None => {
                return Err(CdspError::Io("Websocket closed".into()));
            }
            Some(Ok(_)) => continue,
            Some(Err(err)) => return Err(CdspError::Io(err.to_string())),
        }
    }
}

/// Send a command on an open socket and wait for its reply value.
pub async fn send_command(ws: &mut Ws, command: &str, args: Value) -> Result<Value, CdspError> {
    ws.send(Message::text(format_command(command, args)))
        .await
        .map_err(|err| CdspError::Io(err.to_string()))?;
    let raw = tokio::time::timeout(REPLY_TIMEOUT, next_text(ws))
        .await
        .map_err(|_| CdspError::Io(format!("No reply to {command}")))??;
    let reply = parse_reply(&raw)?;
    if reply.name != command {
        return Err(CdspError::Io(format!(
            "Got a reply to {} while waiting for {command}",
            reply.name
        )));
    }
    if reply.result != "Ok" {
        return Err(CdspError::Command(
            reply.message.unwrap_or_else(|| format!("{command} failed: {}", reply.result)),
        ));
    }
    Ok(reply.value)
}

/// A shared connection for request/response commands. Connects on first use
/// and again after any connection error, so there is no reconnect thread.
pub struct CdspClient {
    url: String,
    ws: Mutex<Option<Ws>>,
}

impl CdspClient {
    pub fn new(host: &str, port: u16) -> Self {
        CdspClient {
            url: format!("ws://{host}:{port}"),
            ws: Mutex::new(None),
        }
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub async fn query(&self, command: &str) -> Result<Value, CdspError> {
        self.query_with(command, Value::Null).await
    }

    pub async fn query_with(&self, command: &str, args: Value) -> Result<Value, CdspError> {
        let mut guard = self.ws.lock().await;
        if guard.is_none() {
            *guard = Some(connect(&self.url).await?);
        }
        let ws = guard.as_mut().expect("connected above");
        let result = send_command(ws, command, args).await;
        if let Err(CdspError::Io(_)) = result {
            *guard = None;
        }
        result
    }
}
