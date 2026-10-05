//! Levels and spectra pushed from CamillaDSP, passed on to browsers as
//! server-sent events. Each subscription has its own websocket to CamillaDSP,
//! since a socket with a subscription on it only carries that subscription.

use crate::camilla::{self, DspError, check, to_json};
use crate::status::StatusCache;
use axum::response::sse::{Event, KeepAlive, Sse};
use camilladsp_config::protocol::{
    SpectrumSubscription, VuLevels, VuSubscription, WsCommand, WsReply, WsResult,
};
use futures_util::{Stream, StreamExt, stream};
use serde_json::{Value, json};
use std::convert::Infallible;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::{Mutex, broadcast, oneshot};
use tokio::task::JoinHandle;
use tokio_stream::wrappers::BroadcastStream;

const REPLY_TIMEOUT: Duration = Duration::from_secs(5);

/// One SSE frame, already serialized.
#[derive(Clone, Debug)]
pub struct Frame {
    pub event: &'static str,
    pub data: String,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The event stream to the browsers. Anything can publish to it.
#[derive(Clone)]
pub struct Publisher {
    sender: broadcast::Sender<Frame>,
}

impl Publisher {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(32);
        Publisher { sender }
    }

    pub fn publish(&self, event: &'static str, data: Value) {
        // An error only means nobody is listening.
        let _ = self.sender.send(Frame {
            event,
            data: data.to_string(),
        });
    }

    fn publish_stream_status(&self, state: &str) {
        self.publish("stream_status", json!({"state": state, "ts": now_ms()}));
    }

    /// The event stream for one browser.
    pub fn subscribe(&self) -> Sse<impl Stream<Item = Result<Event, Infallible>> + use<>> {
        let receiver = self.sender.subscribe();
        self.publish_stream_status("connected");
        let first = Event::default()
            .retry(Duration::from_millis(1000))
            .comment("connected");
        // A lagging browser loses the frames it missed, like the Python queue
        // that drops the oldest frame when full.
        let frames = BroadcastStream::new(receiver).filter_map(|frame| async move {
            frame
                .ok()
                .map(|frame| Event::default().event(frame.event).data(frame.data))
        });
        let events = stream::once(async move { first })
            .chain(frames)
            .map(Ok::<_, Infallible>);
        Sse::new(events).keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("keepalive"),
        )
    }
}

/// Keeps a VU level subscription open for as long as the process runs.
pub struct LevelStream {
    url: String,
    subscription: VuSubscription,
    status: Arc<StatusCache>,
    publisher: Publisher,
}

impl LevelStream {
    pub fn new(
        url: &str,
        status: Arc<StatusCache>,
        publisher: Publisher,
        smoothing_ms: f64,
        max_update_hz: f64,
    ) -> Arc<Self> {
        let smoothing_ms = smoothing_ms.max(0.0) as f32;
        Arc::new(LevelStream {
            url: url.to_string(),
            subscription: VuSubscription {
                max_rate: max_update_hz.max(0.0) as f32,
                attack: 0.1 * smoothing_ms,
                release: smoothing_ms,
            },
            status,
            publisher,
        })
    }

    pub async fn run(self: Arc<Self>) {
        loop {
            if let Err(err) = self.run_once().await {
                log::debug!("Level event stream disconnected: {err}");
                self.publisher.publish_stream_status("reconnecting");
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }

    async fn run_once(&self) -> Result<(), DspError> {
        let mut ws = camilla::connect(&self.url).await?;
        camilla::request_on(&mut ws, &WsCommand::GetVersion, REPLY_TIMEOUT).await?;
        let command = WsCommand::SubscribeVuLevels {
            value: self.subscription,
        };
        match camilla::request_on(&mut ws, &command, REPLY_TIMEOUT).await? {
            WsReply::SubscribeVuLevels { result } => check(result)?,
            other => return Err(DspError::Io(format!("Unexpected reply: {other:?}"))),
        }
        log::debug!("Level event stream connected to CamillaDSP");
        self.publisher.publish_stream_status("connected");
        loop {
            match camilla::receive(&mut ws).await? {
                WsReply::VuLevelsEvent { result, value } => {
                    check(result)?;
                    self.process_levels(value);
                }
                _ => continue,
            }
        }
    }

    fn process_levels(&self, levels: VuLevels) {
        let payload = json!({
            "capturesignalrms": to_json(&levels.capture_rms),
            "capturesignalpeak": to_json(&levels.capture_peak),
            "playbacksignalrms": to_json(&levels.playback_rms),
            "playbacksignalpeak": to_json(&levels.playback_peak),
            "ts": now_ms(),
        });
        self.status.merge(payload.clone());
        self.publisher.publish("levels", payload);
    }
}

#[derive(Debug)]
pub enum SubscribeError {
    /// CamillaDSP refused, because processing is not running.
    ProcessingNotRunning,
    Other(String),
}

/// A spectrum subscription, started and stopped on request. Spectra go out as
/// `spectrum` events on the same stream as the levels.
pub struct SpectrumStream {
    url: String,
    publisher: Publisher,
    task: Mutex<Option<JoinHandle<()>>>,
}

impl SpectrumStream {
    pub fn new(url: &str, publisher: Publisher) -> Self {
        SpectrumStream {
            url: url.to_string(),
            publisher,
            task: Mutex::new(None),
        }
    }

    /// Start a subscription, replacing any running one, and return once
    /// CamillaDSP has accepted or refused it.
    pub async fn subscribe(&self, params: SpectrumSubscription) -> Result<(), SubscribeError> {
        let mut task = self.task.lock().await;
        if let Some(previous) = task.take() {
            previous.abort();
        }
        let (subscribed_tx, subscribed_rx) = oneshot::channel();
        let url = self.url.clone();
        let publisher = self.publisher.clone();
        *task = Some(tokio::spawn(run_spectrum(
            url,
            params,
            publisher,
            subscribed_tx,
        )));
        let result = subscribed_rx
            .await
            .unwrap_or_else(|_| Err(SubscribeError::Other("The subscription ended".into())));
        if result.is_err()
            && let Some(failed) = task.take()
        {
            failed.abort();
        }
        result
    }

    pub async fn unsubscribe(&self) {
        if let Some(task) = self.task.lock().await.take() {
            task.abort();
        }
    }
}

async fn run_spectrum(
    url: String,
    params: SpectrumSubscription,
    publisher: Publisher,
    subscribed: oneshot::Sender<Result<(), SubscribeError>>,
) {
    let mut ws = match camilla::connect(&url).await {
        Ok(ws) => ws,
        Err(err) => {
            let _ = subscribed.send(Err(SubscribeError::Other(err.to_string())));
            return;
        }
    };
    let command = WsCommand::SubscribeSpectrum { value: params };
    let reply = camilla::request_on(&mut ws, &command, REPLY_TIMEOUT).await;
    let accepted = match reply {
        Ok(WsReply::SubscribeSpectrum {
            result: WsResult::Ok,
        }) => Ok(()),
        Ok(WsReply::SubscribeSpectrum {
            result: WsResult::ProcessingNotRunningError,
        }) => Err(SubscribeError::ProcessingNotRunning),
        Ok(WsReply::SubscribeSpectrum { result }) => Err(SubscribeError::Other(
            check(result)
                .err()
                .map(|e| e.to_string())
                .unwrap_or_default(),
        )),
        Ok(other) => Err(SubscribeError::Other(format!(
            "Got a reply to {other:?} while waiting for the subscription"
        ))),
        Err(err) => Err(SubscribeError::Other(err.to_string())),
    };
    let ok = accepted.is_ok();
    let _ = subscribed.send(accepted);
    if !ok {
        return;
    }
    // Ends when the task is aborted, which drops the socket. CamillaDSP ends
    // the subscription when the connection closes, so no StopSubscription is needed.
    loop {
        match camilla::receive(&mut ws).await {
            Ok(WsReply::SpectrumEvent {
                result: WsResult::Ok,
                value,
            }) => {
                if let Some(spectrum) = value {
                    publisher.publish("spectrum", to_json(&spectrum));
                }
            }
            Ok(WsReply::SpectrumEvent {
                result: WsResult::ProcessingStopped,
                ..
            }) => {
                publisher.publish("spectrum", json!({"result": "ProcessingStopped"}));
                return;
            }
            Ok(WsReply::SpectrumEvent { result, .. }) => {
                log::debug!("SpectrumEvent unexpected result: {result:?}");
                return;
            }
            Ok(_) => continue,
            Err(err) => {
                log::debug!("Spectrum event stream error: {err}");
                return;
            }
        }
    }
}
