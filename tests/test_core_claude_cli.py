"""
Tests for core/claude_cli.py and core/config.find_claude_cli.

Covers the error/timeout branches of get_claude_status,
run_claude_prompt, generate_skill_with_claude, improve_skill_with_claude
which are otherwise unreachable without an actual Claude CLI present.
"""

import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from core import claude_cli, config  # noqa: E402


# ---------------------------------------------------------------------------
# get_claude_status
# ---------------------------------------------------------------------------

class TestGetClaudeStatus:
    def test_returns_unavailable_when_cli_missing(self):
        with patch("core.claude_cli.find_claude_cli", return_value=None):
            result = claude_cli.get_claude_status()
        assert result["available"] is False
        assert "not found" in result["error"].lower()

    def test_returns_version_on_success(self):
        with patch("core.claude_cli.find_claude_cli", return_value="/bin/claude"), \
             patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(
                stdout="claude 1.2.3\n", stderr="", returncode=0
            )
            result = claude_cli.get_claude_status()
        assert result["available"] is True
        assert result["path"] == "/bin/claude"
        assert result["version"] == "claude 1.2.3"

    def test_falls_back_to_stderr_for_version(self):
        with patch("core.claude_cli.find_claude_cli", return_value="/bin/claude"), \
             patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(
                stdout="", stderr="claude 9.9\n", returncode=0
            )
            result = claude_cli.get_claude_status()
        assert result["version"] == "claude 9.9"

    def test_handles_timeout(self):
        with patch("core.claude_cli.find_claude_cli", return_value="/bin/claude"), \
             patch("subprocess.run", side_effect=subprocess.TimeoutExpired("claude", 5)):
            result = claude_cli.get_claude_status()
        assert result["available"] is False
        assert "timed out" in result["error"].lower()

    def test_handles_generic_exception(self):
        with patch("core.claude_cli.find_claude_cli", return_value="/bin/claude"), \
             patch("subprocess.run", side_effect=OSError("permission denied")):
            result = claude_cli.get_claude_status()
        assert result["available"] is False
        assert "permission denied" in result["error"]


# ---------------------------------------------------------------------------
# run_claude_prompt
# ---------------------------------------------------------------------------

class TestRunClaudePrompt:
    def test_returns_error_when_cli_missing(self):
        with patch("core.claude_cli.find_claude_cli", return_value=None):
            data, err = claude_cli.run_claude_prompt("hi")
        assert data is None
        assert "not found" in err.lower()

    def test_runs_with_context(self, tmp_path):
        with patch("core.claude_cli.find_claude_cli", return_value="/bin/claude"), \
             patch("core.claude_cli.get_skills_dir", return_value=tmp_path), \
             patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(
                stdout="hello", stderr="", returncode=0
            )
            data, err = claude_cli.run_claude_prompt("say hi", skill_context="ctx")
        assert err is None
        assert data["success"] is True
        # The prompt sent to subprocess should include the context preamble
        args = mock_run.call_args.args[0]
        assert "Using this skill context" in args[-1]

    def test_records_failure_returncode(self, tmp_path):
        with patch("core.claude_cli.find_claude_cli", return_value="/bin/claude"), \
             patch("core.claude_cli.get_skills_dir", return_value=tmp_path), \
             patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(
                stdout="", stderr="oops", returncode=2
            )
            data, err = claude_cli.run_claude_prompt("hi")
        assert err is None
        assert data["success"] is False
        assert data["returncode"] == 2

    def test_handles_timeout(self, tmp_path):
        with patch("core.claude_cli.find_claude_cli", return_value="/bin/claude"), \
             patch("core.claude_cli.get_skills_dir", return_value=tmp_path), \
             patch("subprocess.run", side_effect=subprocess.TimeoutExpired("claude", 1)):
            data, err = claude_cli.run_claude_prompt("hi")
        assert data is None
        assert err == "Timeout"

    def test_handles_generic_exception(self, tmp_path):
        with patch("core.claude_cli.find_claude_cli", return_value="/bin/claude"), \
             patch("core.claude_cli.get_skills_dir", return_value=tmp_path), \
             patch("subprocess.run", side_effect=OSError("boom")):
            data, err = claude_cli.run_claude_prompt("hi")
        assert data is None
        assert "boom" in err


# ---------------------------------------------------------------------------
# generate_skill_with_claude
# ---------------------------------------------------------------------------

class TestGenerateSkillWithClaude:
    def test_requires_idea(self):
        data, err = claude_cli.generate_skill_with_claude("")
        assert data is None
        assert "required" in err.lower()

    def test_returns_error_when_cli_missing(self):
        with patch("core.claude_cli.find_claude_cli", return_value=None):
            data, err = claude_cli.generate_skill_with_claude("idea")
        assert data is None
        assert "not found" in err.lower()

    def test_parses_name_and_description_from_frontmatter(self):
        output = (
            "---\nname: my-skill\ndescription: hi there\n---\n# My Skill\n"
        )
        with patch("core.claude_cli.find_claude_cli", return_value="/bin/claude"), \
             patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(
                stdout=output, stderr="", returncode=0
            )
            data, err = claude_cli.generate_skill_with_claude("idea")
        assert err is None
        assert data["success"] is True
        assert data["skill"]["name"] == "my-skill"
        assert data["skill"]["description"] == "hi there"
        assert data["skill"]["content"] == output.strip()

    def test_handles_output_without_frontmatter(self):
        with patch("core.claude_cli.find_claude_cli", return_value="/bin/claude"), \
             patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(
                stdout="# Just a heading", stderr="", returncode=0
            )
            data, err = claude_cli.generate_skill_with_claude("idea")
        assert err is None
        assert "name" not in data["skill"]
        assert "description" not in data["skill"]

    def test_handles_unterminated_frontmatter(self):
        # '---' header but no closing '---' → triggers ValueError branch
        with patch("core.claude_cli.find_claude_cli", return_value="/bin/claude"), \
             patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(
                stdout="---\nname: x\n# never closed", stderr="", returncode=0
            )
            data, err = claude_cli.generate_skill_with_claude("idea")
        assert err is None
        # Name should not be parsed since frontmatter never terminates
        assert "name" not in data["skill"]

    def test_handles_timeout(self):
        with patch("core.claude_cli.find_claude_cli", return_value="/bin/claude"), \
             patch("subprocess.run", side_effect=subprocess.TimeoutExpired("claude", 1)):
            data, err = claude_cli.generate_skill_with_claude("idea")
        assert data is None
        assert err == "Timeout"

    def test_handles_generic_exception(self):
        with patch("core.claude_cli.find_claude_cli", return_value="/bin/claude"), \
             patch("subprocess.run", side_effect=RuntimeError("bad")):
            data, err = claude_cli.generate_skill_with_claude("idea")
        assert data is None
        assert "bad" in err


# ---------------------------------------------------------------------------
# improve_skill_with_claude
# ---------------------------------------------------------------------------

class TestImproveSkillWithClaude:
    def test_returns_error_when_skill_missing(self, tmp_path):
        with patch("core.claude_cli.get_skills_dir", return_value=tmp_path):
            data, err = claude_cli.improve_skill_with_claude("ghost", "improve")
        assert data is None
        assert "not found" in err.lower()

    def test_returns_error_when_cli_missing(self, tmp_path):
        skill_dir = tmp_path / "foo"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text("# Foo\n", encoding="utf-8")
        with patch("core.claude_cli.get_skills_dir", return_value=tmp_path), \
             patch("core.claude_cli.find_claude_cli", return_value=None):
            data, err = claude_cli.improve_skill_with_claude("foo", "improve")
        assert data is None
        assert "not found" in err.lower()

    def test_improves_skill(self, tmp_path):
        skill_dir = tmp_path / "foo"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text("# Foo\n", encoding="utf-8")
        with patch("core.claude_cli.get_skills_dir", return_value=tmp_path), \
             patch("core.claude_cli.find_claude_cli", return_value="/bin/claude"), \
             patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(
                stdout="# Improved Foo", stderr="", returncode=0
            )
            data, err = claude_cli.improve_skill_with_claude("foo", "make it better")
        assert err is None
        assert data["success"] is True
        assert data["improved_content"] == "# Improved Foo"
        assert data["original_content"] == "# Foo\n"

    def test_handles_timeout(self, tmp_path):
        skill_dir = tmp_path / "foo"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text("# Foo\n", encoding="utf-8")
        with patch("core.claude_cli.get_skills_dir", return_value=tmp_path), \
             patch("core.claude_cli.find_claude_cli", return_value="/bin/claude"), \
             patch("subprocess.run", side_effect=subprocess.TimeoutExpired("claude", 1)):
            data, err = claude_cli.improve_skill_with_claude("foo", "x")
        assert data is None
        assert err == "Timeout"

    def test_handles_generic_exception(self, tmp_path):
        skill_dir = tmp_path / "foo"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text("# Foo\n", encoding="utf-8")
        with patch("core.claude_cli.get_skills_dir", return_value=tmp_path), \
             patch("core.claude_cli.find_claude_cli", return_value="/bin/claude"), \
             patch("subprocess.run", side_effect=RuntimeError("nope")):
            data, err = claude_cli.improve_skill_with_claude("foo", "x")
        assert data is None
        assert "nope" in err


# ---------------------------------------------------------------------------
# core/config.find_claude_cli — currently-fallback-uncovered branches
# ---------------------------------------------------------------------------

class TestFindClaudeCli:
    def test_returns_path_when_in_PATH(self):
        with patch("core.config.shutil.which", return_value="/usr/local/bin/claude"):
            assert config.find_claude_cli() == "/usr/local/bin/claude"

    def test_falls_back_to_home_locations(self, tmp_path, monkeypatch):
        home = tmp_path
        # Create one of the candidate files
        (home / ".claude").mkdir()
        candidate = home / ".claude" / "claude"
        candidate.write_text("")
        candidate.chmod(0o755)

        with patch("core.config.shutil.which", return_value=None), \
             patch("core.config.Path.home", return_value=home):
            result = config.find_claude_cli()
        assert result == str(candidate)

    def test_returns_none_when_nothing_found(self, tmp_path, monkeypatch):
        # Ensure no claude in cwd
        monkeypatch.chdir(tmp_path)
        with patch("core.config.shutil.which", return_value=None), \
             patch("core.config.Path.home", return_value=tmp_path / "no-such-home"):
            result = config.find_claude_cli()
        assert result is None

    def test_finds_in_current_directory(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        (tmp_path / "claude").write_text("")
        with patch("core.config.shutil.which", return_value=None), \
             patch("core.config.Path.home", return_value=tmp_path / "no-such-home"):
            result = config.find_claude_cli()
        assert result == "claude"
