#!/usr/bin/env python3
"""Run the daily Skills Catalogue audit and write a Markdown report.

Pipeline:
  1. Pass 1 — deterministic structural audit over the whole catalogue.
  2. Pass 2 — content audit for one skill (the oldest by ``last_reviewed_at``).
     The Claude CLI is invoked only when ``--use-llm`` is passed and the CLI
     is on PATH; otherwise Pass 2 runs the deterministic rubric alone.
  3. Optional Pass 3 — weekly catalogue review when ``--weekly`` is set.
  4. Write ``reports/YYYY-MM-DD.md`` and refresh state at
     ``reports/.audit-state.json`` for day-over-day deltas.

Exit codes:
  0 — success
  1 — at least one structural finding has severity=error and --fail-on-error
  2 — bad CLI usage
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.audit.models import today_iso
from core.audit.pass1 import aggregate_stats, collect_skill_stats, run_pass1
from core.audit.pass2 import run_pass2
from core.audit.pass3 import run_pass3, save_cluster_snapshot
from core.audit.report import (
    current_tier_map,
    load_state,
    render_daily_report,
    save_state,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skills", type=Path, default=None, help="Skills directory (defaults to repo skills/)")
    parser.add_argument("--reports", type=Path, default=None, help="Reports output dir (defaults to repo reports/)")
    parser.add_argument("--skill", default=None, help="Override Pass 2 target skill (default: oldest)")
    parser.add_argument("--use-llm", action="store_true", help="Invoke the Claude CLI for Pass 2")
    parser.add_argument("--weekly", action="store_true", help="Also run Pass 3 (catalogue-level audit)")
    parser.add_argument("--fail-on-error", action="store_true", help="Exit 1 if any Pass 1 finding has severity=error")
    parser.add_argument("--dry-run", action="store_true", help="Print report to stdout without writing files or meta")
    args = parser.parse_args()

    if args.skills is None:
        from core.config import get_skills_dir
        skills_dir = get_skills_dir()
    else:
        skills_dir = args.skills
    if not skills_dir.is_dir():
        print(f"ERROR: skills dir not found: {skills_dir}", file=sys.stderr)
        return 2

    repo_root = Path(__file__).resolve().parents[1]
    reports_dir = args.reports or (repo_root / "reports")
    reports_dir.mkdir(parents=True, exist_ok=True)
    state_path = reports_dir / ".audit-state.json"
    snapshot_path = reports_dir / ".cluster-snapshot.json"

    # Pass 1
    findings = run_pass1(skills_dir)
    stats = collect_skill_stats(skills_dir)
    aggregate = aggregate_stats(stats)

    # Pass 2
    p2 = None
    try:
        p2 = run_pass2(
            skills_dir,
            skill_name=args.skill,
            use_llm=args.use_llm,
        ) if not args.dry_run else None
        # In dry-run mode we still WANT the rubric output but must not persist
        # the updated _meta.json. Re-run with a no-write branch.
        if args.dry_run:
            from core.audit.pass2 import run_deterministic_rubric, select_next_skill
            chosen = args.skill or select_next_skill(skills_dir)
            if chosen:
                p2 = run_deterministic_rubric(skills_dir, chosen)
    except RuntimeError as exc:
        print(f"Pass 2 skipped: {exc}", file=sys.stderr)

    # Optional weekly Pass 3
    weekly = None
    if args.weekly:
        weekly = run_pass3(skills_dir, snapshot_path=snapshot_path)
        if not args.dry_run:
            save_cluster_snapshot(skills_dir, snapshot_path)

    # Day-over-day deltas
    prev_state = load_state(state_path)
    prev_aggregate = prev_state.get("aggregate")
    prev_tiers = prev_state.get("tiers")

    report_md = render_daily_report(
        findings=findings,
        stats=stats,
        aggregate=aggregate,
        previous_aggregate=prev_aggregate,
        previous_tiers=prev_tiers,
        pass2=p2,
        weekly=weekly,
        when=today_iso(),
    )

    if args.dry_run:
        sys.stdout.write(report_md)
    else:
        out_path = reports_dir / f"{today_iso()}.md"
        out_path.write_text(report_md, encoding="utf-8")
        save_state(state_path, aggregate=aggregate, tiers=current_tier_map(skills_dir))
        print(f"Wrote {out_path}")

    if args.fail_on_error and any(f.severity == "error" for f in findings):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
