import asyncio
import json

import aiohttp

from backend.levelstream import LevelEventStream


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
                aiohttp.WSMessage(
                    aiohttp.WSMsgType.TEXT,
                    json.dumps({"GetVersion": {"result": "Ok", "value": "1.2.3"}}),
                    None,
                ),
                aiohttp.WSMessage(
                    aiohttp.WSMsgType.TEXT,
                    json.dumps({"SubscribeVuLevels": {"result": "Ok"}}),
                    None,
                ),
                aiohttp.WSMessage(
                    aiohttp.WSMsgType.TEXT,
                    json.dumps({"StopSubscription": {"result": "Ok"}}),
                    None,
                ),
            ]
            self._event_messages = [
                aiohttp.WSMessage(
                    aiohttp.WSMsgType.TEXT,
                    json.dumps(
                        {
                            "VuLevelsEvent": {
                                "result": "Ok",
                                "value": {
                                    "capture_rms": [1.0, 2.0],
                                    "capture_peak": [3.0, 4.0],
                                    "playback_rms": [5.0, 6.0],
                                    "playback_peak": [7.0, 8.0],
                                },
                            }
                        }
                    ),
                    None,
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
    monkeypatch.setattr("backend.levelstream.aiohttp.ClientSession", lambda: fake_session)

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
    assert fake_session.websocket.sent[0] == json.dumps("GetVersion")
    assert fake_session.websocket.sent[1] == json.dumps(
        {"SubscribeVuLevels": {"max_rate": 0.0, "attack": 0.0, "release": 0.0}}
    )

    await stream.stop()

    assert json.dumps("StopSubscription") in fake_session.websocket.sent
    assert fake_session.websocket.closed is True
    assert fake_session.closed is True
