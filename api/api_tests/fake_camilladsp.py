"""
A stand-in for CamillaDSP's websocket server, for testing the GUI backends.

It speaks the CamillaDSP 5.0 protocol for the commands the backends use, and
answers from a plain dict of state that tests can change. It runs on its own
event loop in a background thread, so a backend under test can be an ordinary
subprocess talking to it over a real socket.
"""

import asyncio
import copy
import json
import threading

import yaml
from aiohttp import WSMsgType, web

SAMPLE_CONFIG = {
    "devices": {
        "samplerate": 44100,
        "chunksize": 1024,
        "capture": {"type": "Stdin", "channels": 2, "format": "S16_LE"},
        "playback": {"type": "Stdout", "channels": 2, "format": "S16_LE"},
    }
}

CAPTURE_CAPABILITIES = {
    "name": "hw:Aaaa,0,0",
    "description": "Dev A",
    "capability_sets": [
        {
            "mode": "Unified",
            "capabilities": [
                {
                    "channels": 2,
                    "samplerates": [{"samplerate": 44100, "formats": ["S16_LE", "S32_LE"]}],
                }
            ],
        }
    ],
}

PLAYBACK_CAPABILITIES = {
    "name": "hw:Cccc,0,0",
    "description": "Dev C",
    "capability_sets": [
        {
            "mode": "Unified",
            "capabilities": [
                {"channels": 2, "samplerates": [{"samplerate": 48000, "formats": ["F32_LE"]}]}
            ],
        }
    ],
}


def default_state(config_file_path):
    return {
        "online": True,
        # accept connections but never answer the handshake, like a hung or unreachable host
        "hung": False,
        "version": "5.0.0",
        "state": "Running",
        "stop_reason": "None",
        "capture_rate": 44100,
        "rate_adjust": 1.01,
        "buffer_level": 1234,
        "clipped_samples": 12,
        "processing_load": 0.5,
        "resampler_load": 0.2,
        "signal_range": 1.5,
        "update_interval": 100,
        "labels": {"capture": ["L", "R"], "playback": ["L", "R"]},
        "volume": -20.0,
        "mute": False,
        "faders": [{"volume": -20.0, "mute": False}] + [{"volume": 0.0, "mute": False}] * 4,
        "capture_peak": [-2.0, -3.0],
        "playback_peak": [-2.5, -3.5],
        "config": copy.deepcopy(SAMPLE_CONFIG),
        "config_file_path": config_file_path,
        "state_file_path": None,
        "supported_device_types": [["Alsa", "Stdout"], ["Alsa", "Stdin"]],
        "capture_devices": {"Alsa": [["hw:Aaaa,0,0", "Dev A"], ["hw:Bbbb,0,0", "Dev B"]]},
        "playback_devices": {"Alsa": [["hw:Cccc,0,0", "Dev C"], ["hw:Dddd,0,0", "Dev D"]]},
        "capture_capabilities": {"hw:Aaaa,0,0": CAPTURE_CAPABILITIES},
        "playback_capabilities": {"hw:Cccc,0,0": PLAYBACK_CAPABILITIES},
        # device name -> error result, for devices that should fail
        "capability_errors": {},
        # the config is refused with this message, if set
        "reject_config": None,
        # every command received, in order
        "received": [],
    }


class FakeCamillaDSP:
    def __init__(self, config_file_path=None):
        self._initial_path = config_file_path
        self.state = default_state(config_file_path)
        self._loop = asyncio.new_event_loop()
        self._runner = None
        self.port = None
        self._sockets = set()
        # socket -> the name of the subscription on it
        self._subscribed = {}

    def reset(self):
        self.state = default_state(self._initial_path)

    def commands(self, name):
        return [cmd for cmd in self.state["received"] if cmd["command"] == name]

    # ── Lifecycle ─────────────────────────────────────────────────────────

    def start(self):
        ready = threading.Event()

        def run():
            asyncio.set_event_loop(self._loop)
            self._loop.run_until_complete(self._start_server())
            ready.set()
            self._loop.run_forever()

        threading.Thread(target=run, daemon=True).start()
        ready.wait(5)
        return self

    async def _start_server(self):
        app = web.Application()
        app.router.add_get("/", self._handle)
        self._runner = web.AppRunner(app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, "127.0.0.1", 0)
        await site.start()
        self.port = site._server.sockets[0].getsockname()[1]

    def stop(self):
        async def shutdown():
            await self._runner.cleanup()

        asyncio.run_coroutine_threadsafe(shutdown(), self._loop).result(5)
        self._loop.call_soon_threadsafe(self._loop.stop)

    def go_offline(self, hung=False):
        """Drop every connection and refuse new ones, or leave them hanging."""
        self.state["online"] = False
        self.state["hung"] = hung

        async def close_all():
            for ws in list(self._sockets):
                await ws.close()

        asyncio.run_coroutine_threadsafe(close_all(), self._loop).result(5)

    def drop_subscriptions(self, name):
        """Close the sockets with this subscription, like a connection lost while running."""

        async def close():
            for ws, subscribed in list(self._subscribed.items()):
                if subscribed == name:
                    await ws.close()

        asyncio.run_coroutine_threadsafe(close(), self._loop).result(5)

    # ── Protocol ──────────────────────────────────────────────────────────

    async def _handle(self, request):
        if self.state["hung"]:
            # Longer than the backend's connect timeout, short enough not to hold up shutdown.
            await asyncio.sleep(3)
            raise web.HTTPServiceUnavailable()
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        if not self.state["online"]:
            await ws.close()
            return ws
        self._sockets.add(ws)
        subscription = None
        try:
            async for message in ws:
                if message.type != WSMsgType.TEXT or not self.state["online"]:
                    break
                command = json.loads(message.data)
                self.state["received"].append(command)
                name = command.get("command")
                if name in ("SubscribeVuLevels", "SubscribeSpectrum", "SubscribeState"):
                    reply = self._subscribe(command)
                    await ws.send_str(json.dumps(reply))
                    if reply["result"] == "Ok":
                        self._subscribed[ws] = name
                        subscription = asyncio.create_task(self._push_events(ws, name))
                    continue
                if name == "StopSubscription":
                    if subscription is not None:
                        subscription.cancel()
                        subscription = None
                    await ws.send_str(json.dumps({"reply": name, "result": "Ok"}))
                    continue
                await ws.send_str(json.dumps(self._reply(command)))
        finally:
            if subscription is not None:
                subscription.cancel()
            self._sockets.discard(ws)
            self._subscribed.pop(ws, None)
        return ws

    def _subscribe(self, command):
        name = command["command"]
        if name == "SubscribeSpectrum":
            if command["value"]["n_bins"] < 2:
                return {
                    "reply": name,
                    "result": "InvalidRequestError",
                    "message": "n_bins must be at least 2",
                }
            if self.state["state"] != "Running":
                return {"reply": name, "result": "ProcessingNotRunningError"}
        return {"reply": name, "result": "Ok"}

    async def _push_events(self, ws, name):
        if name == "SubscribeState":
            await self._push_state_events(ws)
            return
        while not ws.closed:
            if name == "SubscribeVuLevels":
                event = {
                    "reply": "VuLevelsEvent",
                    "result": "Ok",
                    "value": {
                        "playback_rms": [-7.0, -8.0],
                        "playback_peak": [-3.0, -4.0],
                        "capture_rms": [-5.0, -6.0],
                        "capture_peak": [-2.0, -3.0],
                    },
                }
            elif self.state["state"] == "Inactive":
                # Like CamillaDSP, the spectrum subscription ends when processing stops.
                event = {"reply": "SpectrumEvent", "result": "ProcessingStopped", "value": None}
                await ws.send_str(json.dumps(event))
                return
            else:
                event = {
                    "reply": "SpectrumEvent",
                    "result": "Ok",
                    "value": {"frequencies": [100.0, 1000.0], "magnitudes": [-20.0, -30.0]},
                }
            await ws.send_str(json.dumps(event))
            await asyncio.sleep(0.05)

    async def _push_state_events(self, ws):
        """Like CamillaDSP, an event only when the state changes, none for the current one."""
        last = self.state["state"]
        while not ws.closed:
            await asyncio.sleep(0.05)
            state = self.state["state"]
            if state == last:
                continue
            last = state
            value = {"state": state}
            if state == "Inactive":
                value["stop_reason"] = self.state["stop_reason"]
            await ws.send_str(json.dumps({"reply": "StateEvent", "result": "Ok", "value": value}))

    def _reply(self, command):
        s = self.state
        name = command["command"]

        def ok(value=None, has_value=True):
            reply = {"reply": name, "result": "Ok"}
            if has_value:
                reply["value"] = value
            return reply

        def error(result, message=None, value=None):
            reply = {"reply": name, "result": result, "value": value}
            if message is not None:
                reply["message"] = message
            return reply

        getters = {
            "GetVersion": "version",
            "GetState": "state",
            "GetStopReason": "stop_reason",
            "GetCaptureRate": "capture_rate",
            "GetRateAdjust": "rate_adjust",
            "GetBufferLevel": "buffer_level",
            "GetClippedSamples": "clipped_samples",
            "GetProcessingLoad": "processing_load",
            "GetResamplerLoad": "resampler_load",
            "GetSignalRange": "signal_range",
            "GetUpdateInterval": "update_interval",
            "GetChannelLabels": "labels",
            "GetVolume": "volume",
            "GetMute": "mute",
            "GetFaders": "faders",
            "GetCaptureSignalPeak": "capture_peak",
            "GetPlaybackSignalPeak": "playback_peak",
            "GetConfigFilePath": "config_file_path",
            "GetStateFilePath": "state_file_path",
            "GetSupportedDeviceTypes": "supported_device_types",
        }
        if name in getters:
            return ok(s[getters[name]])
        if name == "GetConfigTitle":
            return ok((s["config"] or {}).get("title") or "")
        if name == "GetConfigDescription":
            return ok((s["config"] or {}).get("description") or "")
        if name == "GetConfig":
            return ok(yaml.dump(s["config"]))
        if name == "GetConfigJson":
            return ok(json.dumps(s["config"]))
        if name in ("SetConfig", "SetConfigJson"):
            if s["reject_config"]:
                return error("ConfigValidationError", s["reject_config"])
            loader = yaml.safe_load if name == "SetConfig" else json.loads
            s["config"] = loader(command["value"])
            return ok(has_value=False)
        if name == "SetConfigFilePath":
            s["config_file_path"] = command["value"]
            return ok(has_value=False)
        if name == "SetVolume":
            s["volume"] = command["value"]
            return ok(has_value=False)
        if name == "SetMute":
            s["mute"] = command["value"]
            return ok(has_value=False)
        if name == "SetFaderVolume":
            s["faders"][command["fader"]] = {**s["faders"][command["fader"]], "volume": command["value"]}
            return ok(has_value=False)
        if name == "SetFaderMute":
            s["faders"][command["fader"]] = {**s["faders"][command["fader"]], "mute": command["value"]}
            return ok(has_value=False)
        if name == "SetUpdateInterval":
            s["update_interval"] = command["value"]
            return ok(has_value=False)
        if name == "Stop":
            s["state"] = "Inactive"
            return ok(has_value=False)
        if name in ("GetAvailableCaptureDevices", "GetAvailablePlaybackDevices"):
            key = "capture_devices" if "Capture" in name else "playback_devices"
            return ok(s[key].get(command["backend"], []))
        if name in ("GetCaptureDeviceCapabilities", "GetPlaybackDeviceCapabilities"):
            key = "capture_capabilities" if "Capture" in name else "playback_capabilities"
            device = command["device"]
            if device in s["capability_errors"]:
                return error(s["capability_errors"][device], device, CAPTURE_CAPABILITIES)
            if device not in s[key]:
                return error("DeviceNotFoundError", "device not found", CAPTURE_CAPABILITIES)
            return ok(s[key][device])
        return {"reply": "Invalid", "error": f"Unknown command {name}"}
