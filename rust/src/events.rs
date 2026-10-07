//! Levels and spectra pushed from CamillaDSP, passed on to browsers as
//! server-sent events. Every browser stream has its own websocket and its own
//! subscription, since a socket with a subscription on it only carries that
//! subscription. The subscription lives exactly as long as the stream: when
//! the browser goes away the stream is dropped with its socket, and CamillaDSP
//! ends the subscription when the socket closes.

use crate::camilla::{self, CamillaClient, DspError, Ws, check};
use axum::response::sse::{Event, KeepAlive, KeepAliveStream, Sse};
use camilladsp_config::protocol::{
    ProcessingState, SpectrumSubscription, StateUpdate, VuSubscription, WsCommand, WsReply,
    WsResult,
};
use futures_util::{Stream, StreamExt, stream};
use serde::Deserialize;
use serde_json::value::RawValue;
use std::convert::Infallible;
use std::time::Duration;

const REPLY_TIMEOUT: Duration = Duration::from_secs(5);

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

/// The VU levels, as `levels` events with CamillaDSP's VuLevels in them.
pub async fn level_stream(
    url: &str,
    subscription: VuSubscription,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>> + use<>>, SubscribeError> {
    let command = WsCommand::SubscribeVuLevels {
        value: subscription,
    };
    Ok(sse(
        event_stream(url, command, "VuLevelsEvent", "levels").await?
    ))
}

/// The spectrum, as `spectrum` events with CamillaDSP's SpectrumData in them.
pub async fn spectrum_stream(
    url: &str,
    params: SpectrumSubscription,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>> + use<>>, SubscribeError> {
    let command = WsCommand::SubscribeSpectrum { value: params };
    Ok(sse(
        event_stream(url, command, "SpectrumEvent", "spectrum").await?
    ))
}

/// The processing state, as `state` events with CamillaDSP's StateUpdate in
/// them. CamillaDSP sends one only when the state changes, so the stream starts
/// with the current state. That is read after subscribing, so a change in
/// between comes as an event rather than being lost.
pub async fn state_stream(
    camilla: &CamillaClient,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>> + use<>>, SubscribeError> {
    let events = event_stream(
        camilla.url(),
        WsCommand::SubscribeState,
        "StateEvent",
        "state",
    )
    .await?;
    let state = camilla.state().await?;
    let stop_reason = match state {
        ProcessingState::Inactive => Some(camilla.stop_reason().await?),
        _ => None,
    };
    let current = serde_json::to_string(&StateUpdate { state, stop_reason })
        .map_err(|err| SubscribeError::Other(err.to_string()))?;
    let first = Event::default().event("state").data(current);
    Ok(sse(stream::once(async { Ok(first) }).chain(events)))
}

fn sse<S>(events: S) -> Sse<KeepAliveStream<S>>
where
    S: Stream<Item = Result<Event, Infallible>> + Send + 'static,
{
    Sse::new(events).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keepalive"),
    )
}

/// Subscribe on a socket of its own, and return once CamillaDSP has accepted
/// or refused. Each `reply` event goes out as an `event` event. The stream
/// ends when CamillaDSP ends the subscription, for example when processing
/// stops, and the browser subscribes again.
async fn event_stream(
    url: &str,
    command: WsCommand,
    reply: &'static str,
    event: &'static str,
) -> Result<impl Stream<Item = Result<Event, Infallible>> + use<>, SubscribeError> {
    let mut ws = camilla::connect(url).await?;
    let answer = camilla::request_on(&mut ws, &command, REPLY_TIMEOUT).await?;
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
    Ok(stream::unfold(ws, move |mut ws| async move {
        match next_event(&mut ws, reply).await {
            Ok(Ok(value)) => Some((Ok(Event::default().event(event).data(value)), ws)),
            Ok(Err(result)) => {
                log::debug!("{reply} stream ended: {result}");
                None
            }
            Err(err) => {
                log::debug!("{reply} stream error: {err}");
                None
            }
        }
    }))
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
