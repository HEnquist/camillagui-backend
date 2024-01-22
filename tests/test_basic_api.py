import json
import pytest
from unittest.mock import MagicMock, patch
import asyncio
import pytest
from aiohttp import web

import main
from backend import views


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
    with patch("camilladsp.CamillaClient", client_constructor):
        print(client)
        print(client.volume)
        print(client.volume.main)
        app = main.build_app()
        print(app["CAMILLA"])
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
