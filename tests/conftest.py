# conftest.py - Shared fixtures for Skills MCP tests
import pytest
import json
import tempfile
import shutil
from pathlib import Path
from unittest.mock import patch, MagicMock
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.fixture
def temp_skills_dir(tmp_path):
    """Create a temporary skills directory with test skills."""
    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()
    return skills_dir


@pytest.fixture
def sample_skill(temp_skills_dir):
    """Create a sample skill for testing."""
    skill_dir = temp_skills_dir / "test-skill"
    skill_dir.mkdir()

    # Create SKILL.md
    skill_md = skill_dir / "SKILL.md"
    skill_md.write_text("""---
name: test-skill
description: A test skill for unit testing
---

# Test Skill

## Overview
This is a test skill used for unit testing the Skills MCP server.

## When to Use
- When running unit tests
- When testing skill loading

## Quick Start
```python
# Example code
print("Hello, test!")
```

## Best Practices
- Always test your code
- Use meaningful assertions
""", encoding="utf-8")

    # Create _meta.json
    meta = {
        "name": "test-skill",
        "description": "A test skill for unit testing",
        "tags": ["testing", "unit-test", "example"],
        "sub_skills": [
            {
                "name": "advanced-testing",
                "file": "references/advanced.md",
                "triggers": ["pytest", "unittest", "mock"]
            }
        ]
    }
    (skill_dir / "_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    # Create references directory with sub-skill
    refs_dir = skill_dir / "references"
    refs_dir.mkdir()
    (refs_dir / "advanced.md").write_text("""# Advanced Testing

## Mocking
Use unittest.mock for mocking dependencies.

## Fixtures
Use pytest fixtures for test setup.
""", encoding="utf-8")

    # Create scripts directory
    scripts_dir = skill_dir / "scripts"
    scripts_dir.mkdir()
    (scripts_dir / "helper.py").write_text("""# Helper script
def test_helper():
    return True
""", encoding="utf-8")

    return skill_dir


@pytest.fixture
def sample_skill_minimal(temp_skills_dir):
    """Create a minimal skill with only required files."""
    skill_dir = temp_skills_dir / "minimal-skill"
    skill_dir.mkdir()

    (skill_dir / "SKILL.md").write_text("""# Minimal Skill

Just a basic skill.
""", encoding="utf-8")

    meta = {
        "name": "minimal-skill",
        "description": "A minimal test skill"
    }
    (skill_dir / "_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    return skill_dir


@pytest.fixture
def sample_skill_invalid_meta(temp_skills_dir):
    """Create a skill with invalid _meta.json."""
    skill_dir = temp_skills_dir / "invalid-skill"
    skill_dir.mkdir()

    (skill_dir / "SKILL.md").write_text("# Invalid Skill\n", encoding="utf-8")
    (skill_dir / "_meta.json").write_text("{ invalid json }", encoding="utf-8")

    return skill_dir


@pytest.fixture
def sample_skill_missing_meta(temp_skills_dir):
    """Create a skill without _meta.json."""
    skill_dir = temp_skills_dir / "no-meta-skill"
    skill_dir.mkdir()

    (skill_dir / "SKILL.md").write_text("# No Meta Skill\n", encoding="utf-8")

    return skill_dir


@pytest.fixture
def sample_skill_missing_skill_md(temp_skills_dir):
    """Create a skill without SKILL.md."""
    skill_dir = temp_skills_dir / "no-skill-md"
    skill_dir.mkdir()

    meta = {
        "name": "no-skill-md",
        "description": "Skill without SKILL.md"
    }
    (skill_dir / "_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    return skill_dir


@pytest.fixture
def sample_skill_with_frontmatter(temp_skills_dir):
    """Create a skill with YAML frontmatter."""
    skill_dir = temp_skills_dir / "frontmatter-skill"
    skill_dir.mkdir()

    (skill_dir / "SKILL.md").write_text("""---
name: frontmatter-skill
description: A skill with YAML frontmatter
author: Test Author
version: 1.0.0
---

# Frontmatter Skill

This skill has YAML frontmatter.
""", encoding="utf-8")

    meta = {
        "name": "frontmatter-skill",
        "description": "A skill with YAML frontmatter",
        "tags": ["yaml", "frontmatter"]
    }
    (skill_dir / "_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    return skill_dir


@pytest.fixture
def multiple_skills(temp_skills_dir, sample_skill, sample_skill_minimal, sample_skill_with_frontmatter):
    """Create multiple skills for testing searches and listings."""
    # Create a few more skills for variety

    # Forms skill
    forms_dir = temp_skills_dir / "forms"
    forms_dir.mkdir()
    (forms_dir / "SKILL.md").write_text("""# Forms

Building accessible HTML forms with validation.
""", encoding="utf-8")
    forms_meta = {
        "name": "forms",
        "description": "Form building and validation patterns",
        "tags": ["html", "validation", "accessibility"],
        "sub_skills": [
            {"name": "react", "file": "references/react.md", "triggers": ["react form", "useForm"]},
            {"name": "validation", "file": "references/validation.md", "triggers": ["zod", "yup", "validate"]}
        ]
    }
    (forms_dir / "_meta.json").write_text(json.dumps(forms_meta, indent=2), encoding="utf-8")
    refs = forms_dir / "references"
    refs.mkdir()
    (refs / "react.md").write_text("# React Forms\n\nUsing React Hook Form with Zod validation.", encoding="utf-8")
    (refs / "validation.md").write_text("# Form Validation\n\nUsing Zod for schema validation.", encoding="utf-8")

    # Building skill
    building_dir = temp_skills_dir / "building"
    building_dir.mkdir()
    (building_dir / "SKILL.md").write_text("""# Building System

3D building mechanics and placement systems.
""", encoding="utf-8")
    building_meta = {
        "name": "building",
        "description": "3D building and placement systems",
        "tags": ["3d", "game-dev", "placement"]
    }
    (building_dir / "_meta.json").write_text(json.dumps(building_meta, indent=2), encoding="utf-8")

    return temp_skills_dir


@pytest.fixture
def flask_test_client(temp_skills_dir):
    """Create a Flask test client with patched skills directory."""
    # Import and patch the API module
    import skills_manager_api as api

    # Patch the SKILLS_DIR
    original_skills_dir = api.SKILLS_DIR
    api.SKILLS_DIR = temp_skills_dir

    # Create a test client
    api.app.config['TESTING'] = True
    client = api.app.test_client()

    yield client

    # Restore original
    api.SKILLS_DIR = original_skills_dir


@pytest.fixture
def flask_app_test_client(temp_skills_dir):
    """Create a Flask test client for the standalone app."""
    import skills_manager_app as app_module

    # Patch the directories
    original_skills_dir = app_module.SKILLS_DIR
    original_app_dir = app_module.APP_DIR

    app_module.SKILLS_DIR = temp_skills_dir
    app_module.APP_DIR = temp_skills_dir.parent

    app_module.app.config['TESTING'] = True
    client = app_module.app.test_client()

    yield client

    # Restore originals
    app_module.SKILLS_DIR = original_skills_dir
    app_module.APP_DIR = original_app_dir


@pytest.fixture
def mock_claude_cli():
    """Mock the Claude CLI for testing."""
    with patch('shutil.which') as mock_which:
        mock_which.return_value = '/usr/bin/claude'
        yield mock_which


@pytest.fixture
def mock_subprocess():
    """Mock subprocess for Claude CLI calls."""
    with patch('subprocess.run') as mock_run:
        mock_result = MagicMock()
        mock_result.stdout = "Mock Claude response"
        mock_result.stderr = ""
        mock_result.returncode = 0
        mock_run.return_value = mock_result
        yield mock_run


@pytest.fixture
def server_module(temp_skills_dir):
    """Import and configure the server module with test directory."""
    import server
    from collections import deque

    # Save original values
    original_skills_dir = server.SKILLS_DIR
    original_index = server._INDEX
    original_content_index = server._CONTENT_INDEX
    original_file_mtimes = server._FILE_MTIMES
    original_usage_stats = server._USAGE_STATS.copy()

    # Patch for testing
    server.SKILLS_DIR = temp_skills_dir
    server._INDEX = None
    server._CONTENT_INDEX = None
    server._FILE_MTIMES = {}
    server._USAGE_STATS = {
        "tool_calls": {},
        "skill_loads": {},
        "searches": deque(maxlen=100),  # Use deque with maxlen like production
        "start_time": "2024-01-01T00:00:00"
    }

    yield server

    # Restore originals
    server.SKILLS_DIR = original_skills_dir
    server._INDEX = original_index
    server._CONTENT_INDEX = original_content_index
    server._FILE_MTIMES = original_file_mtimes
    server._USAGE_STATS = original_usage_stats
