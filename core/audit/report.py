# core/audit/report.py
# Markdown report assembly. Pure-function: takes the audit results and emits
# a single Markdown string.

from __future__ import annotations

import json
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Iterable, Optional

from .models import AuditFinding, today_iso
from .pass1 import aggregate_stats, collect_skill_stats, findings_to_summary
from .pass2 import Pass2Result


def _findings_table(findings: Iterable[AuditFinding]) -> str:
    rows = sorted(findings, key=lambda f: (f.severity != "error", f.severity != "warn", f.skill, f.code))
    if not rows:
        return "_No structural defects detected._\n"
    escaped_pipe = "\\|"
    lines = ["| Severity | Skill | Code | Message |", "|---|---|---|---|"]
    for f in rows:
        msg = f.message.replace("|", escaped_pipe)
        if f.detail:
            msg += f" — _{f.detail.replace('|', escaped_pipe)}_"
        lines.append(f"| {f.severity} | `{f.skill}` | `{f.code}` | {msg} |")
    return "\n".join(lines) + "\n"


def _stats_block(current: dict, previous: dict | None) -> str:
    def delta(key: str, fmt: str = "{:g}") -> str:
        cv = current.get(key)
        if previous is None or key not in previous or previous[key] == cv:
            return fmt.format(cv) if cv is not None else "—"
        pv = previous[key]
        diff = cv - pv
        sign = "+" if diff > 0 else ""
        return f"{fmt.format(cv)} ({sign}{fmt.format(diff)})"

    lines = [
        f"- Total skills: **{delta('total_skills', '{:d}')}**",
        f"- Avg SKILL.md lines: **{delta('avg_skill_md_lines')}**",
        f"- % with supporting assets: **{delta('pct_with_assets')}%**",
        f"- % with description mismatch (meta vs frontmatter): **{delta('pct_description_mismatch')}%**",
    ]
    if current.get("type_counts"):
        kv = ", ".join(f"{k}={v}" for k, v in current["type_counts"].items())
        lines.append(f"- Type distribution: {kv}")
    if current.get("source_counts"):
        kv = ", ".join(f"{k}={v}" for k, v in current["source_counts"].items())
        lines.append(f"- Source distribution: {kv}")
    return "\n".join(lines) + "\n"


def _pass2_block(p2: Pass2Result) -> str:
    if not p2:
        return "_Pass 2 skipped: no skills found._\n"
    lines = [
        f"**Skill audited:** `{p2.skill}` &nbsp; • &nbsp; "
        f"**Score:** {p2.review_score}/100 &nbsp; • &nbsp; "
        f"**Proposed tier:** **{p2.relevance_tier}**",
        "",
        f"_{p2.rubric.get('proposed_tier_justification', '')}_",
        "",
        "**Deterministic rubric:**",
        f"- when-to-use clause distinct from {len(p2.sibling_skills)} sibling(s): "
        f"**{p2.rubric.get('when_to_use_distinct')}** "
        f"(closest overlap = {p2.rubric.get('closest_sibling_overlap')})",
        f"- trigger cue ('use/when/for') present: **{p2.rubric.get('trigger_cue_present')}**",
        f"- ships scripts/: **{p2.rubric.get('has_scripts')}** &nbsp; "
        f"ships references/: **{p2.rubric.get('has_references')}** &nbsp; "
        f"sub-skills: **{p2.rubric.get('n_sub_skills')}**",
        f"- SKILL.md length: **{p2.rubric.get('line_count')}** lines",
    ]
    if p2.rubric.get("version_mentions"):
        lines.append(f"- pinned versions detected: `{', '.join(p2.rubric['version_mentions'])}`")
    if p2.suggestions:
        lines.append("")
        lines.append("**Suggestions:**")
        for s in p2.suggestions:
            lines.append(f"- {s}")
    if p2.llm_error:
        lines.append("")
        lines.append(f"> _LLM rubric skipped: {p2.llm_error}_")
    elif p2.llm_answer:
        lines.append("")
        lines.append("<details><summary>LLM rubric answer</summary>")
        lines.append("")
        lines.append(p2.llm_answer.strip())
        lines.append("")
        lines.append("</details>")
    return "\n".join(lines) + "\n"


def _tier_watch_block(stats: dict, previous_tiers: dict[str, str] | None) -> str:
    """Surface skills currently in Tier C or D, marking those that slid since
    the previous snapshot.
    """
    current_tiers: dict[str, str] = {}
    for name, s in stats.items():
        t = s.meta.get("relevance_tier")
        if t:
            current_tiers[name] = t

    cd = sorted(
        n for n, t in current_tiers.items() if t in ("C", "D")
    )
    if not cd:
        return "_No skills currently in Tier C or D._\n"

    lines = ["| Skill | Tier | Slid from |", "|---|---|---|"]
    for n in cd:
        prev = (previous_tiers or {}).get(n)
        slid = prev if prev and prev != current_tiers[n] else "—"
        lines.append(f"| `{n}` | **{current_tiers[n]}** | {slid} |")
    return "\n".join(lines) + "\n"


def _pass3_block(p3: dict) -> str:
    out: list[str] = []
    overlaps = p3.get("overlap_pairs", [])
    if overlaps:
        out.append("**Sibling description overlap (≥0.55 Jaccard):**\n")
        out.append("| Tag | Skill A | Skill B | Overlap |")
        out.append("|---|---|---|---|")
        for p in overlaps[:25]:
            out.append(f"| `{p['tag']}` | `{p['skill_a']}` | `{p['skill_b']}` | {p['overlap']} |")
        out.append("")
    routers = p3.get("router_necessity", [])
    if routers:
        out.append("**Router necessity:**\n")
        out.append("| Router | Leaves | Weak leaves | Recommendation |")
        out.append("|---|---|---|---|")
        for r in routers:
            out.append(
                f"| `{r['router']}` | {len(r['leaves'])} | {r['weak_leaves']} | {r['recommendation']} |"
            )
        out.append("")
    cd = p3.get("coverage_delta", {})
    if cd:
        out.append("**Coverage delta (tag cluster sizes vs last weekly snapshot):**\n")
        if cd.get("grew"):
            out.append("- Grew: " + ", ".join(f"`{t}` {a}→{b}" for t, (a, b) in cd["grew"].items()))
        if cd.get("shrank"):
            out.append("- Shrank: " + ", ".join(f"`{t}` {a}→{b}" for t, (a, b) in cd["shrank"].items()))
        if cd.get("new"):
            out.append("- New tags: " + ", ".join(f"`{t}`" for t in cd["new"]))
        if cd.get("gone"):
            out.append("- Removed tags: " + ", ".join(f"`{t}`" for t in cd["gone"]))
        if not any(cd.get(k) for k in ("grew", "shrank", "new", "gone")):
            out.append("_No tag-cluster changes since the previous snapshot._")
        out.append("")
    src = p3.get("source_distribution", {})
    if src:
        out.append("**Source distribution:** " + ", ".join(f"{k}={v}" for k, v in src.items()))
    return "\n".join(out) + "\n"


def render_daily_report(
    *,
    findings: list[AuditFinding],
    stats: dict,
    aggregate: dict,
    previous_aggregate: Optional[dict],
    previous_tiers: Optional[dict[str, str]],
    pass2: Optional[Pass2Result],
    weekly: Optional[dict] = None,
    when: Optional[str] = None,
) -> str:
    """Render the full daily Markdown report."""
    when = when or today_iso()
    summary = findings_to_summary(findings)
    parts: list[str] = []
    parts.append(f"# Skills Catalogue — Daily Audit ({when})\n")
    parts.append(
        f"**Findings:** "
        + ", ".join(f"`{k}`={v}" for k, v in sorted(summary.items()))
        + (" — clean run!" if not summary else "")
        + "\n"
    )

    parts.append("## 1. Hygiene defects\n")
    parts.append(_findings_table(findings))

    parts.append("\n## 2. Today's deep-dive\n")
    parts.append(_pass2_block(pass2) if pass2 else "_No skill selected._\n")

    parts.append("\n## 3. Tier-C/D watch list\n")
    parts.append(_tier_watch_block(stats, previous_tiers))

    parts.append("\n## 4. Stats delta\n")
    parts.append(_stats_block(aggregate, previous_aggregate))

    if weekly:
        parts.append("\n## 5. Weekly catalogue review\n")
        parts.append(_pass3_block(weekly))

    return "\n".join(parts)


# ---------- State persistence for day-over-day deltas ----------

def load_state(state_path: Path) -> dict:
    """Load persisted audit state (previous aggregate stats + tier snapshot)."""
    if not state_path.exists():
        return {}
    try:
        return json.loads(state_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def save_state(state_path: Path, *, aggregate: dict, tiers: dict[str, str]) -> None:
    """Persist audit state for next run's deltas."""
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(
        json.dumps(
            {"aggregate": aggregate, "tiers": tiers, "saved_at": today_iso()},
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )


def current_tier_map(skills_dir: Path) -> dict[str, str]:
    """Snapshot every skill's stored ``relevance_tier`` (only those that have one)."""
    out: dict[str, str] = {}
    for skill_dir in collect_skill_stats(skills_dir).keys():
        # collect_skill_stats already loaded each meta; re-loading here keeps
        # this helper independent of caller-side stat caching.
        from .models import load_meta as _lm

        meta = _lm(skills_dir / skill_dir)
        t = meta.get("relevance_tier")
        if t:
            out[skill_dir] = t
    return out
