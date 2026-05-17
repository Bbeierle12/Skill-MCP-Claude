"""
Tests for small helpers in skills_manager_app.py that are otherwise
uncovered: index route, is_port_in_use, open_browser scheduling.
"""

import socket
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.fixture
def app_module(tmp_path):
    """Import skills_manager_app, patch its paths to a temp dir."""
    import core.config as config
    import skills_manager_app as app_module

    # Configure a temp skills dir and app dir
    (tmp_path / "skills").mkdir()
    original_config_skills_dir = config._skills_dir
    original_app_skills_dir = app_module.SKILLS_DIR
    original_app_dir = app_module.APP_DIR

    config._skills_dir = tmp_path / "skills"
    app_module.SKILLS_DIR = tmp_path / "skills"
    app_module.APP_DIR = tmp_path
    # Provide a stub for the static file the index route would serve
    (tmp_path / "skills-manager.html").write_text("<html>ok</html>")

    yield app_module

    config._skills_dir = original_config_skills_dir
    app_module.SKILLS_DIR = original_app_skills_dir
    app_module.APP_DIR = original_app_dir


class TestIndexRoute:
    def test_serves_html(self, app_module):
        app_module.app.config["TESTING"] = True
        client = app_module.app.test_client()
        response = client.get("/")
        assert response.status_code == 200
        assert b"<html>ok</html>" in response.data


class TestIsPortInUse:
    def test_returns_false_for_unused_port(self, app_module):
        # Use a random high port that is very likely unused
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            free_port = s.getsockname()[1]
        # Port is now released; check should return False
        assert app_module.is_port_in_use(free_port) is False

    def test_returns_true_for_listening_port(self, app_module):
        # Open a listening socket and check is_port_in_use detects it
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            s.listen(1)
            port = s.getsockname()[1]
            # Patch HOST to 127.0.0.1 in case it's different
            with patch.object(app_module, "HOST", "127.0.0.1"):
                assert app_module.is_port_in_use(port) is True


class TestOpenBrowser:
    def test_opens_url_after_delay(self, app_module):
        # open_browser sleeps 1.5s; patch sleep to skip the wait
        with patch.object(app_module.time, "sleep") as mock_sleep, \
             patch.object(app_module.webbrowser, "open") as mock_open:
            app_module.open_browser()
        mock_sleep.assert_called_once()
        mock_open.assert_called_once()
        args = mock_open.call_args.args[0]
        assert "http://" in args
        assert str(app_module.PORT) in args


class TestMainFunctionStartup:
    def test_main_exits_early_when_port_in_use(self, app_module):
        with patch.object(app_module, "is_port_in_use", return_value=True), \
             patch.object(app_module.webbrowser, "open"), \
             patch("builtins.input", return_value=""), \
             patch.object(app_module, "find_claude_cli", return_value=None), \
             patch.object(app_module.app, "run") as mock_run:
            app_module.main()
        # When port is in use, app.run should NOT be called
        mock_run.assert_not_called()

    def test_main_starts_server_when_port_free(self, app_module):
        with patch.object(app_module, "is_port_in_use", return_value=False), \
             patch.object(app_module, "find_claude_cli", return_value="/bin/claude"), \
             patch.object(app_module.threading, "Thread") as mock_thread, \
             patch.object(app_module.app, "run") as mock_run:
            mock_run.return_value = None
            app_module.main()
        mock_run.assert_called_once()
        mock_thread.assert_called_once()

    def test_main_handles_keyboard_interrupt(self, app_module):
        with patch.object(app_module, "is_port_in_use", return_value=False), \
             patch.object(app_module, "find_claude_cli", return_value=None), \
             patch.object(app_module.threading, "Thread"), \
             patch.object(app_module.app, "run", side_effect=KeyboardInterrupt):
            # Should not raise
            app_module.main()
