# test_api.py - Tests for the Flask Skills Manager API
import pytest
import json
import base64
from pathlib import Path
from unittest.mock import patch, MagicMock
import sys

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))


class TestSanitizeName:
    """Tests for sanitize_name function."""

    def test_lowercase(self):
        """Test that names are lowercased."""
        import skills_manager_api as api
        assert api.sanitize_name("MySkill") == "myskill"

    def test_replaces_spaces(self):
        """Test that spaces are replaced with hyphens."""
        import skills_manager_api as api
        assert api.sanitize_name("my skill name") == "my-skill-name"

    def test_replaces_special_chars(self):
        """Test that special characters are replaced and trailing hyphens stripped."""
        import skills_manager_api as api
        assert api.sanitize_name("my_skill@v2!") == "my-skill-v2"

    def test_strips_leading_trailing_hyphens(self):
        """Test that leading/trailing hyphens are stripped."""
        import skills_manager_api as api
        assert api.sanitize_name("--my-skill--") == "my-skill"

    def test_strips_whitespace(self):
        """Test that whitespace is stripped."""
        import skills_manager_api as api
        assert api.sanitize_name("  my-skill  ") == "my-skill"

    def test_allows_numbers(self):
        """Test that numbers are preserved."""
        import skills_manager_api as api
        assert api.sanitize_name("skill123") == "skill123"

    def test_empty_string(self):
        """Test handling of empty string."""
        import skills_manager_api as api
        assert api.sanitize_name("") == ""


class TestFindClaudeCli:
    """Tests for find_claude_cli function."""

    def test_finds_cli_in_path(self):
        """Test finding CLI via shutil.which."""
        import skills_manager_api as api
        with patch('shutil.which') as mock_which:
            mock_which.return_value = '/usr/bin/claude'
            with patch('os.path.exists', return_value=False):
                result = api.find_claude_cli()
                assert result == '/usr/bin/claude'

    def test_finds_cli_in_home(self):
        """Test finding CLI in home directory."""
        import skills_manager_api as api
        with patch('shutil.which', return_value=None):
            with patch('os.path.exists') as mock_exists:
                def exists_side_effect(path):
                    return '.claude' in str(path)
                mock_exists.side_effect = exists_side_effect
                with patch('os.path.expanduser', return_value='/home/user/.claude/claude.exe'):
                    result = api.find_claude_cli()
                    assert result is not None

    def test_returns_none_when_not_found(self):
        """Test returns None when CLI not found."""
        import skills_manager_api as api
        with patch('shutil.which', return_value=None):
            with patch('os.path.exists', return_value=False):
                result = api.find_claude_cli()
                assert result is None


class TestListSkillsEndpoint:
    """Tests for GET /api/skills endpoint."""

    def test_lists_skills(self, flask_test_client, sample_skill):
        """Test listing all skills."""
        response = flask_test_client.get('/api/skills')
        assert response.status_code == 200
        data = response.get_json()
        assert "skills" in data
        assert len(data["skills"]) >= 1

    def test_includes_metadata(self, flask_test_client, sample_skill):
        """Test that skill metadata is included."""
        response = flask_test_client.get('/api/skills')
        data = response.get_json()
        skill = next(s for s in data["skills"] if s["name"] == "test-skill")
        assert "description" in skill
        assert "tags" in skill

    def test_includes_content(self, flask_test_client, sample_skill):
        """Test that skill content is included."""
        response = flask_test_client.get('/api/skills')
        data = response.get_json()
        skill = next(s for s in data["skills"] if s["name"] == "test-skill")
        assert "content" in skill
        assert "Test Skill" in skill["content"]

    def test_includes_file_info(self, flask_test_client, sample_skill):
        """Test that file info is included."""
        response = flask_test_client.get('/api/skills')
        data = response.get_json()
        skill = next(s for s in data["skills"] if s["name"] == "test-skill")
        assert "has_scripts" in skill
        assert "has_references" in skill
        assert "file_count" in skill

    def test_extracts_description_from_frontmatter(self, flask_test_client, sample_skill_with_frontmatter):
        """Test extraction of description from YAML frontmatter."""
        response = flask_test_client.get('/api/skills')
        data = response.get_json()
        skill = next((s for s in data["skills"] if s["name"] == "frontmatter-skill"), None)
        if skill:
            assert skill.get("description") is not None

    def test_empty_skills_directory(self, flask_test_client, temp_skills_dir):
        """Test with empty skills directory."""
        response = flask_test_client.get('/api/skills')
        assert response.status_code == 200
        data = response.get_json()
        assert data["skills"] == []


class TestGetSkillEndpoint:
    """Tests for GET /api/skills/<name> endpoint."""

    def test_gets_skill(self, flask_test_client, sample_skill):
        """Test getting a specific skill."""
        response = flask_test_client.get('/api/skills/test-skill')
        assert response.status_code == 200
        data = response.get_json()
        assert data["name"] == "test-skill"
        assert "content" in data

    def test_returns_404_for_missing_skill(self, flask_test_client, temp_skills_dir):
        """Test 404 for missing skill."""
        response = flask_test_client.get('/api/skills/nonexistent')
        assert response.status_code == 404
        data = response.get_json()
        assert "error" in data

    def test_includes_file_list(self, flask_test_client, sample_skill):
        """Test that file list is included."""
        response = flask_test_client.get('/api/skills/test-skill')
        data = response.get_json()
        assert "files" in data
        assert len(data["files"]) > 0
        assert "SKILL.md" in data["files"]


class TestCreateSkillEndpoint:
    """Tests for POST /api/skills endpoint."""

    def test_creates_skill(self, flask_test_client, temp_skills_dir):
        """Test creating a new skill."""
        response = flask_test_client.post('/api/skills',
            json={
                "name": "New Skill",
                "description": "A new test skill",
                "content": "# New Skill\n\nContent here.",
                "tags": ["new", "test"]
            }
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["success"] is True
        assert data["name"] == "new-skill"

        # Verify files created
        skill_dir = temp_skills_dir / "new-skill"
        assert skill_dir.exists()
        assert (skill_dir / "SKILL.md").exists()
        assert (skill_dir / "_meta.json").exists()

    def test_sanitizes_name(self, flask_test_client, temp_skills_dir):
        """Test that skill name is sanitized."""
        response = flask_test_client.post('/api/skills',
            json={"name": "My New Skill!", "description": "Test"}
        )
        data = response.get_json()
        assert data["name"] == "my-new-skill"

    def test_requires_name(self, flask_test_client, temp_skills_dir):
        """Test that name is required."""
        response = flask_test_client.post('/api/skills',
            json={"description": "No name provided"}
        )
        assert response.status_code == 400
        assert "error" in response.get_json()

    def test_prevents_duplicate_without_overwrite(self, flask_test_client, sample_skill):
        """Test that duplicates are prevented."""
        response = flask_test_client.post('/api/skills',
            json={"name": "test-skill", "description": "Duplicate"}
        )
        assert response.status_code == 409

    def test_allows_overwrite(self, flask_test_client, sample_skill):
        """Test that overwrite flag allows duplicates."""
        response = flask_test_client.post('/api/skills',
            json={
                "name": "test-skill",
                "description": "Overwritten",
                "overwrite": True
            }
        )
        assert response.status_code == 200


class TestUpdateSkillEndpoint:
    """Tests for PUT /api/skills/<name> endpoint."""

    def test_updates_skill(self, flask_test_client, sample_skill, temp_skills_dir):
        """Test updating an existing skill."""
        response = flask_test_client.put('/api/skills/test-skill',
            json={
                "description": "Updated description",
                "content": "# Updated Content"
            }
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["success"] is True

        # Verify changes
        skill_md = temp_skills_dir / "test-skill" / "SKILL.md"
        content = skill_md.read_text()
        assert "Updated Content" in content

    def test_returns_404_for_missing_skill(self, flask_test_client, temp_skills_dir):
        """Test 404 for updating missing skill."""
        response = flask_test_client.put('/api/skills/nonexistent',
            json={"description": "Test"}
        )
        assert response.status_code == 404

    def test_updates_meta(self, flask_test_client, sample_skill, temp_skills_dir):
        """Test that _meta.json is updated."""
        response = flask_test_client.put('/api/skills/test-skill',
            json={
                "description": "New description",
                "tags": ["updated", "tags"]
            }
        )
        assert response.status_code == 200

        meta_file = temp_skills_dir / "test-skill" / "_meta.json"
        meta = json.loads(meta_file.read_text())
        assert meta["description"] == "New description"
        assert "updated" in meta["tags"]


class TestDeleteSkillEndpoint:
    """Tests for DELETE /api/skills/<name> endpoint."""

    def test_deletes_skill(self, flask_test_client, sample_skill, temp_skills_dir):
        """Test deleting a skill."""
        response = flask_test_client.delete('/api/skills/test-skill')
        assert response.status_code == 200
        data = response.get_json()
        assert data["success"] is True

        # Verify deletion
        assert not (temp_skills_dir / "test-skill").exists()

    def test_returns_404_for_missing_skill(self, flask_test_client, temp_skills_dir):
        """Test 404 for deleting missing skill."""
        response = flask_test_client.delete('/api/skills/nonexistent')
        assert response.status_code == 404


class TestImportFolderEndpoint:
    """Tests for POST /api/import/folder endpoint."""

    def test_imports_folder(self, flask_test_client, temp_skills_dir, tmp_path):
        """Test importing a skill from a folder."""
        # Create source folder
        source = tmp_path / "source-skill"
        source.mkdir()
        (source / "SKILL.md").write_text("# Imported\n\nFrom folder.")
        (source / "_meta.json").write_text(json.dumps({
            "name": "source-skill",
            "description": "Imported skill"
        }))

        response = flask_test_client.post('/api/import/folder',
            json={"path": str(source)}
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["success"] is True
        assert data["name"] == "source-skill"

        # Verify import
        assert (temp_skills_dir / "source-skill").exists()

    def test_allows_rename(self, flask_test_client, temp_skills_dir, tmp_path):
        """Test importing with a new name."""
        source = tmp_path / "original-name"
        source.mkdir()
        (source / "SKILL.md").write_text("# Test")

        response = flask_test_client.post('/api/import/folder',
            json={"path": str(source), "name": "renamed-skill"}
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["name"] == "renamed-skill"

    def test_requires_path(self, flask_test_client):
        """Test that path is required."""
        response = flask_test_client.post('/api/import/folder', json={})
        assert response.status_code == 400

    def test_returns_404_for_missing_path(self, flask_test_client):
        """Test 404 for missing source path."""
        response = flask_test_client.post('/api/import/folder',
            json={"path": "/nonexistent/path"}
        )
        assert response.status_code == 404

    def test_requires_directory(self, flask_test_client, tmp_path):
        """Test that path must be a directory."""
        file = tmp_path / "not-a-dir.txt"
        file.write_text("Just a file")

        response = flask_test_client.post('/api/import/folder',
            json={"path": str(file)}
        )
        assert response.status_code == 400

    def test_prevents_duplicate(self, flask_test_client, sample_skill, tmp_path):
        """Test that existing skills aren't overwritten."""
        source = tmp_path / "test-skill"
        source.mkdir()
        (source / "SKILL.md").write_text("# Duplicate")

        response = flask_test_client.post('/api/import/folder',
            json={"path": str(source)}
        )
        assert response.status_code == 409

    def test_creates_missing_skill_md(self, flask_test_client, temp_skills_dir, tmp_path):
        """Test that SKILL.md is created if missing."""
        source = tmp_path / "no-skill-md"
        source.mkdir()
        (source / "other.txt").write_text("Some content")

        response = flask_test_client.post('/api/import/folder',
            json={"path": str(source)}
        )
        assert response.status_code == 200

        skill_md = temp_skills_dir / "no-skill-md" / "SKILL.md"
        assert skill_md.exists()


class TestImportJsonEndpoint:
    """Tests for POST /api/import/json endpoint."""

    def test_imports_files(self, flask_test_client, temp_skills_dir):
        """Test importing files via JSON."""
        response = flask_test_client.post('/api/import/json',
            json={
                "skill_name": "json-import",
                "files": [
                    {"path": "SKILL.md", "content": "# JSON Imported"},
                    {"path": "refs/helper.md", "content": "# Helper"}
                ]
            }
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["success"] is True
        assert len(data["files_imported"]) == 2

        # Verify files
        skill_dir = temp_skills_dir / "json-import"
        assert (skill_dir / "SKILL.md").exists()
        assert (skill_dir / "refs" / "helper.md").exists()

    def test_imports_base64_content(self, flask_test_client, temp_skills_dir):
        """Test importing binary files via base64."""
        binary_content = b"Binary content here"
        encoded = base64.b64encode(binary_content).decode()

        response = flask_test_client.post('/api/import/json',
            json={
                "skill_name": "binary-import",
                "files": [
                    {"path": "data.bin", "content": encoded, "base64": True}
                ]
            }
        )
        assert response.status_code == 200

        data_file = temp_skills_dir / "binary-import" / "data.bin"
        assert data_file.read_bytes() == binary_content

    def test_requires_skill_name(self, flask_test_client):
        """Test that skill_name is required."""
        response = flask_test_client.post('/api/import/json',
            json={"files": []}
        )
        assert response.status_code == 400

    def test_prevents_path_traversal(self, flask_test_client, temp_skills_dir):
        """Test that path traversal is prevented."""
        response = flask_test_client.post('/api/import/json',
            json={
                "skill_name": "traversal-test",
                "files": [
                    {"path": "../../../etc/passwd", "content": "malicious"}
                ]
            }
        )
        # Request succeeds but file is skipped
        assert response.status_code == 200
        data = response.get_json()
        assert len(data["files_imported"]) == 0


class TestBrowseFilesystemEndpoint:
    """Tests for GET /api/browse endpoint."""

    def test_browses_directory(self, flask_test_client, tmp_path):
        """Test browsing a directory."""
        # Create test structure
        (tmp_path / "subdir").mkdir()
        (tmp_path / "file.txt").write_text("content")

        response = flask_test_client.get(f'/api/browse?path={tmp_path}')
        assert response.status_code == 200
        data = response.get_json()
        assert data["path"] == str(tmp_path)
        assert len(data["dirs"]) >= 1
        assert len(data["files"]) >= 1

    def test_returns_parent_path(self, flask_test_client, tmp_path):
        """Test that parent path is returned."""
        subdir = tmp_path / "subdir"
        subdir.mkdir()

        response = flask_test_client.get(f'/api/browse?path={subdir}')
        data = response.get_json()
        assert data["parent"] == str(tmp_path)

    def test_identifies_skill_folders(self, flask_test_client, tmp_path):
        """Test identification of skill folders."""
        skill_dir = tmp_path / "my-skill"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text("# Skill")

        response = flask_test_client.get(f'/api/browse?path={tmp_path}')
        data = response.get_json()
        skill_entry = next(d for d in data["dirs"] if d["name"] == "my-skill")
        assert skill_entry["is_skill"] is True

    def test_hides_hidden_files(self, flask_test_client, tmp_path):
        """Test that hidden files are not listed."""
        (tmp_path / ".hidden").write_text("hidden")
        (tmp_path / "visible.txt").write_text("visible")

        response = flask_test_client.get(f'/api/browse?path={tmp_path}')
        data = response.get_json()
        names = [f["name"] for f in data["files"]]
        assert ".hidden" not in names
        assert "visible.txt" in names

    def test_returns_404_for_missing_path(self, flask_test_client):
        """Test 404 for missing path."""
        response = flask_test_client.get('/api/browse?path=/nonexistent/path')
        assert response.status_code == 404


class TestClaudeStatusEndpoint:
    """Tests for GET /api/claude/status endpoint."""

    def test_returns_available_when_found(self, flask_test_client, mock_subprocess):
        """Test returns available when CLI is found."""
        with patch('skills_manager_api.find_claude_cli', return_value='/usr/bin/claude'):
            response = flask_test_client.get('/api/claude/status')
            assert response.status_code == 200
            data = response.get_json()
            assert data["available"] is True
            assert "path" in data

    def test_returns_unavailable_when_not_found(self, flask_test_client):
        """Test returns unavailable when CLI not found."""
        with patch('skills_manager_api.find_claude_cli', return_value=None):
            response = flask_test_client.get('/api/claude/status')
            assert response.status_code == 200
            data = response.get_json()
            assert data["available"] is False


class TestClaudeRunEndpoint:
    """Tests for POST /api/claude/run endpoint."""

    def test_runs_claude(self, flask_test_client, mock_subprocess):
        """Test running Claude CLI."""
        with patch('skills_manager_api.find_claude_cli', return_value='/usr/bin/claude'):
            response = flask_test_client.post('/api/claude/run',
                json={"prompt": "Hello Claude"}
            )
            assert response.status_code == 200
            data = response.get_json()
            assert data["success"] is True
            assert "stdout" in data

    def test_includes_skill_context(self, flask_test_client, mock_subprocess):
        """Test that skill context is included in prompt."""
        with patch('skills_manager_api.find_claude_cli', return_value='/usr/bin/claude'):
            response = flask_test_client.post('/api/claude/run',
                json={
                    "prompt": "Help me",
                    "skill_context": "Some skill content"
                }
            )
            assert response.status_code == 200
            # Verify context was passed
            call_args = mock_subprocess.call_args
            full_prompt = call_args[0][0][2]  # Third arg in command list
            assert "skill context" in full_prompt.lower()

    def test_returns_404_when_cli_not_found(self, flask_test_client):
        """Test 404 when CLI not found."""
        with patch('skills_manager_api.find_claude_cli', return_value=None):
            response = flask_test_client.post('/api/claude/run',
                json={"prompt": "Test"}
            )
            assert response.status_code == 404

    def test_handles_timeout(self, flask_test_client):
        """Test handling of timeout."""
        import subprocess
        with patch('skills_manager_api.find_claude_cli', return_value='/usr/bin/claude'):
            with patch('subprocess.run', side_effect=subprocess.TimeoutExpired('cmd', 120)):
                response = flask_test_client.post('/api/claude/run',
                    json={"prompt": "Test"}
                )
                assert response.status_code == 408


class TestClaudeGenerateSkillEndpoint:
    """Tests for POST /api/claude/generate-skill endpoint."""

    def test_generates_skill(self, flask_test_client, mock_subprocess):
        """Test generating a skill."""
        mock_subprocess.return_value.stdout = """---
name: generated-skill
description: A generated skill
---

# Generated Skill

Content here.
"""
        with patch('skills_manager_api.find_claude_cli', return_value='/usr/bin/claude'):
            response = flask_test_client.post('/api/claude/generate-skill',
                json={"idea": "A skill for testing"}
            )
            assert response.status_code == 200
            data = response.get_json()
            assert data["success"] is True
            assert "skill" in data
            assert data["skill"]["name"] == "generated-skill"

    def test_requires_idea(self, flask_test_client):
        """Test that idea is required."""
        with patch('skills_manager_api.find_claude_cli', return_value='/usr/bin/claude'):
            response = flask_test_client.post('/api/claude/generate-skill',
                json={}
            )
            assert response.status_code == 400

    def test_returns_404_when_cli_not_found(self, flask_test_client):
        """Test 404 when CLI not found."""
        with patch('skills_manager_api.find_claude_cli', return_value=None):
            response = flask_test_client.post('/api/claude/generate-skill',
                json={"idea": "Test"}
            )
            assert response.status_code == 404


class TestClaudeImproveSkillEndpoint:
    """Tests for POST /api/claude/improve-skill endpoint."""

    def test_improves_skill(self, flask_test_client, sample_skill, mock_subprocess):
        """Test improving a skill."""
        mock_subprocess.return_value.stdout = "# Improved Content"
        with patch('skills_manager_api.find_claude_cli', return_value='/usr/bin/claude'):
            response = flask_test_client.post('/api/claude/improve-skill',
                json={
                    "skill_name": "test-skill",
                    "request": "Add more examples"
                }
            )
            assert response.status_code == 200
            data = response.get_json()
            assert data["success"] is True
            assert "improved_content" in data
            assert "original_content" in data

    def test_returns_404_for_missing_skill(self, flask_test_client, temp_skills_dir):
        """Test 404 for missing skill."""
        with patch('skills_manager_api.find_claude_cli', return_value='/usr/bin/claude'):
            response = flask_test_client.post('/api/claude/improve-skill',
                json={
                    "skill_name": "nonexistent",
                    "request": "Improve"
                }
            )
            assert response.status_code == 404


class TestReloadEndpoint:
    """Tests for POST /api/reload endpoint."""

    def test_reloads_index(self, flask_test_client):
        """Test reloading the index."""
        response = flask_test_client.post('/api/reload')
        assert response.status_code == 200
        data = response.get_json()
        assert data["success"] is True
