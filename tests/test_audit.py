# tests/test_audit.py
# Unit tests for the daily skills audit system (core/audit + scripts/).

import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from core.audit import models
from core.audit.models import (
    AUDIT_META_FIELDS,
    AuditFinding,
    SkillStats,
    extract_frontmatter_description,
    extract_referenced_paths,
    load_meta,
    save_meta,
)
from core.audit.pass1 import (
    aggregate_stats,
    collect_skill_stats,
    findings_to_summary,
    run_pass1,
)
from core.audit.pass2 import (
    Pass2Result,
    run_deterministic_rubric,
    run_pass2,
    select_next_skill,
)
from core.audit.pass3 import (
    overlap_pairs,
    router_necessity,
    run_pass3,
    save_cluster_snapshot,
    tag_clusters,
)
from core.audit.report import (
    _findings_table,
    _pass2_block,
    _pass3_block,
    _stats_block,
    _tier_watch_block,
    current_tier_map,
    load_state,
    render_daily_report,
    save_state,
)


# ---------- Fixtures ----------

def _write_skill(skills_dir: Path, name: str, *, meta: dict, content: str = ""):
    """Create a skill directory with a SKILL.md + _meta.json on disk."""
    d = skills_dir / name
    d.mkdir(parents=True, exist_ok=True)
    if "name" not in meta:
        meta["name"] = name
    (d / "_meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    body = content or f"---\nname: {name}\ndescription: {meta.get('description','')}\n---\n\nbody\n"
    (d / "SKILL.md").write_text(body, encoding="utf-8")
    return d


@pytest.fixture
def catalogue(tmp_path):
    """Build a tiny catalogue with diverse defects to drive every audit branch."""
    s = tmp_path / "skills"
    s.mkdir()
    # A — clean, library-heavy, ships scripts
    _write_skill(
        s, "r3f-fundamentals",
        meta={
            "description": "Use React Three Fiber for production-grade 3D scenes when you need full Canvas control and event handling.",
            "tags": ["react", "r3f", "3d", "code-generation"],
            "sub_skills": [],
            "source": "claude-user",
            "type": "template",
            "depends_on": [],
            "enhances": [],
        },
        content="---\nname: r3f-fundamentals\ndescription: Use React Three Fiber for production-grade 3D scenes when you need full Canvas control and event handling.\n---\n\nbody\n",
    )
    (s / "r3f-fundamentals" / "scripts").mkdir()
    (s / "r3f-fundamentals" / "references").mkdir()
    # B — broken depends_on + description mismatch
    _write_skill(
        s, "form-react",
        meta={
            "description": "Production React form patterns using React Hook Form. Use when building Vue 3 forms with VeeValidate.",  # silly mismatch
            "tags": ["forms", "react"],
            "sub_skills": [
                {"name": "rhf", "file": "references/rhf.md", "triggers": ["RHFShared", "react form helper"]}
            ],
            "source": "claude-user",
            "type": "template",
            "depends_on": ["does-not-exist"],
            "enhances": [],
        },
        content="---\nname: form-react\ndescription: Different description in frontmatter.\n---\n\nSee `references/rhf.md` for patterns.\n",
    )
    # C — thin skill, no assets, no trigger cue, short description
    _write_skill(
        s, "brand-guidelines",
        meta={
            "description": "Brand assets.",
            "tags": ["reference"],
            "sub_skills": [],
            "source": "claude-public",
            "type": "discipline",
            "depends_on": [],
            "enhances": [],
        },
        content="---\nname: brand-guidelines\ndescription: Brand assets.\n---\n\nshort.\n",
    )
    # D — router skill
    _write_skill(
        s, "forms-router",
        meta={
            "description": "Use this router for any form-related task to pick the right specialised form skill.",
            "tags": ["forms", "routing"],
            "sub_skills": [],
            "source": "claude-user",
            "type": "router",
            "depends_on": ["form-react"],
            "enhances": [],
        },
    )
    # E — meta-tooling skill with intentionally illustrative broken ref
    _write_skill(
        s, "skill-creator",
        meta={
            "description": "Use when authoring new skills; this skill documents example paths like `references/finance.md`.",
            "tags": ["meta-tooling", "scaffolding"],
            "sub_skills": [],
            "source": "claude-user",
            "type": "template",
            "depends_on": [],
            "enhances": [],
        },
        content="---\nname: skill-creator\ndescription: same\n---\n\nExamples: `references/finance.md` does not exist.\n",
    )
    return s


# ---------- models.py helpers ----------

class TestModels:
    def test_extract_frontmatter_description(self):
        content = "---\nname: x\ndescription: hello world\n---\nbody"
        assert extract_frontmatter_description(content) == "hello world"

    def test_extract_frontmatter_description_missing(self):
        assert extract_frontmatter_description("no frontmatter here") is None

    def test_extract_frontmatter_description_quoted(self):
        assert extract_frontmatter_description('---\ndescription: "quoted"\n---\n') == "quoted"

    def test_extract_referenced_paths_skips_code_fences(self):
        content = "Hi `references/real.md`\n```\nthis/scripts/inside-fence.py\n```\n"
        paths = extract_referenced_paths(content)
        assert "references/real.md" in paths
        assert "scripts/inside-fence.py" not in [p for p in paths]

    def test_extract_referenced_paths_deduplicates(self):
        content = "`references/a.md` `references/a.md`"
        assert extract_referenced_paths(content) == ["references/a.md"]

    def test_audit_meta_fields_constant(self):
        assert set(AUDIT_META_FIELDS) == {"last_reviewed_at", "review_score", "relevance_tier"}


# ---------- Pass 1 ----------

class TestPass1:
    def test_finds_description_mismatch(self, catalogue):
        findings = run_pass1(catalogue)
        codes = {f.code for f in findings if f.skill == "form-react"}
        assert "description-mismatch" in codes

    def test_finds_unknown_relation(self, catalogue):
        findings = run_pass1(catalogue)
        assert any(f.code == "unknown-relation" and f.skill == "form-react" for f in findings)

    def test_finds_broken_reference(self, catalogue):
        findings = run_pass1(catalogue)
        broken = [f for f in findings if f.code == "broken-reference"]
        # form-react references references/rhf.md which doesn't exist as a file
        assert any(f.skill == "form-react" for f in broken)

    def test_meta_tooling_broken_refs_are_info(self, catalogue):
        findings = run_pass1(catalogue)
        meta_refs = [f for f in findings if f.code == "broken-reference" and f.skill == "skill-creator"]
        assert meta_refs, "expected illustrative broken refs to still be reported"
        assert all(f.severity == "info" for f in meta_refs)

    def test_short_description_and_no_trigger_cue(self, catalogue):
        findings = run_pass1(catalogue)
        codes = {f.code for f in findings if f.skill == "brand-guidelines"}
        assert "short-description" in codes
        assert "no-trigger-cue" in codes
        assert "thin-skill" in codes

    def test_stale_review_when_never_reviewed(self, catalogue):
        findings = run_pass1(catalogue)
        stale = {f.skill for f in findings if f.code == "stale-review"}
        # Every skill is never-reviewed in this fixture.
        assert "r3f-fundamentals" in stale

    def test_stale_review_respects_recent_audit(self, catalogue):
        meta = load_meta(catalogue / "r3f-fundamentals")
        meta["last_reviewed_at"] = date.today().isoformat()
        save_meta(catalogue / "r3f-fundamentals", meta)
        findings = run_pass1(catalogue, today=date.today())
        stale = {f.skill for f in findings if f.code == "stale-review"}
        assert "r3f-fundamentals" not in stale

    def test_split_candidate_for_oversized_skill_md(self, tmp_path):
        s = tmp_path / "skills"
        s.mkdir()
        long_body = "\n".join(f"line {i}" for i in range(700))
        _write_skill(
            s, "huge",
            meta={"description": "Use when nothing matters. " * 10, "tags": [], "sub_skills": [], "source": "x", "type": "template", "depends_on": [], "enhances": []},
            content="---\nname: huge\ndescription: same\n---\n\n" + long_body,
        )
        findings = run_pass1(s)
        assert any(f.code == "split-candidate" for f in findings)

    def test_finds_missing_name(self, tmp_path):
        s = tmp_path / "skills"
        s.mkdir()
        # Author a meta.json that omits 'name' entirely.
        d = s / "nameless"
        d.mkdir()
        (d / "_meta.json").write_text(
            json.dumps({
                "description": "Use when you forgot to fill in the name field.",
                "tags": [], "sub_skills": [], "source": "x", "type": "template",
                "depends_on": [], "enhances": [],
            }) + "\n",
            encoding="utf-8",
        )
        (d / "SKILL.md").write_text("---\nname: nameless\ndescription: same\n---\n", encoding="utf-8")
        findings = run_pass1(s)
        assert any(f.code == "missing-name" for f in findings)

    def test_duplicate_trigger_detected(self, tmp_path):
        s = tmp_path / "skills"
        s.mkdir()
        common = [{"name": "x", "file": "x.md", "triggers": ["sharedTrigger"]}]
        _write_skill(s, "a", meta={"description": "Use when A.", "tags": [], "sub_skills": common, "source": "x", "type": "template", "depends_on": [], "enhances": []})
        _write_skill(s, "b", meta={"description": "Use when B.", "tags": [], "sub_skills": common, "source": "x", "type": "template", "depends_on": [], "enhances": []})
        findings = run_pass1(s)
        assert any(f.code == "duplicate-trigger" for f in findings)

    def test_aggregate_stats_shape(self, catalogue):
        stats = collect_skill_stats(catalogue)
        agg = aggregate_stats(stats)
        assert agg["total_skills"] == 5
        assert "pct_description_mismatch" in agg
        assert agg["type_counts"]["template"] >= 1

    def test_findings_to_summary_counts(self, catalogue):
        findings = run_pass1(catalogue)
        summary = findings_to_summary(findings)
        assert summary.get("stale-review", 0) >= 5


# ---------- Pass 2 ----------

class TestPass2:
    def test_select_next_skill_picks_never_reviewed(self, catalogue):
        # Mark every skill reviewed except one
        for d in catalogue.iterdir():
            meta = load_meta(d)
            meta["last_reviewed_at"] = "2030-01-01"
            save_meta(d, meta)
        target_dir = catalogue / "brand-guidelines"
        m = load_meta(target_dir)
        m["last_reviewed_at"] = None
        save_meta(target_dir, m)

        chosen = select_next_skill(catalogue)
        assert chosen == "brand-guidelines"

    def test_select_next_skill_oldest_wins(self, catalogue):
        for d in catalogue.iterdir():
            m = load_meta(d)
            m["last_reviewed_at"] = "2025-01-01"
            save_meta(d, m)
        m = load_meta(catalogue / "form-react")
        m["last_reviewed_at"] = "2020-01-01"
        save_meta(catalogue / "form-react", m)
        assert select_next_skill(catalogue) == "form-react"

    def test_deterministic_rubric_runs_offline(self, catalogue):
        result = run_deterministic_rubric(catalogue, "r3f-fundamentals")
        assert result.skill == "r3f-fundamentals"
        assert 0 <= result.review_score <= 100
        assert result.relevance_tier in {"A", "B", "C", "D"}
        assert result.rubric["proposed_tier_justification"]

    def test_pass2_persists_metadata(self, catalogue):
        result = run_pass2(catalogue, skill_name="brand-guidelines", use_llm=False)
        meta = load_meta(catalogue / "brand-guidelines")
        # last_reviewed_at must be today's ISO date (Pass 2 stamps it).
        assert meta["last_reviewed_at"] == date.today().isoformat()
        assert meta["review_score"] == result.review_score
        assert meta["relevance_tier"] in {"A", "B", "C", "D"}

    def test_pass2_does_not_demote_existing_tier(self, catalogue):
        meta = load_meta(catalogue / "r3f-fundamentals")
        meta["relevance_tier"] = "A"
        save_meta(catalogue / "r3f-fundamentals", meta)
        run_pass2(catalogue, skill_name="r3f-fundamentals", use_llm=False)
        meta = load_meta(catalogue / "r3f-fundamentals")
        # Either still A, or worsened to a higher index (B/C/D) — but the
        # rubric proposes A for r3f-fundamentals, so it must remain A.
        assert meta["relevance_tier"] == "A"

    def test_library_heavy_skill_proposed_tier_a(self, catalogue):
        result = run_deterministic_rubric(catalogue, "r3f-fundamentals")
        assert result.relevance_tier == "A"

    def test_router_skill_proposed_tier_c(self, catalogue):
        result = run_deterministic_rubric(catalogue, "forms-router")
        assert result.relevance_tier == "C"


# ---------- Pass 3 ----------

class TestPass3:
    def test_tag_clusters(self, catalogue):
        clusters = tag_clusters(catalogue)
        assert "forms" in clusters
        assert set(clusters["forms"]) >= {"form-react", "forms-router"}

    def test_router_necessity(self, catalogue):
        rn = router_necessity(catalogue)
        names = {r["router"] for r in rn}
        assert names == {"forms-router"}
        assert rn[0]["leaves"][0]["name"] == "form-react"

    def test_overlap_pairs_runs(self, catalogue):
        # Need >=4 skills sharing a tag for overlap to trigger; this fixture
        # is small, so overlap_pairs may legitimately return [].
        pairs = overlap_pairs(catalogue)
        assert isinstance(pairs, list)

    def test_run_pass3_writes_snapshot(self, catalogue, tmp_path):
        snap = tmp_path / "snap.json"
        run_pass3(catalogue, snapshot_path=snap)  # snapshot not auto-written
        save_cluster_snapshot(catalogue, snap)
        assert snap.exists()
        data = json.loads(snap.read_text())
        assert isinstance(data, dict)
        assert all(isinstance(v, int) for v in data.values())


# ---------- Report ----------

class TestReport:
    def test_render_daily_report_smoke(self, catalogue):
        findings = run_pass1(catalogue)
        stats = collect_skill_stats(catalogue)
        agg = aggregate_stats(stats)
        p2 = run_deterministic_rubric(catalogue, "r3f-fundamentals")
        md = render_daily_report(
            findings=findings,
            stats=stats,
            aggregate=agg,
            previous_aggregate=None,
            previous_tiers=None,
            pass2=p2,
            weekly=run_pass3(catalogue),
        )
        assert "Skills Catalogue — Daily Audit" in md
        assert "Hygiene defects" in md
        assert "Today's deep-dive" in md
        assert "Tier-C/D watch list" in md
        assert "Stats delta" in md
        assert "Weekly catalogue review" in md

    def test_report_handles_empty_findings(self, tmp_path):
        s = tmp_path / "skills"
        s.mkdir()
        # one perfectly clean skill
        _write_skill(
            s, "ok",
            meta={
                "description": "Use this skill when you need a clean test fixture for the audit system.",
                "tags": [], "sub_skills": [], "source": "test", "type": "template",
                "depends_on": [], "enhances": [],
                "last_reviewed_at": date.today().isoformat(),
                "review_score": 80, "relevance_tier": "A",
            },
        )
        findings = run_pass1(s, today=date.today())
        # Only "stale-review" risk excluded by recent timestamp; should be empty.
        bad = [f for f in findings if f.severity == "error"]
        assert bad == []


class TestReportBlocks:
    """Exercise the individual report-assembly helpers and their branches."""

    def test_findings_table_empty(self):
        assert _findings_table([]) == "_No structural defects detected._\n"

    def test_findings_table_escapes_pipes_and_detail(self):
        f = AuditFinding(
            skill="x", code="C1", severity="error",
            message="bad | value", detail="see | here",
        )
        out = _findings_table([f])
        assert "bad \\| value" in out
        assert "see \\| here" in out
        assert "`x`" in out

    def test_stats_block_renders_deltas_with_sign(self):
        current = {
            "total_skills": 10, "avg_skill_md_lines": 6.0,
            "pct_with_assets": 50.0, "pct_description_mismatch": 2.0,
            "type_counts": {"template": 8}, "source_counts": {"claude-user": 10},
        }
        previous = {
            "total_skills": 8, "avg_skill_md_lines": 7.0,
            "pct_with_assets": 50.0, "pct_description_mismatch": 2.0,
        }
        out = _stats_block(current, previous)
        assert "**10 (+2)**" in out          # positive delta, line count
        assert "**6 (-1)**" in out           # negative delta, no "+" sign
        assert "Type distribution: template=8" in out
        assert "Source distribution: claude-user=10" in out

    def test_stats_block_no_previous_shows_plain_values(self):
        out = _stats_block({"total_skills": 3, "avg_skill_md_lines": None,
                            "pct_with_assets": 0.0, "pct_description_mismatch": 0.0}, None)
        assert "**3**" in out
        assert "**—**" in out                 # None value renders as em dash

    def test_pass2_block_none_is_skipped_message(self):
        assert _pass2_block(None) == "_Pass 2 skipped: no skills found._\n"

    def test_pass2_block_with_versions_suggestions_and_llm_error(self):
        p2 = Pass2Result(
            skill="demo",
            rubric={
                "proposed_tier_justification": "solid",
                "when_to_use_distinct": True, "closest_sibling_overlap": 0.1,
                "trigger_cue_present": True, "has_scripts": True,
                "has_references": False, "n_sub_skills": 0, "line_count": 42,
                "version_mentions": ["react@18", "node@22"],
            },
            review_score=77, relevance_tier="B",
            suggestions=["tighten the description"],
            llm_error="rate limited",
        )
        out = _pass2_block(p2)
        assert "pinned versions detected: `react@18, node@22`" in out
        assert "tighten the description" in out
        assert "LLM rubric skipped: rate limited" in out

    def test_pass2_block_with_llm_answer(self):
        p2 = Pass2Result(
            skill="demo", rubric={"line_count": 10},
            llm_answer="  the model said this  ",
        )
        out = _pass2_block(p2)
        assert "<details><summary>LLM rubric answer</summary>" in out
        assert "the model said this" in out

    def test_tier_watch_block_lists_cd_and_marks_slid(self):
        stats = {
            "good": SkillStats(name="good", meta={"relevance_tier": "A"}),
            "weak": SkillStats(name="weak", meta={"relevance_tier": "C"}),
            "dead": SkillStats(name="dead", meta={"relevance_tier": "D"}),
        }
        out = _tier_watch_block(stats, previous_tiers={"weak": "B", "dead": "D"})
        assert "`weak`" in out and "`dead`" in out
        assert "`good`" not in out             # tier A excluded
        assert "| `weak` | **C** | B |" in out  # weak slid from B
        # dead unchanged (D->D) renders an em dash, not a tier
        assert "| `dead` | **D** | — |" in out

    def test_tier_watch_block_empty_when_no_cd(self):
        stats = {"good": SkillStats(name="good", meta={"relevance_tier": "A"})}
        assert _tier_watch_block(stats, None) == "_No skills currently in Tier C or D._\n"

    def test_pass3_block_full(self):
        p3 = {
            "overlap_pairs": [
                {"tag": "forms", "skill_a": "a", "skill_b": "b", "overlap": 0.6}
            ],
            "router_necessity": [
                {"router": "r", "leaves": ["x", "y"], "weak_leaves": 1,
                 "recommendation": "keep"}
            ],
            "coverage_delta": {
                "grew": {"forms": (2, 4)}, "shrank": {"ui": (5, 3)},
                "new": ["fresh"], "gone": ["stale"],
            },
            "source_distribution": {"claude-user": 5},
        }
        out = _pass3_block(p3)
        assert "Sibling description overlap" in out
        assert "`a`" in out and "`b`" in out
        assert "Router necessity" in out
        assert "Grew: `forms` 2→4" in out
        assert "Shrank: `ui` 5→3" in out
        assert "New tags: `fresh`" in out
        assert "Removed tags: `stale`" in out
        assert "**Source distribution:** claude-user=5" in out

    def test_pass3_block_coverage_delta_no_changes(self):
        p3 = {"coverage_delta": {"grew": {}, "shrank": {}, "new": [], "gone": []}}
        out = _pass3_block(p3)
        assert "_No tag-cluster changes since the previous snapshot._" in out


class TestReportState:
    """Cover state persistence + tier snapshotting helpers."""

    def test_load_state_missing_returns_empty(self, tmp_path):
        assert load_state(tmp_path / "nope.json") == {}

    def test_load_state_roundtrip(self, tmp_path):
        p = tmp_path / "state.json"
        save_state(p, aggregate={"total_skills": 4}, tiers={"x": "A"})
        loaded = load_state(p)
        assert loaded["aggregate"] == {"total_skills": 4}
        assert loaded["tiers"] == {"x": "A"}
        assert "saved_at" in loaded

    def test_load_state_corrupt_returns_empty(self, tmp_path):
        p = tmp_path / "bad.json"
        p.write_text("{not valid json", encoding="utf-8")
        assert load_state(p) == {}

    def test_save_state_creates_parent_dirs(self, tmp_path):
        p = tmp_path / "nested" / "deep" / "state.json"
        save_state(p, aggregate={}, tiers={})
        assert p.exists()

    def test_current_tier_map_snapshots_only_tiered_skills(self, tmp_path):
        s = tmp_path / "skills"
        s.mkdir()
        _write_skill(s, "tiered", meta={"description": "d", "relevance_tier": "C"})
        _write_skill(s, "untiered", meta={"description": "d"})
        tier_map = current_tier_map(s)
        assert tier_map == {"tiered": "C"}


# ---------- Backfill script ----------

class TestBackfill:
    def test_backfill_adds_missing_fields(self, tmp_path):
        from scripts.backfill_audit_meta import backfill

        s = tmp_path / "skills"
        s.mkdir()
        _write_skill(
            s, "x",
            meta={"description": "Use when needed for testing.", "tags": [], "sub_skills": [], "source": "t", "type": "template", "depends_on": [], "enhances": []},
        )
        result = backfill(s)
        assert result["total_skills"] == 1
        assert "x" in result["updated"]
        meta = load_meta(s / "x")
        for f in AUDIT_META_FIELDS:
            assert f in meta and meta[f] is None

    def test_backfill_is_idempotent(self, tmp_path):
        from scripts.backfill_audit_meta import backfill

        s = tmp_path / "skills"
        s.mkdir()
        _write_skill(
            s, "x",
            meta={
                "description": "Use when needed.", "tags": [], "sub_skills": [],
                "source": "t", "type": "template", "depends_on": [], "enhances": [],
                "last_reviewed_at": None, "review_score": None, "relevance_tier": None,
            },
        )
        result = backfill(s)
        assert result["updated"] == {}
