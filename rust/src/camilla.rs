//! A client for CamillaDSP's websocket API, using the protocol types from
//! camilladsp-config so the messages are exactly the ones the DSP itself uses.

use camilladsp_config::config::{self, Configuration};
use camilladsp_config::protocol::{
    AudioDeviceDescriptor, ChannelLabels, Fader, ProcessingState, StopReason, WsCommand, WsReply,
    WsResult,
};
use futures_util::{SinkExt, StreamExt};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

pub type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(1);
const REPLY_TIMEOUT: Duration = Duration::from_secs(5);
/// How long requests fail at once after a failed connect, before the next
/// one tries again.
const RETRY_INTERVAL: Duration = Duration::from_secs(1);
/// Applying or reading a config makes CamillaDSP read every coefficient file,
/// which takes a while for long filters on a small machine.
const CONFIG_REPLY_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug)]
pub enum DspError {
    /// Not connected, or the connection failed. pycamilladsp raised IOError.
    Io(String),
    /// CamillaDSP answered, but with an error. pycamilladsp raised DspError.
    Command { result: String, message: String },
}

impl DspError {
    /// The name of the error result, for example `ProcessingNotRunningError`.
    pub fn result(&self) -> Option<&str> {
        match self {
            DspError::Io(_) => None,
            DspError::Command { result, .. } => Some(result),
        }
    }
}

impl std::fmt::Display for DspError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DspError::Io(msg) => write!(f, "{msg}"),
            DspError::Command { message, .. } => write!(f, "{message}"),
        }
    }
}

/// A JSON value of something CamillaDSP sent. serde_json widens an f32 to f64
/// when it builds a `Value`, so 0.2 would become 0.20000000298023224. Going
/// through text keeps the short form, which is also what Python read.
pub fn to_json(value: &impl serde::Serialize) -> serde_json::Value {
    serde_json::to_string(value)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn io_error(err: impl std::fmt::Display) -> DspError {
    DspError::Io(err.to_string())
}

/// `Ok(())` for a successful result, otherwise the error it carries.
pub fn check(result: WsResult) -> Result<(), DspError> {
    if result == WsResult::Ok {
        return Ok(());
    }
    // The tag is the result name, the only way to get it without listing every variant.
    let tagged = serde_json::to_value(&result).unwrap_or_default();
    let name = tagged
        .get("result")
        .and_then(|r| r.as_str())
        .unwrap_or("UnknownError")
        .to_string();
    let message = tagged
        .get("message")
        .and_then(|m| m.as_str())
        .map(String::from)
        .unwrap_or_else(|| name.clone());
    Err(DspError::Command {
        result: name,
        message,
    })
}

pub async fn connect(url: &str) -> Result<Ws, DspError> {
    match tokio::time::timeout(CONNECT_TIMEOUT, tokio_tungstenite::connect_async(url)).await {
        Ok(Ok((ws, _))) => Ok(ws),
        Ok(Err(err)) => Err(io_error(err)),
        Err(_) => Err(DspError::Io(
            "Timed out connecting to CamillaDSP".to_string(),
        )),
    }
}

pub async fn send(ws: &mut Ws, command: &WsCommand) -> Result<(), DspError> {
    let text = serde_json::to_string(command).map_err(io_error)?;
    ws.send(Message::text(text)).await.map_err(io_error)
}

/// Read the text of the next message, skipping pings and the like.
pub async fn receive_text(ws: &mut Ws) -> Result<String, DspError> {
    loop {
        match ws.next().await {
            Some(Ok(Message::Text(text))) => return Ok(text.to_string()),
            Some(Ok(Message::Binary(data))) => {
                return String::from_utf8(data.to_vec())
                    .map_err(|_| io_error("Non-UTF-8 binary message"));
            }
            Some(Ok(Message::Close(_))) | None => return Err(io_error("Websocket closed")),
            Some(Ok(_)) => continue,
            Some(Err(err)) => return Err(io_error(err)),
        }
    }
}

/// Read the next reply, skipping pings and the like. A reply to a command
/// CamillaDSP did not recognize is returned as an error.
pub async fn receive(ws: &mut Ws) -> Result<WsReply, DspError> {
    let text = receive_text(ws).await?;
    match serde_json::from_str::<WsReply>(&text) {
        Ok(WsReply::Invalid { error }) => Err(DspError::Command {
            result: "Invalid".to_string(),
            message: error,
        }),
        Ok(reply) => Ok(reply),
        Err(err) => Err(DspError::Io(format!(
            "Invalid response received: {text}, {err}"
        ))),
    }
}

/// Send a command on an open socket and wait for the reply.
pub async fn request_on(
    ws: &mut Ws,
    command: &WsCommand,
    timeout: Duration,
) -> Result<WsReply, DspError> {
    send(ws, command).await?;
    tokio::time::timeout(timeout, receive(ws))
        .await
        .map_err(|_| io_error("Timed out waiting for a reply from CamillaDSP"))?
}

/// Pull the value out of the expected reply variant, or turn the result into an error.
macro_rules! value_of {
    ($reply:expr, $variant:ident) => {
        match $reply {
            WsReply::$variant { result, value } => check(result).map(|_| value),
            other => Err(unexpected(other)),
        }
    };
}

/// Check the result of a reply that carries no value.
macro_rules! result_of {
    ($reply:expr, $variant:ident) => {
        match $reply {
            WsReply::$variant { result } => check(result),
            other => Err(unexpected(other)),
        }
    };
}

fn unexpected(reply: WsReply) -> DspError {
    DspError::Io(format!("Unexpected reply from CamillaDSP: {reply:?}"))
}

/// A failed connect, which requests are answered with until the next try.
struct Offline {
    error: String,
    retry_at: Instant,
}

/// A shared connection for request/response commands. Connects on first use
/// and again after any connection error, so there is no reconnect thread.
///
/// After a connect fails, requests fail at once with the same error until
/// `RETRY_INTERVAL` has passed, and while the next try is under way. An
/// unreachable host takes the whole connect timeout to fail, and without this
/// every request would wait that out, one after the other on the lock.
pub struct CamillaClient {
    url: String,
    ws: Mutex<Option<Ws>>,
    offline: std::sync::Mutex<Option<Offline>>,
    connections: AtomicU64,
}

impl CamillaClient {
    pub fn new(host: &str, port: u16) -> Self {
        CamillaClient {
            url: format!("ws://{host}:{port}"),
            ws: Mutex::new(None),
            offline: std::sync::Mutex::new(None),
            connections: AtomicU64::new(0),
        }
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    /// The number of the current connection, counting from 1, so that a new
    /// one can be told from the one seen last. Any request reconnects, so a
    /// CamillaDSP restart may go by without any one caller seeing it fail.
    pub fn connection(&self) -> u64 {
        self.connections.load(Ordering::Relaxed)
    }

    /// The error of the last failed connect, until it is time to try again.
    fn check_offline(&self) -> Result<(), DspError> {
        match &*self.offline.lock().unwrap() {
            Some(offline) if Instant::now() < offline.retry_at => {
                Err(DspError::Io(offline.error.clone()))
            }
            _ => Ok(()),
        }
    }

    /// Connect, and ask for the version, like pycamilladsp, which also checks
    /// that the other end really is CamillaDSP.
    async fn connect_checked(&self) -> Result<Ws, DspError> {
        if let Some(offline) = &mut *self.offline.lock().unwrap() {
            // Long enough for this try to finish, so that the requests that
            // come meanwhile fail at once rather than queue up behind it.
            offline.retry_at = Instant::now() + CONNECT_TIMEOUT + REPLY_TIMEOUT;
        }
        let result: Result<Ws, DspError> = async {
            let mut ws = connect(&self.url).await?;
            request_on(&mut ws, &WsCommand::GetVersion, REPLY_TIMEOUT).await?;
            Ok(ws)
        }
        .await;
        *self.offline.lock().unwrap() = match &result {
            Ok(_) => None,
            Err(err) => Some(Offline {
                error: err.to_string(),
                retry_at: Instant::now() + RETRY_INTERVAL,
            }),
        };
        result
    }

    pub async fn request(&self, command: WsCommand) -> Result<WsReply, DspError> {
        let timeout = match command {
            WsCommand::SetConfig { .. }
            | WsCommand::SetConfigJson { .. }
            | WsCommand::SetConfigFilePath { .. }
            | WsCommand::ValidateConfig { .. }
            | WsCommand::ValidateConfigJson { .. } => CONFIG_REPLY_TIMEOUT,
            _ => REPLY_TIMEOUT,
        };
        self.check_offline()?;
        let mut guard = self.ws.lock().await;
        if guard.is_none() {
            // Again, since a connect may have failed while this one waited.
            self.check_offline()?;
            *guard = Some(self.connect_checked().await?);
            self.connections.fetch_add(1, Ordering::Relaxed);
        }
        let ws = guard.as_mut().expect("connected above");
        let result = request_on(ws, &command, timeout).await;
        if let Err(DspError::Io(_)) = result {
            // A lost connection, or a reply that never came and might still
            // arrive and be taken for the answer to the next command.
            *guard = None;
        }
        result
    }

    pub async fn version(&self) -> Result<String, DspError> {
        value_of!(self.request(WsCommand::GetVersion).await?, GetVersion)
    }

    pub async fn state(&self) -> Result<ProcessingState, DspError> {
        value_of!(self.request(WsCommand::GetState).await?, GetState)
    }

    pub async fn stop_reason(&self) -> Result<StopReason, DspError> {
        value_of!(self.request(WsCommand::GetStopReason).await?, GetStopReason)
    }

    pub async fn capture_rate(&self) -> Result<usize, DspError> {
        value_of!(
            self.request(WsCommand::GetCaptureRate).await?,
            GetCaptureRate
        )
    }

    pub async fn rate_adjust(&self) -> Result<f32, DspError> {
        value_of!(self.request(WsCommand::GetRateAdjust).await?, GetRateAdjust)
    }

    pub async fn buffer_level(&self) -> Result<usize, DspError> {
        value_of!(
            self.request(WsCommand::GetBufferLevel).await?,
            GetBufferLevel
        )
    }

    pub async fn clipped_samples(&self) -> Result<usize, DspError> {
        value_of!(
            self.request(WsCommand::GetClippedSamples).await?,
            GetClippedSamples
        )
    }

    pub async fn processing_load(&self) -> Result<f32, DspError> {
        value_of!(
            self.request(WsCommand::GetProcessingLoad).await?,
            GetProcessingLoad
        )
    }

    pub async fn resampler_load(&self) -> Result<f32, DspError> {
        value_of!(
            self.request(WsCommand::GetResamplerLoad).await?,
            GetResamplerLoad
        )
    }

    pub async fn channel_labels(&self) -> Result<ChannelLabels, DspError> {
        value_of!(
            self.request(WsCommand::GetChannelLabels).await?,
            GetChannelLabels
        )
    }

    pub async fn config_title(&self) -> Result<String, DspError> {
        value_of!(
            self.request(WsCommand::GetConfigTitle).await?,
            GetConfigTitle
        )
    }

    pub async fn config_description(&self) -> Result<String, DspError> {
        value_of!(
            self.request(WsCommand::GetConfigDescription).await?,
            GetConfigDescription
        )
    }

    pub async fn volume(&self) -> Result<f32, DspError> {
        value_of!(self.request(WsCommand::GetVolume).await?, GetVolume)
    }

    pub async fn set_volume(&self, value: f32) -> Result<(), DspError> {
        result_of!(
            self.request(WsCommand::SetVolume { value }).await?,
            SetVolume
        )
    }

    pub async fn mute(&self) -> Result<bool, DspError> {
        value_of!(self.request(WsCommand::GetMute).await?, GetMute)
    }

    pub async fn set_mute(&self, value: bool) -> Result<(), DspError> {
        result_of!(self.request(WsCommand::SetMute { value }).await?, SetMute)
    }

    pub async fn faders(&self) -> Result<Vec<Fader>, DspError> {
        value_of!(self.request(WsCommand::GetFaders).await?, GetFaders)
    }

    pub async fn set_fader_volume(&self, fader: usize, value: f32) -> Result<(), DspError> {
        result_of!(
            self.request(WsCommand::SetFaderVolume { fader, value })
                .await?,
            SetFaderVolume
        )
    }

    pub async fn set_fader_mute(&self, fader: usize, value: bool) -> Result<(), DspError> {
        result_of!(
            self.request(WsCommand::SetFaderMute { fader, value })
                .await?,
            SetFaderMute
        )
    }

    pub async fn config_file_path(&self) -> Result<Option<String>, DspError> {
        value_of!(
            self.request(WsCommand::GetConfigFilePath).await?,
            GetConfigFilePath
        )
    }

    pub async fn set_config_file_path(&self, value: String) -> Result<(), DspError> {
        result_of!(
            self.request(WsCommand::SetConfigFilePath { value }).await?,
            SetConfigFilePath
        )
    }

    pub async fn state_file_path(&self) -> Result<Option<String>, DspError> {
        value_of!(
            self.request(WsCommand::GetStateFilePath).await?,
            GetStateFilePath
        )
    }

    /// The active config, `None` if there is none.
    pub async fn config(&self) -> Result<Option<Configuration>, DspError> {
        let json = value_of!(self.request(WsCommand::GetConfigJson).await?, GetConfigJson)?;
        if json.trim() == "null" {
            return Ok(None);
        }
        let mut deserializer = serde_json::Deserializer::from_str(&json);
        config::deserialize_config(&mut deserializer)
            .map(Some)
            .map_err(|issue| {
                let message = format!(
                    "CamillaDSP sent a config the GUI cannot read, {}",
                    crate::validate::describe(&issue)
                );
                log::warn!("{message}");
                DspError::Io(message)
            })
    }

    pub async fn set_config(&self, config: &serde_json::Value) -> Result<(), DspError> {
        let value = serde_json::to_string(config).map_err(io_error)?;
        result_of!(
            self.request(WsCommand::SetConfigJson { value }).await?,
            SetConfigJson
        )
    }

    pub async fn stop(&self) -> Result<(), DspError> {
        result_of!(self.request(WsCommand::Stop).await?, Stop)
    }

    /// The device types CamillaDSP was built with, `(playback, capture)`.
    pub async fn supported_device_types(&self) -> Result<(Vec<String>, Vec<String>), DspError> {
        value_of!(
            self.request(WsCommand::GetSupportedDeviceTypes).await?,
            GetSupportedDeviceTypes
        )
    }

    pub async fn capture_devices(&self, backend: &str) -> Result<Vec<(String, String)>, DspError> {
        let command = WsCommand::GetAvailableCaptureDevices {
            backend: backend.to_string(),
        };
        value_of!(self.request(command).await?, GetAvailableCaptureDevices)
    }

    pub async fn playback_devices(&self, backend: &str) -> Result<Vec<(String, String)>, DspError> {
        let command = WsCommand::GetAvailablePlaybackDevices {
            backend: backend.to_string(),
        };
        value_of!(self.request(command).await?, GetAvailablePlaybackDevices)
    }

    pub async fn capture_device_capabilities(
        &self,
        backend: &str,
        device: &str,
    ) -> Result<AudioDeviceDescriptor, DspError> {
        let command = WsCommand::GetCaptureDeviceCapabilities {
            backend: backend.to_string(),
            device: device.to_string(),
        };
        value_of!(self.request(command).await?, GetCaptureDeviceCapabilities)
    }

    pub async fn playback_device_capabilities(
        &self,
        backend: &str,
        device: &str,
    ) -> Result<AudioDeviceDescriptor, DspError> {
        let command = WsCommand::GetPlaybackDeviceCapabilities {
            backend: backend.to_string(),
            device: device.to_string(),
        };
        value_of!(self.request(command).await?, GetPlaybackDeviceCapabilities)
    }
}
