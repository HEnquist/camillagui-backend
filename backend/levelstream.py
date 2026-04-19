import asyncio
from contextlib import suppress
import json
import logging
import time
from typing import Dict, Optional, Set, Tuple, Union

import aiohttp


class LevelEventStream:
    def __init__(
        self,
        host: str,
        port: int,
        status_cache,
        smoothing_time_constant_ms: float = 100.0,
        max_update_hz: float = 30.0,
    ):
        self._host = host
        self._port = int(port)
        self._status_cache = status_cache
        smoothing_ms = max(0.0, float(smoothing_time_constant_ms))
        self._vu_subscription = {
            "max_rate": max(0.0, float(max_update_hz)),
            "attack": 0.1 * smoothing_ms,
            "release": smoothing_ms,
        }
        self._clients: Set[asyncio.Queue[bytes]] = set()
        self._running = False
        self._task: Optional[asyncio.Task[None]] = None
        self._session: Optional[aiohttp.ClientSession] = None
        self._websocket: Optional[aiohttp.ClientWebSocketResponse] = None
        self._websocket_url = f"ws://{self._host}:{self._port}"

    def start(self, loop: asyncio.AbstractEventLoop):
        if self._task is not None and not self._task.done():
            return
        logging.debug("LevelEventStream starting")
        self._running = True
        self._task = loop.create_task(self._run())

    async def stop(self):
        logging.debug("LevelEventStream stopping")
        self._running = False
        task = self._task
        self._task = None
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        websocket = self._websocket
        self._websocket = None
        if websocket is not None:
            with suppress(Exception):
                await websocket.close()
        session = self._session
        self._session = None
        if session is not None:
            with suppress(Exception):
                await session.close()

    def add_client(self) -> asyncio.Queue[bytes]:
        queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=32)
        self._clients.add(queue)
        client_count = len(self._clients)
        logging.debug("LevelEventStream client added, total clients=%s", client_count)
        self._publish_json(
            "stream_status", {"state": "connected", "ts": int(time.time() * 1000)}
        )
        return queue

    def remove_client(self, queue: asyncio.Queue[bytes]):
        self._clients.discard(queue)
        client_count = len(self._clients)
        logging.debug("LevelEventStream client removed, total clients=%s", client_count)

    def _has_clients(self) -> bool:
        return bool(self._clients)

    def _enqueue_frame(self, frame: bytes):
        for queue in tuple(self._clients):
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                queue.put_nowait(frame)
            except asyncio.QueueFull:
                pass

    def _publish_json(self, event: str, data):
        if not self._has_clients():
            return
        frame = f"event: {event}\ndata: {json.dumps(data)}\n\n".encode("utf-8")
        self._enqueue_frame(frame)

    def _format_command(self, command: str, arg=None) -> str:
        if arg is None:
            return json.dumps(command)
        return json.dumps({command: arg})

    @staticmethod
    def _handle_result(result: Union[str, Dict[str, str]]) -> Tuple[str, Optional[str]]:
        if isinstance(result, str):
            return result, None
        return next(iter(result.items()))

    def _handle_reply(self, command: str, rawreply: Union[str, bytes]):
        try:
            reply = json.loads(rawreply)
        except json.JSONDecodeError as exc:
            raise IOError(f"Invalid response received: {rawreply!r}") from exc
        if command not in reply:
            raise IOError(f"Invalid response received: {rawreply!r}")
        response_data = reply[command]
        if "error" in response_data:
            raise IOError(response_data["error"])
        state, message = self._handle_result(response_data["result"])
        if state != "Ok":
            raise IOError(message or f"{command} failed")
        return response_data.get("value")

    def _handle_event_reply(self, event_name: str, rawreply: Union[str, bytes]):
        try:
            reply = json.loads(rawreply)
        except json.JSONDecodeError as exc:
            raise IOError(f"Invalid response received: {rawreply!r}") from exc
        if event_name not in reply:
            return None
        response_data = reply[event_name]
        state, message = self._handle_result(response_data["result"])
        if state != "Ok":
            raise IOError(message or f"{event_name} failed")
        return response_data.get("value")

    async def _send_command(self, websocket: aiohttp.ClientWebSocketResponse, command: str, arg=None):
        await websocket.send_str(self._format_command(command, arg))
        reply = await websocket.receive()
        return self._handle_reply(command, self._message_payload(reply))

    @staticmethod
    def _message_payload(message: aiohttp.WSMessage) -> Union[str, bytes]:
        if message.type in (aiohttp.WSMsgType.TEXT, aiohttp.WSMsgType.BINARY):
            return message.data
        if message.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSING, aiohttp.WSMsgType.CLOSED):
            raise IOError("Websocket closed")
        if message.type == aiohttp.WSMsgType.ERROR:
            raise IOError("Websocket error") from message.data
        raise IOError(f"Unexpected websocket message type: {message.type}")

    def _process_level_event(self, event_data: Dict[str, object]):
        payload = {
            "capturesignalrms": [float(v) for v in event_data.get("capture_rms", [])],
            "capturesignalpeak": [float(v) for v in event_data.get("capture_peak", [])],
            "playbacksignalrms": [float(v) for v in event_data.get("playback_rms", [])],
            "playbacksignalpeak": [float(v) for v in event_data.get("playback_peak", [])],
            "ts": int(time.time() * 1000),
        }
        self._status_cache.update(payload)
        self._publish_json("levels", payload)

    async def _run(self):
        session = aiohttp.ClientSession()
        self._session = session
        try:
            while self._running:
                websocket: Optional[aiohttp.ClientWebSocketResponse] = None
                subscribed = False
                should_wait = True
                try:
                    logging.debug(
                        "LevelEventStream connecting to CamillaDSP at %s:%s",
                        self._host,
                        self._port,
                    )
                    websocket = await session.ws_connect(self._websocket_url)
                    self._websocket = websocket
                    await self._send_command(websocket, "GetVersion")
                    await self._send_command(
                        websocket, "SubscribeVuLevels", self._vu_subscription
                    )
                    subscribed = True
                    logging.debug("LevelEventStream connected to CamillaDSP")
                    self._publish_json(
                        "stream_status",
                        {"state": "connected", "ts": int(time.time() * 1000)},
                    )
                    async for message in websocket:
                        if not self._running:
                            should_wait = False
                            break
                        event_data = self._handle_event_reply(
                            "VuLevelsEvent", self._message_payload(message)
                        )
                        if event_data is None:
                            continue
                        self._process_level_event(event_data)
                    if self._running:
                        raise IOError("Lost connection to CamillaDSP")
                    should_wait = False
                except asyncio.CancelledError:
                    should_wait = False
                    raise
                except Exception as exc:
                    logging.debug("Level event stream disconnected: %s", exc)
                    if self._running:
                        self._publish_json(
                            "stream_status",
                            {"state": "reconnecting", "ts": int(time.time() * 1000)},
                        )
                finally:
                    if websocket is not None:
                        if subscribed and not websocket.closed:
                            with suppress(Exception):
                                await self._send_command(websocket, "StopSubscription")
                        with suppress(Exception):
                            await websocket.close()
                    self._websocket = None
                if self._running and should_wait:
                    await asyncio.sleep(1.0)
        finally:
            self._websocket = None
            self._session = None
            await session.close()
