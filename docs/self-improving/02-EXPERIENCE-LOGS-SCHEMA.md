# Integration Contract — `experience_logs` SQLite Schema

This is the contract **Gemini's Phase 2** builds and **the reflection engine** reads. The brief specified `task_context, error_trace, resolution, timestamp`; the schema below keeps those exact names and adds the minimum the reflection math needs (event type, resolved flag, signature, provenance). Everything added is nullable or defaulted so the ingestion path stays dumb and fast.

> Owner: Gemini (table creation, `/api/logs` ingestion). Consumer: Brain (read-only clustering). The Brain backfills `signature` and sets `reflected_at`; it does not own ingestion.

---

## 1. DDL (rusqlite, `bundled` feature)

```sql
PRAGMA journal_mode = WAL;        -- concurrent Tailscale writers + one reader
PRAGMA busy_timeout = 5000;       -- tolerate write contention
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS experience_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- ISO-8601 UTC
    agent         TEXT    NOT NULL,                 -- 'antigravity' | 'gemini' | 'claude' | ...
    host          TEXT,                             -- tailscale node name, nullable
    event_type    TEXT    NOT NULL                  -- the brief's three log kinds
                  CHECK (event_type IN ('error','success','setup')),
    task_context  TEXT    NOT NULL,                 -- what the agent was doing (free text)
    command       TEXT,                             -- the command that ran, if any
    error_trace   TEXT,                             -- NULL for success/setup
    resolution    TEXT,                             -- what fixed it, if known
    resolved      INTEGER NOT NULL DEFAULT 0        -- 0/1; an error with a known fix is resolved
                  CHECK (resolved IN (0,1)),
    skill_applied TEXT,                             -- skill name the agent had loaded, if any (effectiveness signal)
    severity      INTEGER NOT NULL DEFAULT 2        -- 0 trace … 4 critical; drives cluster weight
                  CHECK (severity BETWEEN 0 AND 4),
    tokens        INTEGER,                          -- optional cost of the event
    signature     TEXT,                             -- normalized error signature; BACKFILLED by reflection
    reflected_at  TEXT,                             -- set when this row has been folded into a cluster decision
    extra         TEXT                              -- JSON escape hatch for structured extras
);

CREATE INDEX IF NOT EXISTS idx_logs_ts         ON experience_logs(ts);
CREATE INDEX IF NOT EXISTS idx_logs_event      ON experience_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_logs_signature  ON experience_logs(signature);
CREATE INDEX IF NOT EXISTS idx_logs_unreflected ON experience_logs(reflected_at) WHERE reflected_at IS NULL;
```

### Bookkeeping tables (Brain-owned, same DB)

```sql
-- One row per reflection pass; a watermark + summary for observability.
CREATE TABLE IF NOT EXISTS reflection_runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ran_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_log_id   INTEGER NOT NULL,                 -- high-water mark of ids considered
    clusters_seen INTEGER NOT NULL DEFAULT 0,
    jobs_emitted  INTEGER NOT NULL DEFAULT 0
);

-- Audit trail: which cluster produced/updated which skill at which commit.
CREATE TABLE IF NOT EXISTS synthesis_jobs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    cluster_key   TEXT    NOT NULL,                 -- == _meta.cluster_key; idempotency join
    mode          TEXT    NOT NULL CHECK (mode IN ('create','update')),
    skill_name    TEXT    NOT NULL,
    log_count     INTEGER NOT NULL,
    weight        REAL    NOT NULL,                 -- cluster weight at trigger time
    status        TEXT    NOT NULL DEFAULT 'pending'-- pending|written|verified|merged|rejected
                  CHECK (status IN ('pending','written','verified','merged','rejected')),
    branch        TEXT,                             -- reflect/<sig>-<date>
    commit_sha    TEXT,
    note          TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_cluster ON synthesis_jobs(cluster_key, created_at);
```

---

## 2. `/api/logs` ingestion contract (Axum — Gemini Phase 4)

`POST /api/logs`, `Content-Type: application/json`. Agents on the tailnet write here.

Request:
```json
{
  "agent": "antigravity",
  "host": "lenovo",
  "event_type": "error",
  "task_context": "building rust/skills-mcp after adding tui deps",
  "command": "cargo build -p skills-mcp",
  "error_trace": "error[E0463]: can't find crate for `ratatui`",
  "resolution": null,
  "skill_applied": null,
  "severity": 3,
  "tokens": null,
  "extra": {"cwd": "/home/.../rust/skills-mcp"}
}
```
Required: `agent`, `event_type`, `task_context`. Server fills `ts`, `id`, defaults `resolved=0`, `severity=2`. Response `201 {"id": 1234}`.

A later "I fixed it" call is a **new row** with `event_type:"success"`, `resolved:1`, and the `resolution` text — not an update. Reflection pairs error→success by `signature` + `task_context` proximity (see `03 §4`).

---

## 3. Read queries the reflection engine relies on

```sql
-- Unreflected error/setup logs since the last watermark (the work queue).
SELECT id, ts, agent, host, event_type, task_context, command,
       error_trace, resolution, resolved, severity, signature
FROM   experience_logs
WHERE  reflected_at IS NULL
  AND  event_type IN ('error','setup')
ORDER  BY id;

-- Backfill a computed signature (reflection owns this UPDATE).
UPDATE experience_logs SET signature = ?1 WHERE id = ?2;

-- Mark rows folded into a decision so the next pass skips them.
UPDATE experience_logs SET reflected_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN (/* cluster member ids */);
```

---

## 4. Why these columns (mapping to the math)

| Column | Used by | For |
|---|---|---|
| `signature` | clustering (`03 §2`) | exact-bucket grouping; the join key to skills |
| `ts` | weight (`03 §3`) | recency decay |
| `task_context` | weight | breadth = distinct contexts |
| `resolved` / `resolution` | weight + synthesis | resolution gap; the fix text the LLM compiles |
| `severity` | weight | high-severity clusters trip the threshold sooner |
| `skill_applied` | effectiveness loop | "did an existing skill fail to prevent this?" → demote `review_score` |
| `reflected_at` | watermark | idempotent passes; no double-counting |
| `extra` | future | structured context without a migration |

## 5. Notes for the implementer

- **WAL mode is non-negotiable** with multiple tailnet writers + the reflection reader; default rollback journal will serialize and time out.
- Keep ingestion **validation-light** (only the 3 required fields + the two CHECKs). Normalization/signature is the Brain's job, deliberately, so a misbehaving normalizer can never block an agent from logging.
- `signature` is nullable on insert and indexed; the partial index `idx_logs_unreflected` keeps the work-queue scan cheap as the table grows.
