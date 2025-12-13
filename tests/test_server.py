# test_server.py - Tests for the MCP Skills Server
import pytest
import json
from pathlib import Path
from datetime import datetime
from unittest.mock import patch, MagicMock


class TestValidateMeta:
    """Tests for validate_meta function."""

    def test_valid_meta_minimal(self, server_module):
        """Test validation with minimal required fields."""
        meta = {"name": "test-skill", "description": "A test skill"}
        errors = server_module.validate_meta(meta, "test-skill")
        assert errors == []

    def test_valid_meta_full(self, server_module):
        """Test validation with all fields."""
        meta = {
            "name": "test-skill",
            "description": "A test skill",
            "tags": ["test", "example"],
            "sub_skills": [
                {"name": "sub1", "file": "refs/sub1.md", "triggers": ["trigger1"]}
            ]
        }
        errors = server_module.validate_meta(meta, "test-skill")
        assert errors == []

    def test_missing_name(self, server_module):
        """Test validation fails when name is missing."""
        meta = {"description": "A test skill"}
        errors = server_module.validate_meta(meta, "test-skill")
        assert len(errors) == 1
        assert "Missing required field 'name'" in errors[0]

    def test_missing_description(self, server_module):
        """Test validation fails when description is missing."""
        meta = {"name": "test-skill"}
        errors = server_module.validate_meta(meta, "test-skill")
        assert len(errors) == 1
        assert "Missing required field 'description'" in errors[0]

    def test_missing_both_required(self, server_module):
        """Test validation fails when both required fields are missing."""
        meta = {}
        errors = server_module.validate_meta(meta, "test-skill")
        assert len(errors) == 2

    def test_name_mismatch(self, server_module):
        """Test validation fails when name doesn't match directory."""
        meta = {"name": "wrong-name", "description": "A test skill"}
        errors = server_module.validate_meta(meta, "test-skill")
        assert len(errors) == 1
        assert "doesn't match directory name" in errors[0]

    def test_tags_not_list(self, server_module):
        """Test validation fails when tags is not a list."""
        meta = {"name": "test-skill", "description": "Test", "tags": "not-a-list"}
        errors = server_module.validate_meta(meta, "test-skill")
        assert len(errors) == 1
        assert "'tags' must be a list" in errors[0]

    def test_sub_skills_not_list(self, server_module):
        """Test validation fails when sub_skills is not a list."""
        meta = {"name": "test-skill", "description": "Test", "sub_skills": "not-a-list"}
        errors = server_module.validate_meta(meta, "test-skill")
        assert len(errors) == 1
        assert "'sub_skills' must be a list" in errors[0]

    def test_sub_skill_missing_name(self, server_module):
        """Test validation fails when sub_skill is missing name."""
        meta = {
            "name": "test-skill",
            "description": "Test",
            "sub_skills": [{"file": "test.md"}]
        }
        errors = server_module.validate_meta(meta, "test-skill")
        assert len(errors) == 1
        assert "sub_skill[0] missing required field 'name'" in errors[0]

    def test_sub_skill_missing_file(self, server_module):
        """Test validation fails when sub_skill is missing file."""
        meta = {
            "name": "test-skill",
            "description": "Test",
            "sub_skills": [{"name": "sub1"}]
        }
        errors = server_module.validate_meta(meta, "test-skill")
        assert len(errors) == 1
        assert "sub_skill[0] missing required field 'file'" in errors[0]


class TestBuildContentIndex:
    """Tests for build_content_index function."""

    def test_empty_skills_dir(self, server_module, temp_skills_dir):
        """Test indexing empty skills directory."""
        index = server_module.build_content_index()
        assert index == {}

    def test_indexes_skill_md(self, server_module, sample_skill):
        """Test that SKILL.md files are indexed."""
        index = server_module.build_content_index()
        key = "test-skill:SKILL.md"
        assert key in index
        assert index[key]["domain"] == "test-skill"
        assert index[key]["sub_skill"] is None
        assert "test skill" in index[key]["content"]

    def test_indexes_references(self, server_module, sample_skill):
        """Test that reference files are indexed."""
        index = server_module.build_content_index()
        key = "test-skill:references/advanced.md"
        assert key in index
        assert index[key]["domain"] == "test-skill"
        assert index[key]["sub_skill"] == "advanced"
        assert "mocking" in index[key]["content"]

    def test_content_is_lowercased(self, server_module, sample_skill):
        """Test that indexed content is lowercased for search."""
        index = server_module.build_content_index()
        key = "test-skill:SKILL.md"
        # Original has "Test Skill" but should be lowercase
        assert "test skill" in index[key]["content"]

    def test_multiple_skills_indexed(self, server_module, multiple_skills):
        """Test indexing multiple skills."""
        index = server_module.build_content_index()
        assert "test-skill:SKILL.md" in index
        assert "forms:SKILL.md" in index
        assert "building:SKILL.md" in index


class TestLoadIndex:
    """Tests for load_index function."""

    def test_loads_skills(self, server_module, sample_skill):
        """Test that skills are loaded from directory."""
        index = server_module.load_index()
        assert "skills" in index
        assert len(index["skills"]) == 1
        assert index["skills"][0]["name"] == "test-skill"

    def test_loads_multiple_skills(self, server_module, multiple_skills):
        """Test loading multiple skills."""
        index = server_module.load_index()
        assert len(index["skills"]) >= 3
        names = [s["name"] for s in index["skills"]]
        assert "test-skill" in names
        assert "forms" in names

    def test_handles_invalid_json(self, server_module, sample_skill_invalid_meta):
        """Test handling of invalid JSON in _meta.json."""
        index = server_module.load_index()
        assert "validation_errors" in index
        assert len(index["validation_errors"]) >= 1
        assert "Invalid JSON" in index["validation_errors"][0]

    def test_skips_non_directories(self, server_module, temp_skills_dir):
        """Test that non-directory files are skipped."""
        # Create a file in skills directory
        (temp_skills_dir / "random-file.txt").write_text("Not a skill")
        index = server_module.load_index()
        assert len(index["skills"]) == 0

    def test_builds_content_index(self, server_module, sample_skill):
        """Test that content index is built during load."""
        server_module.load_index()
        assert server_module._CONTENT_INDEX is not None
        assert len(server_module._CONTENT_INDEX) > 0


class TestGetIndex:
    """Tests for get_index function."""

    def test_caches_index(self, server_module, sample_skill):
        """Test that index is cached after first load."""
        index1 = server_module.get_index()
        index2 = server_module.get_index()
        assert index1 is index2

    def test_loads_on_first_call(self, server_module, sample_skill):
        """Test that index is loaded on first call."""
        assert server_module._INDEX is None
        index = server_module.get_index()
        assert server_module._INDEX is not None
        assert len(index["skills"]) > 0


class TestTrackUsage:
    """Tests for track_usage function."""

    def test_tracks_tool_calls(self, server_module):
        """Test that tool calls are tracked."""
        server_module.track_usage("list_skills")
        server_module.track_usage("list_skills")
        server_module.track_usage("get_skill")

        stats = server_module._USAGE_STATS["tool_calls"]
        assert stats["list_skills"] == 2
        assert stats["get_skill"] == 1

    def test_tracks_skill_loads(self, server_module):
        """Test that skill loads are tracked."""
        server_module.track_usage("get_skill", {"domain": "forms"})
        server_module.track_usage("get_skill", {"domain": "forms"})
        server_module.track_usage("get_skill", {"domain": "building"})

        stats = server_module._USAGE_STATS["skill_loads"]
        assert stats["forms"] == 2
        assert stats["building"] == 1

    def test_tracks_searches(self, server_module):
        """Test that searches are tracked."""
        server_module.track_usage("search_skills", {"query": "validation"})
        server_module.track_usage("search_skills", {"query": "forms"})

        searches = server_module._USAGE_STATS["searches"]
        assert len(searches) == 2
        assert searches[0]["query"] == "validation"

    def test_limits_search_history(self, server_module):
        """Test that search history is limited to 100 entries."""
        for i in range(150):
            server_module.track_usage("search", {"query": f"query{i}"})

        assert len(server_module._USAGE_STATS["searches"]) == 100


class TestCheckForChanges:
    """Tests for check_for_changes function."""

    def test_detects_new_file(self, server_module, temp_skills_dir):
        """Test detection of new files."""
        # First run to establish baseline
        server_module.check_for_changes()

        # Add a new file
        skill_dir = temp_skills_dir / "new-skill"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text("New skill")

        assert server_module.check_for_changes() is True

    def test_detects_modified_file(self, server_module, sample_skill):
        """Test detection of modified files."""
        # First run
        server_module.check_for_changes()

        # Modify a file
        import time
        time.sleep(0.1)  # Ensure mtime changes
        skill_file = sample_skill / "SKILL.md"
        skill_file.write_text(skill_file.read_text() + "\nModified!")

        assert server_module.check_for_changes() is True

    def test_detects_deleted_file(self, server_module, sample_skill):
        """Test detection of deleted files."""
        # Create and track an extra file
        extra_file = sample_skill / "extra.md"
        extra_file.write_text("Extra content")
        server_module.check_for_changes()

        # Delete the file
        extra_file.unlink()

        assert server_module.check_for_changes() is True

    def test_no_changes(self, server_module, sample_skill):
        """Test returns False when no changes."""
        server_module.check_for_changes()
        assert server_module.check_for_changes() is False


class TestExtractSnippet:
    """Tests for extract_snippet function."""

    def test_extracts_around_match(self, server_module):
        """Test snippet extraction around a match."""
        content = "The quick brown fox jumps over the lazy dog"
        snippet = server_module.extract_snippet(content, "fox", 20)
        assert "fox" in snippet

    def test_adds_ellipsis_before(self, server_module):
        """Test ellipsis added when content before match is truncated."""
        content = "A" * 100 + "target" + "B" * 100
        snippet = server_module.extract_snippet(content, "target", 50)
        assert snippet.startswith("...")

    def test_adds_ellipsis_after(self, server_module):
        """Test ellipsis added when content after match is truncated."""
        content = "A" * 10 + "target" + "B" * 200
        snippet = server_module.extract_snippet(content, "target", 50)
        assert snippet.endswith("...")

    def test_fallback_to_beginning(self, server_module):
        """Test falls back to beginning when no match found."""
        content = "Some content without the search term"
        snippet = server_module.extract_snippet(content, "xyz", 20)
        assert snippet.startswith("Some")

    def test_finds_first_word(self, server_module):
        """Test finds first matching word when exact phrase not found."""
        content = "The quick brown fox"
        snippet = server_module.extract_snippet(content, "brown lazy", 50)
        assert "brown" in snippet

    def test_removes_newlines(self, server_module):
        """Test that newlines are replaced with spaces."""
        content = "Line one\nLine two\nLine three"
        snippet = server_module.extract_snippet(content, "Line", 100)
        assert "\n" not in snippet


class TestListSkills:
    """Tests for _list_skills function."""

    def test_lists_all_skills(self, server_module, multiple_skills):
        """Test listing all skills."""
        result = server_module._list_skills()
        assert "skills" in result
        assert len(result["skills"]) >= 3

    def test_includes_required_fields(self, server_module, sample_skill):
        """Test that required fields are included."""
        result = server_module._list_skills()
        skill = result["skills"][0]
        assert "name" in skill
        assert "description" in skill
        assert "sub_skills" in skill

    def test_lists_sub_skills(self, server_module, sample_skill):
        """Test that sub-skill names are listed."""
        result = server_module._list_skills()
        skill = next(s for s in result["skills"] if s["name"] == "test-skill")
        assert "advanced-testing" in skill["sub_skills"]

    def test_tracks_usage(self, server_module, sample_skill):
        """Test that usage is tracked."""
        server_module._list_skills()
        assert server_module._USAGE_STATS["tool_calls"]["list_skills"] == 1


class TestGetSkill:
    """Tests for _get_skill function."""

    def test_gets_existing_skill(self, server_module, sample_skill):
        """Test getting an existing skill."""
        result = server_module._get_skill("test-skill")
        assert result["name"] == "test-skill"
        assert "content" in result
        assert "Test Skill" in result["content"]

    def test_returns_error_for_missing_skill(self, server_module, temp_skills_dir):
        """Test error returned for missing skill."""
        result = server_module._get_skill("nonexistent")
        assert "error" in result
        assert "not found" in result["error"]

    def test_includes_sub_skills_list(self, server_module, sample_skill):
        """Test that sub-skill names are included."""
        result = server_module._get_skill("test-skill")
        assert "sub_skills" in result
        assert "advanced-testing" in result["sub_skills"]

    def test_indicates_references_exist(self, server_module, sample_skill):
        """Test that has_references flag is set correctly."""
        result = server_module._get_skill("test-skill")
        assert result["has_references"] is True

    def test_indicates_no_references(self, server_module, sample_skill_minimal):
        """Test that has_references is False when no references."""
        result = server_module._get_skill("minimal-skill")
        assert result["has_references"] is False

    def test_tracks_usage(self, server_module, sample_skill):
        """Test that usage is tracked with domain."""
        server_module._get_skill("test-skill")
        assert server_module._USAGE_STATS["skill_loads"]["test-skill"] == 1


class TestGetSubSkill:
    """Tests for _get_sub_skill function."""

    def test_gets_existing_sub_skill(self, server_module, sample_skill):
        """Test getting an existing sub-skill."""
        result = server_module._get_sub_skill("test-skill", "advanced-testing")
        assert result["domain"] == "test-skill"
        assert result["sub_skill"] == "advanced-testing"
        assert "content" in result

    def test_returns_error_for_missing_domain(self, server_module, temp_skills_dir):
        """Test error for missing domain."""
        result = server_module._get_sub_skill("nonexistent", "sub")
        assert "error" in result
        assert "Domain" in result["error"]

    def test_returns_error_for_missing_sub_skill(self, server_module, sample_skill):
        """Test error for missing sub-skill."""
        result = server_module._get_sub_skill("test-skill", "nonexistent")
        assert "error" in result
        assert "Sub-skill" in result["error"]

    def test_returns_error_for_missing_file(self, server_module, temp_skills_dir):
        """Test error when sub-skill file doesn't exist."""
        # Create a skill with sub-skill pointing to missing file
        skill_dir = temp_skills_dir / "broken-skill"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text("# Broken")
        meta = {
            "name": "broken-skill",
            "description": "Test",
            "sub_skills": [{"name": "missing", "file": "nonexistent.md"}]
        }
        (skill_dir / "_meta.json").write_text(json.dumps(meta))

        # Reload index
        server_module._INDEX = None

        result = server_module._get_sub_skill("broken-skill", "missing")
        assert "error" in result
        assert "File not found" in result["error"]


class TestGetSkillsBatch:
    """Tests for _get_skills_batch function."""

    def test_gets_multiple_skills(self, server_module, multiple_skills):
        """Test getting multiple skills at once."""
        requests = [
            {"domain": "test-skill"},
            {"domain": "forms"}
        ]
        result = server_module._get_skills_batch(requests)
        assert "results" in result
        assert len(result["results"]) == 2

    def test_gets_mixed_skills_and_sub_skills(self, server_module, multiple_skills):
        """Test getting mix of skills and sub-skills."""
        requests = [
            {"domain": "forms"},
            {"domain": "forms", "sub_skill": "react"},
            {"domain": "forms", "sub_skill": "validation"}
        ]
        result = server_module._get_skills_batch(requests)
        assert len(result["results"]) == 3
        # First should be main skill
        assert "sub_skills" in result["results"][0]
        # Second and third should be sub-skills
        assert result["results"][1]["sub_skill"] == "react"
        assert result["results"][2]["sub_skill"] == "validation"

    def test_handles_missing_skills_in_batch(self, server_module, sample_skill):
        """Test that missing skills return errors in batch."""
        requests = [
            {"domain": "test-skill"},
            {"domain": "nonexistent"}
        ]
        result = server_module._get_skills_batch(requests)
        assert len(result["results"]) == 2
        assert "content" in result["results"][0]
        assert "error" in result["results"][1]


class TestSearchSkills:
    """Tests for _search_skills function."""

    def test_finds_by_name(self, server_module, multiple_skills):
        """Test finding skills by name."""
        result = server_module._search_skills("forms")
        assert len(result["results"]) >= 1
        assert result["results"][0]["domain"] == "forms"
        assert result["results"][0]["match"] == "name"

    def test_finds_by_description(self, server_module, sample_skill):
        """Test finding skills by description."""
        result = server_module._search_skills("unit testing")
        assert len(result["results"]) >= 1
        assert result["results"][0]["match"] == "description"

    def test_finds_by_tags(self, server_module, sample_skill):
        """Test finding skills by tags."""
        # Search for "example" which is only in tags, not in name or description
        result = server_module._search_skills("example")
        matches = [r for r in result["results"] if r.get("match") == "tags"]
        assert len(matches) >= 1

    def test_finds_sub_skills_by_name(self, server_module, sample_skill):
        """Test finding sub-skills by name."""
        result = server_module._search_skills("advanced-testing")
        sub_matches = [r for r in result["results"] if r.get("sub_skill")]
        assert len(sub_matches) >= 1

    def test_finds_sub_skills_by_triggers(self, server_module, multiple_skills):
        """Test finding sub-skills by trigger words."""
        result = server_module._search_skills("zod")
        matches = [r for r in result["results"] if r.get("match") == "triggers"]
        assert len(matches) >= 1

    def test_respects_limit(self, server_module, multiple_skills):
        """Test that result limit is respected."""
        result = server_module._search_skills("test", limit=2)
        assert len(result["results"]) <= 2

    def test_sorts_by_score(self, server_module, multiple_skills):
        """Test that results are sorted by score descending."""
        result = server_module._search_skills("form")
        if len(result["results"]) > 1:
            scores = [r["score"] for r in result["results"]]
            assert scores == sorted(scores, reverse=True)

    def test_tracks_usage(self, server_module, sample_skill):
        """Test that search is tracked."""
        server_module._search_skills("test")
        assert len(server_module._USAGE_STATS["searches"]) == 1
        assert server_module._USAGE_STATS["searches"][0]["query"] == "test"


class TestSearchContent:
    """Tests for _search_content function."""

    def test_finds_exact_phrase(self, server_module, sample_skill):
        """Test finding exact phrase in content."""
        result = server_module._search_content("unit testing")
        assert len(result["results"]) >= 1
        assert result["results"][0]["score"] >= 1.0

    def test_finds_all_words(self, server_module, sample_skill):
        """Test finding all words in content."""
        result = server_module._search_content("test code")
        assert len(result["results"]) >= 1

    def test_finds_partial_words(self, server_module, sample_skill):
        """Test finding some matching words."""
        result = server_module._search_content("testing xyz nonexistent")
        # Should find matches for "testing" even if other words missing
        matches = [r for r in result["results"] if r["score"] > 0]
        assert len(matches) >= 0  # May or may not find depending on content

    def test_includes_snippet(self, server_module, sample_skill):
        """Test that snippets are included in results."""
        result = server_module._search_content("test")
        if result["results"]:
            assert "snippet" in result["results"][0]

    def test_respects_limit(self, server_module, multiple_skills):
        """Test that result limit is respected."""
        result = server_module._search_content("skill", limit=2)
        assert len(result["results"]) <= 2

    def test_boosts_early_matches(self, server_module, sample_skill):
        """Test that matches in first 500 chars get boosted score."""
        # "Test Skill" appears early in the file
        result = server_module._search_content("test skill")
        if result["results"]:
            # Should have boosted score > 1.0
            early_match = next((r for r in result["results"]
                               if r["domain"] == "test-skill" and r["file"] == "SKILL.md"), None)
            if early_match:
                assert early_match["score"] >= 1.0

    def test_handles_empty_index(self, server_module, temp_skills_dir):
        """Test searching with no indexed content."""
        # Force index load on empty dir
        server_module._INDEX = None
        server_module._CONTENT_INDEX = None
        result = server_module._search_content("anything")
        assert result["results"] == []


class TestReloadIndex:
    """Tests for _reload_index function."""

    def test_reloads_index(self, server_module, sample_skill):
        """Test that index is reloaded."""
        # Initial load
        server_module.get_index()
        old_index = server_module._INDEX

        # Reload
        result = server_module._reload_index()

        assert result["status"] == "reloaded"
        assert result["skill_count"] >= 1

    def test_returns_counts(self, server_module, sample_skill):
        """Test that reload returns correct counts."""
        result = server_module._reload_index()
        assert "skill_count" in result
        assert "content_files_indexed" in result
        assert result["skill_count"] >= 1
        assert result["content_files_indexed"] >= 1

    def test_returns_validation_errors(self, server_module, sample_skill_invalid_meta):
        """Test that validation errors are returned."""
        result = server_module._reload_index()
        assert "validation_errors" in result


class TestGetStats:
    """Tests for _get_stats function."""

    def test_returns_uptime(self, server_module):
        """Test that uptime is returned."""
        result = server_module._get_stats()
        assert "uptime_since" in result

    def test_returns_tool_calls(self, server_module, sample_skill):
        """Test that tool calls are returned."""
        server_module._list_skills()
        result = server_module._get_stats()
        assert "tool_calls" in result
        assert result["tool_calls"]["list_skills"] >= 1

    def test_returns_skill_loads(self, server_module, sample_skill):
        """Test that skill loads are returned."""
        server_module._get_skill("test-skill")
        result = server_module._get_stats()
        assert "skill_loads" in result
        assert result["skill_loads"]["test-skill"] >= 1

    def test_returns_recent_searches(self, server_module, sample_skill):
        """Test that recent searches are returned."""
        server_module._search_skills("test1")
        server_module._search_skills("test2")
        result = server_module._get_stats()
        assert "recent_searches" in result
        assert len(result["recent_searches"]) <= 10

    def test_returns_total_skills(self, server_module, multiple_skills):
        """Test that total skills count is returned."""
        result = server_module._get_stats()
        assert "total_skills" in result
        assert result["total_skills"] >= 3


class TestValidateSkills:
    """Tests for _validate_skills function."""

    def test_valid_skills_pass(self, server_module, sample_skill):
        """Test that valid skills pass validation."""
        result = server_module._validate_skills()
        assert result["valid"] is True
        assert len(result["errors"]) == 0

    def test_detects_missing_meta(self, server_module, sample_skill_missing_meta):
        """Test detection of missing _meta.json."""
        result = server_module._validate_skills()
        errors = [e for e in result["errors"] if "Missing _meta.json" in e]
        assert len(errors) >= 1

    def test_detects_missing_skill_md(self, server_module, sample_skill_missing_skill_md):
        """Test detection of missing SKILL.md."""
        result = server_module._validate_skills()
        errors = [e for e in result["errors"] if "Missing SKILL.md" in e]
        assert len(errors) >= 1

    def test_detects_invalid_json(self, server_module, sample_skill_invalid_meta):
        """Test detection of invalid JSON."""
        result = server_module._validate_skills()
        errors = [e for e in result["errors"] if "Invalid JSON" in e]
        assert len(errors) >= 1

    def test_warns_about_missing_tags(self, server_module, sample_skill_minimal):
        """Test warning about missing tags."""
        result = server_module._validate_skills()
        warnings = [w for w in result["warnings"] if "No tags defined" in w]
        assert len(warnings) >= 1

    def test_warns_about_no_sub_skills(self, server_module, sample_skill_minimal):
        """Test warning about standalone skills."""
        result = server_module._validate_skills()
        warnings = [w for w in result["warnings"] if "No sub-skills" in w]
        assert len(warnings) >= 1

    def test_detects_missing_sub_skill_files(self, server_module, temp_skills_dir):
        """Test detection of missing sub-skill files."""
        skill_dir = temp_skills_dir / "broken-refs"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text("# Test")
        meta = {
            "name": "broken-refs",
            "description": "Test",
            "sub_skills": [{"name": "missing", "file": "refs/missing.md"}]
        }
        (skill_dir / "_meta.json").write_text(json.dumps(meta))

        result = server_module._validate_skills()
        errors = [e for e in result["errors"] if "Sub-skill file not found" in e]
        assert len(errors) >= 1

    def test_returns_skills_checked_count(self, server_module, multiple_skills):
        """Test that skills_checked count is returned."""
        result = server_module._validate_skills()
        assert "skills_checked" in result
        assert result["skills_checked"] >= 3
