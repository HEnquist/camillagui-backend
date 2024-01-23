import json
import pytest
from unittest.mock import MagicMock, patch
import pytest
from aiohttp import web, FormData
import os
import yaml
import random
import string

import main
from backend import views
import camilladsp

TESTFILE_DIR = os.path.join(os.path.dirname(__file__), "testfiles")
SAMPLE_CONFIG = yaml.safe_load(open(os.path.join(TESTFILE_DIR, "config.yml")))

server_config = {
    "camilla_host": "127.0.0.1",
    "camilla_port": 1234,
    "bind_address": "0.0.0.0",
    "port": 5005,
    "config_dir": TESTFILE_DIR,
    "coeff_dir": TESTFILE_DIR,
    "default_config": os.path.join(TESTFILE_DIR, "config.yml"),
    "statefile_path": os.path.join(TESTFILE_DIR, "statefile.yml"),
    "log_file": os.path.join(TESTFILE_DIR, "log.txt"),
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
def mock_app():
    client = MagicMock()
    client_constructor = MagicMock(return_value=client)
    client.volume = MagicMock()
    client.volume.main = MagicMock(side_effect=[-20.0])
    client.mute = MagicMock()
    client.mute.main = MagicMock(side_effect=[False])
    client.levels = MagicMock
    client.levels.capture_peak = MagicMock(side_effect=[[-2.0, -3.0]])
    client.levels.playback_peak = MagicMock(side_effect=[[-2.5, -3.5]])
    client.levels.levels = MagicMock(
        side_effect=[
            {
                "capture_rms": [-5.0, -6.0],
                "capture_peak": [-2.0, -3.0],
                "playback_rms": [-7.0, -8.0],
                "playback_peak": [-3.0, -4.0],
            }
        ]
    )
    client.rate = MagicMock()
    client.rate.capture = MagicMock(side_effect=[44100])
    client.general = MagicMock()
    client.general.state = MagicMock(
        side_effect=[camilladsp.camilladsp.ProcessingState.RUNNING]
    )
    client.general.list_capture_devices = MagicMock(
        side_effect=[[["hw:Aaaa,0,0", "Dev A"], ["hw:Bbbb,0,0", "Dev B"]]]
    )
    client.general.list_playback_devices = MagicMock(
        side_effect=[[["hw:Cccc,0,0", "Dev C"], ["hw:Dddd,0,0", "Dev D"]]]
    )
    client.general.supported_device_types = MagicMock(side_effect=[["Alsa", "Wasapi"]])
    client.status = MagicMock()
    client.status.rate_adjust = MagicMock(side_effect=[1.01])
    client.status.buffer_level = MagicMock(side_effect=[1234])
    client.status.clipped_samples = MagicMock(side_effect=[12])
    client.status.processing_load = MagicMock(side_effect=[0.5])
    client.config = MagicMock()
    client.config.active = MagicMock(side_effect=[SAMPLE_CONFIG])
    client.versions = MagicMock()
    client.versions.library = MagicMock(side_effect=["1.2.3"])
    with patch("camilladsp.CamillaClient", client_constructor):
        app = main.build_app(server_config)
        yield app


@pytest.fixture
def server(event_loop, aiohttp_client, mock_app):
    return event_loop.run_until_complete(aiohttp_client(mock_app))


@pytest.mark.asyncio
async def test_read_volume(mock_request):
    mock_request.match_info = {"name": "volume"}
    reply = await views.get_param(mock_request)
    assert reply.body == "-20.0"


@pytest.mark.asyncio
async def test_read_peaks(mock_request):
    mock_request.match_info = {"name": "capturesignalpeak"}
    reply = await views.get_list_param(mock_request)
    assert json.loads(reply.body) == [-2.0, -3.0]


@pytest.mark.asyncio
async def test_read_volume(server):
    resp = await server.get("/api/getparam/volume")
    assert resp.status == 200
    assert await resp.text() == "-20.0"


@pytest.mark.asyncio
async def test_read_peaks(server):
    resp = await server.get("/api/getlistparam/capturesignalpeak")
    assert resp.status == 200
    assert await resp.json() == [-2.0, -3.0]


@pytest.mark.asyncio
async def test_read_status(server):
    resp = await server.get("/api/status")
    assert resp.status == 200
    response = await resp.json()
    assert response["cdsp_status"] == "RUNNING"


@pytest.mark.parametrize(
    "endpoint, parameters",
    [
        ("/api/status", None),
        ("/api/getparam/mute", None),
        ("/api/getlistparam/playbacksignalpeak", None),
        ("/api/getconfig", None),
        ("/api/getactiveconfigfile", None),
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
@pytest.mark.asyncio
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
@pytest.mark.asyncio
async def test_upload_and_delete(server, upload, delete, getfile):
    filename = ''.join(random.choice(string.ascii_lowercase) for i in range(10))
    filedata = ''.join(random.choice(string.ascii_lowercase) for i in range(10))

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
