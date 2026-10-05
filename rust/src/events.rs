//! VU levels pushed from CamillaDSP, passed on to browsers as server-sent events.
//! The counterpart of `LevelEventStream` in `backend/eventstream.py`.

use crate::cdsp::{self, CdspError};
use crate::status::StatusCache;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::{Stream, StreamExt, stream};
use serde_json::{Value, json};
use std::convert::Infallible;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;

/// One SSE frame, already serialized.
#[derive(Clone, Debug)]
pub struct Frame {
    pub event: &'static str,
    pub data: String,
}

pub struct LevelStream {
    url: String,
    subscription: Value,
    status: Arc<StatusCache>,
    sender: broadcast::Sender<Frame>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl LevelStream {
    pub fn new(
        url: &str,
        status: Arc<StatusCache>,
        smoothing_ms: f64,
        max_update_hz: f64,
    ) -> Arc<Self> {
        let smoothing_ms = smoothing_ms.max(0.0);
        let (sender, _) = broadcast::channel(32);
        Arc::new(LevelStream {
            url: url.to_string(),
            subscription: json!({
                "max_rate": max_update_hz.max(0.0),
                "attack": 0.1 * smoothing_ms,
                "release": smoothing_ms,
            }),
            status,
            sender,
        })
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

    /// Keep a subscription open for as long as the process runs.
    pub async fn run(self: Arc<Self>) {
        loop {
            match self.run_once().await {
                Ok(()) => {}
                Err(err) => {
                    log::debug!("Level event stream disconnected: {err}");
                    self.publish_stream_status("reconnecting");
                }
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }

    async fn run_once(&self) -> Result<(), CdspError> {
        let mut ws = cdsp::connect(&self.url).await?;
        cdsp::send_command(&mut ws, "GetVersion", Value::Null).await?;
        cdsp::send_command(
            &mut ws,
            "SubscribeVuLevels",
            json!({"value": self.subscription}),
        )
        .await?;
        log::debug!("Level event stream connected to CamillaDSP");
        self.publish_stream_status("connected");
        loop {
            let reply = cdsp::parse_reply(&cdsp::next_text(&mut ws).await?)?;
            if reply.name != "VuLevelsEvent" {
                continue;
            }
            if reply.result != "Ok" {
                return Err(CdspError::Command(
                    reply.message.unwrap_or_else(|| format!("VuLevelsEvent failed: {}", reply.result)),
                ));
            }
            self.process_levels(&reply.value);
        }
    }

    fn process_levels(&self, levels: &Value) {
        let field = |name: &str| levels.get(name).cloned().unwrap_or_else(|| json!([]));
        let payload = json!({
            "capturesignalrms": field("capture_rms"),
            "capturesignalpeak": field("capture_peak"),
            "playbacksignalrms": field("playback_rms"),
            "playbacksignalpeak": field("playback_peak"),
            "ts": now_ms(),
        });
        self.status.update_levels(&payload);
        self.publish("levels", payload);
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
