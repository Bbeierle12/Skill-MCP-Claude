# core/audit/pass1.py
# Pass 1 — deterministic structural audit. No LLM calls.
#
# Each check emits an AuditFinding. The full set is returned so a report
# generator can sort/group them by severity or skill.

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
from typing import Iterable

from .models import (
    AuditFinding,
    SkillStats,
    TRIGGER_CUE_PATTERN,
    extract_frontmatter_description,
    extract_referenced_paths,
    iter_skill_dirs,
    load_meta,
    load_skill_md,
)

# Thresholds — tweakable but documented.
THIN_LINE_THRESHOLD = 60
SPLIT_LINE_THRESHOLD = 500
SHORT_DESCRIPTION_CHARS = 120
STALE_REVIEW_DAYS = 30


def collect_skill_stats(skills_dir: Path) -> dict[str, SkillStats]:
    """Gather lightweight per-skill facts in one pass over the filesystem."""
    stats: dict[str, SkillStats] = {}
    for skill_dir in iter_skill_dirs(skills_dir):
        content = load_skill_md(skill_dir)
        meta = load_meta(skill_dir)
        stats[skill_dir.name] = SkillStats(
            name=skill_dir.name,
            skill_md_lines=content.count("\n") + (1 if content and not content.endswith("\n") else 0),
            has_scripts=(skill_dir / "scripts").is_dir(),
            has_references=(skill_dir / "references").is_dir(),
            has_templates=(skill_dir / "templates").is_dir(),
            has_assets_dir=(skill_dir / "assets").is_dir(),
            n_sub_skills=len(meta.get("sub_skills") or []),
            frontmatter_description=extract_frontmatter_description(content),
            meta=meta,
        )
    return stats


def _has_supporting_assets(s: SkillStats) -> bool:
    return (
        s.has_scripts
        or s.has_references
        or s.has_templates
        or s.has_assets_dir
        or s.n_sub_skills > 0
    )


def run_pass1(
    skills_dir: Path,
    *,
    today: date | None = None,
    stale_days: int = STALE_REVIEW_DAYS,
) -> list[AuditFinding]:
    """Run every Pass 1 check and return all findings.

    Args:
        skills_dir: Directory holding skill subdirectories.
        today: Optional reference date for "stale review" check (test seam).
        stale_days: How many days since ``last_reviewed_at`` is considered stale.
    """
    findings: list[AuditFinding] = []
    today = today or date.today()
    all_stats = collect_skill_stats(skills_dir)
    all_names = set(all_stats)

    for name, s in all_stats.items():
        skill_dir = skills_dir / name
        meta = s.meta

        # 1. SKILL.md + _meta.json existence
        if not (skill_dir / "SKILL.md").exists():
            findings.append(AuditFinding(name, "missing-skill-md", "error", "SKILL.md missing"))
        if not (skill_dir / "_meta.json").exists():
            findings.append(AuditFinding(name, "missing-meta", "error", "_meta.json missing"))
            continue  # remaining checks all need meta

        # 2. name matches directory
        meta_name = meta.get("name")
        if meta_name and meta_name != name:
            findings.append(
                AuditFinding(
                    name, "name-mismatch", "error",
                    "_meta.json name does not match directory name",
                    detail=f"meta.name={meta_name!r} dir={name!r}",
                )
            )

        # 3. description parity between _meta.json and SKILL.md frontmatter
        meta_desc = (meta.get("description") or "").strip()
        fm_desc = (s.frontmatter_description or "").strip()
        if meta_desc and fm_desc and meta_desc != fm_desc:
            findings.append(
                AuditFinding(
                    name, "description-mismatch", "warn",
                    "description differs between _meta.json and SKILL.md frontmatter",
                    detail=f"meta={meta_desc[:80]!r} ... fm={fm_desc[:80]!r}",
                )
            )
        if not meta_desc:
            findings.append(AuditFinding(name, "missing-description", "error", "description is empty"))

        # 4. Referenced paths in SKILL.md must exist.
        # Meta-tooling / scaffolding skills DOCUMENT path patterns by design
        # (e.g. skill-creator, router-template). Demote their broken refs to
        # informational so they don't pollute the CI error budget.
        content = load_skill_md(skill_dir)
        tag_set = set(meta.get("tags", []) or [])
        is_meta = bool(tag_set & {"meta-tooling", "scaffolding"})
        ref_severity = "info" if is_meta else "error"
        for ref in extract_referenced_paths(content):
            if not (skill_dir / ref).exists():
                findings.append(
                    AuditFinding(
                        name, "broken-reference", ref_severity,
                        f"SKILL.md references missing path: {ref}",
                        detail=ref,
                    )
                )

        # 5. depends_on / enhances targets must exist
        for field_name in ("depends_on", "enhances"):
            for target in meta.get(field_name, []) or []:
                if target not in all_names:
                    findings.append(
                        AuditFinding(
                            name, "unknown-relation", "error",
                            f"{field_name} target does not exist",
                            detail=f"{field_name} -> {target!r}",
                        )
                    )

        # 6. Sub-skills: file must exist, triggers must be globally unique
        for sub in meta.get("sub_skills", []) or []:
            sub_file = sub.get("file")
            if sub_file and not (skill_dir / sub_file).exists():
                findings.append(
                    AuditFinding(
                        name, "missing-sub-skill-file", "error",
                        f"sub-skill file missing: {sub_file}",
                        detail=f"sub={sub.get('name')!r}",
                    )
                )

        # 7. Description quality
        if meta_desc and len(meta_desc) < SHORT_DESCRIPTION_CHARS:
            findings.append(
                AuditFinding(
                    name, "short-description", "warn",
                    f"description is shorter than {SHORT_DESCRIPTION_CHARS} chars ({len(meta_desc)})",
                )
            )
        if meta_desc and not TRIGGER_CUE_PATTERN.search(meta_desc):
            findings.append(
                AuditFinding(
                    name, "no-trigger-cue", "warn",
                    "description has no 'use / when / for' cue — auto-selection may degrade",
                )
            )

        # 8. Size flags
        if s.skill_md_lines > SPLIT_LINE_THRESHOLD:
            findings.append(
                AuditFinding(
                    name, "split-candidate", "info",
                    f"SKILL.md is {s.skill_md_lines} lines (>{SPLIT_LINE_THRESHOLD}); consider moving examples into references/",
                )
            )
        if s.skill_md_lines and s.skill_md_lines < THIN_LINE_THRESHOLD and not _has_supporting_assets(s):
            findings.append(
                AuditFinding(
                    name, "thin-skill", "info",
                    f"SKILL.md is {s.skill_md_lines} lines and ships no scripts/references/templates",
                )
            )

        # 9. Stale review
        last = meta.get("last_reviewed_at")
        stale = False
        if not last:
            stale = True
            detail = "never reviewed"
        else:
            try:
                last_d = date.fromisoformat(str(last)[:10])
                age = (today - last_d).days
                if age > stale_days:
                    stale = True
                    detail = f"{age} days since last review"
                else:
                    detail = f"{age} days since last review"
            except ValueError:
                stale = True
                detail = f"unparseable last_reviewed_at={last!r}"
        if stale:
            findings.append(
                AuditFinding(name, "stale-review", "info", "skill is due for content audit", detail=detail)
            )

    # 10. Sub-skill trigger global uniqueness (cross-skill)
    seen: dict[str, str] = {}
    for name, s in all_stats.items():
        for sub in s.meta.get("sub_skills", []) or []:
            for trig in sub.get("triggers", []) or []:
                key = trig.strip().lower()
                if not key:
                    continue
                owner = f"{name}::{sub.get('name')}"
                if key in seen and seen[key] != owner:
                    findings.append(
                        AuditFinding(
                            name, "duplicate-trigger", "error",
                            f"sub-skill trigger {trig!r} is also used by {seen[key]}",
                        )
                    )
                else:
                    seen[key] = owner

    return findings


def aggregate_stats(stats: dict[str, SkillStats]) -> dict:
    """Compute the catalogue-wide numbers used in report headers and stats deltas."""
    n = len(stats)
    if n == 0:
        return {
            "total_skills": 0,
            "avg_skill_md_lines": 0.0,
            "pct_with_assets": 0.0,
            "pct_description_mismatch": 0.0,
            "type_counts": {},
            "source_counts": {},
        }

    total_lines = sum(s.skill_md_lines for s in stats.values())
    with_assets = sum(1 for s in stats.values() if _has_supporting_assets(s))

    mismatches = 0
    type_counts: dict[str, int] = {}
    source_counts: dict[str, int] = {}
    for s in stats.values():
        meta_desc = (s.meta.get("description") or "").strip()
        fm_desc = (s.frontmatter_description or "").strip()
        if meta_desc and fm_desc and meta_desc != fm_desc:
            mismatches += 1
        type_counts[s.meta.get("type", "?")] = type_counts.get(s.meta.get("type", "?"), 0) + 1
        source_counts[s.meta.get("source", "?")] = source_counts.get(s.meta.get("source", "?"), 0) + 1

    return {
        "total_skills": n,
        "avg_skill_md_lines": round(total_lines / n, 1),
        "pct_with_assets": round(with_assets / n * 100, 1),
        "pct_description_mismatch": round(mismatches / n * 100, 1),
        "type_counts": dict(sorted(type_counts.items())),
        "source_counts": dict(sorted(source_counts.items())),
    }


def findings_to_summary(findings: Iterable[AuditFinding]) -> dict[str, int]:
    """Count findings by code for the report header and CI gating."""
    out: dict[str, int] = {}
    for f in findings:
        out[f.code] = out.get(f.code, 0) + 1
    return out
