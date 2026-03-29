import json
import os
import random
import string
from unittest.mock import MagicMock, patch

import camilladsp
import pytest
import yaml
from aiohttp import FormData, web

import main
from backend import views

TESTFILE_DIR = os.path.join(os.path.dirname(__file__), "testfiles")
SAMPLE_CONFIG_PATH = os.path.join(TESTFILE_DIR, "config.yml")
STATEFILE_PATH = os.path.join(TESTFILE_DIR, "statefile.yml")
STATEFILE_TEMPLATE_PATH = os.path.join(TESTFILE_DIR, "statefile_template.yml")
LOGFILE_PATH = os.path.join(TESTFILE_DIR, "log.txt")
SAMPLE_CONFIG = yaml.safe_load(open(SAMPLE_CONFIG_PATH))
GUI_CONFIG_PATH = os.path.join(TESTFILE_DIR, "gui_config.yml")


@pytest.fixture
def statefile():
    statefile_data = yaml.safe_load(open(STATEFILE_TEMPLATE_PATH))
    statefile_data["config_path"] = os.path.join(
        TESTFILE_DIR, statefile_data["config_path"]
    )
    with open(STATEFILE_PATH, "w") as f:
        yaml.dump(statefile_data, f)


server_config = {
    "camilla_host": "127.0.0.1",
    "camilla_port": 1234,
    "bind_address": "0.0.0.0",
    "port": 5005,
    "config_dir": TESTFILE_DIR,
    "coeff_dir": TESTFILE_DIR,
    "default_config": SAMPLE_CONFIG_PATH,
    "statefile_path": STATEFILE_PATH,
    "log_file": LOGFILE_PATH,
    "gui_config_file": GUI_CONFIG_PATH,
    "on_set_active_config": None,
    "on_get_active_config": None,
    "supported_capture_types": None,
    "supported_playback_types": None,
    "can_update_active_config": True,
}


@pytest.fixture
def mock_request(mock_app):
    request = MagicMock
    request.app = mock_app
    yield request


@pytest.fixture
def mock_camillaclient(statefile):
    client = MagicMock()
    client_constructor = MagicMock(return_value=client)
    client_constructor._client = client
    client.volume = MagicMock()
    client.volume.main_volume = MagicMock(return_value=-20.0)
    client.volume.main_mute = MagicMock(return_value=False)
    client.levels = MagicMock
    client.levels.capture_peak = MagicMock(return_value=[-2.0, -3.0])
    client.levels.playback_peak = MagicMock(return_value=[-2.5, -3.5])
    client.levels.levels = MagicMock(
        return_value={
            "capture_rms": [-5.0, -6.0],
            "capture_peak": [-2.0, -3.0],
            "playback_rms": [-7.0, -8.0],
            "playback_peak": [-3.0, -4.0],
        }
    )
    client.levels.labels = MagicMock(
        return_value={"capture": ["L", "R"], "playback": ["L", "R"]}
    )
    client.rate = MagicMock()
    client.rate.capture = MagicMock(return_value=44100)
    client.general = MagicMock()
    client.general.state = MagicMock(return_value=camilladsp.ProcessingState.RUNNING)
    client.general.list_capture_devices = MagicMock(
        return_value=[["hw:Aaaa,0,0", "Dev A"], ["hw:Bbbb,0,0", "Dev B"]]
    )
    client.general.list_playback_devices = MagicMock(
        return_value=[["hw:Cccc,0,0", "Dev C"], ["hw:Dddd,0,0", "Dev D"]]
    )
    client.general.supported_device_types = MagicMock(return_value=["Alsa", "Wasapi"])
    client.status = MagicMock()
    client.status.rate_adjust = MagicMock(return_value=1.01)
    client.status.buffer_level = MagicMock(return_value=1234)
    client.status.clipped_samples = MagicMock(return_value=12)
    client.status.processing_load = MagicMock(return_value=0.5)
    client.status.resampler_load = MagicMock(return_value=0.2)
    client.config = MagicMock()
    client.config.active = MagicMock(return_value=SAMPLE_CONFIG)
    client.config.file_path = MagicMock(return_value=SAMPLE_CONFIG_PATH)
    client.versions = MagicMock()
    client.versions.library = MagicMock(return_value="1.2.3")
    yield client_constructor


@pytest.fixture
def mock_app(mock_camillaclient):
    with patch("camilladsp.CamillaClient", mock_camillaclient):
        app = main.build_app(server_config)
        yield app


@pytest.fixture
def mock_offline_app(mock_camillaclient):
    mock_camillaclient._client.config.file_path = MagicMock(return_value=None)
    mock_camillaclient._client.config.active = MagicMock(
        side_effect=camilladsp.CamillaError
    )
    mock_camillaclient._client.general.state = MagicMock(
        side_effect=camilladsp.CamillaError
    )
    with patch("camilladsp.CamillaClient", mock_camillaclient):
        app = main.build_app(server_config)
        yield app


@pytest.fixture
async def server(aiohttp_client, mock_app):
    return await aiohttp_client(mock_app)


@pytest.fixture
async def offline_server(aiohttp_client, mock_offline_app):
    return await aiohttp_client(mock_offline_app)


async def test_read_volume(mock_request):
    mock_request.match_info = {"name": "volume"}
    reply = await views.get_param(mock_request)
    assert reply.body == "-20.0"


async def test_read_peaks(mock_request):
    mock_request.match_info = {"name": "capturesignalpeak"}
    reply = await views.get_list_param(mock_request)
    assert json.loads(reply.body) == [-2.0, -3.0]


async def test_read_volume(server):
    resp = await server.get("/api/getparam/volume")
    assert resp.status == 200
    assert await resp.text() == "-20.0"


async def test_read_peaks(server):
    resp = await server.get("/api/getlistparam/capturesignalpeak")
    assert resp.status == 200
    assert await resp.json() == [-2.0, -3.0]


async def test_read_status(server):
    resp = await server.get("/api/status")
    assert resp.status == 200
    response = await resp.json()
    assert response["cdsp_status"] == "RUNNING"
    assert response["resamplerload"] == 0.2


async def test_read_resampler_load(mock_request):
    mock_request.match_info = {"name": "resamplerload"}
    reply = await views.get_param(mock_request)
    assert reply.body == b"0.2"


async def test_stop_processing(server):
    resp = await server.post("/api/stop")
    assert resp.status == 200
    server.app["CAMILLA"].general.stop.assert_called_once()


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
        ("/api/capturedevices/alsa", None),
        ("/api/playbackdevices/alsa", None),
        ("/api/backends", None),
    ],
)
async def test_all_get_endpoints_ok(server, endpoint, parameters):
    if parameters:
        resp = await server.get(endpoint, params=parameters)
    else:
        resp = await server.get(endpoint)
    assert resp.status == 200


@pytest.mark.parametrize(
    "upload, delete, getfile",
    [
        ("/api/uploadconfigs", "/api/deleteconfigs", "/config/"),
        ("/api/uploadcoeffs", "/api/deletecoeffs", "/coeff/"),
    ],
)
async def test_upload_and_delete(server, upload, delete, getfile):
    filename = "".join(random.choice(string.ascii_lowercase) for i in range(10))
    filedata = "".join(random.choice(string.ascii_lowercase) for i in range(10))

    # try to get a file that does not exist
    resp = await server.get(getfile + filename)
    assert resp.status == 404

    # generate and upload a file
    data = FormData()
    data.add_field("file0", filedata.encode(), filename=filename)
    resp = await server.post(upload, data=data)
    assert resp.status == 200

    # fetch the file, check the content
    resp = await server.get(getfile + filename)
    assert resp.status == 200
    response_data = await resp.read()
    assert response_data == filedata.encode()

    # delete the file
    resp = await server.post(delete, json=[filename])
    assert resp.status == 200

    # try to download the deleted file
    resp = await server.get(getfile + filename)
    assert resp.status == 404


async def test_startup_config_online(server):
    resp = await server.get("/api/getstartconfig")
    assert resp.status == 200
    content = await resp.json()
    print(content)
    assert content["config"]["devices"]["samplerate"] == 44100
    assert content["source"] == "dsp"
    assert content["configFileName"] == "config.yml"


async def test_startup_config_offline(offline_server):
    resp = await offline_server.get("/api/getstartconfig")
    assert resp.status == 200
    content = await resp.json()
    print(content)
    assert content["config"]["devices"]["samplerate"] == 48000
    assert content["source"] == "active"
    assert content["configFileName"] == "config2.yml"


async def test_startup_config_offline_falls_back_to_default_for_legacy_active(
    offline_server,
):
    legacy_name = "legacy_startup.yml"
    legacy_path = os.path.join(TESTFILE_DIR, legacy_name)
    legacy_config = {
        "devices": {
            "samplerate": 48000,
            "chunksize": 1024,
            "capture": {"type": "Stdin", "channels": 2, "format": "S16LE"},
            "playback": {"type": "Stdout", "channels": 2, "format": "S16LE"},
        }
    }
    with open(legacy_path, "w", encoding="utf-8") as f:
        yaml.dump(legacy_config, f)

    state = yaml.safe_load(open(STATEFILE_PATH))
    state["config_path"] = legacy_path
    with open(STATEFILE_PATH, "w", encoding="utf-8") as f:
        yaml.dump(state, f)

    try:
        resp = await offline_server.get("/api/getstartconfig")
        assert resp.status == 200
        content = await resp.json()
        assert content["source"] == "default"
        assert content["configFileName"] == "config.yml"
        assert content["config"]["devices"]["samplerate"] == 44100
    finally:
        if os.path.exists(legacy_path):
            os.remove(legacy_path)


async def test_translate_eqapo(server):
    from test_eqapo_config_import import EXAMPLE

    resp = await server.post("/api/eqapotojson?channels=2", data=EXAMPLE)
    assert resp.status == 200
    content = await resp.json()
    assert "filters" in content


async def test_translate_eqapo_bad(server):
    resp = await server.post("/api/eqapotojson", data="blank")
    assert resp.status == 400


async def test_translate_convolver(server):
    resp = await server.post("/api/convolvertojson", data="96000 1 2 0\n0\n0")
    assert resp.status == 200
    content = await resp.json()
    assert "devices" in content
    assert content["devices"]["samplerate"] == 96000


async def test_get_config_file_with_migration_bypasses_file_validation(server):
    server.app["VALIDATOR"].validate_file = MagicMock(
        side_effect=camilladsp.CamillaError("strict file validation failed")
    )

    resp_without_migration = await server.get(
        "/api/getconfigfile", params={"name": "config.yml"}
    )
    assert resp_without_migration.status == 400

    resp_with_migration = await server.get(
        "/api/getconfigfile", params={"name": "config.yml", "migrate": "TRUE"}
    )
    assert resp_with_migration.status == 200
    content = await resp_with_migration.json()
    assert isinstance(content["devices"]["samplerate"], int)


async def test_stored_configs_missing_files_only_is_warning(server):
    server.app["VALIDATOR"].validate_config = MagicMock(return_value=None)
    server.app["VALIDATOR"].get_errors = MagicMock(
        return_value=[
            (
                ["filters", "conv", "parameters", "filename"],
                "Coefficient file not found",
                "warning",
            )
        ]
    )

    resp = await server.get("/api/storedconfigs")
    assert resp.status == 200
    content = await resp.json()
    config_file = next((item for item in content if item["name"] == "config.yml"), None)
    assert config_file is not None
    assert config_file["valid"] is True
    assert config_file["errors"] is not None
    assert config_file["errors"][0][2] == "warning"


async def test_stored_configs_missing_files_plus_other_error_is_invalid(server):
    server.app["VALIDATOR"].validate_config = MagicMock(return_value=None)
    server.app["VALIDATOR"].get_errors = MagicMock(
        return_value=[
            (
                ["filters", "conv", "parameters", "filename"],
                "Coefficient file not found",
                "warning",
            ),
            (["devices", "samplerate"], "Must be larger than 0", "error"),
        ]
    )

    resp = await server.get("/api/storedconfigs")
    assert resp.status == 200
    content = await resp.json()
    config_file = next((item for item in content if item["name"] == "config.yml"), None)
    assert config_file is not None
    assert config_file["valid"] is False
    assert config_file["errors"] is not None
    assert any(issue[2] == "error" for issue in config_file["errors"])

    async def test_stored_configs_eqapo_text_does_not_crash_and_has_no_version(server):
        filename = "eqapo_like.yml"
        filepath = os.path.join(TESTFILE_DIR, filename)
        content = """Preamp: -7.08 dB
    Filter 1: ON LSC Fc 105.0 Hz Gain 7.2 dB Q 0.70
    Filter 2: ON PK Fc 188.0 Hz Gain -3.2 dB Q 0.39
    Filter 3: ON HSC Fc 10000.0 Hz Gain -1.8 dB Q 0.70
    """
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)

        try:
            resp = await server.get("/api/storedconfigs")
            assert resp.status == 200
            files = await resp.json()
            config_file = next(
                (item for item in files if item["name"] == filename), None
            )
            assert config_file is not None
            assert config_file["version"] is None
            assert config_file["valid"] is False
            assert config_file["errors"] is not None
            assert (
                config_file["errors"][0][1]
                == "This does not appear to be a CamillaDSP config file."
            )
        finally:
            if os.path.exists(filepath):
                os.remove(filepath)
