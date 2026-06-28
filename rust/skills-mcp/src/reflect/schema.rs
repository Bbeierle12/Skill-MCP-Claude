//! Additive migration for the reflection engine.
//!
//! Gemini's `MemoryVault` owns the base `experience_logs` table (id, task_context,
//! error_trace, resolution, timestamp). The reflection engine needs richer columns
//! to cluster and weight logs. Rather than ask the (now-frozen) base schema to change,
//! this module adds reflection-owned columns *on top of* the base table, idempotently.
//!
//! SQLite has no `ADD COLUMN IF NOT EXISTS`, so we inspect `PRAGMA table_info` and add
//! only the columns that are missing. Existing rows get `NULL` for the new columns; the
//! fetch path (see [`crate::reflect::cluster`]) derives sane values for legacy rows.

use rusqlite::{Connection, Result};
use std::collections::HashSet;

/// Reflection-owned columns added to the base `experience_logs` table.
/// All nullable: the base ingestion path never sets them.
const ADDED_COLUMNS: &[(&str, &str)] = &[
    ("signature", "TEXT"),     // normalized error signature (clustering join key)
    ("event_type", "TEXT"),    // 'error' | 'success' | 'setup' (derived for legacy rows)
    ("severity", "INTEGER"),   // 0..4; drives cluster weight
    ("resolved", "INTEGER"),   // 0/1
    ("reflected_at", "TEXT"),  // watermark: set once folded into a cluster decision
    ("skill_applied", "TEXT"), // skill the agent had loaded (effectiveness signal)
];

/// Idempotently add the reflection columns, indices, and bookkeeping tables.
///
/// Requires the base `experience_logs` table to already exist (created by
/// `MemoryVault::new`). Safe to call on every startup.
pub fn ensure_reflection_schema(conn: &Connection) -> Result<()> {
    let existing = existing_columns(conn)?;
    for (name, ty) in ADDED_COLUMNS {
        if !existing.contains(*name) {
            // Column names come from the const allowlist above, never user input.
            conn.execute(
                &format!("ALTER TABLE experience_logs ADD COLUMN {name} {ty}"),
                [],
            )?;
        }
    }

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_logs_signature ON experience_logs(signature)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_logs_unreflected \
         ON experience_logs(reflected_at) WHERE reflected_at IS NULL",
        [],
    )?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS reflection_runs (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            ran_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            last_log_id   INTEGER NOT NULL,
            clusters_seen INTEGER NOT NULL DEFAULT 0,
            jobs_emitted  INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS synthesis_jobs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            cluster_key TEXT NOT NULL,
            mode        TEXT NOT NULL,
            skill_name  TEXT NOT NULL,
            log_count   INTEGER NOT NULL,
            weight      REAL NOT NULL,
            status      TEXT NOT NULL DEFAULT 'pending',
            branch      TEXT,
            commit_sha  TEXT,
            note        TEXT
        );",
    )?;
    Ok(())
}

/// The set of column names currently on `experience_logs`.
fn existing_columns(conn: &Connection) -> Result<HashSet<String>> {
    let mut stmt = conn.prepare("PRAGMA table_info(experience_logs)")?;
    let names = stmt.query_map([], |row| row.get::<_, String>(1))?;
    names.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Create the base table exactly as Gemini's `MemoryVault::init_schema` does.
    fn base_table(conn: &Connection) {
        conn.execute(
            "CREATE TABLE experience_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_context TEXT NOT NULL,
                error_trace TEXT,
                resolution TEXT,
                timestamp TEXT NOT NULL
            )",
            [],
        )
        .unwrap();
    }

    #[test]
    fn adds_columns_and_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        base_table(&conn);

        // First run adds all reflection columns.
        ensure_reflection_schema(&conn).unwrap();
        let cols = existing_columns(&conn).unwrap();
        for (name, _) in ADDED_COLUMNS {
            assert!(cols.contains(*name), "missing column {name}");
        }
        // Base columns survive.
        assert!(cols.contains("task_context"));

        // Second run is a no-op (does not error on duplicate column).
        ensure_reflection_schema(&conn).unwrap();
        // Bookkeeping tables exist.
        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('reflection_runs','synthesis_jobs')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 2);
    }

    #[test]
    fn preserves_existing_rows() {
        let conn = Connection::open_in_memory().unwrap();
        base_table(&conn);
        conn.execute(
            "INSERT INTO experience_logs (task_context, error_trace, resolution, timestamp)
             VALUES ('t', 'boom', NULL, '2026-06-27T00:00:00Z')",
            [],
        )
        .unwrap();

        ensure_reflection_schema(&conn).unwrap();

        // The legacy row is intact; new columns are NULL.
        let (ctx, sig): (String, Option<String>) = conn
            .query_row(
                "SELECT task_context, signature FROM experience_logs WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(ctx, "t");
        assert_eq!(sig, None);
    }
}
