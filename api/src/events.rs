//! The processing state, levels and spectra pushed from CamillaDSP, passed on
//! to a browser as server-sent events on one stream, so that a GUI tab holds
//! one of the browser's few connections to the backend.
//!
//! Each part has its own websocket and its own subscription, since a socket
//! with a subscription on it only carries that subscription. The parts live
//! exactly as long as the stream: when the browser goes away the stream is
//! dropped with its sockets, and CamillaDSP ends the subscriptions when the
//! sockets close.

use crate::camilla::{self, CamillaClient, DspError, Ws, check};
use crate::reply::EventStream;
use axum::response::sse::{Event, Sse};
use camilladsp_schema::protocol::{
    ProcessingState, SpectrumData, SpectrumSubscription, StateUpdate, VuLevels, VuSubscription,
    WsCommand, WsReply, WsResult,
};
use futures_util::{Stream, StreamExt, future, stream};
use serde::Deserialize;
use serde_json::value::RawValue;
use std::convert::Infallible;
use std::time::Duration;
use tokio::sync::{mpsc, watch};
use tokio::time::{Instant, MissedTickBehavior, interval_at};
use utoipa::ToSchema;

const REPLY_TIMEOUT: Duration = Duration::from_secs(5);

/// How often a `heartbeat` event is sent, so that the browser can tell a dead
/// connection from a quiet one. A comment would keep the connection open too,
/// but an `EventSource` does not show those to the page.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(2);

/// How many events wait for a slow browser before the parts wait too.
const EVENTS_WAITING: usize = 16;

#[derive(Debug)]
pub enum SubscribeError {
    /// CamillaDSP refused, because processing is not running.
    ProcessingNotRunning,
    Other(String),
}

impl From<DspError> for SubscribeError {
    fn from(err: DspError) -> Self {
        SubscribeError::Other(err.to_string())
    }
}

/// The data of each event the stream sends, by event name. The values are
/// passed on as CamillaDSP sent them, unparsed, so these are the types
/// CamillaDSP's protocol says they are. Nothing of this type is ever made,
/// it only describes the stream in the spec.
#[derive(ToSchema)]
#[allow(dead_code, reason = "only describes the events in the spec")]
pub struct EventPayloads {
    /// A `state` event: the processing state, first the current one, then one
    /// for each change.
    state: StateUpdate,
    /// A `levels` event, one for each update from CamillaDSP.
    levels: VuLevels,
    /// A `spectrum` event, one for each update from CamillaDSP.
    spectrum: SpectrumData,
    /// A `heartbeat` event, an empty object every two seconds.
    heartbeat: Heartbeat,
}

/// The data of a `heartbeat` event.
#[derive(ToSchema)]
#[allow(dead_code, reason = "only describes the events in the spec")]
pub struct Heartbeat {}

/// What a stream carries besides the state, which it always has.
#[derive(Debug, Default)]
pub struct Parts {
    pub levels: Option<VuSubscription>,
    pub spectrum: Option<SpectrumSubscription>,
}

/// One stream for a browser tab. The state subscription carries it: it is made
/// first, a refusal is the error, and the stream ends when that subscription
/// does, which is how the browser learns at once that CamillaDSP went away.
///
/// The levels and the spectrum come and go inside the stream. One that is
/// refused, for example a spectrum while processing is stopped, or that
/// CamillaDSP ends, is subscribed again when a `state` event says `Running`.
pub async fn events(
    camilla: &CamillaClient,
    parts: Parts,
) -> Result<EventStream<EventPayloads>, SubscribeError> {
    let state = state_values(camilla).await?;
    let (sender, mut receiver) = mpsc::channel(EVENTS_WAITING);
    let mut commands = Vec::new();
    if let Some(value) = parts.levels {
        commands.push(Part {
            command: WsCommand::SubscribeVuLevels { value },
            reply: "VuLevelsEvent",
            event: "levels",
        });
    }
    if let Some(value) = parts.spectrum {
        commands.push(Part {
            command: WsCommand::SubscribeSpectrum { value },
            reply: "SpectrumEvent",
            event: "spectrum",
        });
    }
    tokio::spawn(run(state, commands, camilla.url().to_string(), sender));
    let events = stream::poll_fn(move |cx| receiver.poll_recv(cx)).map(Ok::<_, Infallible>);
    Ok(EventStream::new(Sse::new(events)))
}

/// The state values, as CamillaDSP's StateUpdate JSON. CamillaDSP sends one
/// only when the state changes, so they start with the current state. That is
/// read after subscribing, so a change in between comes as an event rather
/// than being lost.
async fn state_values(
    camilla: &CamillaClient,
) -> Result<impl Stream<Item = String> + Send + Unpin + use<>, SubscribeError> {
    let changes = subscribe(camilla.url(), &WsCommand::SubscribeState, "StateEvent").await?;
    let state = camilla.state().await?;
    let stop_reason = match state {
        ProcessingState::Inactive => Some(camilla.stop_reason().await?),
        _ => None,
    };
    let current = serde_json::to_string(&StateUpdate { state, stop_reason })
        .map_err(|err| SubscribeError::Other(err.to_string()))?;
    Ok(Box::pin(
        stream::once(future::ready(current)).chain(changes),
    ))
}

/// A subscription besides the state.
struct Part {
    command: WsCommand,
    reply: &'static str,
    event: &'static str,
}

impl Part {
    /// Subscribe, and pass the events on until CamillaDSP ends the
    /// subscription. Then, or after a refusal, wait for the next `Running`
    /// state and subscribe again. Returns when the browser has gone away.
    async fn run(self, url: String, mut running: watch::Receiver<()>, sender: mpsc::Sender<Event>) {
        loop {
            // A `Running` from now on means try again, even one that comes
            // while this attempt is still waiting for its answer.
            running.borrow_and_update();
            match subscribe(&url, &self.command, self.reply).await {
                Ok(mut values) => {
                    while let Some(value) = values.next().await {
                        let event = Event::default().event(self.event).data(value);
                        if sender.send(event).await.is_err() {
                            return;
                        }
                    }
                }
                Err(SubscribeError::ProcessingNotRunning) => {
                    log::debug!("{} refused, processing is not running", self.reply);
                }
                Err(SubscribeError::Other(message)) => {
                    log::debug!("{} failed: {message}", self.reply);
                }
            }
            if running.changed().await.is_err() {
                return;
            }
        }
    }
}

/// Pass the state on, with a heartbeat, while the parts run beside it, until
/// the state subscription ends or the browser goes away.
async fn run(
    mut state: impl Stream<Item = String> + Unpin,
    parts: Vec<Part>,
    url: String,
    sender: mpsc::Sender<Event>,
) {
    let (running, running_receiver) = watch::channel(());
    let parts = future::join_all(
        parts
            .into_iter()
            .map(|part| part.run(url.clone(), running_receiver.clone(), sender.clone())),
    );
    // The parts never end while the state goes on, not even when there are none.
    let parts = async {
        parts.await;
        future::pending::<()>().await
    };
    let main = async {
        let mut heartbeat = interval_at(Instant::now() + HEARTBEAT_INTERVAL, HEARTBEAT_INTERVAL);
        heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
        loop {
            let event = tokio::select! {
                value = state.next() => {
                    let Some(value) = value else {
                        log::debug!("State stream ended");
                        return;
                    };
                    if is_running(&value) {
                        running.send_replace(());
                    }
                    Event::default().event("state").data(value)
                }
                _ = heartbeat.tick() => Event::default().event("heartbeat").data("{}"),
                _ = sender.closed() => return,
            };
            if sender.send(event).await.is_err() {
                return;
            }
        }
    };
    // The state goes first, so the stream starts with the current state: it is
    // ready at once, and is sent before any part has subscribed.
    tokio::select! {
        biased;
        _ = main => {}
        _ = parts => {}
    }
}

fn is_running(state: &str) -> bool {
    serde_json::from_str::<StateUpdate>(state)
        .is_ok_and(|update| update.state == ProcessingState::Running)
}

/// Subscribe on a socket of its own, and return once CamillaDSP has accepted
/// or refused. The stream has the value of each `reply` event, as CamillaDSP
/// sent it, and ends when CamillaDSP ends the subscription, for example when
/// processing stops, or when the socket fails.
async fn subscribe(
    url: &str,
    command: &WsCommand,
    reply: &'static str,
) -> Result<impl Stream<Item = String> + Send + Unpin + use<>, SubscribeError> {
    let mut ws = camilla::connect(url).await?;
    let answer = camilla::request_on(&mut ws, command, REPLY_TIMEOUT).await?;
    match answer {
        WsReply::SubscribeVuLevels { result }
        | WsReply::SubscribeSpectrum { result }
        | WsReply::SubscribeState { result } => match result {
            WsResult::Ok => {}
            WsResult::ProcessingNotRunningError => {
                return Err(SubscribeError::ProcessingNotRunning);
            }
            result => {
                return Err(SubscribeError::Other(
                    check(result)
                        .err()
                        .map(|e| e.to_string())
                        .unwrap_or_default(),
                ));
            }
        },
        other => {
            return Err(SubscribeError::Other(format!(
                "Got a reply to {other:?} while waiting for the subscription"
            )));
        }
    }
    log::debug!("Subscribed to {reply}");
    Ok(Box::pin(stream::unfold(ws, move |mut ws| async move {
        match next_event(&mut ws, reply).await {
            Ok(Ok(value)) => Some((value, ws)),
            Ok(Err(result)) => {
                log::debug!("{reply} stream ended: {result}");
                None
            }
            Err(err) => {
                log::debug!("{reply} stream error: {err}");
                None
            }
        }
    })))
}

/// A pushed event with its value left as CamillaDSP's own JSON text, which goes
/// to the browsers unchanged. Parsing the floats and writing them out again was
/// most of what a frame cost.
#[derive(Deserialize)]
struct RawEvent<'a> {
    reply: &'a str,
    result: &'a str,
    #[serde(borrow)]
    value: Option<&'a RawValue>,
}

/// The value of the next `reply` event, or the result name of an event that
/// carries an error. Other messages are skipped.
async fn next_event(ws: &mut Ws, reply: &str) -> Result<Result<String, String>, DspError> {
    loop {
        let text = camilla::receive_text(ws).await?;
        let event = serde_json::from_str::<RawEvent>(&text)
            .map_err(|err| DspError::Io(format!("Invalid event received: {text}, {err}")))?;
        if event.reply != reply {
            continue;
        }
        if event.result != "Ok" {
            return Ok(Err(event.result.to_string()));
        }
        if let Some(value) = event.value {
            return Ok(Ok(value.get().to_string()));
        }
    }
}
