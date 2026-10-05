"""Post the same configs to the Python (5005) and Rust (5006) /api/validateconfig and compare."""

import copy
import glob
import json
import os
import sys
import urllib.error
import urllib.request

import yaml

HOME = os.path.expanduser("~")


def post(port, config):
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/validateconfig",
        data=json.dumps(config).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode()


def summary(status, body):
    if status == 200:
        return "OK", []
    try:
        issues = json.loads(body)
    except json.JSONDecodeError:
        return f"HTTP {status}", [((), body[:200], "?")]
    return "issues", [(tuple(path), message, severity) for path, message, severity in issues]


def without_alsa(config):
    """Alsa devices only parse in a Linux build of camilladsp-config, swap them for stdio."""
    devices = config.get("devices")
    if not isinstance(devices, dict):
        return config
    for side, replacement in (("capture", "Stdin"), ("playback", "Stdout")):
        device = devices.get(side)
        if isinstance(device, dict) and device.get("type") == "Alsa":
            devices[side] = {
                "type": replacement,
                "channels": device.get("channels"),
                "format": device.get("format") or "S32_LE",
            }
    return config


def corpus():
    files = sorted(
        glob.glob(f"{HOME}/rust/camilladsp/exampleconfigs/*.yml")
        + glob.glob(f"{HOME}/repos/cdsp_gui/camillagui-backend/tests/testfiles/config*.yml")
        + glob.glob(f"{HOME}/camilladsp/configs/*.yml")
    )
    for name in files:
        try:
            with open(name) as f:
                config = yaml.safe_load(f)
        except Exception as err:
            print(f"skip {name}: {err}")
            continue
        if isinstance(config, dict):
            yield os.path.relpath(name, HOME), without_alsa(config)

    base = {
        "devices": {
            "samplerate": 44100,
            "chunksize": 1024,
            "capture": {"type": "Stdin", "channels": 2, "format": "S16_LE"},
            "playback": {"type": "Stdout", "channels": 2, "format": "S16_LE"},
        },
        "filters": {
            "lp": {"type": "Biquad", "parameters": {"type": "Lowpass", "freq": 1000, "q": 0.7}},
        },
        "mixers": {
            "mono": {
                "channels": {"in": 2, "out": 2},
                "mapping": [
                    {"dest": 0, "sources": [{"channel": 0, "gain": -6}, {"channel": 1, "gain": -6}]},
                    {"dest": 1, "sources": [{"channel": 0, "gain": -6}, {"channel": 1, "gain": -6}]},
                ],
            }
        },
        "pipeline": [
            {"type": "Mixer", "name": "mono"},
            {"type": "Filter", "channels": [0, 1], "names": ["lp"]},
        ],
    }
    yield "mutation base", base

    def mutated(label, change):
        config = copy.deepcopy(base)
        change(config)
        return f"mutation: {label}", config

    first_filter = "lp"

    def neg_freq(c):
        c["filters"]["lp"]["parameters"]["freq"] = -5

    yield mutated("negative freq", neg_freq)
    yield mutated("freq is a string", lambda c: c["filters"][first_filter]["parameters"].__setitem__("freq", "abc"))
    yield mutated("q missing", lambda c: c["filters"]["lp"]["parameters"].pop("q"))
    yield mutated("mixer source channel out of range", lambda c: c["mixers"]["mono"]["mapping"][0]["sources"][0].__setitem__("channel", 5))
    yield mutated("mixer in != capture channels", lambda c: c["mixers"]["mono"]["channels"].__setitem__("in", 4))
    yield mutated("unknown mixer in pipeline", lambda c: c["pipeline"][0].__setitem__("name", "nomix"))
    yield mutated("bad filter type", lambda c: c["filters"]["lp"].__setitem__("type", "Bogus"))
    yield mutated("bad biquad subtype", lambda c: c["filters"]["lp"]["parameters"].__setitem__("type", "Bogus"))
    yield mutated("NaN-free but huge gain", lambda c: c["filters"].__setitem__("g", {"type": "Gain", "parameters": {"gain": 1000}}))
    yield mutated("samplerate zero", lambda c: c["devices"].__setitem__("samplerate", 0))
    yield mutated("freq above nyquist", lambda c: c["filters"]["lp"]["parameters"].__setitem__("freq", 30000))
    yield mutated("unknown field in devices", lambda c: c["devices"].__setitem__("bogus", 1))
    yield mutated("unknown filter in pipeline", lambda c: c["pipeline"].append({"type": "Filter", "channels": [0], "names": ["nosuchfilter"]}))
    yield mutated("channel out of range", lambda c: c["pipeline"].append({"type": "Filter", "channels": [17], "names": [first_filter]}))
    yield mutated("missing coeff file", lambda c: c["filters"].__setitem__("fir", {"type": "Conv", "parameters": {"type": "Wav", "filename": "does_not_exist.wav"}}))
    yield mutated("chunksize zero", lambda c: c["devices"].__setitem__("chunksize", 0))
    yield mutated("no pipeline", lambda c: c.pop("pipeline"))

    def several(c):
        neg_freq(c)
        c["pipeline"].append({"type": "Filter", "channels": [17], "names": ["nosuchfilter"]})
        c["filters"]["fir"] = {"type": "Conv", "parameters": {"type": "Wav", "filename": "does_not_exist.wav"}}

    yield mutated("several problems", several)


def main():
    verdict_diffs = 0
    for label, config in corpus():
        py = summary(*post(5005, config))
        rs = summary(*post(5006, config))
        same_verdict = py[0] == rs[0]
        verdict_diffs += not same_verdict
        mark = "  " if same_verdict else "!!"
        print(f"{mark} {label}: python={py[0]}({len(py[1])}) rust={rs[0]}({len(rs[1])})")
        if py[1] or rs[1]:
            for path, message, severity in py[1][:4]:
                print(f"     py {severity:7} {'/'.join(map(str, path)) or '<root>'}: {message[:110]}")
            for path, message, severity in rs[1][:4]:
                print(f"     rs {severity:7} {'/'.join(map(str, path)) or '<root>'}: {message[:110]}")
    print(f"\nverdict differences: {verdict_diffs}")


if __name__ == "__main__":
    sys.exit(main())
