# core/audit/pass3.py
# Pass 3 — weekly catalogue-level audit.
#
# Produces structured data only; the report module formats it.

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Optional

from .models import iter_skill_dirs, load_meta

# Minimum cluster size to be analysed for description overlap.
CLUSTER_MIN = 4
# Jaccard overlap threshold above which two sibling descriptions look redundant.
OVERLAP_THRESHOLD = 0.55


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]{4,}", text.lower())}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def tag_clusters(skills_dir: Path) -> dict[str, list[str]]:
    """Return tag -> [skill names] for every tag in the catalogue."""
    out: dict[str, list[str]] = defaultdict(list)
    for skill_dir in iter_skill_dirs(skills_dir):
        meta = load_meta(skill_dir)
        for t in meta.get("tags", []) or []:
            out[t].append(skill_dir.name)
    return dict(sorted(out.items()))


def overlap_pairs(skills_dir: Path) -> list[dict]:
    """For each tag cluster of size >= CLUSTER_MIN, list sibling pairs whose
    descriptions exceed OVERLAP_THRESHOLD Jaccard similarity.
    """
    descs: dict[str, str] = {}
    for skill_dir in iter_skill_dirs(skills_dir):
        meta = load_meta(skill_dir)
        descs[skill_dir.name] = (meta.get("description") or "").strip()

    pairs: list[dict] = []
    for tag, names in tag_clusters(skills_dir).items():
        if len(names) < CLUSTER_MIN:
            continue
        for i, a in enumerate(names):
            wa = _words(descs.get(a, ""))
            for b in names[i + 1:]:
                wb = _words(descs.get(b, ""))
                score = _jaccard(wa, wb)
                if score >= OVERLAP_THRESHOLD:
                    pairs.append({
                        "tag": tag,
                        "skill_a": a,
                        "skill_b": b,
                        "overlap": round(score, 3),
                    })
    pairs.sort(key=lambda p: -p["overlap"])
    return pairs


def router_necessity(skills_dir: Path) -> list[dict]:
    """For each router skill, summarise whether its leaves carry strong enough
    descriptions to make the router redundant.
    """
    out: list[dict] = []
    for skill_dir in iter_skill_dirs(skills_dir):
        meta = load_meta(skill_dir)
        if meta.get("type") != "router":
            continue
        leaves = list(meta.get("depends_on") or [])
        leaf_info: list[dict] = []
        weak_leaves = 0
        for leaf in leaves:
            leaf_meta = load_meta(skills_dir / leaf)
            leaf_desc = (leaf_meta.get("description") or "").strip()
            strong = (
                len(leaf_desc) >= 120
                and re.search(r"\b(use|when|for)\b", leaf_desc, re.I) is not None
            )
            if not strong:
                weak_leaves += 1
            leaf_info.append({
                "name": leaf,
                "description_chars": len(leaf_desc),
                "strong": strong,
            })
        out.append({
            "router": skill_dir.name,
            "leaves": leaf_info,
            "weak_leaves": weak_leaves,
            "recommendation": (
                "Router justified — at least one leaf has a weak description."
                if weak_leaves
                else "All leaves carry strong descriptions; consider deprecating the router."
            ),
        })
    return out


def source_distribution(skills_dir: Path) -> dict[str, int]:
    """Catalogue-wide counts of skills per `source` value."""
    counts: dict[str, int] = defaultdict(int)
    for skill_dir in iter_skill_dirs(skills_dir):
        meta = load_meta(skill_dir)
        counts[meta.get("source", "?")] += 1
    return dict(sorted(counts.items()))


def coverage_delta(skills_dir: Path, previous_path: Optional[Path]) -> dict:
    """Compare current tag-cluster sizes to a previously persisted snapshot.

    Returns ``{"grew": {...}, "shrank": {...}, "new": [...], "gone": [...]}``.
    Missing previous file => everything is "new".
    """
    current = {tag: len(names) for tag, names in tag_clusters(skills_dir).items()}
    previous: dict[str, int] = {}
    if previous_path and previous_path.exists():
        try:
            previous = json.loads(previous_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            previous = {}

    grew = {t: (previous[t], current[t]) for t in current if t in previous and current[t] > previous[t]}
    shrank = {t: (previous[t], current[t]) for t in current if t in previous and current[t] < previous[t]}
    new = sorted(t for t in current if t not in previous)
    gone = sorted(t for t in previous if t not in current)
    return {
        "grew": grew,
        "shrank": shrank,
        "new": new,
        "gone": gone,
        "current": current,
    }


def save_cluster_snapshot(skills_dir: Path, snapshot_path: Path) -> None:
    """Persist the current tag-cluster sizes for next week's coverage_delta."""
    snapshot = {tag: len(names) for tag, names in tag_clusters(skills_dir).items()}
    snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    snapshot_path.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")


def run_pass3(skills_dir: Path, snapshot_path: Optional[Path] = None) -> dict:
    """Run the weekly catalogue audit and return a single result dict."""
    return {
        "tag_clusters": tag_clusters(skills_dir),
        "overlap_pairs": overlap_pairs(skills_dir),
        "router_necessity": router_necessity(skills_dir),
        "source_distribution": source_distribution(skills_dir),
        "coverage_delta": coverage_delta(skills_dir, snapshot_path),
    }
