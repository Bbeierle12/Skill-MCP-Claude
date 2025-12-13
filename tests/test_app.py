# test_app.py - Tests for the Standalone Skills Manager App
import pytest
import json
import base64
import socket
from pathlib import Path
from unittest.mock import patch, MagicMock
import sys

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))


class TestGetAppDir:
    """Tests for get_app_dir function."""

    def test_returns_file_parent_when_not_frozen(self):
        """Test returns __file__ parent when not frozen."""
        import skills_manager_app as app_module
        # In test environment, sys.frozen is not set
        result = app_module.get_app_dir()
        assert isinstance(result, Path)
        assert result.exists()

    def test_returns_executable_parent_when_frozen(self):
        """Test returns executable parent when frozen (PyInstaller)."""
        import skills_manager_app as app_module
        with patch.object(sys, 'frozen', True, create=True):
            with patch.object(sys, 'executable', '/path/to/app.exe'):
                # Note: This tests the logic, actual frozen behavior differs
                result = app_module.get_app_dir()
                assert isinstance(result, Path)


class TestSanitizeName:
    """Tests for sanitize_name function in app module."""

    def test_lowercase(self):
        """Test that names are lowercased."""
        import skills_manager_app as app
        assert app.sanitize_name("MySkill") == "myskill"

    def test_replaces_special_chars(self):
        """Test that special characters are replaced."""
        import skills_manager_app as app
        assert app.sanitize_name("my_skill@v2") == "my-skill-v2"

    def test_strips_hyphens(self):
        """Test that leading/trailing hyphens are stripped."""
        import skills_manager_app as app
        assert app.sanitize_name("--skill--") == "skill"


class TestFindClaudeCli:
    """Tests for find_claude_cli function in app module."""

    def test_finds_via_which(self):
        """Test finding CLI via shutil.which."""
        import skills_manager_app as app
        with patch('shutil.which') as mock_which:
            mock_which.return_value = '/usr/bin/claude'
            with patch('os.path.exists', return_value=False):
                result = app.find_claude_cli()
                assert result == '/usr/bin/claude'

    def test_returns_none_when_not_found(self):
        """Test returns None when not found."""
        import skills_manager_app as app
        with patch('shutil.which', return_value=None):
            with patch('os.path.exists', return_value=False):
                result = app.find_claude_cli()
                assert result is None


class TestIsPortInUse:
    """Tests for is_port_in_use function."""

    def test_returns_false_for_free_port(self):
        """Test returns False for a free port."""
        import skills_manager_app as app
        # Find a free port
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('127.0.0.1', 0))
            free_port = s.getsockname()[1]

        result = app.is_port_in_use(free_port)
        assert result is False

    def test_returns_true_for_used_port(self):
        """Test returns True for a port in use."""
        import skills_manager_app as app
        # Bind to a port
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('127.0.0.1', 0))
            s.listen(1)
            used_port = s.getsockname()[1]

            result = app.is_port_in_use(used_port)
            assert result is True


class TestListSkillsEndpoint:
    """Tests for GET /api/skills endpoint in app."""

    def test_lists_skills(self, flask_app_test_client, sample_skill):
        """Test listing all skills."""
        response = flask_app_test_client.get('/api/skills')
        assert response.status_code == 200
        data = response.get_json()
        assert "skills" in data

    def test_includes_metadata(self, flask_app_test_client, sample_skill):
        """Test that metadata is included."""
        response = flask_app_test_client.get('/api/skills')
        data = response.get_json()
        if data["skills"]:
            skill = data["skills"][0]
            assert "name" in skill
            assert "has_scripts" in skill
            assert "has_references" in skill

    def test_handles_empty_directory(self, flask_app_test_client, temp_skills_dir):
        """Test handling empty skills directory."""
        response = flask_app_test_client.get('/api/skills')
        assert response.status_code == 200
        data = response.get_json()
        assert data["skills"] == []


class TestGetSkillEndpoint:
    """Tests for GET /api/skills/<name> endpoint in app."""

    def test_gets_skill(self, flask_app_test_client, sample_skill):
        """Test getting a specific skill."""
        response = flask_app_test_client.get('/api/skills/test-skill')
        assert response.status_code == 200
        data = response.get_json()
        assert data["name"] == "test-skill"

    def test_returns_404_for_missing(self, flask_app_test_client, temp_skills_dir):
        """Test 404 for missing skill."""
        response = flask_app_test_client.get('/api/skills/nonexistent')
        assert response.status_code == 404

    def test_includes_files_list(self, flask_app_test_client, sample_skill):
        """Test that files list is included."""
        response = flask_app_test_client.get('/api/skills/test-skill')
        data = response.get_json()
        assert "files" in data


class TestCreateSkillEndpoint:
    """Tests for POST /api/skills endpoint in app."""

    def test_creates_skill(self, flask_app_test_client, temp_skills_dir):
        """Test creating a new skill."""
        response = flask_app_test_client.post('/api/skills',
            json={
                "name": "new-skill",
                "description": "A new skill",
                "content": "# New Skill"
            }
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["success"] is True

    def test_requires_name(self, flask_app_test_client):
        """Test that name is required."""
        response = flask_app_test_client.post('/api/skills',
            json={"description": "No name"}
        )
        assert response.status_code == 400

    def test_prevents_duplicates(self, flask_app_test_client, sample_skill):
        """Test duplicate prevention."""
        response = flask_app_test_client.post('/api/skills',
            json={"name": "test-skill", "description": "Duplicate"}
        )
        assert response.status_code == 409


class TestUpdateSkillEndpoint:
    """Tests for PUT /api/skills/<name> endpoint in app."""

    def test_updates_skill(self, flask_app_test_client, sample_skill):
        """Test updating a skill."""
        response = flask_app_test_client.put('/api/skills/test-skill',
            json={
                "description": "Updated",
                "content": "# Updated"
            }
        )
        assert response.status_code == 200

    def test_returns_404_for_missing(self, flask_app_test_client, temp_skills_dir):
        """Test 404 for missing skill."""
        response = flask_app_test_client.put('/api/skills/nonexistent',
            json={"description": "Test"}
        )
        assert response.status_code == 404


class TestDeleteSkillEndpoint:
    """Tests for DELETE /api/skills/<name> endpoint in app."""

    def test_deletes_skill(self, flask_app_test_client, sample_skill, temp_skills_dir):
        """Test deleting a skill."""
        response = flask_app_test_client.delete('/api/skills/test-skill')
        assert response.status_code == 200
        assert not (temp_skills_dir / "test-skill").exists()

    def test_returns_404_for_missing(self, flask_app_test_client, temp_skills_dir):
        """Test 404 for missing skill."""
        response = flask_app_test_client.delete('/api/skills/nonexistent')
        assert response.status_code == 404


class TestImportFolderEndpoint:
    """Tests for POST /api/import/folder endpoint in app."""

    def test_imports_folder(self, flask_app_test_client, temp_skills_dir, tmp_path):
        """Test importing a folder."""
        source = tmp_path / "import-me"
        source.mkdir()
        (source / "SKILL.md").write_text("# Imported")

        response = flask_app_test_client.post('/api/import/folder',
            json={"path": str(source)}
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["success"] is True

    def test_requires_path(self, flask_app_test_client):
        """Test that path is required."""
        response = flask_app_test_client.post('/api/import/folder', json={})
        assert response.status_code == 400

    def test_returns_404_for_invalid_path(self, flask_app_test_client):
        """Test 404 for invalid path."""
        response = flask_app_test_client.post('/api/import/folder',
            json={"path": "/nonexistent"}
        )
        assert response.status_code == 404

    def test_creates_missing_files(self, flask_app_test_client, temp_skills_dir, tmp_path):
        """Test creation of missing required files."""
        source = tmp_path / "no-skill-md"
        source.mkdir()

        response = flask_app_test_client.post('/api/import/folder',
            json={"path": str(source)}
        )
        assert response.status_code == 200

        skill_dir = temp_skills_dir / "no-skill-md"
        assert (skill_dir / "SKILL.md").exists()
        assert (skill_dir / "_meta.json").exists()


class TestImportJsonEndpoint:
    """Tests for POST /api/import/json endpoint in app."""

    def test_imports_files(self, flask_app_test_client, temp_skills_dir):
        """Test importing files via JSON."""
        response = flask_app_test_client.post('/api/import/json',
            json={
                "skill_name": "json-skill",
                "files": [
                    {"path": "SKILL.md", "content": "# JSON Skill"}
                ]
            }
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["success"] is True

    def test_imports_base64(self, flask_app_test_client, temp_skills_dir):
        """Test importing base64 encoded content."""
        content = base64.b64encode(b"Binary data").decode()
        response = flask_app_test_client.post('/api/import/json',
            json={
                "skill_name": "binary-skill",
                "files": [
                    {"path": "data.bin", "content": content, "base64": True}
                ]
            }
        )
        assert response.status_code == 200

    def test_requires_skill_name(self, flask_app_test_client):
        """Test that skill_name is required."""
        response = flask_app_test_client.post('/api/import/json',
            json={"files": []}
        )
        assert response.status_code == 400

    def test_prevents_path_traversal(self, flask_app_test_client, temp_skills_dir):
        """Test path traversal prevention."""
        response = flask_app_test_client.post('/api/import/json',
            json={
                "skill_name": "safe",
                "files": [
                    {"path": "../../../etc/passwd", "content": "bad"}
                ]
            }
        )
        # Should succeed but skip the bad file
        assert response.status_code == 200
        data = response.get_json()
        assert len(data["files_imported"]) == 0


class TestBrowseFilesystemEndpoint:
    """Tests for GET /api/browse endpoint in app."""

    def test_browses_directory(self, flask_app_test_client, tmp_path):
        """Test browsing a directory."""
        (tmp_path / "subdir").mkdir()
        (tmp_path / "file.txt").write_text("content")

        response = flask_app_test_client.get(f'/api/browse?path={tmp_path}')
        assert response.status_code == 200
        data = response.get_json()
        assert "dirs" in data
        assert "files" in data

    def test_returns_parent(self, flask_app_test_client, tmp_path):
        """Test parent path is returned."""
        subdir = tmp_path / "sub"
        subdir.mkdir()

        response = flask_app_test_client.get(f'/api/browse?path={subdir}')
        data = response.get_json()
        assert data["parent"] == str(tmp_path)

    def test_returns_404_for_missing(self, flask_app_test_client):
        """Test 404 for missing path."""
        response = flask_app_test_client.get('/api/browse?path=/nonexistent')
        assert response.status_code == 404

    def test_identifies_skills(self, flask_app_test_client, tmp_path):
        """Test skill folder identification."""
        skill_dir = tmp_path / "a-skill"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text("# Skill")

        response = flask_app_test_client.get(f'/api/browse?path={tmp_path}')
        data = response.get_json()
        skill_entry = next(d for d in data["dirs"] if d["name"] == "a-skill")
        assert skill_entry["is_skill"] is True


class TestClaudeStatusEndpoint:
    """Tests for GET /api/claude/status endpoint in app."""

    def test_available(self, flask_app_test_client):
        """Test when CLI is available."""
        with patch('skills_manager_app.find_claude_cli', return_value='/usr/bin/claude'):
            with patch('subprocess.run') as mock_run:
                mock_run.return_value.stdout = "Claude 1.0"
                mock_run.return_value.stderr = ""
                response = flask_app_test_client.get('/api/claude/status')
                assert response.status_code == 200
                data = response.get_json()
                assert data["available"] is True

    def test_unavailable(self, flask_app_test_client):
        """Test when CLI is not available."""
        with patch('skills_manager_app.find_claude_cli', return_value=None):
            response = flask_app_test_client.get('/api/claude/status')
            data = response.get_json()
            assert data["available"] is False


class TestClaudeRunEndpoint:
    """Tests for POST /api/claude/run endpoint in app."""

    def test_runs_prompt(self, flask_app_test_client):
        """Test running a prompt."""
        with patch('skills_manager_app.find_claude_cli', return_value='/usr/bin/claude'):
            with patch('subprocess.run') as mock_run:
                mock_run.return_value.stdout = "Response"
                mock_run.return_value.stderr = ""
                response = flask_app_test_client.post('/api/claude/run',
                    json={"prompt": "Test"}
                )
                assert response.status_code == 200
                data = response.get_json()
                assert data["success"] is True

    def test_includes_context(self, flask_app_test_client):
        """Test skill context is included."""
        with patch('skills_manager_app.find_claude_cli', return_value='/usr/bin/claude'):
            with patch('subprocess.run') as mock_run:
                mock_run.return_value.stdout = "Response"
                mock_run.return_value.stderr = ""
                response = flask_app_test_client.post('/api/claude/run',
                    json={
                        "prompt": "Help",
                        "skill_context": "Context here"
                    }
                )
                assert response.status_code == 200
                # Verify context was in the command
                call_args = mock_run.call_args[0][0]
                assert "Context here" in call_args[2]

    def test_returns_404_without_cli(self, flask_app_test_client):
        """Test 404 when CLI not found."""
        with patch('skills_manager_app.find_claude_cli', return_value=None):
            response = flask_app_test_client.post('/api/claude/run',
                json={"prompt": "Test"}
            )
            assert response.status_code == 404

    def test_handles_timeout(self, flask_app_test_client):
        """Test timeout handling."""
        import subprocess
        with patch('skills_manager_app.find_claude_cli', return_value='/usr/bin/claude'):
            with patch('subprocess.run', side_effect=subprocess.TimeoutExpired('cmd', 120)):
                response = flask_app_test_client.post('/api/claude/run',
                    json={"prompt": "Test"}
                )
                assert response.status_code == 408


class TestClaudeGenerateSkillEndpoint:
    """Tests for POST /api/claude/generate-skill endpoint in app."""

    def test_generates_skill(self, flask_app_test_client):
        """Test skill generation."""
        with patch('skills_manager_app.find_claude_cli', return_value='/usr/bin/claude'):
            with patch('subprocess.run') as mock_run:
                mock_run.return_value.stdout = """---
name: generated
description: Generated skill
---
# Generated"""
                mock_run.return_value.stderr = ""
                response = flask_app_test_client.post('/api/claude/generate-skill',
                    json={"idea": "A test skill"}
                )
                assert response.status_code == 200
                data = response.get_json()
                assert data["success"] is True
                assert "skill" in data

    def test_requires_idea(self, flask_app_test_client):
        """Test that idea is required."""
        with patch('skills_manager_app.find_claude_cli', return_value='/usr/bin/claude'):
            response = flask_app_test_client.post('/api/claude/generate-skill',
                json={}
            )
            assert response.status_code == 400

    def test_returns_404_without_cli(self, flask_app_test_client):
        """Test 404 when CLI not found."""
        with patch('skills_manager_app.find_claude_cli', return_value=None):
            response = flask_app_test_client.post('/api/claude/generate-skill',
                json={"idea": "Test"}
            )
            assert response.status_code == 404


class TestReloadEndpoint:
    """Tests for POST /api/reload endpoint in app."""

    def test_reload(self, flask_app_test_client):
        """Test reload endpoint."""
        response = flask_app_test_client.post('/api/reload')
        assert response.status_code == 200
        data = response.get_json()
        assert data["success"] is True


class TestIntegrationScenarios:
    """Integration tests for common usage scenarios."""

    def test_create_and_retrieve_skill(self, flask_app_test_client, temp_skills_dir):
        """Test creating a skill and retrieving it."""
        # Create
        create_response = flask_app_test_client.post('/api/skills',
            json={
                "name": "integration-test",
                "description": "Integration test skill",
                "content": "# Integration Test\n\nTest content."
            }
        )
        assert create_response.status_code == 200

        # List and find it
        list_response = flask_app_test_client.get('/api/skills')
        skills = list_response.get_json()["skills"]
        assert any(s["name"] == "integration-test" for s in skills)

        # Get specific
        get_response = flask_app_test_client.get('/api/skills/integration-test')
        assert get_response.status_code == 200
        skill = get_response.get_json()
        assert skill["description"] == "Integration test skill"

    def test_update_and_verify(self, flask_app_test_client, sample_skill, temp_skills_dir):
        """Test updating a skill and verifying changes."""
        # Update
        update_response = flask_app_test_client.put('/api/skills/test-skill',
            json={
                "description": "Updated description",
                "content": "# Updated Content",
                "tags": ["updated"]
            }
        )
        assert update_response.status_code == 200

        # Verify
        get_response = flask_app_test_client.get('/api/skills/test-skill')
        skill = get_response.get_json()
        assert skill["description"] == "Updated description"
        assert "Updated Content" in skill["content"]

    def test_import_and_list(self, flask_app_test_client, temp_skills_dir, tmp_path):
        """Test importing a skill and listing it."""
        # Create source
        source = tmp_path / "imported-skill"
        source.mkdir()
        (source / "SKILL.md").write_text("# Imported Skill")
        (source / "_meta.json").write_text(json.dumps({
            "name": "imported-skill",
            "description": "An imported skill",
            "tags": ["imported"]
        }))

        # Import
        import_response = flask_app_test_client.post('/api/import/folder',
            json={"path": str(source)}
        )
        assert import_response.status_code == 200

        # List and find
        list_response = flask_app_test_client.get('/api/skills')
        skills = list_response.get_json()["skills"]
        assert any(s["name"] == "imported-skill" for s in skills)

    def test_create_update_delete(self, flask_app_test_client, temp_skills_dir):
        """Test full lifecycle: create, update, delete."""
        # Create
        flask_app_test_client.post('/api/skills',
            json={"name": "lifecycle-test", "description": "Test"}
        )

        # Verify exists
        assert flask_app_test_client.get('/api/skills/lifecycle-test').status_code == 200

        # Update
        flask_app_test_client.put('/api/skills/lifecycle-test',
            json={"description": "Updated"}
        )

        # Delete
        delete_response = flask_app_test_client.delete('/api/skills/lifecycle-test')
        assert delete_response.status_code == 200

        # Verify deleted
        assert flask_app_test_client.get('/api/skills/lifecycle-test').status_code == 404
