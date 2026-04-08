import asyncio
import json
import logging
import math
import threading
import time
from typing import Dict, List, Optional, Set

import camilladsp


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
        base_tau_seconds = max(0.0, float(smoothing_time_constant_ms) / 1000.0)
        self._min_publish_interval_seconds = (
            0.0 if max_update_hz <= 0.0 else 1.0 / float(max_update_hz)
        )
        # Use asymmetric smoothing so level rises react faster than level falls.
        self._attack_time_constant_seconds = 0.35 * base_tau_seconds
        self._release_time_constant_seconds = 2.0 * base_tau_seconds
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._clients: Set[asyncio.Queue[bytes]] = set()
        self._clients_lock = threading.Lock()
        self._running = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._subscriber: Optional[camilladsp.CamillaClient] = None
        self._smoothed_levels: Dict[str, Dict[str, object]] = {
            "capture": {"ts": None, "rms": None, "peak": None},
            "playback": {"ts": None, "rms": None, "peak": None},
        }
        self._last_level_event_publish_ts = {"capture": None, "playback": None}
        self._last_published_ts = {"capture": None, "playback": None}

    def start(self, loop: asyncio.AbstractEventLoop):
        if self._thread is not None:
            return
        logging.debug("LevelEventStream starting")
        self._loop = loop
        self._running.set()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        logging.debug("LevelEventStream stopping")
        self._running.clear()
        self._loop = None
        subscriber = self._subscriber
        self._subscriber = None
        # Never block process shutdown on websocket close/join.
        # The stream thread is daemonized and will terminate with the process.
        self._thread = None
        if subscriber is not None:
            threading.Thread(
                target=self._disconnect_subscriber,
                args=(subscriber,),
                daemon=True,
            ).start()

    @staticmethod
    def _disconnect_subscriber(subscriber):
        try:
            subscriber.disconnect()
        except Exception:
            pass

    def _interruptible_wait(self, seconds: float):
        deadline = time.monotonic() + max(0.0, seconds)
        while self._running.is_set():
            remaining = deadline - time.monotonic()
            if remaining <= 0.0:
                break
            time.sleep(min(0.1, remaining))

    def add_client(self) -> asyncio.Queue[bytes]:
        queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=32)
        with self._clients_lock:
            self._clients.add(queue)
            client_count = len(self._clients)
        logging.debug("LevelEventStream client added, total clients=%s", client_count)
        self._publish_json("stream_status", {"state": "connected", "ts": int(time.time() * 1000)})
        return queue

    def remove_client(self, queue: asyncio.Queue[bytes]):
        with self._clients_lock:
            self._clients.discard(queue)
            client_count = len(self._clients)
        logging.debug("LevelEventStream client removed, total clients=%s", client_count)

    def _has_clients(self) -> bool:
        with self._clients_lock:
            return bool(self._clients)

    def _enqueue_frame(self, frame: bytes):
        with self._clients_lock:
            clients = list(self._clients)
        for queue in clients:
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
        if self._loop is None or not self._has_clients():
            return
        frame = f"event: {event}\ndata: {json.dumps(data)}\n\n".encode("utf-8")
        try:
            self._loop.call_soon_threadsafe(self._enqueue_frame, frame)
        except RuntimeError:
            # Event loop is shutting down.
            pass

    def _smoothing_alpha(self, dt_seconds: float, tau: float) -> float:
        if tau <= 0.0:
            return 1.0
        if dt_seconds <= 0.0:
            return 0.0
        return 1.0 - math.exp(-dt_seconds / tau)

    def _smoothing_alphas(self, dt_seconds: float) -> tuple[float, float]:
        return (
            self._smoothing_alpha(dt_seconds, self._attack_time_constant_seconds),
            self._smoothing_alpha(dt_seconds, self._release_time_constant_seconds),
        )

    def _smooth_series(
        self,
        previous: Optional[List[float]],
        current: List[float],
        attack_alpha: float,
        release_alpha: float,
    ) -> List[float]:
        if previous is None or len(previous) != len(current):
            return current
        if attack_alpha >= 1.0 and release_alpha >= 1.0:
            return current
        if attack_alpha <= 0.0 and release_alpha <= 0.0:
            return previous
        smoothed = []
        for prev, cur in zip(previous, current):
            if cur > prev:
                alpha = attack_alpha
            elif cur < prev:
                alpha = release_alpha
            else:
                smoothed.append(prev)
                continue
            smoothed.append(prev + alpha * (cur - prev))
        return smoothed

    def _apply_smoothing(
        self, side: str, rms: List[float], peak: List[float], now_mono: float
    ) -> Dict[str, List[float]]:
        side_state = self._smoothed_levels.get(side)
        if side_state is None:
            return {"rms": rms, "peak": peak}

        prev_ts = side_state["ts"]
        if prev_ts is None:
            side_state["ts"] = now_mono
            side_state["rms"] = rms
            side_state["peak"] = peak
            return {"rms": rms, "peak": peak}

        dt_seconds = now_mono - float(prev_ts)
        attack_alpha, release_alpha = self._smoothing_alphas(dt_seconds)
        smoothed_rms = self._smooth_series(  # type: ignore[arg-type]
            side_state["rms"], rms, attack_alpha, release_alpha
        )
        smoothed_peak = self._smooth_series(  # type: ignore[arg-type]
            side_state["peak"], peak, attack_alpha, release_alpha
        )
        side_state["ts"] = now_mono
        side_state["rms"] = smoothed_rms
        side_state["peak"] = smoothed_peak
        return {"rms": smoothed_rms, "peak": smoothed_peak}

    def _should_publish_level_event(self, side: str, now_wall: float) -> bool:
        if self._min_publish_interval_seconds <= 0.0:
            self._last_level_event_publish_ts[side] = now_wall
            return True
        last_publish_ts = self._last_level_event_publish_ts.get(side)
        if last_publish_ts is None:
            self._last_level_event_publish_ts[side] = now_wall
            return True
        if now_wall - last_publish_ts < self._min_publish_interval_seconds:
            return False
        self._last_level_event_publish_ts[side] = now_wall
        return True

    def _run(self):
        while self._running.is_set():
            client = camilladsp.CamillaClient(self._host, self._port)
            self._subscriber = client
            try:
                logging.debug("LevelEventStream connecting to CamillaDSP at %s:%s", self._host, self._port)
                client.connect()
                logging.debug("LevelEventStream connected to CamillaDSP")
                self._publish_json(
                    "stream_status",
                    {"state": "connected", "ts": int(time.time() * 1000)},
                )

                def on_level_event(event_data):
                    side = event_data.get("side")
                    now_wall = time.time()
                    rms = [float(v) for v in event_data.get("rms", [])]
                    peak = [float(v) for v in event_data.get("peak", [])]
                    smoothed = self._apply_smoothing(side, rms, peak, time.monotonic())
                    rms = smoothed["rms"]
                    peak = smoothed["peak"]
                    if side == "capture":
                        self._status_cache["capturesignalrms"] = rms
                        self._status_cache["capturesignalpeak"] = peak
                    elif side == "playback":
                        self._status_cache["playbacksignalrms"] = rms
                        self._status_cache["playbacksignalpeak"] = peak
                    last_ts = self._last_published_ts.get(side)
                    gap_ms = None
                    if last_ts is not None:
                        gap_ms = (now_wall - last_ts) * 1000.0
                    self._last_published_ts[side] = now_wall
                    if gap_ms is not None and gap_ms > 300.0:
                        logging.debug(
                            "LevelEventStream slow publish gap for %s: %.1f ms",
                            side,
                            gap_ms,
                        )
                    if side not in self._last_level_event_publish_ts:
                        return self._running.is_set()
                    if not self._should_publish_level_event(side, now_wall):
                        return self._running.is_set()
                    payload = {
                        "side": side,
                        "rms": rms,
                        "peak": peak,
                        "ts": int(now_wall * 1000),
                    }
                    self._publish_json("levels", payload)
                    return self._running.is_set()

                client.levels.subscribe_signal_levels(on_level_event, side="both")
            except Exception as exc:
                logging.debug("Level event stream disconnected: %s", exc)
                self._publish_json(
                    "stream_status",
                    {"state": "reconnecting", "ts": int(time.time() * 1000)},
                )
                self._interruptible_wait(1.0)
            finally:
                try:
                    client.disconnect()
                except Exception:
                    pass
                self._subscriber = None
