import json
import pytest
from unittest.mock import MagicMock, patch
import asyncio
import pytest
from aiohttp import web

import main
from backend import views
import camilladsp

server_config = {
    "camilla_host": "127.0.0.1",
    "camilla_port": 1234,
    "bind_address": "0.0.0.0",
    "port": 5005,
    "config_dir": ".",
    "coeff_dir": ".",
    "default_config": "./default_config.yml",
    "statefile_path": "./statefile.yml",
    "log_file": None,
    "on_set_active_config": None,
    "on_get_active_config": None,
    "supported_capture_types": None,
    "supported_playback_types": None,
    "can_update_active_config": False,
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
    client.levels = MagicMock
    client.levels.capture_peak = MagicMock(side_effect=[[-2.0, -3.0]])
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
    client.status = MagicMock()
    client.status.rate_adjust = MagicMock(side_effect=[1.01])
    client.status.buffer_level = MagicMock(side_effect=[1234])
    client.status.clipped_samples = MagicMock(side_effect=[12])
    client.status.processing_load = MagicMock(side_effect=[0.5])
    with patch("camilladsp.CamillaClient", client_constructor):
        app = main.build_app(server_config)
        app["STATUSCACHE"]["py_cdsp_version"] = "1.2.3"
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
