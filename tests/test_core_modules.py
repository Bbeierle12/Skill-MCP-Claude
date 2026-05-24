"""
Tests for core/browse.py and additional edge cases in core/skills.py.

These cover:
  - browse: invalid paths, paths outside skills dir, permission errors,
    file (not directory) targets, missing paths.
  - skills.py:
      * list_all_skills: invalid metadata recovery (logged warning), missing
        files (logged warning), excludes plain files.
      * get_skill_by_name: invalid name / invalid path / unreadable meta.
      * create_skill: empty after sanitization, overwrite=True.
      * update_skill: invalid existing metadata.
      * import_folder: rejects file paths, cleanup on failure.
      * import_files_json: null-byte rejection, oversize rejection,
        disallowed extension, absolute path rejection.
"""

import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import core.config as config  # noqa: E402
from core import browse, skills  # noqa: E402


@pytest.fixture
def patched_skills_dir(tmp_path):
    """Patch core.config to use a temporary skills directory."""
    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()
    original = config._skills_dir
    config._skills_dir = skills_dir
    yield skills_dir
    config._skills_dir = original


# ---------------------------------------------------------------------------
# browse_skills_directory
# ---------------------------------------------------------------------------

class TestBrowseRoot:
    def test_browse_empty_root(self, patched_skills_dir):
        result, err = browse.browse_skills_directory()
        assert err is None
        assert result["path"] == ""
        assert result["parent"] is None
        assert result["dirs"] == []
        assert result["files"] == []
        assert result["restricted"] is True

    def test_browse_marks_skill_folders(self, patched_skills_dir):
        sk = patched_skills_dir / "a-skill"
        sk.mkdir()
        (sk / "SKILL.md").write_text("# x", encoding="utf-8")
        non_skill = patched_skills_dir / "not-a-skill"
        non_skill.mkdir()
        result, err = browse.browse_skills_directory()
        assert err is None
        by_name = {d["name"]: d for d in result["dirs"]}
        assert by_name["a-skill"]["is_skill"] is True
        assert by_name["not-a-skill"]["is_skill"] is False


class TestBrowseTraversal:
    def test_rejects_dotdot(self, patched_skills_dir):
        result, err = browse.browse_skills_directory("../etc")
        assert result is None
        assert "traversal" in err.lower()

    def test_rejects_dotdot_nested(self, patched_skills_dir):
        result, err = browse.browse_skills_directory("a/../../etc")
        assert result is None
        assert "traversal" in err.lower()


class TestBrowseEdgeCases:
    def test_returns_error_for_missing_path(self, patched_skills_dir):
        result, err = browse.browse_skills_directory("does-not-exist")
        assert result is None
        assert "not found" in err.lower()

    def test_returns_error_for_file_not_directory(self, patched_skills_dir):
        f = patched_skills_dir / "afile.txt"
        f.write_text("x")
        result, err = browse.browse_skills_directory("afile.txt")
        assert result is None
        assert "not a directory" in err.lower()

    def test_hidden_files_are_skipped(self, patched_skills_dir):
        (patched_skills_dir / ".hidden").write_text("x")
        (patched_skills_dir / "visible.txt").write_text("x")
        result, err = browse.browse_skills_directory()
        assert err is None
        names = [f["name"] for f in result["files"]]
        assert "visible.txt" in names
        assert ".hidden" not in names

    def test_parent_calculation_for_nested(self, patched_skills_dir):
        nested = patched_skills_dir / "skill-a" / "nested"
        nested.mkdir(parents=True)
        result, err = browse.browse_skills_directory("skill-a/nested")
        assert err is None
        assert result["parent"] == "skill-a"

    def test_parent_empty_for_top_level_dir(self, patched_skills_dir):
        (patched_skills_dir / "skill-a").mkdir()
        result, err = browse.browse_skills_directory("skill-a")
        assert err is None
        # Direct child of skills dir: parent is empty string
        assert result["parent"] == ""

    def test_handles_resolve_exception(self, patched_skills_dir):
        # Force resolve() to raise to hit the "Invalid path" branch
        with patch.object(Path, "resolve", side_effect=OSError("bad path")):
            result, err = browse.browse_skills_directory("anything")
        assert result is None
        assert err == "Invalid path"

    def test_handles_permission_error_on_iterdir(self, patched_skills_dir):
        with patch.object(Path, "iterdir", side_effect=PermissionError("no")):
            result, err = browse.browse_skills_directory()
        assert result is None
        assert "permission" in err.lower()


# ---------------------------------------------------------------------------
# core/skills.py — additional edge case coverage
# ---------------------------------------------------------------------------

class TestListAllSkillsEdgeCases:
    def test_returns_empty_when_dir_missing(self, tmp_path):
        # Simulate the directory not existing by pointing at a path
        # that's never created. We bypass auto-create by manipulating cache.
        nonexistent = tmp_path / "nope"
        original = config._skills_dir
        config._skills_dir = nonexistent
        try:
            result = skills.list_all_skills()
        finally:
            config._skills_dir = original
        assert result == []

    def test_skips_non_directories(self, patched_skills_dir):
        # A plain file in skills dir should be ignored
        (patched_skills_dir / "not-a-skill.txt").write_text("hi")
        result = skills.list_all_skills()
        assert result == []

    def test_recovers_from_invalid_metadata(self, patched_skills_dir):
        sk = patched_skills_dir / "bad-meta"
        sk.mkdir()
        (sk / "SKILL.md").write_text(
            "---\ndescription: from frontmatter\n---\n# Bad\n", encoding="utf-8"
        )
        (sk / "_meta.json").write_text("{ not valid json", encoding="utf-8")
        result = skills.list_all_skills()
        # The bad metadata is skipped, but the skill is still returned with
        # description pulled from the SKILL.md frontmatter
        assert len(result) == 1
        assert result[0]["name"] == "bad-meta"
        assert result[0]["description"] == "from frontmatter"


class TestGetSkillByNameEdgeCases:
    def test_rejects_invalid_name(self, patched_skills_dir):
        data, err = skills.get_skill_by_name("../bad")
        assert data is None
        assert "invalid" in err.lower()

    def test_returns_404_for_missing(self, patched_skills_dir):
        data, err = skills.get_skill_by_name("ghost")
        assert data is None
        assert "not found" in err.lower()

    def test_recovers_from_bad_meta(self, patched_skills_dir):
        sk = patched_skills_dir / "ok"
        sk.mkdir()
        (sk / "SKILL.md").write_text("# OK", encoding="utf-8")
        (sk / "_meta.json").write_text("{ broken", encoding="utf-8")
        data, err = skills.get_skill_by_name("ok")
        assert err is None
        assert data["name"] == "ok"
        assert "SKILL.md" in data["files"]


class TestCreateSkillEdgeCases:
    def test_rejects_name_that_sanitizes_to_empty(self, patched_skills_dir):
        data, err = skills.create_skill("!!!")
        assert data is None
        assert "required" in err.lower()

    def test_overwrite_true_replaces(self, patched_skills_dir):
        skills.create_skill("foo", description="first")
        data, err = skills.create_skill(
            "foo", description="second", overwrite=True
        )
        assert err is None
        skill_md = (patched_skills_dir / "foo" / "SKILL.md").read_text()
        assert "description: second" in skill_md

    def test_rejects_empty_description(self, patched_skills_dir):
        # The canonical contract forbids an empty description; creation must fail
        # loudly and write nothing.
        data, err = skills.create_skill("good-name", description="")
        assert data is None
        assert "Invalid skill metadata" in err
        assert "description" in err
        assert not (patched_skills_dir / "good-name").exists()

    def test_rejects_string_sub_skills(self, patched_skills_dir):
        # sub_skills entries must be objects, not bare strings.
        data, err = skills.create_skill(
            "good-name", description="A valid description", sub_skills=["just-a-string"]
        )
        assert data is None
        assert "Invalid skill metadata" in err
        assert not (patched_skills_dir / "good-name").exists()


class TestUpdateSkillEdgeCases:
    def test_recovers_from_bad_existing_meta(self, patched_skills_dir):
        sk = patched_skills_dir / "x"
        sk.mkdir()
        (sk / "SKILL.md").write_text("# X", encoding="utf-8")
        (sk / "_meta.json").write_text("{ corrupt", encoding="utf-8")
        data, err = skills.update_skill("x", description="new")
        assert err is None
        meta = json.loads((sk / "_meta.json").read_text())
        assert meta["description"] == "new"
        # tags defaults to [] when there was no recoverable previous value
        assert meta["tags"] == []

    def test_tags_only_update_preserves_description(self, patched_skills_dir):
        # A tags-only update must not blank an existing description.
        skills.create_skill("keep-desc", description="Original description")
        data, err = skills.update_skill("keep-desc", tags=["new-tag"])
        assert err is None
        meta = json.loads((patched_skills_dir / "keep-desc" / "_meta.json").read_text())
        assert meta["description"] == "Original description"
        assert meta["tags"] == ["new-tag"]

    def test_rejects_update_that_produces_invalid_meta(self, patched_skills_dir):
        # Existing meta has no description and none is provided -> merged meta is
        # invalid, so the update is refused and the file left unchanged.
        sk = patched_skills_dir / "no-desc"
        sk.mkdir()
        (sk / "SKILL.md").write_text("# no-desc", encoding="utf-8")
        (sk / "_meta.json").write_text('{"name": "no-desc"}', encoding="utf-8")
        data, err = skills.update_skill("no-desc", tags=["x"])
        assert data is None
        assert "Invalid skill metadata" in err
        # File must be untouched.
        assert json.loads((sk / "_meta.json").read_text()) == {"name": "no-desc"}


class TestImportFolderEdgeCases:
    def test_requires_source_path(self, patched_skills_dir):
        data, err = skills.import_folder("")
        assert data is None
        assert "required" in err.lower()

    def test_rejects_missing_source(self, patched_skills_dir, tmp_path):
        data, err = skills.import_folder(str(tmp_path / "ghost"))
        assert data is None
        assert "not found" in err.lower()

    def test_rejects_file_source(self, patched_skills_dir, tmp_path):
        f = tmp_path / "file.txt"
        f.write_text("x")
        data, err = skills.import_folder(str(f))
        assert data is None
        assert "must be a directory" in err.lower()

    def test_rejects_duplicate(self, patched_skills_dir, tmp_path):
        src = tmp_path / "src-skill"
        src.mkdir()
        (src / "SKILL.md").write_text("# x", encoding="utf-8")
        (patched_skills_dir / "src-skill").mkdir()
        data, err = skills.import_folder(str(src))
        assert data is None
        assert "already exists" in err.lower()

    def test_creates_missing_skill_md_and_meta(self, patched_skills_dir, tmp_path):
        src = tmp_path / "raw"
        src.mkdir()
        (src / "note.txt").write_text("hi")
        data, err = skills.import_folder(str(src))
        assert err is None
        assert (patched_skills_dir / "raw" / "SKILL.md").exists()
        assert (patched_skills_dir / "raw" / "_meta.json").exists()

    def test_cleans_up_on_failure(self, patched_skills_dir, tmp_path):
        src = tmp_path / "src"
        src.mkdir()
        (src / "SKILL.md").write_text("# x", encoding="utf-8")
        # Make copytree fail mid-copy
        with patch("core.skills.shutil.copytree", side_effect=OSError("disk full")):
            data, err = skills.import_folder(str(src))
        assert data is None
        assert "disk full" in err
        # Destination should not be left around
        assert not (patched_skills_dir / "src").exists()


class TestImportFilesJsonEdgeCases:
    def test_requires_skill_name(self, patched_skills_dir):
        data, err = skills.import_files_json("", [])
        assert data is None
        assert "required" in err.lower()

    def test_rejects_invalid_name(self, patched_skills_dir):
        data, err = skills.import_files_json("!!!", [])
        assert data is None
        assert "invalid" in err.lower()

    def test_skips_files_with_disallowed_extension(self, patched_skills_dir):
        data, err = skills.import_files_json(
            "skill-a",
            [{"path": "evil.exe", "content": "MZ..."}],
        )
        assert err is None
        # Disallowed extension is skipped
        assert data["files_imported"] == []

    def test_skips_files_with_null_bytes(self, patched_skills_dir):
        data, err = skills.import_files_json(
            "skill-a",
            [{"path": "bad.md", "content": "before\x00after"}],
        )
        assert err is None
        assert data["files_imported"] == []

    def test_skips_absolute_paths(self, patched_skills_dir):
        data, err = skills.import_files_json(
            "skill-a",
            [{"path": "/etc/passwd", "content": "hi"}],
        )
        assert err is None
        assert data["files_imported"] == []

    def test_imports_text_file(self, patched_skills_dir):
        data, err = skills.import_files_json(
            "skill-a",
            [{"path": "SKILL.md", "content": "# hi"}],
        )
        assert err is None
        assert "SKILL.md" in data["files_imported"]
        assert (
            patched_skills_dir / "skill-a" / "SKILL.md"
        ).read_text() == "# hi"

    def test_imports_base64_file(self, patched_skills_dir):
        import base64 as b64
        encoded = b64.b64encode(b"hello").decode()
        data, err = skills.import_files_json(
            "skill-a",
            [{"path": "data.txt", "content": encoded, "base64": True}],
        )
        assert err is None
        assert "data.txt" in data["files_imported"]
        assert (
            patched_skills_dir / "skill-a" / "data.txt"
        ).read_bytes() == b"hello"

    def test_base64_with_null_bytes_rejected(self, patched_skills_dir):
        import base64 as b64
        encoded = b64.b64encode(b"a\x00b").decode()
        data, err = skills.import_files_json(
            "skill-a",
            [{"path": "data.txt", "content": encoded, "base64": True}],
        )
        assert err is None
        assert data["files_imported"] == []
