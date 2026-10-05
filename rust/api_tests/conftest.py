"""
Black-box API tests that run against the real backend processes.

Each backend is started as a subprocess with its own copy of the test files
and its own fake CamillaDSP, so the same tests can run against the Rust and
the Python backend and show where they differ. Pick the backends with
API_TEST_BACKENDS, a comma separated list, "rust,python" by default. The Rust
backend is built with cargo first unless CAMILLAGUI_BIN points at a binary.

Run from the repository root with the backend's venv:

    .venv/bin/python -m pytest rust/api_tests
"""

import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).parent))
from fake_camilladsp import FakeCamillaDSP  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
TESTFILES = REPO / "tests" / "testfiles"
BACKENDS = [b.strip() for b in os.environ.get("API_TEST_BACKENDS", "rust,python").split(",") if b.strip()]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Response:
    def __init__(self, status, headers, body):
        self.status = status
        self.headers = headers
        self.body = body

    @property
    def text(self):
        return self.body.decode("utf-8")

    def json(self):
        return json.loads(self.body)


def rust_binary():
    explicit = os.environ.get("CAMILLAGUI_BIN")
    if explicit:
        return explicit
    subprocess.run(["cargo", "build"], cwd=REPO / "rust", check=True)
    return str(REPO / "rust" / "target" / "debug" / "camillagui")


class Backend:
    """A backend process, its folders and the fake CamillaDSP it talks to."""

    def __init__(self, kind, root, overrides=None):
        self.kind = kind
        self.root = Path(root)
        self.config_dir = self.root / "configs"
        shutil.copytree(TESTFILES, self.config_dir)
        self.statefile = self.config_dir / "statefile.yml"
        self.fake = FakeCamillaDSP(str(self.config_dir / "config.yml")).start()
        self.port = free_port()
        settings = {
            "camilla_host": "127.0.0.1",
            "camilla_port": self.fake.port,
            "bind_address": "127.0.0.1",
            "port": self.port,
            "config_dir": str(self.config_dir),
            "coeff_dir": str(self.config_dir),
            "audiofiles_dir": None,
            "default_config": str(self.config_dir / "config.yml"),
            "statefile_path": str(self.statefile),
            "log_file": str(self.config_dir / "log.txt"),
            "gui_config_file": str(self.config_dir / "gui_config.yml"),
            "on_set_active_config": None,
            "on_get_active_config": None,
            "supported_capture_types": None,
            "supported_playback_types": None,
            "allow_absolute_paths": False,
            "level_smoothing_ms": 100,
            "level_max_update_hz": 30,
        }
        settings.update(overrides or {})
        self.settings = settings
        settings_path = self.root / "camillagui.yml"
        settings_path.write_text(yaml.dump(settings))
        self.reset_statefile()
        if kind == "rust":
            command = [rust_binary(), "-c", str(settings_path)]
        else:
            command = [sys.executable, str(REPO / "main.py"), "-c", str(settings_path)]
        self.log = open(self.root / "backend.log", "w")
        self.process = subprocess.Popen(command, cwd=REPO, stdout=self.log, stderr=subprocess.STDOUT)
        self.wait_until_ready()

    def reset_statefile(self):
        template = yaml.safe_load((TESTFILES / "statefile_template.yml").read_text())
        template["config_path"] = str(self.config_dir / template["config_path"])
        self.statefile.write_text(yaml.dump(template))

    def wait_until_ready(self):
        deadline = time.time() + 20
        while time.time() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError(f"{self.kind} backend exited, see {self.root / 'backend.log'}")
            try:
                status = self.get("/api/status").json()
                if status["cdsp_status"] != "Offline" and self.get("/api/backends").json():
                    return
            except (urllib.error.URLError, ConnectionError, json.JSONDecodeError):
                pass
            time.sleep(0.1)
        raise RuntimeError(f"{self.kind} backend did not come up")

    def wait_for_backends(self, expected):
        """Wait until the backend has read the device types after reconnecting."""
        deadline = time.time() + 10
        while time.time() < deadline:
            self.get("/api/status")
            if self.get("/api/backends").json() == expected:
                return
            time.sleep(0.1)
        raise RuntimeError(f"{self.kind} backend did not read the device types")

    def reset(self):
        was_offline = not self.fake.state["online"]
        self.fake.reset()
        self.reset_statefile()
        if was_offline:
            self.wait_for_backends(self.fake.state["supported_device_types"])

    def stop(self):
        self.process.terminate()
        try:
            self.process.wait(5)
        except subprocess.TimeoutExpired:
            self.process.kill()
        self.fake.stop()
        self.log.close()

    def request(self, method, path, params=None, data=None, json_body=None, headers=None):
        url = f"http://127.0.0.1:{self.port}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        headers = dict(headers or {})
        if json_body is not None:
            data = json.dumps(json_body).encode()
            headers.setdefault("Content-Type", "application/json")
        elif isinstance(data, str):
            data = data.encode()
        request = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return Response(response.status, response.headers, response.read())
        except urllib.error.HTTPError as err:
            return Response(err.code, err.headers, err.read())

    def get(self, path, params=None):
        return self.request("GET", path, params=params)

    def post(self, path, **kwargs):
        return self.request("POST", path, **kwargs)

    def upload(self, path, filename, content):
        boundary = uuid.uuid4().hex
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file0"; filename="{filename}"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
        return self.post(
            path, data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
        )


@pytest.fixture(scope="session", params=BACKENDS)
def backend_session(request, tmp_path_factory):
    backend = Backend(request.param, tmp_path_factory.mktemp(request.param))
    yield backend
    backend.stop()


@pytest.fixture
def server(backend_session):
    backend_session.reset()
    yield backend_session


@pytest.fixture
def make_backend(tmp_path):
    """Start a separate backend with some settings changed."""
    started = []

    def make(kind, overrides):
        backend = Backend(kind, tmp_path / f"{kind}-{len(started)}", overrides)
        started.append(backend)
        return backend

    yield make
    for backend in started:
        backend.stop()


@pytest.fixture(scope="session")
def both_backends(tmp_path_factory):
    """One of each, for comparing their responses directly."""
    if set(BACKENDS) != {"rust", "python"}:
        pytest.skip("Comparing needs both backends")
    backends = {kind: Backend(kind, tmp_path_factory.mktemp(f"cmp-{kind}")) for kind in ("rust", "python")}
    yield backends
    for backend in backends.values():
        backend.stop()
