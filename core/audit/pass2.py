# core/audit/pass2.py
# Pass 2 — content audit for ONE skill per run, on a rolling cycle.
#
# Strategy:
#   1. Pick the skill with the oldest last_reviewed_at (never-reviewed wins).
#   2. Always run a deterministic rubric — distinctness vs. siblings, library
#      version hints, cross-reference suggestions, proposed relevance_tier.
#   3. If the Claude CLI is available, also ask it the rubric questions via
#      the existing improve_skill_with_claude function and capture its answer
#      under "llm_answer". When the CLI is missing (e.g. CI), the deterministic
#      rubric stands alone and the report says so.
#   4. Write last_reviewed_at + review_score + relevance_tier back into the
#      audited skill's _meta.json.

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Optional

from .models import (
    AUDIT_META_FIELDS,
    RELEVANCE_TIERS,
    TRIGGER_CUE_PATTERN,
    iter_skill_dirs,
    load_meta,
    load_skill_md,
    save_meta,
    today_iso,
)

# Skills whose dominant value is a pinned library API are Tier A regardless of
# how short the SKILL.md is — the value lives in the recipes. These tag names
# are matched as exact strings against the skill's `tags` array.
_LIBRARY_HEAVY_TAGS = {
    "three.js",
    "r3f",
    "glsl",
    "shaders",
    "p5.js",
    "tone.js",
    "gsap",
    "react",
    "vue",
    "ffmpeg",
}

# Skills whose primary content is process / discipline advice. These slide
# toward Tier B/C as base-model capability grows.
_PROCESS_TAGS = {"process", "workflow", "planning", "debugging", "meta-tooling"}

# Library / framework versions to flag when their stated version looks dated.
# This is purely a heuristic prompt for the human reviewer.
_VERSION_PATTERN = re.compile(
    r"\b(react|vue|three|node|python|typescript|tailwind|next|express)\b"
    r"[^\n]{0,40}?"
    r"\b(v?\d+\.\d+(?:\.\d+)?)\b",
    re.IGNORECASE,
)


@dataclass
class Pass2Result:
    """Structured outcome of one Pass 2 audit."""

    skill: str
    rubric: dict = field(default_factory=dict)
    review_score: int = 0
    relevance_tier: str = "B"
    llm_answer: Optional[str] = None
    llm_error: Optional[str] = None
    suggestions: list[str] = field(default_factory=list)
    sibling_skills: list[str] = field(default_factory=list)


# ---------- Skill selection ----------

def select_next_skill(skills_dir: Path, *, today: date | None = None) -> Optional[str]:
    """Return the skill name with the oldest ``last_reviewed_at`` (never-reviewed wins).

    Ties are broken by name for deterministic behaviour in tests.
    """
    candidates: list[tuple[str, str]] = []  # (sort_key, name)
    for skill_dir in iter_skill_dirs(skills_dir):
        meta = load_meta(skill_dir)
        last = meta.get("last_reviewed_at") or ""
        candidates.append((str(last), skill_dir.name))
    if not candidates:
        return None
    candidates.sort(key=lambda c: (c[0] or "0000-00-00", c[1]))
    return candidates[0][1]


# ---------- Deterministic rubric ----------

def _siblings_by_tag(skills_dir: Path, target_name: str, tags: list[str]) -> list[str]:
    """Return names of other skills that share at least one tag with the target."""
    if not tags:
        return []
    tag_set = set(tags)
    out: list[str] = []
    for skill_dir in iter_skill_dirs(skills_dir):
        if skill_dir.name == target_name:
            continue
        meta = load_meta(skill_dir)
        other_tags = set(meta.get("tags", []) or [])
        if tag_set & other_tags:
            out.append(skill_dir.name)
    return sorted(out)


def _description_distinctness(target_desc: str, sibling_descs: list[str]) -> tuple[bool, float]:
    """Crude bag-of-words distinctness score against sibling descriptions.

    Returns (is_distinct, jaccard_overlap_against_closest_sibling).
    """
    if not target_desc or not sibling_descs:
        return True, 0.0
    target_words = {w for w in re.findall(r"[a-z0-9]{4,}", target_desc.lower())}
    if not target_words:
        return True, 0.0
    best = 0.0
    for s in sibling_descs:
        other = {w for w in re.findall(r"[a-z0-9]{4,}", s.lower())}
        if not other:
            continue
        inter = len(target_words & other)
        union = len(target_words | other) or 1
        best = max(best, inter / union)
    return best < 0.6, round(best, 3)


def _propose_tier(meta: dict, content: str, line_count: int) -> tuple[str, str]:
    """Heuristic tier proposal. Returns (tier, justification)."""
    tags = set(meta.get("tags", []) or [])
    skill_type = meta.get("type", "")
    has_scripts = bool(meta.get("has_scripts")) or False  # may not be present
    # Tier A: ships pinned library recipes or proprietary knowledge.
    if tags & _LIBRARY_HEAVY_TAGS:
        return "A", "ships pinned API recipes for a library that models still hallucinate"
    if "reference" in tags and skill_type == "discipline":
        return "A", "encodes proprietary or org-specific reference material"
    if skill_type == "router":
        return "C", "router skills add indirection; modern models route well from leaf descriptions alone"
    if tags & _PROCESS_TAGS and line_count < 200:
        return "B", "process / discipline content largely overlaps base-model knowledge; keep as house-style contract"
    if line_count < 60 and not (
        "scripts" in content or "references" in content or "templates" in content
    ):
        return "C", "thin prose with no supporting assets; likely redundant with base-model output"
    return "B", "useful but partially redundant with base-model capability; trim explanatory padding"


def _score(rubric: dict) -> int:
    """Composite 0-100 review score. Each subscore is 0-25."""
    return sum(
        max(0, min(25, int(rubric.get(k, 0))))
        for k in ("distinctness", "asset_richness", "freshness", "cross_references")
    )


def run_deterministic_rubric(
    skills_dir: Path, skill_name: str, *, today: date | None = None
) -> Pass2Result:
    """Apply the deterministic rubric to one skill. Does not write to disk."""
    skill_dir = skills_dir / skill_name
    meta = load_meta(skill_dir)
    content = load_skill_md(skill_dir)
    line_count = content.count("\n") + (1 if content and not content.endswith("\n") else 0)
    tags = list(meta.get("tags") or [])
    desc = (meta.get("description") or "").strip()

    siblings = _siblings_by_tag(skills_dir, skill_name, tags)
    sibling_descs = []
    for sib in siblings:
        sib_meta = load_meta(skills_dir / sib)
        sib_desc = (sib_meta.get("description") or "").strip()
        if sib_desc:
            sibling_descs.append(sib_desc)
    is_distinct, overlap = _description_distinctness(desc, sibling_descs)

    # Sub-scores (each out of 25, summed to a 0-100 review_score).
    distinctness_score = 25 if is_distinct else max(0, int(25 * (1 - overlap)))

    asset_richness_score = 25
    if not (skill_dir / "scripts").is_dir():
        asset_richness_score -= 6
    if not (skill_dir / "references").is_dir():
        asset_richness_score -= 6
    if line_count < 60:
        asset_richness_score -= 6
    if not meta.get("sub_skills"):
        asset_richness_score -= 3
    asset_richness_score = max(0, asset_richness_score)

    last = meta.get("last_reviewed_at")
    today_d = today or date.today()
    if not last:
        freshness_score = 0
    else:
        try:
            age = (today_d - date.fromisoformat(str(last)[:10])).days
            freshness_score = max(0, 25 - max(0, age - 14))  # full marks within 14 days
        except ValueError:
            freshness_score = 0

    cross_ref_score = 25
    if not (meta.get("depends_on") or meta.get("enhances")):
        cross_ref_score -= 10
    cross_ref_score = max(0, cross_ref_score)

    rubric: dict = {
        "when_to_use_distinct": is_distinct,
        "closest_sibling_overlap": overlap,
        "trigger_cue_present": bool(TRIGGER_CUE_PATTERN.search(desc)) if desc else False,
        "version_mentions": [
            f"{m.group(1)} {m.group(2)}" for m in _VERSION_PATTERN.finditer(content)
        ][:5],
        "has_scripts": (skill_dir / "scripts").is_dir(),
        "has_references": (skill_dir / "references").is_dir(),
        "n_sub_skills": len(meta.get("sub_skills") or []),
        "line_count": line_count,
        # Subscores
        "distinctness": distinctness_score,
        "asset_richness": asset_richness_score,
        "freshness": freshness_score,
        "cross_references": cross_ref_score,
    }
    tier, justification = _propose_tier(meta, content, line_count)
    rubric["proposed_tier_justification"] = justification

    suggestions: list[str] = []
    if not is_distinct:
        suggestions.append(
            f"Tighten the 'when to use' clause — {overlap*100:.0f}% term overlap with a sibling in the same tag cluster."
        )
    if line_count > 500:
        suggestions.append(
            "Consider moving long examples into references/ to keep SKILL.md scannable (<500 lines)."
        )
    if not (meta.get("depends_on") or meta.get("enhances")):
        suggestions.append(
            "Skill has no depends_on / enhances edges — verify it should be standalone."
        )
    if desc and not TRIGGER_CUE_PATTERN.search(desc):
        suggestions.append(
            "Add an explicit 'Use when ...' clause to the description so Claude can auto-select the skill."
        )
    if rubric["version_mentions"]:
        suggestions.append(
            "Verify pinned library versions are still current: " + ", ".join(rubric["version_mentions"])
        )

    return Pass2Result(
        skill=skill_name,
        rubric=rubric,
        review_score=_score(rubric),
        relevance_tier=tier,
        suggestions=suggestions,
        sibling_skills=siblings,
    )


# ---------- LLM-assisted rubric ----------

_RUBRIC_PROMPT = """You are auditing a skill in a Claude Skills catalogue.

Answer these five questions concisely, one short paragraph each.
Return the answers as a Markdown list under the exact headings shown.

1. **When-to-use clarity** — Is the description's "when to use" clause clear and
   distinct from these sibling skills in the same tag cluster: {siblings}?
2. **API freshness** — Do any code examples reference deprecated APIs or old
   library versions that should be updated?
3. **Base-model redundancy** — Does any section duplicate knowledge a current
   frontier model would produce unprompted? Quote and recommend deletion if so.
4. **Cross-references** — Should this skill add `depends_on` / `enhances`
   edges to other skills in the catalogue? Suggest them.
5. **Relevance tier (A/B/C/D)** — One sentence: which tier and why.

Do NOT rewrite the SKILL.md. Output only the audit answers."""


def run_llm_rubric(skill_name: str, siblings: list[str]) -> tuple[Optional[str], Optional[str]]:
    """Ask Claude CLI the rubric questions. Returns (answer, error).

    Imported lazily so test environments without the CLI module-load side
    effects still work.
    """
    try:
        from core.claude_cli import improve_skill_with_claude  # noqa: WPS433
    except Exception as exc:  # pragma: no cover - import-time failure is exotic
        return None, f"failed to import claude_cli: {exc}"

    request = _RUBRIC_PROMPT.format(siblings=", ".join(siblings) or "(no siblings)")
    result, err = improve_skill_with_claude(skill_name=skill_name, improvement_request=request)
    if err:
        return None, err
    # improve_skill_with_claude returns the model's full response under
    # "improved_content"; for an audit we don't use it as a replacement —
    # we just keep the text.
    return (result or {}).get("improved_content"), None


# ---------- Orchestration ----------

def run_pass2(
    skills_dir: Path,
    *,
    skill_name: Optional[str] = None,
    use_llm: bool = True,
    today: date | None = None,
) -> Pass2Result:
    """Run Pass 2 on one skill. Writes audit fields back into _meta.json.

    Args:
        skills_dir: catalogue directory.
        skill_name: optional explicit skill to audit; default picks the oldest.
        use_llm: when False, skip the Claude CLI call entirely (tests / CI).
    """
    if skill_name is None:
        skill_name = select_next_skill(skills_dir, today=today)
    if skill_name is None:
        raise RuntimeError("no skills found in catalogue")

    result = run_deterministic_rubric(skills_dir, skill_name, today=today)

    if use_llm:
        answer, err = run_llm_rubric(skill_name, result.sibling_skills)
        result.llm_answer = answer
        result.llm_error = err

    # Persist audit metadata.
    meta = load_meta(skills_dir / skill_name)
    meta["last_reviewed_at"] = today_iso() if today is None else today.isoformat()
    meta["review_score"] = result.review_score
    # Only update the tier if it is missing OR the deterministic proposal is
    # more conservative (further down the A→D scale) than the stored tier.
    # Defensively guard against unexpected stored values — never auto-promote.
    stored_tier = meta.get("relevance_tier")
    proposed = result.relevance_tier
    if proposed in RELEVANCE_TIERS:
        if stored_tier not in RELEVANCE_TIERS:
            meta["relevance_tier"] = proposed
        elif RELEVANCE_TIERS.index(proposed) > RELEVANCE_TIERS.index(stored_tier):
            meta["relevance_tier"] = proposed
    save_meta(skills_dir / skill_name, meta)

    return result


__all__ = [
    "Pass2Result",
    "run_pass2",
    "run_deterministic_rubric",
    "select_next_skill",
    "AUDIT_META_FIELDS",
]
