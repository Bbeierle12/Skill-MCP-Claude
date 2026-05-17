# Skills Catalogue — Daily Audit Reports

This folder holds the auto-generated reports from
`scripts/run_daily_audit.py`. Each daily run produces a `YYYY-MM-DD.md`
file with four sections (Hygiene defects, Today's deep-dive, Tier-C/D
watch list, Stats delta) plus an optional weekly review.

`.audit-state.json` and `.cluster-snapshot.json` are state files used to
compute day-over-day and week-over-week deltas. Both are safe to delete —
the next run will recreate them.
