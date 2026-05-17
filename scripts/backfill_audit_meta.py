#!/usr/bin/env python3
"""Backfill the three optional audit fields into every skill's _meta.json.

Adds (if missing):
  - last_reviewed_at  : null
  - review_score      : null
  - relevance_tier    : null

Run once after pulling the audit feature. Idempotent — safe to run repeatedly.

Usage:
    python scripts/backfill_audit_meta.py                # default skills/ dir
    python scripts/backfill_audit_meta.py --skills DIR   # custom dir
    python scripts/backfill_audit_meta.py --dry-run      # report only
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow running as a script from the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.audit.models import AUDIT_META_FIELDS, iter_skill_dirs, load_meta, save_meta


def backfill(skills_dir: Path, *, dry_run: bool = False) -> dict:
    added: dict[str, list[str]] = {}
    total = 0
    for skill_dir in iter_skill_dirs(skills_dir):
        meta = load_meta(skill_dir)
        if not meta:
            continue
        total += 1
        missing = [f for f in AUDIT_META_FIELDS if f not in meta]
        if not missing:
            continue
        for f in missing:
            meta[f] = None
        added[skill_dir.name] = missing
        if not dry_run:
            save_meta(skill_dir, meta)
    return {"total_skills": total, "updated": added}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skills", type=Path, default=None, help="Path to skills/ directory")
    parser.add_argument("--dry-run", action="store_true", help="Report changes without writing")
    args = parser.parse_args()

    if args.skills is None:
        from core.config import get_skills_dir
        skills_dir = get_skills_dir()
    else:
        skills_dir = args.skills

    if not skills_dir.is_dir():
        print(f"ERROR: skills dir not found: {skills_dir}", file=sys.stderr)
        return 2

    result = backfill(skills_dir, dry_run=args.dry_run)
    print(f"Scanned {result['total_skills']} skills.")
    if not result["updated"]:
        print("All skills already carry the audit fields. Nothing to do.")
        return 0
    print(f"{'Would update' if args.dry_run else 'Updated'} {len(result['updated'])} skill(s):")
    for name, fields in sorted(result["updated"].items()):
        print(f"  {name}: added {', '.join(fields)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
