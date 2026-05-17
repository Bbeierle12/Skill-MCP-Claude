"""
Tests for core/utils.py — sanitize_name, parse_frontmatter,
extract_description_from_frontmatter, create_skill_markdown.

Covers both YAML and no-YAML code paths.
"""

import importlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from core import utils as utils_mod  # noqa: E402


# ---------------------------------------------------------------------------
# sanitize_name
# ---------------------------------------------------------------------------

class TestSanitizeName:
    def test_empty_string(self):
        assert utils_mod.sanitize_name("") == ""

    def test_none_like_empty(self):
        # The implementation guards against falsy values.
        assert utils_mod.sanitize_name(None or "") == ""

    def test_basic_lowercase(self):
        assert utils_mod.sanitize_name("MyCoolSkill") == "mycoolskill"

    def test_replaces_spaces_with_dashes(self):
        assert utils_mod.sanitize_name("My Skill Name") == "my-skill-name"

    def test_strips_leading_trailing_dashes(self):
        assert utils_mod.sanitize_name("  hello  ") == "hello"
        assert utils_mod.sanitize_name("---x---") == "x"

    def test_keeps_existing_dashes(self):
        assert utils_mod.sanitize_name("foo-bar") == "foo-bar"

    def test_strips_outer_whitespace_first(self):
        # The strip() happens before regex substitution.
        assert utils_mod.sanitize_name("\t a-b \n") == "a-b"

    def test_only_invalid_chars(self):
        assert utils_mod.sanitize_name("@@@!!!") == ""


# ---------------------------------------------------------------------------
# parse_frontmatter
# ---------------------------------------------------------------------------

class TestParseFrontmatter:
    def test_no_frontmatter(self):
        meta, body = utils_mod.parse_frontmatter("# Title\nbody text")
        assert meta == {}
        assert body == "# Title\nbody text"

    def test_basic_yaml_frontmatter(self):
        content = "---\nname: foo\ndescription: a desc\n---\n# Title\nbody"
        meta, body = utils_mod.parse_frontmatter(content)
        assert meta["name"] == "foo"
        assert meta["description"] == "a desc"
        assert body == "# Title\nbody"

    def test_empty_frontmatter(self):
        content = "---\n---\nbody"
        meta, body = utils_mod.parse_frontmatter(content)
        assert meta == {}
        assert body == "body"

    def test_unterminated_frontmatter(self):
        # No closing '---' — should return ({}, original_content)
        meta, body = utils_mod.parse_frontmatter("---\nname: foo\nbody")
        assert meta == {}
        assert body == "---\nname: foo\nbody"

    def test_non_dict_frontmatter_returns_empty(self):
        # YAML list, not a mapping
        content = "---\n- a\n- b\n---\nbody"
        meta, body = utils_mod.parse_frontmatter(content)
        assert meta == {}
        # Falls through to the "not isinstance(.., dict)" branch and returns original
        assert body == content

    def test_yaml_tags_parsed(self):
        pytest.importorskip("yaml")
        content = "---\ntags:\n  - alpha\n  - beta\n---\nbody"
        meta, _ = utils_mod.parse_frontmatter(content)
        assert meta["tags"] == ["alpha", "beta"]

    def test_fallback_parser_when_yaml_missing(self, monkeypatch):
        """Force the no-YAML fallback path to execute."""
        monkeypatch.setattr(utils_mod, "_HAS_YAML", False)
        content = "---\nname: foo\ndescription: bar\n---\nbody"
        meta, body = utils_mod.parse_frontmatter(content)
        assert meta == {"name": "foo", "description": "bar"}
        assert body == "body"

    def test_fallback_skips_lines_without_colon(self, monkeypatch):
        monkeypatch.setattr(utils_mod, "_HAS_YAML", False)
        content = "---\nthis-line-has-no-colon\nname: foo\n---\nbody"
        meta, _ = utils_mod.parse_frontmatter(content)
        assert meta == {"name": "foo"}


# ---------------------------------------------------------------------------
# extract_description_from_frontmatter
# ---------------------------------------------------------------------------

class TestExtractDescription:
    def test_extracts_description(self):
        content = "---\ndescription: hello world\n---\nbody"
        assert (
            utils_mod.extract_description_from_frontmatter(content)
            == "hello world"
        )

    def test_returns_none_when_missing(self):
        assert (
            utils_mod.extract_description_from_frontmatter("# no frontmatter")
            is None
        )

    def test_returns_none_for_unterminated(self):
        # Unterminated frontmatter -> empty meta -> None
        assert (
            utils_mod.extract_description_from_frontmatter(
                "---\ndescription: foo\nbody without close"
            )
            is None
        )


# ---------------------------------------------------------------------------
# create_skill_markdown
# ---------------------------------------------------------------------------

class TestCreateSkillMarkdown:
    def test_format(self):
        md = utils_mod.create_skill_markdown("foo", "bar", "body content")
        assert md.startswith("---\nname: foo\ndescription: bar\n---")
        assert md.endswith("body content\n")

    def test_handles_empty_content(self):
        md = utils_mod.create_skill_markdown("foo", "", "")
        assert "name: foo" in md
        assert "description:" in md
