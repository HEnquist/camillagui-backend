//! A client for CamillaDSP's websocket API, using the protocol types from
//! camilladsp-schema so the messages are exactly the ones the DSP itself uses.

use camilladsp_schema::config::{self, Configuration};
use camilladsp_schema::protocol::{
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

/// The reply, if it is the one to the command. A reply is tagged with the
/// name of its command.
fn answering(command: &WsCommand, reply: WsReply) -> Result<WsReply, DspError> {
    fn tag(message: &impl serde::Serialize, field: &str) -> Option<String> {
        let value = serde_json::to_value(message).ok()?;
        value.get(field)?.as_str().map(String::from)
    }
    if tag(command, "command") == tag(&reply, "reply") {
        Ok(reply)
    } else {
        Err(unexpected(reply))
    }
}

/// A failed connect, which requests are answered with until the next try.
struct Offline {
    error: String,
    retry_at: Instant,
}

/// Puts back the retry time a connect pushed ahead, when the connect is
/// dropped before it finishes, by a reload or a closed tab. Otherwise every
/// request would fail with the old error until the pushed time, although
/// CamillaDSP may well be back.
struct RestoreRetry<'a> {
    offline: &'a std::sync::Mutex<Option<Offline>>,
    retry_at: Option<Instant>,
}

impl Drop for RestoreRetry<'_> {
    fn drop(&mut self) {
        if let Some(retry_at) = self.retry_at
            && let Some(offline) = &mut *self.offline.lock().unwrap()
        {
            offline.retry_at = retry_at;
        }
    }
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
        // Long enough for this try to finish, so that the requests that come
        // meanwhile fail at once rather than queue up behind it.
        let previous = self.offline.lock().unwrap().as_mut().map(|offline| {
            std::mem::replace(
                &mut offline.retry_at,
                Instant::now() + CONNECT_TIMEOUT + REPLY_TIMEOUT,
            )
        });
        let mut restore = RestoreRetry {
            offline: &self.offline,
            retry_at: previous,
        };
        let result: Result<Ws, DspError> = async {
            let mut ws = connect(&self.url).await?;
            request_on(&mut ws, &WsCommand::GetVersion, REPLY_TIMEOUT).await?;
            Ok(ws)
        }
        .await;
        restore.retry_at = None;
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
        // The socket is taken out of the slot, and only put back once the
        // reply is in. A request dropped halfway, by a closed tab or an
        // aborted fetch, drops the socket with it, since the reply would
        // otherwise be taken for the answer to the next command.
        let mut ws = match guard.take() {
            Some(ws) => ws,
            None => {
                // Again, since a connect may have failed while this one waited.
                self.check_offline()?;
                let ws = self.connect_checked().await?;
                self.connections.fetch_add(1, Ordering::Relaxed);
                ws
            }
        };
        let result = request_on(&mut ws, &command, timeout)
            .await
            .and_then(|reply| answering(&command, reply));
        // Not after a lost connection either, or a reply that never came and
        // might still arrive, or a reply to some other command, after which
        // the one to this command would be taken for the answer to the next.
        if !matches!(result, Err(DspError::Io(_))) {
            *guard = Some(ws);
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

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    /// A fake CamillaDSP that answers GetVersion at once, GetState after a
    /// delay, so that a request can be dropped while it waits, and GetMute
    /// after a stray GetVolume reply, like a message out of turn. The first
    /// `stalled` connections are accepted but never get the websocket
    /// handshake, so that a connect can be dropped while it waits.
    async fn fake_camilladsp(stalled: usize) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let mut held = Vec::new();
            while let Ok((stream, _)) = listener.accept().await {
                if held.len() < stalled {
                    held.push(stream);
                    continue;
                }
                tokio::spawn(async move {
                    let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                    while let Some(Ok(Message::Text(text))) = ws.next().await {
                        let reply = match serde_json::from_str(&text).unwrap() {
                            WsCommand::GetVersion => WsReply::GetVersion {
                                result: WsResult::Ok,
                                value: "5.0.0".to_string(),
                            },
                            WsCommand::GetState => {
                                tokio::time::sleep(Duration::from_millis(200)).await;
                                WsReply::GetState {
                                    result: WsResult::Ok,
                                    value: ProcessingState::Running,
                                }
                            }
                            WsCommand::GetMute => {
                                let stray = WsReply::GetVolume {
                                    result: WsResult::Ok,
                                    value: -10.0,
                                };
                                let text = serde_json::to_string(&stray).unwrap();
                                ws.send(Message::text(text)).await.unwrap();
                                WsReply::GetMute {
                                    result: WsResult::Ok,
                                    value: true,
                                }
                            }
                            command => panic!("unexpected command {command:?}"),
                        };
                        let text = serde_json::to_string(&reply).unwrap();
                        ws.send(Message::text(text)).await.unwrap();
                    }
                });
            }
        });
        port
    }

    #[tokio::test]
    async fn dropped_request_does_not_leave_its_reply_for_the_next() {
        let port = fake_camilladsp(0).await;
        let client = CamillaClient::new("127.0.0.1", port);
        assert_eq!(client.version().await.unwrap(), "5.0.0");
        assert_eq!(client.connection(), 1);
        // Dropped before the reply comes, like the handler of an aborted fetch.
        let dropped = tokio::time::timeout(Duration::from_millis(50), client.state()).await;
        assert!(dropped.is_err());
        // The late GetState reply must not be read as the answer to this one.
        assert_eq!(client.version().await.unwrap(), "5.0.0");
        assert_eq!(client.connection(), 2);
    }

    #[tokio::test]
    async fn stray_reply_does_not_leave_the_next_one_behind() {
        let port = fake_camilladsp(0).await;
        let client = CamillaClient::new("127.0.0.1", port);
        assert_eq!(client.version().await.unwrap(), "5.0.0");
        assert_eq!(client.connection(), 1);
        // The stray GetVolume reply comes first and is refused.
        let err = client.mute().await.unwrap_err();
        assert!(err.to_string().starts_with("Unexpected reply"), "{err}");
        // The GetMute reply behind it must not be read as the answer to this one.
        assert_eq!(client.version().await.unwrap(), "5.0.0");
        assert_eq!(client.connection(), 2);
    }

    #[tokio::test]
    async fn dropped_connect_does_not_hold_off_the_next() {
        let port = fake_camilladsp(1).await;
        let client = CamillaClient::new("127.0.0.1", port);
        // A connect that failed earlier, and is due for another try.
        *client.offline.lock().unwrap() = Some(Offline {
            error: "Old error".to_string(),
            retry_at: Instant::now(),
        });
        // The first try stalls in the handshake and is dropped, like the
        // handler of a reloaded page. A request meanwhile fails at once.
        let stalled = tokio::time::timeout(Duration::from_millis(100), client.version());
        let meanwhile = async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            client.version().await
        };
        let (stalled, meanwhile) = tokio::join!(stalled, meanwhile);
        assert!(stalled.is_err());
        assert_eq!(meanwhile.unwrap_err().to_string(), "Old error");
        // The next request tries again rather than answer with the old error.
        assert_eq!(client.version().await.unwrap(), "5.0.0");
        assert_eq!(client.connection(), 1);
    }
}
