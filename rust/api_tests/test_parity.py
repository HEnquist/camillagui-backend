"""
Send the same requests to the Rust and the Python backend and compare the
responses in full. Differences that are intended are listed with the reason.
"""

import json
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parents[2]


def body(resp):
    try:
        return resp.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        return resp.body


def compare(backends, method, path, **kwargs):
    rust = backends["rust"].request(method, path, **kwargs)
    python = backends["python"].request(method, path, **kwargs)
    assert rust.status == python.status, (path, rust.text, python.text)
    return body(rust), body(python)


def without(value, *keys):
    return {k: v for k, v in value.items() if k not in keys}


def strip_config_dir(value, backends):
    """The two backends have their own copies of the test files."""
    text = json.dumps(value)
    for backend in backends.values():
        text = text.replace(str(backend.config_dir), "<config_dir>")
    return json.loads(text)


def without_statefile(files):
    """Each backend writes its own statefile, so its time and size differ."""
    return [f for f in files if f["name"] != "statefile.yml"]


@pytest.mark.parametrize(
    "path, params",
    [
        ("/api/getparam/volume", None),
        ("/api/getparam/mute", None),
        ("/api/getparam/signalrange", None),
        ("/api/getparam/updateinterval", None),
        ("/api/getparam/processingload", None),
        ("/api/getparamjson/faders", None),
        ("/api/getlistparam/capturesignalpeak", None),
        ("/api/getlistparam/other", None),
        ("/api/getconfig", None),
        ("/api/defaultsforcoeffs", {"file": "test.txt"}),
        ("/api/logfile", None),
        ("/api/capturedevices/Alsa", None),
        ("/api/playbackdevices/Alsa", None),
        ("/api/capturedevicecapabilities/Alsa", {"device": "hw:Aaaa,0,0"}),
        ("/api/backends", None),
        ("/api/getactiveconfigfilename", None),
    ],
)
def test_same_response(both_backends, path, params):
    rust, python = compare(both_backends, "GET", path, params=params)
    assert rust == python


def test_status(both_backends):
    rust, python = compare(both_backends, "GET", "/api/status")
    # There is no pycamilladsp any more, the backends have their own versions,
    # and the level timestamps are a few milliseconds apart.
    ignored = ("py_cdsp_version", "backend_version", "capture_device_capabilities", "ts")
    assert without(rust, *ignored) == without(python, *ignored)


def test_gui_config(both_backends):
    rust, python = compare(both_backends, "GET", "/api/guiconfig")
    assert rust == python


@pytest.mark.parametrize("path", ["/api/storedconfigs", "/api/storedcoeffs"])
def test_stored_files(both_backends, path):
    rust, python = compare(both_backends, "GET", path)
    rust = without_statefile(strip_config_dir(rust, both_backends))
    python = without_statefile(strip_config_dir(python, both_backends))
    assert rust == python


# The endpoints that send a config with its optional fields filled in. Python
# filled them from its schemas, Rust from camilladsp's own config types, which
# may know of more fields. Every field Python sends must be there with the same
# value; Rust may add fields, which must all be null.
def assert_same_config(rust, python, path=()):
    if isinstance(python, dict) and isinstance(rust, dict):
        for key, value in python.items():
            assert key in rust, f"{'/'.join(path + (key,))} is missing"
            assert_same_config(rust[key], value, path + (key,))
        for key in set(rust) - set(python):
            assert rust[key] is None, f"{'/'.join(path + (key,))} is extra and not null: {rust[key]}"
    elif isinstance(python, list) and isinstance(rust, list):
        assert len(rust) == len(python), "/".join(path)
        for index, (r, p) in enumerate(zip(rust, python)):
            assert_same_config(r, p, path + (str(index),))
    else:
        assert rust == python, f"{'/'.join(path)}: {rust!r} != {python!r}"


def example_configs():
    folder = Path.home() / "rust" / "camilladsp" / "exampleconfigs"
    configs = sorted(folder.glob("*.yml")) if folder.is_dir() else []
    return [
        pytest.param(
            path,
            marks=pytest.mark.xfail(
                strict=True,
                reason="Repeats a key. PyYAML keeps the last one, Rust refuses the file like camilladsp does",
            ),
        )
        if path.name in DUPLICATE_KEY_CONFIGS
        else path
        for path in configs
    ]


DUPLICATE_KEY_CONFIGS = {"resampler_experiment.yml"}


@pytest.mark.parametrize("name", ["config.yml", "config2.yml"])
def test_config_file(both_backends, name):
    rust, python = compare(both_backends, "GET", "/api/getconfigfile", params={"name": name})
    assert_same_config(rust, python)


def test_default_config_file(both_backends):
    rust, python = compare(both_backends, "GET", "/api/getdefaultconfigfile")
    assert_same_config(rust, python)


def test_startup_config(both_backends):
    rust, python = compare(both_backends, "GET", "/api/getstartconfig")
    assert_same_config(rust, python)


@pytest.mark.parametrize("path", example_configs(), ids=lambda p: p.name)
def test_yml_config_to_json(both_backends, path):
    text = path.read_text()
    rust, python = compare(both_backends, "POST", "/api/ymlconfigtojsonconfig", data=text)
    assert_same_config(rust, python)


@pytest.mark.parametrize("path", example_configs(), ids=lambda p: p.name)
def test_yml_to_json(both_backends, path):
    rust, python = compare(both_backends, "POST", "/api/ymltojson", data=path.read_text())
    assert rust == python


def test_config_to_yml(both_backends):
    config = yaml.safe_load((REPO / "tests" / "testfiles" / "config.yml").read_text())
    rust, python = compare(both_backends, "POST", "/api/configtoyml", json_body=config)
    assert yaml.safe_load(rust) == yaml.safe_load(python)
