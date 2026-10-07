"""
The API tests, over HTTP against the real backend process.
"""

import array
import json
import random
import shutil
import string
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from textwrap import dedent

import pytest
import yaml

# ── Parameters and status ─────────────────────────────────────────────────


def test_read_volume(server):
    resp = server.get("/api/param/volume")
    assert resp.status == 200
    assert resp.text == "-20.0"


def test_read_mute(server):
    assert server.get("/api/param/mute").json() is False
    server.fake.state["mute"] = True
    assert server.get("/api/param/mute").json() is True


def test_set_volume_and_mute(server):
    assert server.post("/api/param/volume", json_body=-12.5).status == 204
    assert server.fake.state["volume"] == -12.5
    assert server.post("/api/param/mute", json_body=True).status == 204
    assert server.fake.state["mute"] is True
    resp = server.post("/api/param/mute", json_body="maybe")
    assert resp.status == 422
    assert "message" in resp.json()


def test_faders(server):
    assert server.get("/api/param/faders").json()[0] == {"volume": -20.0, "mute": False}
    assert server.post("/api/param/faders/2/volume", json_body=-6).status == 204
    assert server.post("/api/param/faders/2/mute", json_body=True).status == 204
    assert server.fake.state["faders"][2] == {"volume": -6.0, "mute": True}


def test_errors_are_json(server):
    resp = server.post("/api/param/faders/x/mute", json_body=True)
    assert resp.status == 400
    assert set(resp.json()) == {"message"}
    server.fake.go_offline()
    resp = server.get("/api/param/volume")
    assert resp.status == 503
    assert resp.json()["message"]


def test_read_status(server):
    resp = server.get("/api/status")
    assert resp.status == 200
    status = resp.json()
    assert status["cdsp_online"] is True
    # The state comes from /api/state, so the status does not ask for it.
    assert "cdsp_status" not in status
    assert not server.fake.commands("GetState")
    assert status["resamplerload"] == 0.2
    assert status["capturerate"] == 44100
    assert status["labels"] == {"capture": ["L", "R"], "playback": ["L", "R"]}
    # The device lists and capabilities are kept for their own endpoints, not sent with every poll.
    assert set(status) == {
        "cdsp_online",
        "cdsp_version",
        "backend_version",
        "capturerate",
        "rateadjust",
        "bufferlevel",
        "clippedsamples",
        "processingload",
        "resamplerload",
        "labels",
        "title",
        "description",
    }
    assert server.get("/api/backends").json() == {
        "playback": ["Alsa", "Stdout"],
        "capture": ["Alsa", "Stdin"],
    }


def wait_until_offline(server):
    """The status asks CamillaDSP at most once a second, so it may take that long to notice."""
    deadline = time.time() + 5
    while True:
        status = server.get("/api/status").json()
        if not status["cdsp_online"]:
            return status
        assert time.time() < deadline
        time.sleep(0.05)


def test_status_goes_offline(server):
    server.fake.go_offline()
    status = wait_until_offline(server)
    assert status["cdsp_version"] == "(offline)"


def test_status_rereads_the_version_after_a_restart_it_did_not_see(server):
    # A quick restart, noticed by another request, which reconnects.
    server.fake.go_offline()
    server.fake.state["version"] = "5.0.1"
    server.fake.state["online"] = True
    deadline = time.time() + 5
    while server.get("/api/param/volume").status != 200:
        assert time.time() < deadline
    while server.get("/api/status").json()["cdsp_version"] != "5.0.1":
        assert time.time() < deadline
        time.sleep(0.05)
    # Offline again, so the next reset reconnects and reads the usual version.
    server.fake.go_offline()


def timed_status(server):
    start = time.time()
    status = server.get("/api/status").json()
    return status, time.time() - start


def test_status_does_not_wait_on_a_hung_camilladsp(server):
    server.fake.go_offline(hung=True)
    wait_until_offline(server)
    # Every connect runs into the timeout. Only one request per retry interval
    # tries, the others answer at once.
    slow = fast = 0
    end = time.time() + 2.5
    while time.time() < end:
        status, elapsed = timed_status(server)
        assert status["cdsp_online"] is False
        if elapsed > 0.5:
            slow += 1
        else:
            fast += 1
        time.sleep(0.05)
    assert 1 <= slow <= 2
    assert fast >= 5


def read_events(stream, name, count, timeout=5):
    """The data of the next `count` events called `name`, parsed."""
    deadline = time.time() + timeout
    event = None
    found = []
    while time.time() < deadline and len(found) < count:
        line = stream.readline().decode().strip()
        if line.startswith("event:"):
            event = line.split(":", 1)[1].strip()
        if line.startswith("data:") and event == name:
            found.append(json.loads(line.split(":", 1)[1]))
    return found


def test_state_stream(server):
    with urllib.request.urlopen(f"http://127.0.0.1:{server.port}/api/state", timeout=10) as stream:
        assert stream.headers["Content-Type"].startswith("text/event-stream")
        assert stream.headers["X-Accel-Buffering"] == "no"
        # CamillaDSP sends nothing until the state changes, so the backend starts with the current one.
        assert read_events(stream, "state", 1) == [{"state": "Running"}]
        server.fake.state["stop_reason"] = "Done"
        server.fake.state["state"] = "Inactive"
        assert read_events(stream, "state", 1) == [{"state": "Inactive", "stop_reason": "Done"}]
        server.fake.state["state"] = "Paused"
        assert read_events(stream, "state", 1) == [{"state": "Paused"}]


def test_state_stream_starts_with_the_stop_reason(server):
    server.fake.state["state"] = "Inactive"
    server.fake.state["stop_reason"] = {"CaptureError": "device gone"}
    with urllib.request.urlopen(f"http://127.0.0.1:{server.port}/api/state", timeout=10) as stream:
        assert read_events(stream, "state", 1) == [
            {"state": "Inactive", "stop_reason": {"CaptureError": "device gone"}}
        ]


def test_state_stream_offline(server):
    server.fake.go_offline()
    with pytest.raises(urllib.error.HTTPError) as error:
        urllib.request.urlopen(f"http://127.0.0.1:{server.port}/api/state", timeout=10)
    assert error.value.code == 503


def wait_for_sockets(server, count):
    deadline = time.time() + 5
    while len(server.fake._sockets) != count and time.time() < deadline:
        time.sleep(0.05)
    assert len(server.fake._sockets) == count


def test_level_stream_ends_with_the_browser(server):
    before = len(server.fake._sockets)
    with urllib.request.urlopen(f"http://127.0.0.1:{server.port}/api/levels", timeout=10):
        wait_for_sockets(server, before + 1)
    wait_for_sockets(server, before)


def test_level_stream(server):
    with urllib.request.urlopen(f"http://127.0.0.1:{server.port}/api/levels", timeout=10) as stream:
        assert stream.headers["Content-Type"].startswith("text/event-stream")
        # So that nginx passes the events on as they come.
        assert stream.headers["X-Accel-Buffering"] == "no"
        deadline = time.time() + 5
        event = None
        while time.time() < deadline:
            line = stream.readline().decode().strip()
            if line.startswith("event:"):
                event = line.split(":", 1)[1].strip()
            if line.startswith("data:") and event == "levels":
                levels = json.loads(line.split(":", 1)[1])
                # CamillaDSP's VuLevels, passed on as it came.
                assert levels == {
                    "playback_rms": [-7.0, -8.0],
                    "playback_peak": [-3.0, -4.0],
                    "capture_rms": [-5.0, -6.0],
                    "capture_peak": [-2.0, -3.0],
                }
                return
    pytest.fail("No levels event")


SPECTRUM_PARAMS = {
    "side": "playback",
    "channel": None,
    "min_freq": 20.0,
    "max_freq": 20000.0,
    "n_bins": 10,
    "max_rate": 10.0,
}


def spectrum_url(server):
    # No channel means all channels, so it is left out like the frontend does.
    query = urllib.parse.urlencode({k: v for k, v in SPECTRUM_PARAMS.items() if v is not None})
    return f"http://127.0.0.1:{server.port}/api/spectrum?{query}"


def test_spectrum_stream(server):
    with urllib.request.urlopen(spectrum_url(server), timeout=10) as stream:
        assert stream.headers["Content-Type"].startswith("text/event-stream")
        assert stream.headers["X-Accel-Buffering"] == "no"
        subscribed = server.fake.commands("SubscribeSpectrum")[-1]["value"]
        assert subscribed["n_bins"] == 10
        assert subscribed["channel"] is None
        deadline = time.time() + 5
        event = None
        while time.time() < deadline:
            line = stream.readline().decode().strip()
            if line.startswith("event:"):
                event = line.split(":", 1)[1].strip()
            if line.startswith("data:") and event == "spectrum":
                spectrum = json.loads(line.split(":", 1)[1])
                assert spectrum == {"frequencies": [100.0, 1000.0], "magnitudes": [-20.0, -30.0]}
                return
    pytest.fail("No spectrum event")


def test_spectrum_needs_processing(server):
    server.fake.state["state"] = "Inactive"
    with pytest.raises(urllib.error.HTTPError) as error:
        urllib.request.urlopen(spectrum_url(server), timeout=10)
    assert error.value.code == 503
    assert json.loads(error.value.read())["result"] == "ProcessingNotRunningError"


def test_stop_processing(server):
    resp = server.post("/api/stop")
    assert resp.status == 204
    assert len(server.fake.commands("Stop")) == 1


@pytest.mark.parametrize(
    "endpoint, parameters",
    [
        ("/api/status", None),
        ("/api/param/mute", None),
        ("/api/param/faders", None),
        ("/api/getconfig", None),
        ("/api/getstartconfig", None),
        ("/api/getdefaultconfigfile", None),
        ("/api/files/config", None),
        ("/api/files/coeff", None),
        ("/api/defaultsforcoeffs", {"file": "test.wav"}),
        ("/api/guiconfig", None),
        ("/api/getconfigfile", {"name": "config.yml"}),
        ("/api/logfile", None),
        ("/api/devices/capture/Alsa", None),
        ("/api/devices/playback/Alsa", None),
        ("/api/devices/capture/Alsa/capabilities", {"device": "hw:Aaaa,0,0"}),
        ("/api/devices/playback/Alsa/capabilities", {"device": "hw:Cccc,0,0"}),
        ("/api/backends", None),
        ("/api/getactiveconfigfilename", None),
    ],
)
def test_all_get_endpoints_ok(server, endpoint, parameters):
    resp = server.get(endpoint, params=parameters)
    assert resp.status == 200, resp.text


def test_openapi_spec_is_served_as_committed(server):
    resp = server.get("/api/openapi.json")
    assert resp.status == 200
    assert resp.headers["Content-Type"] == "application/json"
    committed = Path(__file__).parent.parent / "openapi.json"
    assert resp.text == committed.read_text()


def test_gui_index_redirects(server):
    resp = server.get("/")
    assert resp.status == 200
    assert b"<html" in resp.body.lower()


def test_style_override(server):
    embedded = server.get("/gui/css-variables.css")
    assert embedded.status == 200
    override = server.root / "css-variables.css"
    override.write_text(":root { --test: 1; }")
    try:
        resp = server.get("/gui/css-variables.css")
        assert resp.text == ":root { --test: 1; }"
        assert resp.headers["Content-Type"].startswith("text/css")
    finally:
        override.unlink()
    assert server.get("/gui/css-variables.css").body == embedded.body


# ── Devices ───────────────────────────────────────────────────────────────


def test_device_capabilities_are_cached(server):
    url = "/api/devices/capture/Alsa/capabilities"
    resp = server.get(url, params={"device": "hw:Aaaa,0,0"})
    assert resp.status == 200
    content = resp.json()
    assert content["name"] == "hw:Aaaa,0,0"
    assert content["capability_sets"][0]["mode"] == "Unified"
    server.fake.go_offline()
    cached = server.get(url, params={"device": "hw:Aaaa,0,0"})
    assert cached.status == 200
    assert cached.json() == content


def test_device_capabilities_returns_cached_on_error(server):
    url = "/api/devices/playback/Alsa/capabilities"
    first = server.get(url, params={"device": "hw:Cccc,0,0"})
    assert first.status == 200
    server.fake.state["capability_errors"] = {"hw:Cccc,0,0": "DeviceBusyError"}
    resp = server.get(url, params={"device": "hw:Cccc,0,0"})
    assert resp.status == 200
    assert resp.json() == first.json()


def test_device_capabilities_forwards_error_without_cache(server):
    resp = server.get("/api/devices/capture/Alsa/capabilities", params={"device": "missing"})
    assert resp.status == 400
    assert resp.json()["message"] == "device not found"


def test_capabilities_need_a_device(server):
    url = "/api/devices/capture/Alsa/capabilities"
    assert server.get(url).status == 400
    assert server.get(url, params={"device": ""}).status == 400


def test_devices_need_a_direction(server):
    resp = server.get("/api/devices/sideways/Alsa")
    assert resp.status == 400
    assert "message" in resp.json()


def test_device_lists_come_from_the_cache_when_offline(server):
    server.fake.go_offline()
    resp = server.get("/api/devices/capture/Alsa")
    assert resp.status == 200
    assert resp.json() == [
        {"name": "hw:Aaaa,0,0", "description": "Dev A"},
        {"name": "hw:Bbbb,0,0", "description": "Dev B"},
    ]


def test_backends(server):
    backends = server.get("/api/backends").json()
    assert "Alsa" in backends["capture"]
    assert "Alsa" in backends["playback"]


# ── Files ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("kind, getfile", [("config", "/config/"), ("coeff", "/coeff/")])
def test_upload_and_delete(server, kind, getfile):
    filename = "".join(random.choice(string.ascii_lowercase) for i in range(10))
    filedata = "".join(random.choice(string.ascii_lowercase) for i in range(10))

    assert server.get(getfile + filename).status == 404
    resp = server.upload(f"/api/files/{kind}/upload", filename, filedata.encode())
    assert resp.status == 204, resp.text
    resp = server.get(getfile + filename)
    assert resp.status == 200
    assert resp.body == filedata.encode()
    assert server.post(f"/api/files/{kind}/delete", json_body={"names": [filename]}).status == 204
    assert server.get(getfile + filename).status == 404


def test_upload_large_binary_file(server):
    filedata = random.randbytes(3_000_000)
    assert server.upload("/api/files/coeff/upload", "large.raw", filedata).status == 204
    try:
        assert server.get("/coeff/large.raw").body == filedata
    finally:
        server.post("/api/files/coeff/delete", json_body={"names": ["large.raw"]})


def test_failed_upload_keeps_the_existing_file(server):
    assert server.upload("/api/files/coeff/upload", "kept.raw", b"original").status == 204
    try:
        boundary = uuid.uuid4().hex
        # The form ends in the middle of the file, as when an upload is cut off.
        body = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="files"; filename="kept.raw"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode() + b"replacement, cut off"
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
        resp = server.post("/api/files/coeff/upload", data=body, headers=headers)
        assert resp.status == 400
        assert server.get("/coeff/kept.raw").body == b"original"
        assert not list(server.config_dir.glob(".*.part"))
    finally:
        server.post("/api/files/coeff/delete", json_body={"names": ["kept.raw"]})


def test_upload_needs_a_form(server):
    resp = server.post("/api/files/coeff/upload", data=b"not a form")
    assert resp.status == 400
    assert "message" in resp.json()


def test_uploaded_configs_get_bare_paths(server):
    config = "filters:\n  f: {type: Conv, parameters: {type: Raw, filename: /far/away/f.raw}}\n"
    assert server.upload("/api/files/config/upload", "uploaded.yml", config.encode()).status == 204
    try:
        stored = yaml.safe_load(server.get("/config/uploaded.yml").body)
        assert stored["filters"]["f"]["parameters"]["filename"] == "f.raw"
    finally:
        server.post("/api/files/config/delete", json_body={"names": ["uploaded.yml"]})


def test_rename(server):
    assert server.upload("/api/files/coeff/upload", "rename_a.txt", b"1").status == 204
    try:
        url = "/api/files/coeff/rename"
        resp = server.post(url, json_body={"source": "rename_a.txt", "target": "config.yml"})
        assert resp.status == 400
        assert resp.json()["message"] == "File config.yml already exists"
        resp = server.post(url, json_body={"source": "rename_a.txt", "target": "rename_b.txt"})
        assert resp.status == 204
        assert server.get("/coeff/rename_b.txt").body == b"1"
    finally:
        server.post("/api/files/coeff/delete", json_body={"names": ["rename_b.txt"]})


def test_zip_download(server):
    resp = server.post("/api/files/config/zip", json_body={"names": ["config.yml", "config2.yml"]})
    assert resp.status == 200
    assert resp.headers["Content-Disposition"] == "attachment; filename=configs.zip"
    import io
    import zipfile

    names = zipfile.ZipFile(io.BytesIO(resp.body)).namelist()
    assert sorted(names) == ["config.yml", "config2.yml"]


def test_files_need_a_known_folder(server):
    assert server.get("/api/files/elsewhere").status == 400


def test_stored_files_listing(server):
    files = server.get("/api/files/coeff").json()
    names = [f["name"] for f in files]
    assert "config.yml" in names
    assert ".gitignore" not in names
    assert names == sorted(names, key=str.lower)
    assert set(files[0]) == {"name", "lastModified", "size"}


def test_missing_directories_warn_instead_of_stopping_the_backend(server, make_backend, tmp_path):
    missing = {
        "config_dir": str(tmp_path / "configs-missing"),
        "coeff_dir": str(tmp_path / "coeffs-missing"),
        "audiofiles_dir": str(tmp_path / "audiofiles-missing"),
    }
    backend = make_backend(missing)
    log = (backend.root / "backend.log").read_text()
    for setting, path in missing.items():
        assert f"The directory {path}, set as {setting}, does not exist" in log

    for kind in ("config", "coeff", "audiofile"):
        resp = backend.get(f"/api/files/{kind}")
        assert resp.status == 200, kind
        assert resp.json() == [], kind

    for kind, setting in (
        ("config", "config_dir"),
        ("coeff", "coeff_dir"),
        ("audiofile", "audiofiles_dir"),
    ):
        resp = backend.upload(f"/api/files/{kind}/upload", "file.txt", b"data")
        assert resp.status == 500, kind
        message = resp.json()["message"]
        assert message == f"The directory {missing[setting]} does not exist. Create it and try again."


def test_refuses_to_start_with_ssl_settings(make_backend):
    with pytest.raises(RuntimeError, match="exited"):
        make_backend({"ssl_certificate": "/some/cert.pem"})


def test_audiofiles_need_a_folder(server):
    assert server.get("/api/files/audiofile").status == 404


# ── Configs ───────────────────────────────────────────────────────────────


def test_get_config(server):
    assert server.get("/api/getconfig").json()["devices"]["samplerate"] == 44100


def test_set_config(server):
    config = server.get("/api/getconfigfile", params={"name": "config2.yml"}).json()
    resp = server.post("/api/setconfig", json_body={"config": config})
    assert resp.status == 204, resp.text
    assert server.fake.state["config"]["devices"]["samplerate"] == 48000


def test_set_config_refused(server):
    server.fake.state["reject_config"] = "something is wrong"
    resp = server.post("/api/setconfig", json_body={"config": server.get("/api/getconfig").json()})
    assert resp.status == 422
    assert resp.json() == {"message": "something is wrong", "result": "ConfigValidationError"}


def test_set_config_needs_a_config(server):
    resp = server.post("/api/setconfig", json_body={"config": {"devices": {"samplerate": "fast"}}})
    assert resp.status == 422
    assert "devices" in resp.json()["message"]
    assert server.fake.commands("SetConfigJson") == []


def test_set_config_offline(server):
    config = server.get("/api/getconfig").json()
    server.fake.go_offline()
    assert server.post("/api/setconfig", json_body={"config": config}).status == 503


def test_set_config_refuses_paths_outside_the_folders(server):
    config = {
        "devices": server.get("/api/getconfig").json()["devices"],
        "filters": {"f": {"type": "Conv", "parameters": {"type": "Raw", "filename": "/etc/passwd"}}},
    }
    assert server.post("/api/setconfig", json_body={"config": config}).status == 403


def test_save_config_file(server):
    config = server.get("/api/getconfigfile", params={"name": "config2.yml"}).json()
    config["title"] = "Saved"
    try:
        resp = server.post("/api/saveconfigfile", json_body={"config": config, "filename": "saved.yml"})
        assert resp.status == 204
        saved = yaml.safe_load((server.config_dir / "saved.yml").read_text())
        assert saved["title"] == "Saved"
        assert saved["devices"]["samplerate"] == 48000
    finally:
        (server.config_dir / "saved.yml").unlink(missing_ok=True)


def test_set_active_config_file_offline_updates_the_statefile(server):
    server.fake.go_offline()
    resp = server.post("/api/setactiveconfigfile", json_body={"name": "config.yml"})
    assert resp.status == 204
    state = yaml.safe_load(server.statefile.read_text())
    assert state["config_path"] == str(server.config_dir / "config.yml")
    assert server.get("/api/getactiveconfigfilename").json() == {"configFileName": "config.yml"}


def test_active_config_file_online_without_dsp_statefile(server):
    assert server.get("/api/getactiveconfigfilename").json() == {"configFileName": None}
    server.fake.state["state_file_path"] = "/somewhere/state.yml"
    assert server.get("/api/getactiveconfigfilename").json() == {"configFileName": "config.yml"}


def test_startup_config_online(server):
    resp = server.get("/api/getstartconfig")
    assert resp.status == 200
    content = resp.json()
    assert content["config"]["devices"]["samplerate"] == 44100
    assert content["source"] == "dsp"
    assert content["configFileName"] == "config.yml"


def test_startup_config_offline(server):
    server.fake.go_offline()
    resp = server.get("/api/getstartconfig")
    assert resp.status == 200
    content = resp.json()
    assert content["config"]["devices"]["samplerate"] == 48000
    assert content["source"] == "active"
    assert content["configFileName"] == "config2.yml"


def test_startup_config_offline_falls_back_to_default_for_legacy_active(server):
    legacy_path = server.config_dir / "legacy_startup.yml"
    legacy_config = {
        "devices": {
            "samplerate": 48000,
            "chunksize": 1024,
            "capture": {"type": "Stdin", "channels": 2, "format": "S16LE"},
            "playback": {"type": "Stdout", "channels": 2, "format": "S16LE"},
        }
    }
    legacy_path.write_text(yaml.dump(legacy_config))
    state = yaml.safe_load(server.statefile.read_text())
    state["config_path"] = str(legacy_path)
    server.statefile.write_text(yaml.dump(state))
    server.fake.go_offline()
    try:
        resp = server.get("/api/getstartconfig")
        assert resp.status == 200
        content = resp.json()
        assert content["source"] == "default"
        assert content["configFileName"] == "config.yml"
        assert content["config"]["devices"]["samplerate"] == 44100
    finally:
        legacy_path.unlink()


EQAPO_EXAMPLE = """
Preamp: -6 db
Filter  1: ON  PK       Fc     50 Hz   Gain  -3.0 dB  Q 10.00
Channel: L
Filter  2: ON  PEQ      Fc     100 Hz  Gain   1.0 dB  BW Oct 0.167
"""


def test_translate_eqapo(server):
    resp = server.post("/api/eqapotojson", json_body={"text": EQAPO_EXAMPLE, "channels": 2})
    assert resp.status == 200
    content = resp.json()
    parameters = content["filters"]["Filter_1"]["parameters"]
    assert {key: value for key, value in parameters.items() if value is not None} == {
        "type": "Peaking",
        "freq": 50.0,
        "gain": -3.0,
        "q": 10.0,
    }
    assert content["pipeline"][1]["channels"] == [0]
    assert "devices" not in content


def test_translate_eqapo_gives_valid_filters(server):
    text = "Filter: ON LS Fc 300 Hz Gain 5 dB\nFilter: ON HP Fc 30 Hz\nConvolution: L.wav\n"
    filters = server.post("/api/eqapotojson", json_body={"text": text, "channels": 2}).json()["filters"]
    config = {
        "devices": server.get("/api/getconfig").json()["devices"],
        "filters": filters,
        "pipeline": [{"type": "Filter", "channels": [0], "names": sorted(filters)}],
    }
    resp = server.post("/api/validateconfig", json_body=config)
    assert resp.status == 200
    # The wav file does not exist, which is only a warning. Anything else is a real problem.
    assert [issue for issue in resp.json() if issue["severity"] == "error"] == []


def test_translate_eqapo_needs_the_channels(server):
    assert server.post("/api/eqapotojson", json_body={"text": "blank"}).status == 422


def test_translate_eqapo_skips_non_finite_numbers(server):
    text = "Filter: ON PK Fc 1000 Hz Gain inf dB Q 1\nFilter: ON PK Fc 2000 Hz Gain 3 dB Q 1\n"
    resp = server.post("/api/eqapotojson", json_body={"text": text, "channels": 2})
    assert resp.status == 200
    filters = resp.json()["filters"]
    assert list(filters) == ["Filter_1"]
    assert filters["Filter_1"]["parameters"]["freq"] == 2000.0


def test_translate_eqapo_that_is_not_a_fragment(server):
    # A negative channel count gives a mixer that no config can have.
    body = {"text": "Copy: L=R\n", "channels": -1}
    resp = server.post("/api/eqapotojson", json_body=body)
    assert resp.status == 400
    assert resp.json()["message"].startswith("mixers.Copy_1")


def test_translate_convolver(server):
    resp = server.post("/api/convolvertojson", json_body={"text": "96000 1 2 0\n0\n0"})
    assert resp.status == 200
    content = resp.json()
    assert content["devices"]["samplerate"] == 96000


def test_translate_convolver_that_is_not_a_fragment(server):
    resp = server.post("/api/convolvertojson", json_body={"text": "-1 1 2 0\n0\n0"})
    assert resp.status == 400
    assert resp.json()["message"].startswith("devices.samplerate")


def test_yml_to_json_migrates(server):
    text = "filters:\n  lim: {type: Limiter, parameters: {clip_limit: -3}}\n"
    resp = server.post("/api/ymltojson", json_body={"text": text})
    assert resp.status == 200
    # Only the sections it has, and the optional fields filled in.
    assert resp.json() == {
        "filters": {
            "lim": {
                "type": "Clipper",
                "description": None,
                "parameters": {"clip_limit": -3.0, "soft_clip": None},
            }
        }
    }


def test_yml_to_json_says_what_is_wrong(server):
    text = "filters:\n  lim: {type: Gain, parameters: {gain: loud}}\n"
    resp = server.post("/api/ymltojson", json_body={"text": text})
    assert resp.status == 400
    assert resp.json()["message"].startswith("filters.lim")


def test_yml_to_json_takes_some_device_settings(server):
    text = "devices:\n  samplerate: 48000\n  capture: {type: Stdin, channels: 2, format: S16_LE}\n"
    resp = server.post("/api/ymltojson", json_body={"text": text})
    assert resp.status == 200
    devices = resp.json()["devices"]
    assert devices["samplerate"] == 48000
    assert devices["capture"]["type"] == "Stdin"
    assert "chunksize" not in devices


def test_yml_to_json_checks_the_device_settings(server):
    text = "devices:\n  samplerate: 48000\n  samplerat: 44100\n"
    resp = server.post("/api/ymltojson", json_body={"text": text})
    assert resp.status == 400
    assert resp.json()["message"].startswith("devices")


NONFINITE_CONFIG = dedent(
    """
    devices:
      samplerate: 44100
      chunksize: 1024
      capture: {type: Stdin, channels: 2, format: S16_LE}
      playback: {type: Stdout, channels: 2, format: S16_LE}
    filters:
      gain: {type: Gain, parameters: {gain: .nan}}
      fir: {type: Conv, parameters: {type: Values, values: [1.0, -.inf]}}
    """
)
NONFINITE_MESSAGE = (
    "The config contains NaN or infinity, which CamillaDSP does not accept: "
    "filters/gain/parameters/gain, filters/fir/parameters/values/1"
)


def test_yaml_with_nonfinite_values_is_refused_not_sent_as_bad_json(server):
    resp = server.post("/api/ymltojson", json_body={"text": NONFINITE_CONFIG})
    assert resp.status == 400
    assert resp.json()["message"] == NONFINITE_MESSAGE


def test_config_file_with_nonfinite_values_is_refused(server):
    (server.config_dir / "nonfinite_tmp.yml").write_text(NONFINITE_CONFIG)
    try:
        resp = server.get("/api/getconfigfile", params={"name": "nonfinite_tmp.yml"})
    finally:
        (server.config_dir / "nonfinite_tmp.yml").unlink()
    assert resp.status == 400
    assert resp.json()["message"] == NONFINITE_MESSAGE


def test_get_config_file_missing(server):
    resp = server.get("/api/getconfigfile", params={"name": "nosuchfile.yml"})
    assert resp.status == 404
    assert resp.json()["message"] == "Config file 'nosuchfile.yml' not found."


def test_get_config_file_that_is_not_a_config(server):
    (server.config_dir / "broken_tmp.yml").write_text("devices: {samplerate: fast}\n")
    try:
        resp = server.get("/api/getconfigfile", params={"name": "broken_tmp.yml"})
    finally:
        (server.config_dir / "broken_tmp.yml").unlink()
    assert resp.status == 400
    assert resp.json()["message"].startswith("devices")


def test_get_config_file_with_migration(server):
    legacy = {
        "devices": {
            "samplerate": 48000,
            "chunksize": 1024,
            "adjust_period": 10,
            "capture": {"type": "Stdin", "channels": 2, "format": "S16LE"},
            "playback": {"type": "Stdout", "channels": 2, "format": "S16LE"},
        },
        "filters": {"lim": {"type": "Limiter", "parameters": {"clip_limit": -3.0}}},
    }
    (server.config_dir / "legacy_tmp.yml").write_text(yaml.dump(legacy))
    try:
        resp = server.get("/api/getconfigfile", params={"name": "legacy_tmp.yml", "migrate": "true"})
    finally:
        (server.config_dir / "legacy_tmp.yml").unlink()
    assert resp.status == 200, resp.text
    content = resp.json()
    assert isinstance(content["devices"]["samplerate"], int)
    assert content["devices"]["adjust_interval_s"] == 10
    assert content["devices"]["capture"]["format"] == "S16_LE"
    assert content["filters"]["lim"]["type"] == "Clipper"


def test_get_config_file_fills_in_defaults(server):
    content = server.get("/api/getconfigfile", params={"name": "config.yml"}).json()
    assert "queuelimit" in content["devices"]
    assert content["devices"]["queuelimit"] is None


def test_stored_configs(server):
    content = server.get("/api/files/config").json()
    config_file = next(item for item in content if item["name"] == "config.yml")
    assert config_file["valid"] is True
    assert "errors" not in config_file
    assert config_file["version"] == 5


def test_stored_configs_missing_file_is_only_a_warning(server):
    config = {
        "devices": {
            "samplerate": 44100,
            "chunksize": 1024,
            "capture": {"type": "Stdin", "channels": 2, "format": "S16_LE"},
            "playback": {"type": "Stdout", "channels": 2, "format": "S16_LE"},
        },
        "filters": {"conv": {"type": "Conv", "parameters": {"type": "Wav", "filename": "missing.wav"}}},
        "pipeline": [{"type": "Filter", "channels": [0], "names": ["conv"]}],
    }
    (server.config_dir / "missingfile_tmp.yml").write_text(yaml.dump(config))
    try:
        content = server.get("/api/files/config").json()
    finally:
        (server.config_dir / "missingfile_tmp.yml").unlink()
    config_file = next(item for item in content if item["name"] == "missingfile_tmp.yml")
    assert config_file["valid"] is True
    assert config_file["errors"][0]["path"] == ["filters", "conv", "parameters", "filename"]
    assert config_file["errors"][0]["severity"] == "warning"


def test_stored_configs_eqapo_text_does_not_crash_and_has_no_version(server):
    content = dedent("""
        Preamp: -7.08 dB
        Filter 1: ON LSC Fc 105.0 Hz Gain 7.2 dB Q 0.70
        Filter 2: ON PK Fc 188.0 Hz Gain -3.2 dB Q 0.39
        Filter 3: ON HSC Fc 10000.0 Hz Gain -1.8 dB Q 0.70
        """).strip()
    (server.config_dir / "eqapo_like.yml").write_text(content)
    try:
        files = server.get("/api/files/config").json()
    finally:
        (server.config_dir / "eqapo_like.yml").unlink()
    config_file = next(item for item in files if item["name"] == "eqapo_like.yml")
    assert "version" not in config_file
    assert config_file["valid"] is False
    assert config_file["errors"][0]["message"] == "This does not appear to be a CamillaDSP config file."


GRAPHIC_EQ_CONFIG = {
    "devices": {
        "samplerate": 48000,
        "chunksize": 1024,
        "capture": {"type": "Stdin", "channels": 2, "format": "S16_LE"},
        "playback": {"type": "Stdout", "channels": 2, "format": "S16_LE"},
    },
    "filters": {
        "geq": {
            "type": "BiquadCombo",
            "parameters": {"type": "GraphicEqualizer", "gains": [0.0, 1.0, -1.0]},
        }
    },
    "pipeline": [{"type": "Filter", "channels": [0], "names": ["geq"]}],
}


def test_validate_config_with_default_graphic_eq_range(server):
    resp = server.post("/api/validateconfig", json_body=GRAPHIC_EQ_CONFIG)
    assert resp.status == 200, resp.text
    assert resp.json() == []

    # 32 kHz cannot fit the default 20000 Hz upper band, and CamillaDSP
    # rejects that rather than clamping, so the GUI has to report it.
    config = json.loads(json.dumps(GRAPHIC_EQ_CONFIG))
    config["devices"]["samplerate"] = 32000
    resp = server.post("/api/validateconfig", json_body=config)
    assert resp.status == 200
    errors = resp.json()
    assert any("samplerate/2" in str(error) or "Nyquist" in str(error) for error in errors), errors


def test_validate_config_that_does_not_parse(server):
    resp = server.post("/api/validateconfig", json_body={"devices": {"samplerate": "fast"}})
    assert resp.status == 200
    [issue] = resp.json()
    assert issue["path"] == ["devices", "samplerate"]
    assert issue["severity"] == "error"


def test_validate_config_refuses_paths_outside_the_folders(server):
    config = json.loads(json.dumps(GRAPHIC_EQ_CONFIG))
    config["devices"]["capture"] = {"type": "WavFile", "channels": 2, "filename": "/etc/hosts"}
    config["filters"]["fir"] = {
        "type": "Conv",
        "parameters": {"type": "Raw", "filename": "/dev/zero", "read_bytes_lines": 0},
    }
    resp = server.post("/api/validateconfig", json_body=config)
    assert resp.status == 200
    issues = resp.json()
    # Only the refusal, nothing from opening the files.
    for path, filename in [
        (["filters", "fir", "parameters", "filename"], "/dev/zero"),
        (["devices", "capture", "filename"], "/etc/hosts"),
    ]:
        [issue] = [issue for issue in issues if issue["path"] == path]
        assert issue["severity"] == "error"
        assert filename in issue["message"]
        assert "allow_absolute_paths" in issue["message"]


def test_validate_config_needs_a_content_type(server):
    resp = server.post("/api/validateconfig", data=json.dumps(GRAPHIC_EQ_CONFIG))
    assert resp.status == 415
    assert "message" in resp.json()


def test_validate_config_reports_device_types_the_dsp_lacks(server):
    # The device types are read when the backend reconnects.
    server.fake.go_offline()
    wait_until_offline(server)
    server.fake.state["supported_device_types"] = [["Stdout"], ["Alsa"]]
    server.fake.state["online"] = True
    server.wait_for_backends([["Stdout"], ["Alsa"]])
    resp = server.post("/api/validateconfig", json_body=GRAPHIC_EQ_CONFIG)
    assert resp.status == 200
    assert any(issue["path"] == ["devices", "capture", "type"] for issue in resp.json())
    # Offline again, so the next reset reconnects and reads the usual types.
    server.fake.go_offline()


def test_gui_config(server):
    config = server.get("/api/guiconfig").json()
    assert config["volume_range"] == 50
    assert config["page_title"] == "CamillaDSP"
    assert config["coeff_dir"] == "./"
    assert config["audiofiles_supported"] is False
    assert config["can_update_active_config"] is True
    assert config["allow_absolute_paths"] is False


def test_log_file(server):
    resp = server.get("/api/logfile")
    assert resp.headers["Content-Type"].startswith("text/plain")
    assert resp.text.startswith("Log message 1")


def test_log_file_not_set(make_backend):
    resp = make_backend({"log_file": None}).get("/api/logfile")
    assert resp.status == 404
    assert resp.json()["message"] == "Please configure a valid 'log_file' path"


def test_defaults_for_coeffs(server):
    assert server.get("/api/defaultsforcoeffs", params={"file": "x.wav"}).json() == {"type": "Wav"}
    assert server.get("/api/defaultsforcoeffs", params={"file": "x.dbl"}).json()["format"] == "F64_LE"
    assert server.get("/api/defaultsforcoeffs", params={"file": "x.what"}).json() == {}


def wav_bytes():
    data = struct.pack("<4sI4s", b"RIFF", 36 + 8, b"WAVE")
    data += struct.pack("<4sIHHIIHH", b"fmt ", 16, 3, 2, 44100, 44100 * 8, 8, 32)
    return data + struct.pack("<4sI", b"data", 8) + bytes(8)


def test_wav_info_outside_the_audiofiles_dir(server):
    path = server.config_dir / "info_tmp.wav"
    path.write_bytes(wav_bytes())
    try:
        resp = server.get("/api/wavinfo", params={"filename": str(path)})
    finally:
        path.unlink()
    # An absolute path is outside the (missing) audiofiles_dir.
    assert resp.status == 403


def test_wav_info(make_backend, tmp_path):
    audiofiles = tmp_path / "audio"
    audiofiles.mkdir()
    (audiofiles / "x.wav").write_bytes(wav_bytes())
    (audiofiles / "y.wav").write_bytes(b"not a wav file")
    backend = make_backend({"audiofiles_dir": str(audiofiles)})
    info = backend.get("/api/wavinfo", params={"filename": "x.wav"}).json()
    assert info["channels"] == 2
    assert info["sampleformat"] == "F32_LE"
    assert backend.get("/api/wavinfo", params={"filename": "y.wav"}).status == 404
    listing = {file["name"]: file for file in backend.get("/api/files/audiofile").json()}
    assert listing["x.wav"]["samplerate"] == 44100
    assert listing["y.wav"]["valid"] is False
    assert "samplerate" not in listing["y.wav"]


@pytest.mark.skipif(sys.platform == "win32", reason="Needs symlinks")
def test_symlinked_audio_files_keep_their_names(make_backend, tmp_path):
    audiofiles = tmp_path / "audio"
    (audiofiles / "sub").mkdir(parents=True)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (elsewhere / "song.wav").write_bytes(wav_bytes())
    (audiofiles / "sub" / "current.wav").symlink_to(elsewhere / "song.wav")
    backend = make_backend({"audiofiles_dir": str(audiofiles)})
    config = yaml.safe_load((backend.config_dir / "config2.yml").read_text())
    linked = str(audiofiles / "sub" / "current.wav")
    config["devices"]["capture"] = {"type": "WavFile", "filename": linked}
    (backend.config_dir / "linked.yml").write_text(yaml.dump(config))

    config = backend.get("/api/getconfigfile", params={"name": "linked.yml"}).json()
    assert config["devices"]["capture"]["filename"] == "sub/current.wav"
    assert backend.get("/api/wavinfo", params={"filename": "sub/current.wav"}).status == 200
    resp = backend.post("/api/setconfig", json_body={"config": config})
    assert resp.status == 204, resp.text
    assert backend.fake.state["config"]["devices"]["capture"]["filename"] == linked


# ── Coefficients ──────────────────────────────────────────────────────────


@pytest.fixture
def coeff_files(server):
    values = [0.0, 0.25, -0.5, 1.0]
    written = []
    for samplerate in (44100, 48000):
        path = server.config_dir / f"convtest_{samplerate}_2.f32"
        path.write_bytes(struct.pack(f"<{len(values)}f", *values))
        written.append(path)
    yield values
    for path in written:
        path.unlink()


def unframe_coefficients(body):
    header_length = struct.unpack("<I", body[0:4])[0]
    header = json.loads(body[4 : 4 + header_length])
    start = 4 + header_length + (-(4 + header_length) % 8)
    samples = array.array("f" if header["format"] == "float32" else "d")
    samples.frombytes(body[start:])
    return header, samples.tolist()


def conv_request(filename, samplerate=44100, channels=2):
    return {
        "parameters": {
            "type": "Raw",
            "filename": filename,
            "format": "F32_LE",
            "skip_bytes_lines": 0,
            "read_bytes_lines": 0,
        },
        "samplerate": samplerate,
        "channels": channels,
    }


def test_convcoeffs_reads_a_raw_file(server, coeff_files):
    resp = server.post("/api/convcoeffs", json_body=conv_request("convtest_44100_2.f32"))
    assert resp.status == 200
    header, coefficients = unframe_coefficients(resp.body)
    assert coefficients == coeff_files
    assert header["format"] == "float32"


def test_convcoeffs_resolves_the_filename_tokens(server, coeff_files):
    resp = server.post(
        "/api/convcoeffs",
        json_body=conv_request("convtest_$samplerate$_$channels$.f32", samplerate=48000),
    )
    assert resp.status == 200
    header, coefficients = unframe_coefficients(resp.body)
    assert coefficients == coeff_files
    assert header["options"] == [
        {"name": "convtest_44100_2.f32", "samplerate": 44100, "channels": 2},
        {"name": "convtest_48000_2.f32", "samplerate": 48000, "channels": 2},
    ]


def test_convcoeffs_lists_the_options_from_the_folder_of_the_file(server, coeff_files):
    # convtest_44100_2.f32 and convtest_48000_2.f32 are at the top of coeff_dir,
    # the subfolder has a 96000 variant only, and that is the one to offer.
    folder = server.config_dir / "convtest_sub"
    folder.mkdir()
    values = [0.5, -0.25]
    (folder / "convtest_96000_2.f32").write_bytes(struct.pack(f"<{len(values)}f", *values))
    try:
        filename = "convtest_sub/convtest_$samplerate$_$channels$.f32"
        resp = server.post("/api/convcoeffs", json_body=conv_request(filename, samplerate=96000))
        assert resp.status == 200, resp.text
        header, coefficients = unframe_coefficients(resp.body)
        assert coefficients == values
        assert header["options"] == [
            {"name": "convtest_96000_2.f32", "samplerate": 96000, "channels": 2},
        ]
    finally:
        shutil.rmtree(folder)


def test_convcoeffs_rejects_a_path_outside_the_coeff_dir(server):
    assert server.post("/api/convcoeffs", json_body=conv_request("/etc/passwd")).status == 403


def test_convcoeffs_accepts_a_path_relative_to_the_config_dir(server, coeff_files):
    resp = server.post("/api/convcoeffs", json_body=conv_request("../configs/convtest_44100_2.f32"))
    assert resp.status == 200
    _header, coefficients = unframe_coefficients(resp.body)
    assert coefficients == coeff_files


def test_convcoeffs_rejects_a_relative_path_that_escapes_the_coeff_dir(server):
    resp = server.post("/api/convcoeffs", json_body=conv_request("../../../../../../etc/passwd"))
    assert resp.status == 403


def test_convcoeffs_reports_a_missing_file(server):
    assert server.post("/api/convcoeffs", json_body=conv_request("nosuchfile.f32")).status == 404


def test_convcoeffs_sends_float64_when_the_source_holds_more(server):
    values = [-(2**31), -12345678, 0, 12345678, 2**31 - 1]
    path = server.config_dir / "convtest_s32.raw"
    path.write_bytes(struct.pack(f"<{len(values)}i", *values))
    try:
        request = conv_request("convtest_s32.raw")
        request["parameters"]["format"] = "S32_LE"
        resp = server.post("/api/convcoeffs", json_body=request)
        assert resp.status == 200, resp.text
        header, coefficients = unframe_coefficients(resp.body)
        assert header["format"] == "float64"
        assert coefficients == [v / 2**31 for v in values]
    finally:
        path.unlink()


def test_convcoeffs_rejects_a_conv_that_reads_no_file(server):
    request = conv_request("unused.f32")
    request["parameters"] = {"type": "Values", "values": [1.0, 0.5]}
    assert server.post("/api/convcoeffs", json_body=request).status == 400


def test_convcoeffs_rejects_a_conv_without_a_filename(server):
    request = conv_request("")
    resp = server.post("/api/convcoeffs", json_body=request)
    assert resp.status == 400, resp.text
    # Not a Conv's parameters at all.
    request["parameters"]["filename"] = None
    resp = server.post("/api/convcoeffs", json_body=request)
    assert resp.status == 422, resp.text
    assert "message" in resp.json()


# ── Separate folders ──────────────────────────────────────────────────────


@pytest.fixture
def split_files(split_server):
    """A coefficient file and a wav file at the top of each folder and in a subfolder."""
    for folder in ("", "sub"):
        coeffs = split_server.coeff_dir / folder
        coeffs.mkdir(exist_ok=True)
        (coeffs / "f.raw").write_bytes(struct.pack("<4f", 1.0, 0.5, 0.25, 0.0))
        audiofiles = split_server.audiofiles_dir / folder
        audiofiles.mkdir(exist_ok=True)
        (audiofiles / "in.wav").write_bytes(wav_bytes())
    yield split_server


def split_config(server, coeff, capture, playback):
    config = server.get("/api/getconfigfile", params={"name": "config2.yml"}).json()
    config["devices"]["capture"] = {"type": "WavFile", "filename": capture}
    config["devices"]["playback"] = {
        "type": "File",
        "channels": 2,
        "format": "S16_LE",
        "filename": playback,
    }
    config["filters"] = {
        "fir": {"type": "Conv", "parameters": {"type": "Raw", "filename": coeff, "format": "F32_LE"}}
    }
    return config


def file_paths(config):
    return (
        config["filters"]["fir"]["parameters"]["filename"],
        config["devices"]["capture"]["filename"],
        config["devices"]["playback"]["filename"],
    )


def absolute_file_paths(server, folder):
    return (
        str(server.coeff_dir / folder / "f.raw"),
        str(server.audiofiles_dir / folder / "in.wav"),
        str(server.audiofiles_dir / folder / "out.wav"),
    )


# The paths as the GUI has them, and the subfolder they are in.
SPLIT_PATHS = [
    (("f.raw", "in.wav", "out.wav"), ""),
    (("../coeffs/sub/f.raw", "sub/in.wav", "sub/out.wav"), "sub"),
]


@pytest.mark.parametrize("paths, folder", SPLIT_PATHS)
def test_set_config_with_separate_folders(split_files, paths, folder):
    server = split_files
    resp = server.post("/api/setconfig", json_body={"config": split_config(server, *paths)})
    assert resp.status == 204, resp.text
    absolute = absolute_file_paths(server, folder)
    assert file_paths(server.fake.state["config"]) == absolute
    # The GUI reads the running config back with its paths as it set them,
    # and can apply it again.
    running = server.get("/api/getconfig").json()
    assert file_paths(running) == paths
    resp = server.post("/api/setconfig", json_body={"config": running})
    assert resp.status == 204, resp.text
    assert file_paths(server.fake.state["config"]) == absolute


@pytest.mark.parametrize("paths, folder", SPLIT_PATHS)
def test_start_config_from_dsp_with_separate_folders(split_files, paths, folder):
    server = split_files
    resp = server.post("/api/setconfig", json_body={"config": split_config(server, *paths)})
    assert resp.status == 204, resp.text
    start = server.get("/api/getstartconfig").json()
    assert start["source"] == "dsp"
    assert file_paths(start["config"]) == paths


@pytest.mark.parametrize("paths, folder", SPLIT_PATHS)
def test_saved_config_file_with_separate_folders(split_files, paths, folder):
    server = split_files
    body = {"config": split_config(server, *paths), "filename": "split.yml"}
    try:
        assert server.post("/api/saveconfigfile", json_body=body).status == 204
        saved = server.get("/api/getconfigfile", params={"name": "split.yml"}).json()
    finally:
        (server.config_dir / "split.yml").unlink(missing_ok=True)
    assert file_paths(saved) == paths
    resp = server.post("/api/setconfig", json_body={"config": saved})
    assert resp.status == 204, resp.text
    assert file_paths(server.fake.state["config"]) == absolute_file_paths(server, folder)


def test_validate_config_with_separate_folders(split_files):
    server = split_files
    coeff_path = ["filters", "fir", "parameters", "filename"]
    file_locations = [coeff_path, ["devices", "capture", "filename"]]
    config = split_config(server, "../coeffs/sub/f.raw", "in.wav", "out.wav")
    resp = server.post("/api/validateconfig", json_body=config)
    assert resp.status == 200, resp.text
    assert [issue for issue in resp.json() if issue["path"] in file_locations] == []

    # A file that exists, but in the audio folder rather than the coefficient one.
    config["filters"]["fir"]["parameters"]["filename"] = "../audiofiles/in.wav"
    resp = server.post("/api/validateconfig", json_body=config)
    [issue] = [issue for issue in resp.json() if issue["path"] == coeff_path]
    assert issue["severity"] == "error"
    assert "../audiofiles/in.wav" in issue["message"]


def test_convcoeffs_with_separate_folders(split_server):
    server = split_server
    values = [0.5, -0.25]
    for folder, samplerate in [(server.coeff_dir, 44100), (server.coeff_dir / "sub", 96000)]:
        folder.mkdir(exist_ok=True)
        path = folder / f"convtest_{samplerate}_2.f32"
        path.write_bytes(struct.pack(f"<{len(values)}f", *values))
    # A bare name is in coeff_dir, a path with a folder is relative to config_dir,
    # and the options come from the folder the file is in.
    for filename, samplerate in [
        ("convtest_$samplerate$_$channels$.f32", 44100),
        ("../coeffs/sub/convtest_$samplerate$_$channels$.f32", 96000),
    ]:
        resp = server.post("/api/convcoeffs", json_body=conv_request(filename, samplerate=samplerate))
        assert resp.status == 200, resp.text
        header, coefficients = unframe_coefficients(resp.body)
        assert coefficients == values
        assert header["options"] == [
            {"name": f"convtest_{samplerate}_2.f32", "samplerate": samplerate, "channels": 2},
        ]
