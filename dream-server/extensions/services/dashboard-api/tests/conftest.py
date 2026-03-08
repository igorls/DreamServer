"""Shared fixtures for dashboard-api unit tests."""

import os
import sys
from pathlib import Path

import pytest

# Add dashboard-api source to path so we can import modules directly.
DASHBOARD_API_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(DASHBOARD_API_DIR))

# Set env vars BEFORE any app imports so config.py and security.py initialise
# correctly (they read env at module level).
_TEST_API_KEY = "test-key-12345"
os.environ.setdefault("DASHBOARD_API_KEY", _TEST_API_KEY)
os.environ.setdefault("DREAM_INSTALL_DIR", "/tmp/dream-test-install")
os.environ.setdefault("DREAM_DATA_DIR", "/tmp/dream-test-data")
os.environ.setdefault("DREAM_EXTENSIONS_DIR", "/tmp/dream-test-extensions")
os.environ.setdefault("GPU_BACKEND", "nvidia")


@pytest.fixture()
def install_dir(tmp_path, monkeypatch):
    """Provide an isolated install directory with a .env file."""
    d = tmp_path / "dream-server"
    d.mkdir()
    monkeypatch.setattr("helpers.INSTALL_DIR", str(d))
    return d


@pytest.fixture()
def data_dir(tmp_path, monkeypatch):
    """Provide an isolated data directory for bootstrap/token files."""
    d = tmp_path / "data"
    d.mkdir()
    monkeypatch.setattr("helpers.DATA_DIR", str(d))
    monkeypatch.setattr("helpers._TOKEN_FILE", d / "token_counter.json")
    return d


@pytest.fixture()
def setup_config_dir(tmp_path, monkeypatch):
    """Provide an isolated config directory for setup/persona files."""
    d = tmp_path / "config"
    d.mkdir()
    import config
    monkeypatch.setattr(config, "SETUP_CONFIG_DIR", d)
    # Also patch the setup router which imports SETUP_CONFIG_DIR at the top
    import routers.setup as setup_router
    monkeypatch.setattr(setup_router, "SETUP_CONFIG_DIR", d)
    return d


@pytest.fixture()
def test_client(monkeypatch):
    """Return a FastAPI TestClient pre-configured with Bearer auth."""
    import security
    monkeypatch.setattr(security, "DASHBOARD_API_KEY", _TEST_API_KEY)

    from fastapi.testclient import TestClient
    from main import app

    client = TestClient(app, raise_server_exceptions=True)
    client.auth_headers = {"Authorization": f"Bearer {_TEST_API_KEY}"}
    return client
