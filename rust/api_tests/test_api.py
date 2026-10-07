"""
The API tests, over HTTP against the real backend process.
"""

import array
import json
import random
import string
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from textwrap import dedent

import pytest
import yaml

# ── Parameters and status ─────────────────────────────────────────────────


def test_read_volume(server):
    resp = server.get("/api/getparam/volume")
    assert resp.status == 200
    assert resp.text == "-20.0"


def test_read_mute(server):
    assert server.get("/api/getparam/mute").text == "False"
    server.fake.state["mute"] = True
    assert server.get("/api/getparam/mute").text == "True"


@pytest.mark.parametrize(
    "name, expected",
    [
        ("signalrange", "1.5"),
        ("updateinterval", "100"),
        ("processingload", "0.5"),
        ("resamplerload", "0.2"),
    ],
)
def test_read_params(server, name, expected):
    resp = server.get(f"/api/getparam/{name}")
    assert resp.status == 200
    assert resp.text == expected


def test_unknown_param(server):
    assert server.get("/api/getparam/nonsense").status == 404


def test_set_volume_and_mute(server):
    assert server.post("/api/setparam/volume", data="-12.5").status == 200
    assert server.fake.state["volume"] == -12.5
    assert server.post("/api/setparam/mute", data="true").status == 200
    assert server.fake.state["mute"] is True
    assert server.post("/api/setparam/mute", data="maybe").status == 400


def test_faders(server):
    assert server.get("/api/getparamjson/faders").json()[0] == {"volume": -20.0, "mute": False}
    assert server.post("/api/setparamindex/volume/2", data="-6").status == 200
    assert server.post("/api/setparamindex/mute/2", data="True").status == 200
    assert server.fake.state["faders"][2] == {"volume": -6.0, "mute": True}


def test_read_peaks(server):
    resp = server.get("/api/getlistparam/capturesignalpeak")
    assert resp.status == 200
    assert resp.json() == [-2.0, -3.0]


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
    assert server.get("/api/backends").json() == [["Alsa", "Stdout"], ["Alsa", "Stdin"]]


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
    while server.get("/api/getparam/volume").status != 200:
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
    assert json.loads(error.value.read()) == {"result": "ProcessingNotRunningError"}


def test_stop_processing(server):
    resp = server.post("/api/stop")
    assert resp.status == 200
    assert len(server.fake.commands("Stop")) == 1


@pytest.mark.parametrize(
    "endpoint, parameters",
    [
        ("/api/status", None),
        ("/api/getparam/mute", None),
        ("/api/getlistparam/playbacksignalpeak", None),
        ("/api/getconfig", None),
        ("/api/getstartconfig", None),
        ("/api/getdefaultconfigfile", None),
        ("/api/storedconfigs", None),
        ("/api/storedcoeffs", None),
        ("/api/defaultsforcoeffs", {"file": "test.wav"}),
        ("/api/guiconfig", None),
        ("/api/getconfigfile", {"name": "config.yml"}),
        ("/api/logfile", None),
        ("/api/capturedevices/Alsa", None),
        ("/api/playbackdevices/Alsa", None),
        ("/api/capturedevicecapabilities/Alsa", {"device": "hw:Aaaa,0,0"}),
        ("/api/playbackdevicecapabilities/Alsa", {"device": "hw:Cccc,0,0"}),
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


def test_capture_device_capabilities_are_cached(server):
    resp = server.get("/api/capturedevicecapabilities/Alsa", params={"device": "hw:Aaaa,0,0"})
    assert resp.status == 200
    content = resp.json()
    assert content["name"] == "hw:Aaaa,0,0"
    server.fake.go_offline()
    cached = server.get("/api/capturedevicecapabilities/Alsa", params={"device": "hw:Aaaa,0,0"})
    assert cached.status == 200
    assert cached.json() == content


def test_playback_device_capabilities_returns_cached_on_error(server):
    first = server.get("/api/playbackdevicecapabilities/Alsa", params={"device": "hw:Cccc,0,0"})
    assert first.status == 200
    server.fake.state["capability_errors"] = {"hw:Cccc,0,0": "DeviceBusyError"}
    resp = server.get("/api/playbackdevicecapabilities/Alsa", params={"device": "hw:Cccc,0,0"})
    assert resp.status == 200
    assert resp.json() == first.json()


def test_capture_device_capabilities_forwards_error_without_cache(server):
    resp = server.get("/api/capturedevicecapabilities/Alsa", params={"device": "missing"})
    assert resp.status == 400
    assert resp.text == "device not found"


def test_capabilities_need_a_device(server):
    assert server.get("/api/capturedevicecapabilities/Alsa").status == 400


def test_device_lists_come_from_the_cache_when_offline(server):
    server.fake.go_offline()
    resp = server.get("/api/capturedevices/Alsa")
    assert resp.status == 200
    assert resp.json() == [["hw:Aaaa,0,0", "Dev A"], ["hw:Bbbb,0,0", "Dev B"]]


# ── Files ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "upload, delete, getfile",
    [
        ("/api/uploadconfigs", "/api/deleteconfigs", "/config/"),
        ("/api/uploadcoeffs", "/api/deletecoeffs", "/coeff/"),
    ],
)
def test_upload_and_delete(server, upload, delete, getfile):
    filename = "".join(random.choice(string.ascii_lowercase) for i in range(10))
    filedata = "".join(random.choice(string.ascii_lowercase) for i in range(10))

    assert server.get(getfile + filename).status == 404
    resp = server.upload(upload, filename, filedata.encode())
    assert resp.status == 200
    assert resp.text == "Saved 1 file(s)"
    resp = server.get(getfile + filename)
    assert resp.status == 200
    assert resp.body == filedata.encode()
    assert server.post(delete, json_body=[filename]).status == 200
    assert server.get(getfile + filename).status == 404


def test_uploaded_configs_get_bare_paths(server):
    config = "filters:\n  f: {type: Conv, parameters: {type: Raw, filename: /far/away/f.raw}}\n"
    assert server.upload("/api/uploadconfigs", "uploaded.yml", config.encode()).status == 200
    try:
        stored = yaml.safe_load(server.get("/config/uploaded.yml").body)
        assert stored["filters"]["f"]["parameters"]["filename"] == "f.raw"
    finally:
        server.post("/api/deleteconfigs", json_body=["uploaded.yml"])


def test_rename(server):
    assert server.upload("/api/uploadcoeffs", "rename_a.txt", b"1").status == 200
    try:
        resp = server.post("/api/renamecoeff", params={"source": "rename_a.txt", "target": "config.yml"})
        assert resp.status == 400
        assert resp.text == "File config.yml already exists"
        resp = server.post("/api/renamecoeff", params={"source": "rename_a.txt", "target": "rename_b.txt"})
        assert resp.status == 200
        assert server.get("/coeff/rename_b.txt").body == b"1"
    finally:
        server.post("/api/deletecoeffs", json_body=["rename_b.txt"])


def test_zip_download(server):
    resp = server.post("/api/downloadconfigszip", json_body=["config.yml", "config2.yml"])
    assert resp.status == 200
    assert resp.headers["Content-Disposition"] == "attachment; filename=configs.zip"
    import io
    import zipfile

    names = zipfile.ZipFile(io.BytesIO(resp.body)).namelist()
    assert sorted(names) == ["config.yml", "config2.yml"]


def test_stored_files_listing(server):
    files = server.get("/api/storedcoeffs").json()
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

    for listing in ("/api/storedconfigs", "/api/storedcoeffs", "/api/storedaudiofiles"):
        resp = backend.get(listing)
        assert resp.status == 200, listing
        assert resp.json() == [], listing

    for upload, setting in (
        ("/api/uploadconfigs", "config_dir"),
        ("/api/uploadcoeffs", "coeff_dir"),
        ("/api/uploadaudiofiles", "audiofiles_dir"),
    ):
        resp = backend.upload(upload, "file.txt", b"data")
        assert resp.status == 500, upload
        assert resp.text == f"The directory {missing[setting]} does not exist. Create it and try again."


def test_refuses_to_start_with_ssl_settings(make_backend):
    with pytest.raises(RuntimeError, match="exited"):
        make_backend({"ssl_certificate": "/some/cert.pem"})


def test_audiofiles_need_a_folder(server):
    assert server.get("/api/storedaudiofiles").status == 404


# ── Configs ───────────────────────────────────────────────────────────────


def test_get_config(server):
    assert server.get("/api/getconfig").json()["devices"]["samplerate"] == 44100


def test_set_config(server):
    config = server.get("/api/getconfigfile", params={"name": "config2.yml"}).json()
    resp = server.post("/api/setconfig", json_body={"config": config})
    assert resp.status == 200, resp.text
    assert server.fake.state["config"]["devices"]["samplerate"] == 48000


def test_set_config_refused(server):
    server.fake.state["reject_config"] = "something is wrong"
    resp = server.post("/api/setconfig", json_body={"config": server.get("/api/getconfig").json()})
    assert resp.status == 422
    assert resp.text == "something is wrong"


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
        assert resp.status == 200
        saved = yaml.safe_load((server.config_dir / "saved.yml").read_text())
        assert saved["title"] == "Saved"
        assert saved["devices"]["samplerate"] == 48000
    finally:
        (server.config_dir / "saved.yml").unlink(missing_ok=True)


def test_set_active_config_file_offline_updates_the_statefile(server):
    server.fake.go_offline()
    resp = server.post("/api/setactiveconfigfile", json_body={"name": "config.yml"})
    assert resp.status == 200
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
    resp = server.post("/api/eqapotojson", params={"channels": 2}, data=EQAPO_EXAMPLE)
    assert resp.status == 200
    content = resp.json()
    assert content["filters"]["Filter_1"]["parameters"] == {
        "type": "Peaking",
        "freq": 50.0,
        "gain": -3.0,
        "q": 10.0,
    }
    assert content["pipeline"][1]["channels"] == [0]


def test_translate_eqapo_gives_valid_filters(server):
    text = "Filter: ON LS Fc 300 Hz Gain 5 dB\nFilter: ON HP Fc 30 Hz\nConvolution: L.wav\n"
    filters = server.post("/api/eqapotojson", params={"channels": 2}, data=text).json()["filters"]
    config = {
        "devices": server.get("/api/getconfig").json()["devices"],
        "filters": filters,
        "pipeline": [{"type": "Filter", "channels": [0], "names": sorted(filters)}],
    }
    resp = server.post("/api/validateconfig", json_body=config)
    # The wav file does not exist, which is only a warning. Anything else is a real problem.
    issues = resp.json() if resp.status == 406 else []
    assert [issue for issue in issues if issue[2] == "error"] == []


def test_translate_eqapo_bad(server):
    assert server.post("/api/eqapotojson", data="blank").status == 400


def test_translate_convolver(server):
    resp = server.post("/api/convolvertojson", data="96000 1 2 0\n0\n0")
    assert resp.status == 200
    content = resp.json()
    assert content["devices"]["samplerate"] == 96000


def test_config_to_yml(server):
    resp = server.post("/api/configtoyml", json_body={"devices": {"samplerate": 44100}})
    assert resp.status == 200
    assert yaml.safe_load(resp.text) == {"devices": {"samplerate": 44100}}


def test_yml_to_json_migrates(server):
    resp = server.post("/api/ymltojson", data="filters:\n  lim: {type: Limiter, parameters: {clip_limit: -3}}\n")
    assert resp.status == 200
    assert resp.json()["filters"]["lim"]["type"] == "Clipper"


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


@pytest.mark.parametrize("endpoint", ["/api/ymltojson", "/api/ymlconfigtojsonconfig"])
def test_yaml_with_nonfinite_values_is_refused_not_sent_as_bad_json(server, endpoint):
    resp = server.post(endpoint, data=NONFINITE_CONFIG)
    assert resp.status == 400
    assert resp.text == NONFINITE_MESSAGE


def test_config_file_with_nonfinite_values_is_refused(server):
    (server.config_dir / "nonfinite_tmp.yml").write_text(NONFINITE_CONFIG)
    try:
        resp = server.get("/api/getconfigfile", params={"name": "nonfinite_tmp.yml"})
    finally:
        (server.config_dir / "nonfinite_tmp.yml").unlink()
    assert resp.status == 400
    assert resp.text == NONFINITE_MESSAGE


def test_get_config_file_missing(server):
    resp = server.get("/api/getconfigfile", params={"name": "nosuchfile.yml"})
    assert resp.status == 404
    assert resp.text == "Config file 'nosuchfile.yml' not found."


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
        resp = server.get("/api/getconfigfile", params={"name": "legacy_tmp.yml", "migrate": "TRUE"})
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
    content = server.get("/api/storedconfigs").json()
    config_file = next(item for item in content if item["name"] == "config.yml")
    assert config_file["valid"] is True
    assert config_file["errors"] is None
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
        content = server.get("/api/storedconfigs").json()
    finally:
        (server.config_dir / "missingfile_tmp.yml").unlink()
    config_file = next(item for item in content if item["name"] == "missingfile_tmp.yml")
    assert config_file["valid"] is True
    assert config_file["errors"][0][0] == ["filters", "conv", "parameters", "filename"]
    assert config_file["errors"][0][2] == "warning"


def test_stored_configs_eqapo_text_does_not_crash_and_has_no_version(server):
    content = dedent("""
        Preamp: -7.08 dB
        Filter 1: ON LSC Fc 105.0 Hz Gain 7.2 dB Q 0.70
        Filter 2: ON PK Fc 188.0 Hz Gain -3.2 dB Q 0.39
        Filter 3: ON HSC Fc 10000.0 Hz Gain -1.8 dB Q 0.70
        """).strip()
    (server.config_dir / "eqapo_like.yml").write_text(content)
    try:
        files = server.get("/api/storedconfigs").json()
    finally:
        (server.config_dir / "eqapo_like.yml").unlink()
    config_file = next(item for item in files if item["name"] == "eqapo_like.yml")
    assert config_file["version"] is None
    assert config_file["valid"] is False
    assert config_file["errors"][0][1] == "This does not appear to be a CamillaDSP config file."


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
    assert resp.text == "OK"

    # 32 kHz cannot fit the default 20000 Hz upper band, and CamillaDSP
    # rejects that rather than clamping, so the GUI has to report it.
    config = json.loads(json.dumps(GRAPHIC_EQ_CONFIG))
    config["devices"]["samplerate"] = 32000
    resp = server.post("/api/validateconfig", json_body=config)
    assert resp.status == 406
    errors = resp.json()
    assert any("samplerate/2" in str(error) or "Nyquist" in str(error) for error in errors), errors


def test_validate_config_without_content_type(server):
    resp = server.post("/api/validateconfig", data=json.dumps(GRAPHIC_EQ_CONFIG))
    assert resp.status == 200, resp.text


def test_validate_config_reports_device_types_the_dsp_lacks(server):
    # The device types are read when the backend reconnects.
    server.fake.go_offline()
    wait_until_offline(server)
    server.fake.state["supported_device_types"] = [["Stdout"], ["Alsa"]]
    server.fake.state["online"] = True
    server.wait_for_backends([["Stdout"], ["Alsa"]])
    resp = server.post("/api/validateconfig", json_body=GRAPHIC_EQ_CONFIG)
    assert resp.status == 406
    assert any(error[0] == ["devices", "capture", "type"] for error in resp.json())
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
    assert server.get("/api/logfile").text.startswith("Log message 1")


def test_defaults_for_coeffs(server):
    assert server.get("/api/defaultsforcoeffs", params={"file": "x.wav"}).json() == {"type": "Wav"}
    assert server.get("/api/defaultsforcoeffs", params={"file": "x.dbl"}).json()["format"] == "F64_LE"


def test_wav_info(server):
    data = struct.pack("<4sI4s", b"RIFF", 36 + 8, b"WAVE")
    data += struct.pack("<4sIHHIIHH", b"fmt ", 16, 3, 2, 44100, 44100 * 8, 8, 32)
    data += struct.pack("<4sI", b"data", 8) + bytes(8)
    path = server.config_dir / "info_tmp.wav"
    path.write_bytes(data)
    try:
        resp = server.get("/api/wavinfo", params={"filename": str(path)})
    finally:
        path.unlink()
    # An absolute path is outside the (missing) audiofiles_dir.
    assert resp.status == 403


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
        "config": {
            "type": "Conv",
            "parameters": {
                "type": "Raw",
                "filename": filename,
                "format": "F32_LE",
                "skip_bytes_lines": 0,
                "read_bytes_lines": 0,
            },
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
        request["config"]["parameters"]["format"] = "S32_LE"
        resp = server.post("/api/convcoeffs", json_body=request)
        assert resp.status == 200, resp.text
        header, coefficients = unframe_coefficients(resp.body)
        assert header["format"] == "float64"
        assert coefficients == [v / 2**31 for v in values]
    finally:
        path.unlink()


def test_convcoeffs_rejects_a_conv_that_reads_no_file(server):
    request = conv_request("unused.f32")
    request["config"]["parameters"] = {"type": "Values", "values": [1.0, 0.5]}
    assert server.post("/api/convcoeffs", json_body=request).status == 400


def test_convcoeffs_rejects_a_conv_without_a_filename(server):
    for filename in ("", None):
        request = conv_request("unused.f32")
        request["config"]["parameters"]["filename"] = filename
        resp = server.post("/api/convcoeffs", json_body=request)
        assert resp.status == 400, resp.text
