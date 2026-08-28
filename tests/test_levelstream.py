import asyncio
import json

import aiohttp
import pytest

from backend.eventstream import (
    LevelEventStream,
    ProcessingNotRunning,
    SpectrumEventStream,
    _format_command,
    _parse_reply,
)


def _reply(payload):
    """Wrap a reply dict in the websocket text frame CamillaDSP would send."""
    return aiohttp.WSMessage(aiohttp.WSMsgType.TEXT, json.dumps(payload), None)


# === CamillaDSP 5.0 message framing ===


def test_format_command_without_arguments():
    assert json.loads(_format_command("GetVersion")) == {"command": "GetVersion"}


def test_format_command_puts_arguments_in_named_fields():
    assert json.loads(_format_command("SubscribeSpectrum", value={"n_bins": 64})) == {
        "command": "SubscribeSpectrum",
        "value": {"n_bins": 64},
    }


def test_parse_reply_returns_name_result_and_value():
    raw = json.dumps({"reply": "GetVersion", "result": "Ok", "value": "5.0.0"})
    assert _parse_reply(raw) == ("GetVersion", "Ok", "5.0.0", None)


def test_parse_reply_reads_the_flat_error_message():
    # errors are flat now: the name in "result", the text in "message"
    raw = json.dumps(
        {
            "reply": "SubscribeVuLevels",
            "result": "InvalidValueError",
            "message": "attack out of range",
        }
    )
    name, result, value, message = _parse_reply(raw)
    assert (name, result, value) == ("SubscribeVuLevels", "InvalidValueError", None)
    assert message == "attack out of range"


def test_parse_reply_raises_on_invalid_command():
    raw = json.dumps({"reply": "Invalid", "error": "Unknown command"})
    with pytest.raises(IOError, match="Unknown command"):
        _parse_reply(raw)


def test_parse_reply_raises_on_a_v4_message():
    # the old externally tagged shape must not be silently accepted
    raw = json.dumps({"GetVersion": {"result": "Ok", "value": "4.1.3"}})
    with pytest.raises(IOError, match="Invalid response"):
        _parse_reply(raw)


def test_parse_reply_raises_on_malformed_json():
    with pytest.raises(IOError, match="Invalid response"):
        _parse_reply("not json")


def test_parse_reply_raises_when_result_is_missing():
    with pytest.raises(IOError, match="Invalid response"):
        _parse_reply(json.dumps({"reply": "GetVersion", "value": "5.0.0"}))


# === Level stream ===


def test_vu_subscription_config_preserves_backend_tuning():
    stream = LevelEventStream("127.0.0.1", 1234, {}, smoothing_time_constant_ms=100, max_update_hz=30)

    assert stream._vu_subscription == {"max_rate": 30.0, "attack": 10.0, "release": 100.0}


def test_vu_subscription_can_disable_smoothing_and_rate_limit():
    stream = LevelEventStream("127.0.0.1", 1234, {}, smoothing_time_constant_ms=0, max_update_hz=0)

    assert stream._vu_subscription == {"max_rate": 0.0, "attack": 0.0, "release": 0.0}


async def test_level_stream_reads_events_via_aiohttp_websocket(monkeypatch):
    status_cache = {}
    stream = LevelEventStream(
        "127.0.0.1",
        1234,
        status_cache,
        smoothing_time_constant_ms=0,
        max_update_hz=0,
    )

    class FakeWebSocket:
        def __init__(self):
            self.closed = False
            self.sent = []
            self._command_replies = [
                _reply({"reply": "GetVersion", "result": "Ok", "value": "5.0.0"}),
                _reply({"reply": "SubscribeVuLevels", "result": "Ok"}),
                _reply({"reply": "StopSubscription", "result": "Ok"}),
            ]
            self._event_messages = [
                _reply(
                    {
                        "reply": "VuLevelsEvent",
                        "result": "Ok",
                        "value": {
                            "capture_rms": [1.0, 2.0],
                            "capture_peak": [3.0, 4.0],
                            "playback_rms": [5.0, 6.0],
                            "playback_peak": [7.0, 8.0],
                        },
                    }
                )
            ]
            self._closed_event = asyncio.Event()

        async def send_str(self, data):
            self.sent.append(data)

        async def receive(self):
            return self._command_replies.pop(0)

        def __aiter__(self):
            return self

        async def __anext__(self):
            if self._event_messages:
                return self._event_messages.pop(0)
            await self._closed_event.wait()
            raise StopAsyncIteration

        async def close(self):
            self.closed = True
            self._closed_event.set()

    class FakeSession:
        def __init__(self):
            self.websocket = FakeWebSocket()
            self.closed = False
            self.url = None

        async def ws_connect(self, url):
            self.url = url
            return self.websocket

        async def close(self):
            self.closed = True

    fake_session = FakeSession()
    monkeypatch.setattr("backend.eventstream.aiohttp.ClientSession", lambda: fake_session)

    queue = stream.add_client()
    stream.start(asyncio.get_running_loop())

    level_frame = None
    for _ in range(3):
        frame = await asyncio.wait_for(queue.get(), timeout=0.5)
        if b"event: levels" in frame:
            level_frame = frame
            break

    assert level_frame is not None
    assert status_cache["capturesignalrms"] == [1.0, 2.0]
    assert status_cache["capturesignalpeak"] == [3.0, 4.0]
    assert status_cache["playbacksignalrms"] == [5.0, 6.0]
    assert status_cache["playbacksignalpeak"] == [7.0, 8.0]
    assert fake_session.url == "ws://127.0.0.1:1234"
    # CamillaDSP 5.0 wire format: internally tagged, arguments in named fields
    assert json.loads(fake_session.websocket.sent[0]) == {"command": "GetVersion"}
    assert json.loads(fake_session.websocket.sent[1]) == {
        "command": "SubscribeVuLevels",
        "value": {"max_rate": 0.0, "attack": 0.0, "release": 0.0},
    }

    await stream.stop()

    assert json.dumps({"command": "StopSubscription"}) in fake_session.websocket.sent
    assert fake_session.websocket.closed is True
    assert fake_session.closed is True


# === Spectrum stream ===


class _FakeSpectrumWebSocket:
    """A CamillaDSP 5.0 websocket that replies to SubscribeSpectrum then pushes events."""

    def __init__(self, subscribe_reply, events=()):
        self.closed = False
        self.sent = []
        self._replies = [subscribe_reply]
        self._events = list(events)
        self._closed_event = asyncio.Event()

    async def send_str(self, data):
        self.sent.append(data)

    async def receive(self):
        if self._replies:
            return self._replies.pop(0)
        # CamillaDSP answers every command, including the StopSubscription
        # sent while tearing the subscription down
        command = json.loads(self.sent[-1])["command"]
        return _reply({"reply": command, "result": "Ok"})

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._events:
            return self._events.pop(0)
        await self._closed_event.wait()
        raise StopAsyncIteration

    async def close(self):
        self.closed = True
        self._closed_event.set()


def _fake_spectrum_session(monkeypatch, websocket):
    class FakeSession:
        def __init__(self):
            self.closed = False

        async def ws_connect(self, _url):
            return websocket

        async def close(self):
            self.closed = True

    session = FakeSession()
    monkeypatch.setattr("backend.eventstream.aiohttp.ClientSession", lambda: session)
    return session


async def test_spectrum_subscribe_sends_params_as_a_named_field(monkeypatch):
    websocket = _FakeSpectrumWebSocket(
        _reply({"reply": "SubscribeSpectrum", "result": "Ok"})
    )
    _fake_spectrum_session(monkeypatch, websocket)

    published = []
    stream = SpectrumEventStream(
        "127.0.0.1", 1234, lambda event, data: published.append((event, data))
    )
    params = {"side": "capture", "n_bins": 64, "min_freq": 20.0, "max_freq": 20000.0}
    await stream.subscribe(params)

    assert json.loads(websocket.sent[0]) == {
        "command": "SubscribeSpectrum",
        "value": params,
    }

    await stream.unsubscribe()


async def test_spectrum_subscribe_raises_when_processing_is_not_running(monkeypatch):
    # the rejection arrives in the flat "result" field now
    websocket = _FakeSpectrumWebSocket(
        _reply({"reply": "SubscribeSpectrum", "result": "ProcessingNotRunningError"})
    )
    _fake_spectrum_session(monkeypatch, websocket)

    stream = SpectrumEventStream("127.0.0.1", 1234, lambda event, data: None)
    with pytest.raises(ProcessingNotRunning):
        await stream.subscribe({"side": "capture", "n_bins": 64})


async def test_spectrum_subscribe_reports_an_error_result(monkeypatch):
    websocket = _FakeSpectrumWebSocket(
        _reply(
            {
                "reply": "SubscribeSpectrum",
                "result": "InvalidValueError",
                "message": "n_bins must be >= 2",
            }
        )
    )
    _fake_spectrum_session(monkeypatch, websocket)

    stream = SpectrumEventStream("127.0.0.1", 1234, lambda event, data: None)
    with pytest.raises(IOError, match="n_bins must be >= 2"):
        await stream.subscribe({"side": "capture", "n_bins": 1})


async def test_spectrum_publishes_events_and_forwards_processing_stopped(monkeypatch):
    spectrum = {"frequencies": [20.0, 200.0], "magnitudes": [-10.0, -20.0]}
    websocket = _FakeSpectrumWebSocket(
        _reply({"reply": "SubscribeSpectrum", "result": "Ok"}),
        events=[
            _reply({"reply": "SpectrumEvent", "result": "Ok", "value": spectrum}),
            # processing stopping cancels the subscription at the DSP end
            _reply({"reply": "SpectrumEvent", "result": "ProcessingStopped"}),
        ],
    )
    _fake_spectrum_session(monkeypatch, websocket)

    published = []
    stream = SpectrumEventStream(
        "127.0.0.1", 1234, lambda event, data: published.append((event, data))
    )
    await stream.subscribe({"side": "capture", "n_bins": 2})

    for _ in range(20):
        if len(published) >= 2:
            break
        await asyncio.sleep(0.01)

    assert published[0] == ("spectrum", spectrum)
    assert published[1] == ("spectrum", {"result": "ProcessingStopped"})

    await stream.unsubscribe()
    # CamillaDSP already cancelled, so no StopSubscription is sent
    assert all("StopSubscription" not in sent for sent in websocket.sent)
