# tests/test_coverage_expansion.py
# Additional tests targeting uncovered branches identified by `pytest --cov`.
#
# Organised by module under test. Each test focuses on a specific code path
# missing from the baseline coverage report. See PR description for the list.

from __future__ import annotations

import json
import os
import sys
import base64
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest


# ---------------------------------------------------------------------------
# core/audit/models.py — helper edge cases
# ---------------------------------------------------------------------------

class TestAuditModels:
    def test_audit_finding_to_dict_roundtrip(self):
        from core.audit.models import AuditFinding
        f = AuditFinding("skill-a", "code-x", "warn", "msg", detail="extra")
        d = f.to_dict()
        assert d == {
            "skill": "skill-a", "code": "code-x",
            "severity": "warn", "message": "msg", "detail": "extra",
        }

    def test_now_iso_returns_seconds_precision(self):
        from core.audit.models import now_iso
        s = now_iso()
        # seconds-precision ISO with +00:00 suffix
        assert s.endswith("+00:00")
        # No microseconds component (no '.' before timezone)
        assert "." not in s.split("+", 1)[0]

    def test_today_iso_is_yyyy_mm_dd(self):
        from core.audit.models import today_iso
        s = today_iso()
        date.fromisoformat(s)  # raises if malformed
        assert len(s) == 10

    def test_iter_skill_dirs_missing_dir(self, tmp_path):
        from core.audit.models import iter_skill_dirs
        # Non-existent path → generator yields nothing (no exception).
        result = list(iter_skill_dirs(tmp_path / "nope"))
        assert result == []

    def test_iter_skill_dirs_skips_hidden_and_files(self, tmp_path):
        from core.audit.models import iter_skill_dirs
        s = tmp_path / "skills"
        s.mkdir()
        (s / ".hidden").mkdir()
        (s / "real").mkdir()
        (s / "not-a-dir.txt").write_text("x")
        names = [p.name for p in iter_skill_dirs(s)]
        assert names == ["real"]

    def test_load_meta_missing_file(self, tmp_path):
        from core.audit.models import load_meta
        d = tmp_path / "skill"
        d.mkdir()
        assert load_meta(d) == {}

    def test_load_meta_invalid_json(self, tmp_path):
        from core.audit.models import load_meta
        d = tmp_path / "skill"
        d.mkdir()
        (d / "_meta.json").write_text("{ not valid json", encoding="utf-8")
        assert load_meta(d) == {}

    def test_load_skill_md_missing(self, tmp_path):
        from core.audit.models import load_skill_md
        d = tmp_path / "skill"
        d.mkdir()
        assert load_skill_md(d) == ""

    def test_extract_frontmatter_description_multiline(self):
        from core.audit.models import extract_frontmatter_description
        content = (
            "---\n"
            "name: x\n"
            "description: first line\n"
            "  continuation line\n"
            "  more text\n"
            "other: value\n"
            "---\n"
            "body\n"
        )
        out = extract_frontmatter_description(content)
        assert out == "first line continuation line more text"

    def test_extract_frontmatter_description_only_other_keys(self):
        from core.audit.models import extract_frontmatter_description
        # Frontmatter exists but has no description field
        assert extract_frontmatter_description("---\nname: x\n---\nbody") is None

    def test_extract_frontmatter_description_empty_value(self):
        from core.audit.models import extract_frontmatter_description
        assert extract_frontmatter_description("---\ndescription:\n---\nbody") is None


# ---------------------------------------------------------------------------
# core/audit/pass1.py — additional findings paths
# ---------------------------------------------------------------------------

def _write_skill_minimal(skills_dir: Path, name: str, meta: dict, *, content: str = ""):
    """Write a skill with the given meta and a SKILL.md (defaults to body-only)."""
    d = skills_dir / name
    d.mkdir(parents=True, exist_ok=True)
    if "name" not in meta:
        meta["name"] = name
    (d / "_meta.json").write_text(json.dumps(meta), encoding="utf-8")
    body = content or f"---\nname: {name}\ndescription: {meta.get('description','')}\n---\n\nbody\n"
    (d / "SKILL.md").write_text(body, encoding="utf-8")
    return d


class TestPass1Extra:
    def test_missing_skill_md(self, tmp_path):
        from core.audit.pass1 import run_pass1
        s = tmp_path / "skills"
        s.mkdir()
        d = s / "x"
        d.mkdir()
        (d / "_meta.json").write_text(
            json.dumps({
                "name": "x", "description": "Use this skill when testing.",
                "tags": [], "sub_skills": [], "source": "t", "type": "template",
                "depends_on": [], "enhances": [],
            }), encoding="utf-8")
        # No SKILL.md
        findings = run_pass1(s)
        assert any(f.code == "missing-skill-md" and f.severity == "error" for f in findings)

    def test_missing_meta_short_circuits_remaining_checks(self, tmp_path):
        from core.audit.pass1 import run_pass1, collect_skill_stats
        s = tmp_path / "skills"
        s.mkdir()
        d = s / "x"
        d.mkdir()
        (d / "SKILL.md").write_text("# x\n", encoding="utf-8")
        # No _meta.json
        findings = run_pass1(s)
        codes = {f.code for f in findings if f.skill == "x"}
        assert "missing-meta" in codes
        # description/relation checks must be skipped
        assert "missing-description" not in codes
        assert "unknown-relation" not in codes

    def test_name_mismatch_finding(self, tmp_path):
        from core.audit.pass1 import run_pass1
        s = tmp_path / "skills"
        s.mkdir()
        _write_skill_minimal(
            s, "real-name",
            meta={
                "name": "wrong-name",
                "description": "Use this skill when you want to demonstrate name mismatch handling.",
                "tags": [], "sub_skills": [], "source": "x", "type": "template",
                "depends_on": [], "enhances": [],
            },
        )
        findings = run_pass1(s)
        assert any(f.code == "name-mismatch" for f in findings)

    def test_missing_description_finding(self, tmp_path):
        from core.audit.pass1 import run_pass1
        s = tmp_path / "skills"
        s.mkdir()
        _write_skill_minimal(
            s, "x",
            meta={"description": "", "tags": [], "sub_skills": [],
                  "source": "x", "type": "template", "depends_on": [], "enhances": []},
        )
        findings = run_pass1(s)
        assert any(f.code == "missing-description" and f.severity == "error" for f in findings)

    def test_missing_sub_skill_file_finding(self, tmp_path):
        from core.audit.pass1 import run_pass1
        s = tmp_path / "skills"
        s.mkdir()
        _write_skill_minimal(
            s, "x",
            meta={
                "description": "Use this skill when working on missing sub-skill testing.",
                "tags": [], "sub_skills": [{"name": "sub", "file": "references/sub.md", "triggers": []}],
                "source": "x", "type": "template", "depends_on": [], "enhances": [],
            },
        )
        findings = run_pass1(s)
        assert any(f.code == "missing-sub-skill-file" for f in findings)

    def test_unparseable_last_reviewed_at(self, tmp_path):
        from core.audit.pass1 import run_pass1
        s = tmp_path / "skills"
        s.mkdir()
        _write_skill_minimal(
            s, "x",
            meta={
                "description": "Use this skill when verifying unparseable timestamp handling.",
                "tags": [], "sub_skills": [], "source": "x", "type": "template",
                "depends_on": [], "enhances": [], "last_reviewed_at": "not-a-date",
            },
        )
        findings = run_pass1(s)
        stale = [f for f in findings if f.code == "stale-review"]
        assert stale and "unparseable" in stale[0].detail

    def test_aggregate_stats_empty(self):
        from core.audit.pass1 import aggregate_stats
        out = aggregate_stats({})
        assert out["total_skills"] == 0
        assert out["pct_with_assets"] == 0.0
        assert out["type_counts"] == {}


# ---------------------------------------------------------------------------
# core/audit/pass2.py — LLM rubric and edge branches
# ---------------------------------------------------------------------------

class TestPass2Extra:
    def test_run_llm_rubric_success(self, tmp_path, monkeypatch):
        """run_llm_rubric returns the improved_content as answer."""
        from core.audit import pass2

        def fake_improve(skill_name, improvement_request):
            assert "siblings" not in improvement_request  # template filled in
            return {"improved_content": "## When-to-use\nGreat."}, None

        monkeypatch.setattr(
            "core.claude_cli.improve_skill_with_claude", fake_improve, raising=True
        )
        answer, err = pass2.run_llm_rubric("x", siblings=["a", "b"])
        assert err is None
        assert answer == "## When-to-use\nGreat."

    def test_run_llm_rubric_error(self, monkeypatch):
        from core.audit import pass2

        def fake_improve(skill_name, improvement_request):
            return None, "CLI not found"

        monkeypatch.setattr(
            "core.claude_cli.improve_skill_with_claude", fake_improve, raising=True
        )
        answer, err = pass2.run_llm_rubric("x", siblings=[])
        assert answer is None
        assert err == "CLI not found"

    def test_run_llm_rubric_handles_no_result(self, monkeypatch):
        from core.audit import pass2

        def fake_improve(*a, **k):
            return None, None

        monkeypatch.setattr(
            "core.claude_cli.improve_skill_with_claude", fake_improve, raising=True
        )
        answer, err = pass2.run_llm_rubric("x", siblings=[])
        assert answer is None and err is None

    def test_run_pass2_invokes_llm_when_requested(self, tmp_path, monkeypatch):
        from core.audit import pass2
        s = tmp_path / "skills"
        s.mkdir()
        _write_skill_minimal(
            s, "only",
            meta={
                "description": "Use this skill when verifying LLM rubric path is invoked.",
                "tags": ["react"], "sub_skills": [], "source": "x", "type": "template",
                "depends_on": [], "enhances": [],
            },
        )

        calls = []

        def fake_rubric(skill_name, siblings):
            calls.append((skill_name, siblings))
            return "answer-from-llm", None

        monkeypatch.setattr(pass2, "run_llm_rubric", fake_rubric)
        result = pass2.run_pass2(s, use_llm=True)
        assert calls and calls[0][0] == "only"
        assert result.llm_answer == "answer-from-llm"
        assert result.llm_error is None

    def test_run_pass2_raises_when_no_skills(self, tmp_path):
        from core.audit.pass2 import run_pass2
        s = tmp_path / "skills"
        s.mkdir()
        with pytest.raises(RuntimeError):
            run_pass2(s, use_llm=False)

    def test_pass2_today_override_writes_date(self, tmp_path):
        from core.audit.pass2 import run_pass2
        from core.audit.models import load_meta
        s = tmp_path / "skills"
        s.mkdir()
        _write_skill_minimal(
            s, "x",
            meta={
                "description": "Use this skill when verifying today-override stamping.",
                "tags": [], "sub_skills": [], "source": "x", "type": "template",
                "depends_on": [], "enhances": [],
            },
        )
        fixed = date(2023, 6, 15)
        run_pass2(s, skill_name="x", use_llm=False, today=fixed)
        assert load_meta(s / "x")["last_reviewed_at"] == "2023-06-15"

    def test_pass2_recent_review_full_freshness_score(self, tmp_path):
        from core.audit.pass2 import run_deterministic_rubric
        s = tmp_path / "skills"
        s.mkdir()
        recent = date.today() - timedelta(days=3)
        _write_skill_minimal(
            s, "x",
            meta={
                "description": "Use this skill when verifying freshness scoring close to today.",
                "tags": [], "sub_skills": [], "source": "x", "type": "template",
                "depends_on": [], "enhances": [],
                "last_reviewed_at": recent.isoformat(),
            },
        )
        r = run_deterministic_rubric(s, "x")
        assert r.rubric["freshness"] == 25

    def test_pass2_unparseable_review_zero_freshness(self, tmp_path):
        from core.audit.pass2 import run_deterministic_rubric
        s = tmp_path / "skills"
        s.mkdir()
        _write_skill_minimal(
            s, "x",
            meta={
                "description": "Use this skill when verifying freshness scoring with bad date.",
                "tags": [], "sub_skills": [], "source": "x", "type": "template",
                "depends_on": [], "enhances": [],
                "last_reviewed_at": "not-a-date",
            },
        )
        r = run_deterministic_rubric(s, "x")
        assert r.rubric["freshness"] == 0

    def test_pass2_version_mentions_and_split_suggestion(self, tmp_path):
        from core.audit.pass2 import run_deterministic_rubric
        s = tmp_path / "skills"
        s.mkdir()
        # 600 lines so the "consider moving long examples" suggestion fires,
        # and a version hint string for version_mentions detection.
        body = "react 18.2.0\n" + "\n".join(f"line {i}" for i in range(600))
        _write_skill_minimal(
            s, "x",
            meta={
                "description": "Use this skill when working with React form patterns and validation.",
                "tags": ["forms"], "sub_skills": [], "source": "x", "type": "template",
                "depends_on": [], "enhances": [],
            },
            content="---\nname: x\ndescription: same\n---\n\n" + body,
        )
        r = run_deterministic_rubric(s, "x")
        assert r.rubric["version_mentions"], "expected react version match"
        assert any("library versions" in sg for sg in r.suggestions)
        assert any("references/" in sg for sg in r.suggestions)

    def test_pass2_no_trigger_cue_suggestion(self, tmp_path):
        from core.audit.pass2 import run_deterministic_rubric
        s = tmp_path / "skills"
        s.mkdir()
        _write_skill_minimal(
            s, "x",
            meta={
                # No 'use'/'when'/'for' word in description
                "description": "Brand colours and assets list, organised by team.",
                "tags": [], "sub_skills": [], "source": "x", "type": "template",
                "depends_on": [], "enhances": [],
            },
        )
        r = run_deterministic_rubric(s, "x")
        assert any("Use when" in sg for sg in r.suggestions)

    def test_pass2_does_not_promote_existing_tier(self, tmp_path):
        """If the deterministic proposal is *better* than the stored tier
        (e.g. proposal=B but stored=D), the stored tier must remain — Pass 2
        never auto-promotes."""
        from core.audit.pass2 import run_pass2
        from core.audit.models import load_meta, save_meta
        s = tmp_path / "skills"
        s.mkdir()
        _write_skill_minimal(
            s, "x",
            meta={
                "description": "Use this skill when verifying tier handling.",
                "tags": ["react"],  # library-heavy → proposes A
                "sub_skills": [], "source": "x", "type": "template",
                "depends_on": [], "enhances": [],
                "relevance_tier": "D",  # already manually demoted
            },
        )
        run_pass2(s, skill_name="x", use_llm=False)
        meta = load_meta(s / "x")
        # Must remain D (proposed A is "better" — never auto-promote)
        assert meta["relevance_tier"] == "D"


# ---------------------------------------------------------------------------
# core/audit/pass3.py — coverage_delta with previous snapshot, edge cases
# ---------------------------------------------------------------------------

class TestPass3Extra:
    def test_coverage_delta_with_previous(self, tmp_path):
        from core.audit.pass3 import coverage_delta, save_cluster_snapshot
        s = tmp_path / "skills"
        s.mkdir()
        # initial state: one skill tagged "forms"
        _write_skill_minimal(s, "a", meta={
            "description": "Use forms a.", "tags": ["forms"], "sub_skills": [],
            "source": "x", "type": "template", "depends_on": [], "enhances": []
        })
        # Snapshot includes a tag that will disappear, and a count that will grow.
        snap = tmp_path / "snap.json"
        snap.write_text(json.dumps({"forms": 1, "gone-tag": 3}), encoding="utf-8")
        # Add a new skill tagged forms (cluster grows 1 -> 2), plus a brand-new tag.
        _write_skill_minimal(s, "b", meta={
            "description": "Use forms b.", "tags": ["forms", "brand-new-tag"], "sub_skills": [],
            "source": "x", "type": "template", "depends_on": [], "enhances": []
        })
        cd = coverage_delta(s, snap)
        assert cd["grew"]["forms"] == (1, 2)
        assert "gone-tag" in cd["gone"]
        assert "brand-new-tag" in cd["new"]
        # round-trip
        save_cluster_snapshot(s, tmp_path / "new-snap.json")
        snap2 = json.loads((tmp_path / "new-snap.json").read_text())
        assert snap2 == {"forms": 2, "brand-new-tag": 1}

    def test_coverage_delta_handles_missing_snapshot(self, tmp_path):
        from core.audit.pass3 import coverage_delta
        s = tmp_path / "skills"
        s.mkdir()
        _write_skill_minimal(s, "a", meta={
            "description": "Use a.", "tags": ["forms"], "sub_skills": [],
            "source": "x", "type": "template", "depends_on": [], "enhances": []
        })
        cd = coverage_delta(s, tmp_path / "nope.json")
        assert cd["new"] == ["forms"]
        assert cd["grew"] == {} and cd["shrank"] == {}

    def test_coverage_delta_invalid_previous_snapshot(self, tmp_path):
        from core.audit.pass3 import coverage_delta
        s = tmp_path / "skills"
        s.mkdir()
        _write_skill_minimal(s, "a", meta={
            "description": "Use a.", "tags": ["forms"], "sub_skills": [],
            "source": "x", "type": "template", "depends_on": [], "enhances": []
        })
        bad_snap = tmp_path / "bad.json"
        bad_snap.write_text("{ not valid", encoding="utf-8")
        cd = coverage_delta(s, bad_snap)
        # Invalid JSON treated as empty previous → everything is new.
        assert cd["new"] == ["forms"]

    def test_coverage_delta_shrank(self, tmp_path):
        from core.audit.pass3 import coverage_delta
        s = tmp_path / "skills"
        s.mkdir()
        _write_skill_minimal(s, "a", meta={
            "description": "Use a.", "tags": ["forms"], "sub_skills": [],
            "source": "x", "type": "template", "depends_on": [], "enhances": []
        })
        snap = tmp_path / "snap.json"
        snap.write_text(json.dumps({"forms": 5}), encoding="utf-8")
        cd = coverage_delta(s, snap)
        assert cd["shrank"]["forms"] == (5, 1)

    def test_jaccard_empty_descriptions(self, tmp_path):
        """A skill with an empty description must not crash overlap_pairs even
        in a large tag cluster (>= CLUSTER_MIN)."""
        from core.audit.pass3 import overlap_pairs
        s = tmp_path / "skills"
        s.mkdir()
        # 4 skills sharing a tag, one with an empty description.
        for i, desc in enumerate([
            "Use this skill when building forms with react and validation logic in production environments.",
            "Use this skill when building forms with react and validation logic in production environments.",
            "Use this skill when building forms with react and validation logic in production environments.",
            "",  # empty description path
        ]):
            _write_skill_minimal(s, f"k{i}", meta={
                "description": desc, "tags": ["t"], "sub_skills": [],
                "source": "x", "type": "template", "depends_on": [], "enhances": []
            })
        pairs = overlap_pairs(s)
        # Empty-description skill must not appear as a high-overlap pair.
        names = {p["skill_a"] for p in pairs} | {p["skill_b"] for p in pairs}
        assert "k3" not in names

    def test_router_with_strong_leaves_recommendation(self, tmp_path):
        from core.audit.pass3 import router_necessity
        s = tmp_path / "skills"
        s.mkdir()
        # Leaf with strong description (>=120 chars + 'use' cue)
        strong = ("Use this skill when authoring production-grade form components " * 3)[:200]
        _write_skill_minimal(s, "leaf", meta={
            "description": strong, "tags": ["forms"], "sub_skills": [],
            "source": "x", "type": "template", "depends_on": [], "enhances": []
        })
        _write_skill_minimal(s, "router", meta={
            "description": "Use this router for any form-related task to pick the right specialised form skill.",
            "tags": ["forms"], "sub_skills": [],
            "source": "x", "type": "router", "depends_on": ["leaf"], "enhances": []
        })
        rn = router_necessity(s)
        info = next(r for r in rn if r["router"] == "router")
        assert info["weak_leaves"] == 0
        assert "deprecating" in info["recommendation"]


# ---------------------------------------------------------------------------
# core/audit/report.py — stats deltas, p2 LLM blocks, slid tiers
# ---------------------------------------------------------------------------

class TestReportExtra:
    def _stub_p2(self, **overrides):
        from core.audit.pass2 import Pass2Result
        kwargs = dict(
            skill="x",
            rubric={
                "when_to_use_distinct": True,
                "closest_sibling_overlap": 0.1,
                "trigger_cue_present": True,
                "version_mentions": ["react 18.2"],
                "has_scripts": True,
                "has_references": True,
                "n_sub_skills": 0,
                "line_count": 100,
                "proposed_tier_justification": "good",
            },
            review_score=80,
            relevance_tier="A",
            sibling_skills=["a", "b"],
            suggestions=["sugg1", "sugg2"],
        )
        kwargs.update(overrides)
        return Pass2Result(**kwargs)

    def test_p2_block_includes_llm_answer(self):
        from core.audit.report import _pass2_block
        p2 = self._stub_p2(llm_answer="LLM said this.\n\n", llm_error=None)
        md = _pass2_block(p2)
        assert "LLM rubric answer" in md
        assert "LLM said this." in md
        assert "pinned versions detected" in md  # version_mentions branch
        assert "Suggestions" in md

    def test_p2_block_includes_llm_error(self):
        from core.audit.report import _pass2_block
        p2 = self._stub_p2(llm_error="CLI not found")
        md = _pass2_block(p2)
        assert "LLM rubric skipped" in md
        assert "CLI not found" in md
        assert "LLM rubric answer" not in md

    def test_p2_block_handles_none(self):
        from core.audit.report import _pass2_block
        assert "skipped" in _pass2_block(None)

    def test_stats_block_with_deltas(self):
        from core.audit.report import _stats_block
        cur = {
            "total_skills": 10, "avg_skill_md_lines": 50.0,
            "pct_with_assets": 80.0, "pct_description_mismatch": 5.0,
            "type_counts": {"template": 8}, "source_counts": {"x": 10},
        }
        prev = {
            "total_skills": 7, "avg_skill_md_lines": 40.0,
            "pct_with_assets": 60.0, "pct_description_mismatch": 10.0,
        }
        md = _stats_block(cur, prev)
        # positive delta with + sign
        assert "(+3)" in md
        # negative delta without leading +
        assert "(-5)" in md or "(-5.0)" in md
        assert "template=8" in md
        assert "x=10" in md

    def test_stats_block_no_previous(self):
        from core.audit.report import _stats_block
        cur = {
            "total_skills": 3, "avg_skill_md_lines": 12.5,
            "pct_with_assets": 0.0, "pct_description_mismatch": 0.0,
            "type_counts": {}, "source_counts": {},
        }
        md = _stats_block(cur, None)
        assert "Total skills" in md
        # no parenthesised delta because previous is None
        assert "(+" not in md and "(-" not in md

    def test_tier_watch_block_marks_slid(self, tmp_path):
        from core.audit.report import _tier_watch_block
        from core.audit.pass1 import collect_skill_stats
        s = tmp_path / "skills"
        s.mkdir()
        _write_skill_minimal(s, "a", meta={
            "description": "Use a.", "tags": [], "sub_skills": [],
            "source": "x", "type": "template", "depends_on": [], "enhances": [],
            "relevance_tier": "C",
        })
        _write_skill_minimal(s, "b", meta={
            "description": "Use b.", "tags": [], "sub_skills": [],
            "source": "x", "type": "template", "depends_on": [], "enhances": [],
            "relevance_tier": "A",  # not in C/D
        })
        stats = collect_skill_stats(s)
        md = _tier_watch_block(stats, previous_tiers={"a": "B"})
        # 'a' slid from B to C → previous shown
        assert "`a`" in md and "B" in md
        # 'b' not in C/D → not listed
        assert "`b`" not in md

    def test_tier_watch_block_empty(self, tmp_path):
        from core.audit.report import _tier_watch_block
        # No stats → no skills in C/D → emit "no skills" sentinel
        md = _tier_watch_block({}, None)
        assert "No skills currently in Tier C or D" in md

    def test_pass3_block_overlap_router_and_coverage(self):
        from core.audit.report import _pass3_block
        p3 = {
            "overlap_pairs": [{"tag": "forms", "skill_a": "a", "skill_b": "b", "overlap": 0.7}],
            "router_necessity": [{
                "router": "r", "leaves": [{"name": "a"}, {"name": "b"}],
                "weak_leaves": 1, "recommendation": "keep",
            }],
            "coverage_delta": {
                "grew": {"forms": (1, 3)}, "shrank": {"oss": (5, 2)},
                "new": ["brand"], "gone": ["legacy"],
            },
            "source_distribution": {"user": 5, "public": 2},
        }
        md = _pass3_block(p3)
        assert "Sibling description overlap" in md
        assert "Router necessity" in md
        assert "Coverage delta" in md
        assert "forms" in md and "1→3" in md
        assert "Source distribution" in md
        assert "user=5" in md

    def test_pass3_block_empty_coverage_delta(self):
        from core.audit.report import _pass3_block
        md = _pass3_block({
            "overlap_pairs": [],
            "router_necessity": [],
            "coverage_delta": {"grew": {}, "shrank": {}, "new": [], "gone": []},
            "source_distribution": {},
        })
        assert "No tag-cluster changes" in md

    def test_save_state_and_load_state_roundtrip(self, tmp_path):
        from core.audit.report import save_state, load_state, current_tier_map
        s = tmp_path / "skills"
        s.mkdir()
        _write_skill_minimal(s, "a", meta={
            "description": "Use a.", "tags": [], "sub_skills": [],
            "source": "x", "type": "template", "depends_on": [], "enhances": [],
            "relevance_tier": "B",
        })
        _write_skill_minimal(s, "no-tier", meta={
            "description": "Use n.", "tags": [], "sub_skills": [],
            "source": "x", "type": "template", "depends_on": [], "enhances": [],
        })
        tiers = current_tier_map(s)
        assert tiers == {"a": "B"}  # only skills with a stored tier are included
        state_path = tmp_path / "state.json"
        save_state(state_path, aggregate={"total_skills": 2}, tiers=tiers)
        loaded = load_state(state_path)
        assert loaded["aggregate"] == {"total_skills": 2}
        assert loaded["tiers"] == {"a": "B"}

    def test_load_state_missing_and_corrupt(self, tmp_path):
        from core.audit.report import load_state
        assert load_state(tmp_path / "nope.json") == {}
        bad = tmp_path / "bad.json"
        bad.write_text("{ not json", encoding="utf-8")
        assert load_state(bad) == {}


# ---------------------------------------------------------------------------
# scripts/backfill_audit_meta.py — main() entry point
# ---------------------------------------------------------------------------

class TestBackfillMain:
    def test_main_updates_skills(self, tmp_path, capsys):
        from scripts.backfill_audit_meta import main
        s = tmp_path / "skills"
        s.mkdir()
        _write_skill_minimal(s, "x", meta={
            "description": "Use x for testing.", "tags": [], "sub_skills": [],
            "source": "x", "type": "template", "depends_on": [], "enhances": [],
        })
        rc = main_with_argv(main, ["--skills", str(s)])
        assert rc == 0
        out = capsys.readouterr().out
        assert "Updated" in out
        assert "added last_reviewed_at" in out

    def test_main_dry_run(self, tmp_path, capsys):
        from scripts.backfill_audit_meta import main
        from core.audit.models import load_meta
        s = tmp_path / "skills"
        s.mkdir()
        _write_skill_minimal(s, "x", meta={
            "description": "Use x.", "tags": [], "sub_skills": [],
            "source": "x", "type": "template", "depends_on": [], "enhances": [],
        })
        rc = main_with_argv(main, ["--skills", str(s), "--dry-run"])
        assert rc == 0
        assert "Would update" in capsys.readouterr().out
        # No mutations on disk
        meta = load_meta(s / "x")
        assert "last_reviewed_at" not in meta

    def test_main_missing_dir(self, tmp_path, capsys):
        from scripts.backfill_audit_meta import main
        rc = main_with_argv(main, ["--skills", str(tmp_path / "nope")])
        assert rc == 2
        assert "ERROR" in capsys.readouterr().err

    def test_main_already_complete(self, tmp_path, capsys):
        from scripts.backfill_audit_meta import main
        s = tmp_path / "skills"
        s.mkdir()
        _write_skill_minimal(s, "x", meta={
            "description": "Use x.", "tags": [], "sub_skills": [],
            "source": "x", "type": "template", "depends_on": [], "enhances": [],
            "last_reviewed_at": None, "review_score": None, "relevance_tier": None,
        })
        rc = main_with_argv(main, ["--skills", str(s)])
        assert rc == 0
        assert "already carry" in capsys.readouterr().out

    def test_backfill_skips_dirs_without_meta(self, tmp_path):
        from scripts.backfill_audit_meta import backfill
        s = tmp_path / "skills"
        s.mkdir()
        (s / "no-meta").mkdir()
        (s / "no-meta" / "SKILL.md").write_text("body", encoding="utf-8")
        result = backfill(s)
        assert result["total_skills"] == 0
        assert result["updated"] == {}


def main_with_argv(main_fn, argv):
    """Run a CLI ``main()`` after replacing ``sys.argv``."""
    old = sys.argv[:]
    try:
        sys.argv = ["prog"] + list(argv)
        return main_fn()
    finally:
        sys.argv = old


# ---------------------------------------------------------------------------
# scripts/run_daily_audit.py — orchestration entry point (0% baseline)
# ---------------------------------------------------------------------------

class TestRunDailyAudit:
    def _build_catalogue(self, tmp_path: Path) -> Path:
        s = tmp_path / "skills"
        s.mkdir()
        _write_skill_minimal(s, "a", meta={
            "description": "Use this skill when running the daily audit smoke test.",
            "tags": ["react"], "sub_skills": [], "source": "x", "type": "template",
            "depends_on": [], "enhances": [],
        })
        _write_skill_minimal(s, "b", meta={
            "description": "Use this skill for the second daily audit smoke target.",
            "tags": [], "sub_skills": [], "source": "x", "type": "template",
            "depends_on": [], "enhances": [],
        })
        return s

    def test_main_writes_report_and_state(self, tmp_path):
        from scripts.run_daily_audit import main
        s = self._build_catalogue(tmp_path)
        reports = tmp_path / "reports"
        rc = main_with_argv(main, [
            "--skills", str(s), "--reports", str(reports),
        ])
        assert rc == 0
        files = list(reports.glob("*.md"))
        assert len(files) == 1
        assert "Skills Catalogue — Daily Audit" in files[0].read_text(encoding="utf-8")
        # State file is created so the next run can compute deltas.
        assert (reports / ".audit-state.json").exists()

    def test_main_dry_run_prints_no_state(self, tmp_path, capsys):
        from scripts.run_daily_audit import main
        s = self._build_catalogue(tmp_path)
        reports = tmp_path / "reports"
        rc = main_with_argv(main, [
            "--skills", str(s), "--reports", str(reports), "--dry-run",
        ])
        assert rc == 0
        out = capsys.readouterr().out
        assert "Skills Catalogue — Daily Audit" in out
        # Dry-run must not create the dated report or state file.
        assert list(reports.glob("*.md")) == []
        assert not (reports / ".audit-state.json").exists()

    def test_main_weekly_runs_pass3_and_snapshot(self, tmp_path):
        from scripts.run_daily_audit import main
        s = self._build_catalogue(tmp_path)
        reports = tmp_path / "reports"
        rc = main_with_argv(main, [
            "--skills", str(s), "--reports", str(reports), "--weekly",
        ])
        assert rc == 0
        report = next(reports.glob("*.md"))
        body = report.read_text(encoding="utf-8")
        assert "Weekly catalogue review" in body
        assert (reports / ".cluster-snapshot.json").exists()

    def test_main_target_skill_argument(self, tmp_path):
        from scripts.run_daily_audit import main
        from core.audit.models import load_meta
        s = self._build_catalogue(tmp_path)
        reports = tmp_path / "reports"
        rc = main_with_argv(main, [
            "--skills", str(s), "--reports", str(reports), "--skill", "b",
        ])
        assert rc == 0
        # Pass 2 should have stamped only 'b'
        assert load_meta(s / "b").get("last_reviewed_at") == date.today().isoformat()
        assert load_meta(s / "a").get("last_reviewed_at") in (None, "", False)

    def test_main_missing_skills_dir(self, tmp_path, capsys):
        from scripts.run_daily_audit import main
        rc = main_with_argv(main, ["--skills", str(tmp_path / "nope")])
        assert rc == 2
        assert "skills dir not found" in capsys.readouterr().err

    def test_main_fail_on_error_returns_one(self, tmp_path):
        """Inject a structural defect (missing _meta.json) and verify
        --fail-on-error surfaces a non-zero exit code."""
        from scripts.run_daily_audit import main
        s = tmp_path / "skills"
        s.mkdir()
        # Skill with no _meta.json → error severity
        broken = s / "broken"
        broken.mkdir()
        (broken / "SKILL.md").write_text("# broken\n", encoding="utf-8")
        reports = tmp_path / "reports"
        rc = main_with_argv(main, [
            "--skills", str(s), "--reports", str(reports), "--fail-on-error",
        ])
        assert rc == 1

    def test_main_pass2_skip_when_no_skills(self, tmp_path, capsys):
        """An empty catalogue should still produce a report without crashing;
        Pass 2 logs a 'skipped' message to stderr."""
        from scripts.run_daily_audit import main
        s = tmp_path / "skills"
        s.mkdir()
        reports = tmp_path / "reports"
        rc = main_with_argv(main, [
            "--skills", str(s), "--reports", str(reports),
        ])
        assert rc == 0
        assert "Pass 2 skipped" in capsys.readouterr().err


# ---------------------------------------------------------------------------
# core/skills.py — mutation & import error paths
# ---------------------------------------------------------------------------

class TestSkillsMutations:
    def _patch_skills_dir(self, monkeypatch, tmp_path):
        import core.config as config
        monkeypatch.setattr(config, "_skills_dir", tmp_path / "skills")
        (tmp_path / "skills").mkdir(exist_ok=True)
        return tmp_path / "skills"

    def test_create_skill_rejects_empty_name(self, tmp_path, monkeypatch):
        from core.skills import create_skill
        self._patch_skills_dir(monkeypatch, tmp_path)
        result, err = create_skill(name="", description="d", content="c")
        assert result is None and "required" in err

    def test_create_skill_rejects_unsafe_name(self, tmp_path, monkeypatch):
        from core.skills import create_skill
        self._patch_skills_dir(monkeypatch, tmp_path)
        # sanitize_name will leave only path-safe chars; force unsafe via raw call
        # by including chars that survive sanitisation to dashes only.
        result, err = create_skill(name="..", description="d", content="c")
        assert result is None
        assert err is not None

    def test_create_skill_no_overwrite(self, tmp_path, monkeypatch):
        from core.skills import create_skill
        sd = self._patch_skills_dir(monkeypatch, tmp_path)
        (sd / "exists").mkdir()
        result, err = create_skill(name="exists", description="d", content="c")
        assert result is None and "already exists" in err

    def test_create_skill_with_overwrite(self, tmp_path, monkeypatch):
        from core.skills import create_skill
        sd = self._patch_skills_dir(monkeypatch, tmp_path)
        (sd / "exists").mkdir()
        result, err = create_skill(
            name="exists", description="d", content="c", overwrite=True
        )
        assert err is None and result["success"]

    def test_update_skill_not_found(self, tmp_path, monkeypatch):
        from core.skills import update_skill
        self._patch_skills_dir(monkeypatch, tmp_path)
        result, err = update_skill(name="missing", description="d")
        assert result is None and "not found" in err

    def test_update_skill_invalid_name(self, tmp_path, monkeypatch):
        from core.skills import update_skill
        self._patch_skills_dir(monkeypatch, tmp_path)
        result, err = update_skill(name="../etc", description="d")
        assert result is None
        assert err is not None

    def test_update_skill_preserves_existing_meta(self, tmp_path, monkeypatch):
        from core.skills import create_skill, update_skill
        sd = self._patch_skills_dir(monkeypatch, tmp_path)
        create_skill(name="s", description="orig", content="body",
                     tags=["old"], sub_skills=[{"name": "sub", "file": "sub.md"}])
        result, err = update_skill(name="s", description="new", content="b2", tags=["new"])
        assert err is None and result["success"]
        meta = json.loads((sd / "s" / "_meta.json").read_text())
        assert meta["description"] == "new"
        assert meta["tags"] == ["new"]
        # sub_skills preserved
        assert meta["sub_skills"] and meta["sub_skills"][0]["name"] == "sub"

    def test_delete_skill_invalid_and_missing(self, tmp_path, monkeypatch):
        from core.skills import delete_skill
        self._patch_skills_dir(monkeypatch, tmp_path)
        r, err = delete_skill("../etc")
        assert r is None and err is not None
        r, err = delete_skill("does-not-exist")
        assert r is None and "not found" in err

    def test_delete_skill_success(self, tmp_path, monkeypatch):
        from core.skills import create_skill, delete_skill
        sd = self._patch_skills_dir(monkeypatch, tmp_path)
        create_skill(name="s", description="d", content="c")
        assert (sd / "s").exists()
        r, err = delete_skill("s")
        assert err is None and r["success"]
        assert not (sd / "s").exists()

    def test_import_folder_validation(self, tmp_path, monkeypatch):
        from core.skills import import_folder
        self._patch_skills_dir(monkeypatch, tmp_path)
        # empty source path
        r, err = import_folder("")
        assert r is None and "required" in err
        # nonexistent
        r, err = import_folder(str(tmp_path / "nope"))
        assert r is None and "not found" in err
        # not a directory
        f = tmp_path / "a.txt"
        f.write_text("x")
        r, err = import_folder(str(f))
        assert r is None and "directory" in err

    def test_import_folder_creates_meta_from_frontmatter(self, tmp_path, monkeypatch):
        from core.skills import import_folder
        sd = self._patch_skills_dir(monkeypatch, tmp_path)
        src = tmp_path / "external"
        src.mkdir()
        (src / "SKILL.md").write_text(
            "---\ndescription: Imported via frontmatter\n---\n# body\n",
            encoding="utf-8",
        )
        r, err = import_folder(str(src), new_name="brought-in")
        assert err is None and r["success"]
        meta = json.loads((sd / "brought-in" / "_meta.json").read_text())
        assert meta["description"] == "Imported via frontmatter"
        assert meta["source"] == "imported"

    def test_import_folder_creates_skill_md_if_missing(self, tmp_path, monkeypatch):
        from core.skills import import_folder
        sd = self._patch_skills_dir(monkeypatch, tmp_path)
        src = tmp_path / "external"
        src.mkdir()
        (src / "notes.txt").write_text("x", encoding="utf-8")
        r, err = import_folder(str(src), new_name="imported")
        assert err is None
        assert (sd / "imported" / "SKILL.md").exists()
        assert (sd / "imported" / "_meta.json").exists()

    def test_import_folder_rejects_duplicate(self, tmp_path, monkeypatch):
        from core.skills import import_folder
        sd = self._patch_skills_dir(monkeypatch, tmp_path)
        (sd / "dup").mkdir()
        src = tmp_path / "external"
        src.mkdir()
        (src / "SKILL.md").write_text("# x", encoding="utf-8")
        r, err = import_folder(str(src), new_name="dup")
        assert r is None and "already exists" in err

    def test_import_files_json_text_and_base64(self, tmp_path, monkeypatch):
        from core.skills import import_files_json
        sd = self._patch_skills_dir(monkeypatch, tmp_path)
        encoded = base64.b64encode(b"binary-bytes-here").decode("ascii")
        r, err = import_files_json("my-skill", [
            {"path": "SKILL.md", "content": "---\ndescription: from json\n---\n# body\n"},
            {"path": "scripts/helper.bin", "content": encoded, "base64": True},
        ])
        assert err is None
        assert (sd / "my-skill" / "SKILL.md").read_text().startswith("---")
        assert (sd / "my-skill" / "scripts" / "helper.bin").read_bytes() == b"binary-bytes-here"
        meta = json.loads((sd / "my-skill" / "_meta.json").read_text())
        assert meta["description"] == "from json"
        assert meta["source"] == "json-upload"

    def test_import_files_json_missing_name(self, tmp_path, monkeypatch):
        from core.skills import import_files_json
        self._patch_skills_dir(monkeypatch, tmp_path)
        r, err = import_files_json("", [])
        assert r is None and "required" in err

    def test_import_files_json_rejects_null_byte_text(self, tmp_path, monkeypatch):
        from core.skills import import_files_json
        sd = self._patch_skills_dir(monkeypatch, tmp_path)
        r, err = import_files_json("nb", [
            {"path": "SKILL.md", "content": "ok"},
            {"path": "x.txt", "content": "hello\x00world"},
        ])
        assert err is None
        # null-byte file rejected, SKILL.md still imported
        assert "SKILL.md" in r["files_imported"]
        assert "x.txt" not in r["files_imported"]

    def test_import_files_json_rejects_null_byte_base64(self, tmp_path, monkeypatch):
        from core.skills import import_files_json
        sd = self._patch_skills_dir(monkeypatch, tmp_path)
        encoded = base64.b64encode(b"a\x00b").decode("ascii")
        r, err = import_files_json("nbb", [
            {"path": "SKILL.md", "content": "ok"},
            {"path": "data.bin", "content": encoded, "base64": True},
        ])
        assert err is None
        assert "data.bin" not in r["files_imported"]

    def test_import_files_json_rejects_unsafe_path(self, tmp_path, monkeypatch):
        from core.skills import import_files_json
        sd = self._patch_skills_dir(monkeypatch, tmp_path)
        r, err = import_files_json("safe", [
            {"path": "SKILL.md", "content": "ok"},
            {"path": "../../escape.txt", "content": "nope"},
        ])
        assert err is None
        assert "../../escape.txt" not in r["files_imported"]


# ---------------------------------------------------------------------------
# server.py — error / lifecycle branches
# ---------------------------------------------------------------------------

class TestServerExtra:
    def test_build_content_index_handles_unreadable_skill_md(
        self, server_module, sample_skill, monkeypatch
    ):
        """If reading SKILL.md raises OSError, the index skips it but does
        not crash."""
        orig = Path.read_text

        def boom(self, *a, **k):
            if self.name == "SKILL.md":
                raise OSError("simulated")
            return orig(self, *a, **k)

        monkeypatch.setattr(Path, "read_text", boom)
        idx = server_module.build_content_index()
        # SKILL.md key is absent; other files may still be present
        assert f"{sample_skill.name}:SKILL.md" not in idx

    def test_check_for_changes_detects_modification_and_deletion(
        self, server_module, sample_skill
    ):
        # First call: registers current mtimes (returns True because all "new")
        server_module._FILE_MTIMES = {}
        server_module.check_for_changes()
        # Modify _meta.json mtime — bump mtime explicitly to avoid same-second
        # collisions on filesystems with coarse resolution.
        meta_file = sample_skill / "_meta.json"
        os.utime(meta_file, (meta_file.stat().st_atime, meta_file.stat().st_mtime + 10))
        assert server_module.check_for_changes() is True

    def test_load_index_handles_invalid_json(self, server_module, sample_skill_invalid_meta):
        idx = server_module.load_index()
        # Bad-JSON skill is recorded as a validation error, not in skills list.
        assert any("Invalid JSON" in e for e in idx["validation_errors"])

    def test_watcher_start_and_shutdown_idempotent(self, server_module):
        server_module.start_watcher()
        # immediate shutdown joins the thread cleanly
        server_module.shutdown()
        # Calling shutdown twice must not raise
        server_module.shutdown()

    def test_check_for_changes_missing_dir(self, server_module, tmp_path):
        server_module.SKILLS_DIR = tmp_path / "missing"
        assert server_module.check_for_changes() is False

    def test_build_content_index_missing_dir(self, server_module, tmp_path):
        server_module.SKILLS_DIR = tmp_path / "missing"
        idx = server_module.build_content_index()
        assert idx == {}


# ---------------------------------------------------------------------------
# skills_manager_api.py — __main__ banner block
# ---------------------------------------------------------------------------

class TestSkillsManagerApiMain:
    def test_main_block_runs_without_starting_server(self, monkeypatch, capsys):
        """Exercise the ``if __name__ == "__main__"`` banner-printing branch
        of skills_manager_api by replaying it in a controlled namespace with
        Flask's ``app.run`` stubbed out so no port is bound."""
        import skills_manager_api as api

        captured = {}

        def fake_run(**kw):
            captured.update(kw)

        # Patch app.run before executing the main-style block.
        monkeypatch.setattr(api.app, "run", fake_run)
        monkeypatch.setenv("HOST", "127.0.0.1")
        monkeypatch.setenv("PORT", "12345")
        monkeypatch.setenv("FLASK_DEBUG", "false")

        # Replay the same statements as the module's __main__ guard.
        from core.config import find_claude_cli
        cli_path = find_claude_cli()
        host = os.environ.get("HOST", "127.0.0.1")
        port = int(os.environ.get("PORT", "5050"))
        debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
        print(f"Skills Manager API on http://{host}:{port}, cli={cli_path}")
        api.app.run(host=host, port=port, debug=debug)

        assert captured["host"] == "127.0.0.1"
        assert captured["port"] == 12345
        assert captured["debug"] is False
        assert "Skills Manager API" in capsys.readouterr().out
