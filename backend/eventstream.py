import asyncio
from contextlib import suppress
import json
import logging
import time
from typing import Any, Callable, Dict, Optional, Set, Tuple, Union

import aiohttp


# CamillaDSP 5.0 websocket framing.
#
# Messages are internally tagged. A command is {"command": <name>} plus its
# arguments as named fields. A reply is one flat object,
# {"reply": <name>, "result": <status>}, with the payload in "value" and any
# error text in "message". A command CamillaDSP does not recognise comes back
# as {"reply": "Invalid", "error": <text>}.
#
# The backend talks to CamillaDSP over its own websocket here rather than
# through pycamilladsp, because these are pushed subscriptions rather than
# request/response calls, so the framing has to be repeated. Keep it in step
# with pycamilladsp's camillaws.py.


def _format_command(command: str, **args) -> str:
    """Encode a command with its arguments as named fields."""
    return json.dumps({"command": command, **args})


def _parse_reply(rawreply: Union[str, bytes]) -> Tuple[str, str, Any, Optional[str]]:
    """
    Decode a reply into (name, result, value, message).

    Raises IOError if the message is not a well-formed reply, or if CamillaDSP
    rejected the command outright.
    """
    try:
        reply = json.loads(rawreply)
    except json.JSONDecodeError as exc:
        raise IOError(f"Invalid response received: {rawreply!r}") from exc
    if not isinstance(reply, dict) or "reply" not in reply:
        raise IOError(f"Invalid response received: {rawreply!r}")
    if reply["reply"] == "Invalid":
        # The command was not recognized, or is not valid in the current state.
        raise IOError(reply.get("error") or "Command not recognized")
    result = reply.get("result")
    if not isinstance(result, str):
        raise IOError(f"Invalid response received: {rawreply!r}")
    return reply["reply"], result, reply.get("value"), reply.get("message")


def _message_payload(message: aiohttp.WSMessage) -> Union[str, bytes]:
    if message.type in (aiohttp.WSMsgType.TEXT, aiohttp.WSMsgType.BINARY):
        return message.data
    if message.type in (
        aiohttp.WSMsgType.CLOSE,
        aiohttp.WSMsgType.CLOSING,
        aiohttp.WSMsgType.CLOSED,
    ):
        raise IOError("Websocket closed")
    if message.type == aiohttp.WSMsgType.ERROR:
        raise IOError("Websocket error") from message.data
    raise IOError(f"Unexpected websocket message type: {message.type}")


async def _send_command(
    websocket: aiohttp.ClientWebSocketResponse, command: str, **args
):
    """Send a command, wait for its reply, and return the reply value."""
    await websocket.send_str(_format_command(command, **args))
    name, result, value, message = _parse_reply(
        _message_payload(await websocket.receive())
    )
    if name != command:
        raise IOError(f"Got a reply to {name} while waiting for {command}")
    if result != "Ok":
        raise IOError(message or f"{command} failed: {result}")
    return value


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
                    await _send_command(websocket, "GetVersion")
                    await _send_command(
                        websocket, "SubscribeVuLevels", value=self._vu_subscription
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
                        name, result, value, error = _parse_reply(
                            _message_payload(message)
                        )
                        if name != "VuLevelsEvent":
                            continue
                        if result != "Ok":
                            raise IOError(error or f"VuLevelsEvent failed: {result}")
                        self._process_level_event(value)
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
                                await _send_command(websocket, "StopSubscription")
                        with suppress(Exception):
                            await websocket.close()
                    self._websocket = None
                if self._running and should_wait:
                    await asyncio.sleep(1.0)
        finally:
            self._websocket = None
            self._session = None
            await session.close()


class ProcessingNotRunning(Exception):
    """Raised when SubscribeSpectrum is rejected because processing is not running."""


class SpectrumEventStream:
    """
    On-demand spectrum subscription over a dedicated WebSocket to CamillaDSP.

    Call ``subscribe(params)`` to start — it blocks until CamillaDSP confirms
    the subscription (or rejects it), then returns.  Spectrum events are pushed
    to SSE clients via the injected ``publish_json`` callable, which should be
    ``LevelEventStream._publish_json``.

    Call ``unsubscribe()`` to stop.
    """

    def __init__(
        self,
        host: str,
        port: int,
        publish_json: Callable[[str, Any], None],
    ):
        self._websocket_url = f"ws://{host}:{port}"
        self._publish_json = publish_json
        self._task: Optional[asyncio.Task[None]] = None
        self._websocket: Optional[aiohttp.ClientWebSocketResponse] = None
        self._session: Optional[aiohttp.ClientSession] = None

    async def subscribe(self, params: Dict[str, Any]) -> None:
        """
        Start a spectrum subscription with the given parameters.

        Connects to CamillaDSP, sends ``SubscribeSpectrum``, and waits for
        confirmation before returning.  Any previous subscription is stopped
        first.

        Raises:
            ProcessingNotRunning: CamillaDSP rejected the subscription because
                processing is not running.
            IOError: Connection or protocol error.
        """
        await self._stop_task()
        loop = asyncio.get_running_loop()
        subscribed: asyncio.Future[None] = loop.create_future()
        self._task = asyncio.create_task(self._run(params, subscribed))
        try:
            await subscribed
        except Exception:
            await self._stop_task()
            raise

    async def unsubscribe(self) -> None:
        """Cancel the active spectrum subscription, if any."""
        await self._stop_task()

    async def _stop_task(self) -> None:
        task = self._task
        self._task = None
        if task is not None and not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        ws = self._websocket
        self._websocket = None
        if ws is not None and not ws.closed:
            with suppress(Exception):
                await ws.close()
        session = self._session
        self._session = None
        if session is not None and not session.closed:
            with suppress(Exception):
                await session.close()

    async def _run(
        self,
        params: Dict[str, Any],
        subscribed: asyncio.Future[None],
    ) -> None:
        session = aiohttp.ClientSession()
        self._session = session
        ws: Optional[aiohttp.ClientWebSocketResponse] = None
        subscribed_ok = False
        try:
            ws = await session.ws_connect(self._websocket_url)
            self._websocket = ws

            # Send SubscribeSpectrum and wait for CamillaDSP's reply.
            await ws.send_str(_format_command("SubscribeSpectrum", value=params))
            name, result, _value, error = _parse_reply(
                _message_payload(await ws.receive())
            )

            if name != "SubscribeSpectrum":
                raise IOError(f"Got a reply to {name} while waiting for the subscription")

            if result == "ProcessingNotRunningError":
                if not subscribed.done():
                    subscribed.set_exception(ProcessingNotRunning())
                return
            if result != "Ok":
                raise IOError(error or f"SubscribeSpectrum failed: {result}")

            subscribed_ok = True
            if not subscribed.done():
                subscribed.set_result(None)

            # Receive pushed SpectrumEvent messages.
            async for message in ws:
                try:
                    name, result, value, _error = _parse_reply(
                        _message_payload(message)
                    )
                except IOError:
                    break
                if name != "SpectrumEvent":
                    continue
                if result == "Ok":
                    if value is not None:
                        self._publish_json("spectrum", value)
                elif result == "ProcessingStopped":
                    # Forward the cancellation signal, then stop cleanly.
                    self._publish_json("spectrum", {"result": "ProcessingStopped"})
                    subscribed_ok = False  # CamillaDSP already cancelled
                    break
                else:
                    logging.debug("SpectrumEvent unexpected result: %s", result)
                    break

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logging.debug("Spectrum event stream error: %s", exc)
            if not subscribed.done():
                subscribed.set_exception(IOError(str(exc)))
        finally:
            # Best-effort StopSubscription (skipped when CamillaDSP already cancelled).
            if subscribed_ok and ws is not None and not ws.closed:
                with suppress(Exception):
                    await ws.send_str(_format_command("StopSubscription"))
                    await ws.receive()
            self._websocket = None
            if ws is not None and not ws.closed:
                with suppress(Exception):
                    await ws.close()
            self._session = None
            with suppress(Exception):
                await session.close()
