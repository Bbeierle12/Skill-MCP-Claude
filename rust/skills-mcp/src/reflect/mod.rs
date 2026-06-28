//! Reflection engine: turn raw agent experience logs into `SynthesisJob`s.
//!
//! This is the "Brain" half of the self-improving skills system. Gemini's `MemoryVault`
//! (see [`crate::db`]) owns ingestion and the base `experience_logs` table; this module
//! reads those logs, clusters recurring failures, weights them, and emits jobs for the
//! synthesis engine (designed in `docs/self-improving/04-SYNTHESIS-ENGINE.md`, not yet
//! implemented).
//!
//! The reflection columns are added *additively* on top of Gemini's frozen 5-column base
//! table ([`schema::ensure_reflection_schema`]), so ingestion is untouched and legacy rows
//! work via derived defaults.
//!
//! ```no_run
//! use rusqlite::Connection;
//! use skills_mcp::reflect::{reflect_once, ReflectionConfig};
//!
//! let conn = Connection::open("memory.db").unwrap();
//! let jobs = reflect_once(&conn, &ReflectionConfig::default()).unwrap();
//! println!("{} synthesis job(s) emitted", jobs.len());
//! ```

mod cluster;
mod normalize;
mod schema;
mod weight;
pub mod synth;

pub use cluster::{backfill_signatures, cluster_logs, fetch_unreflected, Cluster};
pub use normalize::{cluster_key, normalize_signature};
pub use schema::ensure_reflection_schema;
pub use synth::synthesize;
pub use weight::{
    cluster_weight, estimate_tokens, evaluate, proposed_skill_name, Mode, ReflectionConfig,
    SynthesisJob,
};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Result};

/// Default T2 lexical-merge threshold (token Jaccard).
const DEFAULT_JACCARD: f64 = 0.7;

/// A single experience log as the reflection engine sees it: the base columns plus the
/// reflection-owned columns, with sane values derived for legacy rows.
#[derive(Debug, Clone)]
pub struct LogRow {
    /// Row id.
    pub id: i64,
    /// What the agent was doing.
    pub task_context: String,
    /// Error trace, if this was a failure.
    pub error_trace: Option<String>,
    /// The fix, if known.
    pub resolution: Option<String>,
    /// RFC3339 timestamp.
    pub timestamp: String,
    /// Normalized error signature (filled by [`backfill_signatures`]).
    pub signature: Option<String>,
    /// `error` | `success` | `setup` (derived for legacy rows).
    pub event_type: String,
    /// Severity 0..4.
    pub severity: i64,
    /// Whether the log is considered resolved.
    pub resolved: bool,
    /// Skill the agent had loaded when this happened, if any.
    pub skill_applied: Option<String>,
}

/// Run one reflection pass: migrate, fetch the work queue, cluster, weight, and emit +
/// persist a `SynthesisJob` for every cluster that trips the trigger heuristic. Marks the
/// considered logs reflected (watermark) and records the run.
pub fn reflect_once(conn: &Connection, cfg: &ReflectionConfig) -> Result<Vec<SynthesisJob>> {
    ensure_reflection_schema(conn)?;

    let mut logs = fetch_unreflected(conn)?;
    if logs.is_empty() {
        return Ok(Vec::new());
    }
    let last_log_id = logs.iter().map(|l| l.id).max().unwrap_or(0);
    let member_ids: Vec<i64> = logs.iter().map(|l| l.id).collect();

    backfill_signatures(conn, &mut logs)?;
    let clusters = cluster_logs(logs, DEFAULT_JACCARD);

    let now = Utc::now();
    let mut jobs = Vec::new();
    for c in &clusters {
        let covered = existing_skill_for(conn, &c.key)?;
        if let Some(job) = evaluate(c, now, cfg, covered.as_deref()) {
            persist_job(conn, &job)?;
            jobs.push(job);
        }
    }

    mark_reflected(conn, &member_ids)?;
    record_run(conn, last_log_id, clusters.len(), jobs.len())?;
    Ok(jobs)
}

/// The skill (if any) a prior synthesis job already produced for this cluster key —
/// makes the pass idempotent and turns recurrences into updates.
fn existing_skill_for(conn: &Connection, cluster_key: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT skill_name FROM synthesis_jobs WHERE cluster_key = ?1 ORDER BY id DESC LIMIT 1",
        params![cluster_key],
        |r| r.get::<_, String>(0),
    )
    .optional()
}

fn persist_job(conn: &Connection, job: &SynthesisJob) -> Result<()> {
    let skill_name = job
        .target_skill
        .clone()
        .unwrap_or_else(|| proposed_skill_name(&job.signature));
    let mode = match job.mode {
        Mode::Create => "create",
        Mode::Update => "update",
    };
    conn.execute(
        "INSERT INTO synthesis_jobs (cluster_key, mode, skill_name, log_count, weight, status)
         VALUES (?1, ?2, ?3, ?4, ?5, 'pending')",
        params![
            job.cluster_key,
            mode,
            skill_name,
            job.rep_ids.len() as i64,
            job.weight
        ],
    )?;
    Ok(())
}

fn mark_reflected(conn: &Connection, ids: &[i64]) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.unchecked_transaction()?;
    for id in ids {
        tx.execute(
            "UPDATE experience_logs SET reflected_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
    }
    tx.commit()
}

fn record_run(conn: &Connection, last_log_id: i64, clusters: usize, jobs: usize) -> Result<()> {
    conn.execute(
        "INSERT INTO reflection_runs (last_log_id, clusters_seen, jobs_emitted)
         VALUES (?1, ?2, ?3)",
        params![last_log_id, clusters as i64, jobs as i64],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn insert(conn: &Connection, ctx: &str, err: &str, ts: &str) {
        conn.execute(
            "INSERT INTO experience_logs (task_context, error_trace, resolution, timestamp)
             VALUES (?1, ?2, NULL, ?3)",
            params![ctx, err, ts],
        )
        .unwrap();
    }

    #[test]
    fn end_to_end_emits_job_and_watermarks() {
        let conn = Connection::open_in_memory().unwrap();
        base_table(&conn);
        let now = Utc::now().to_rfc3339();
        // Four identical-signature failures (different paths + contexts), unresolved.
        for ctx in ["build-a", "build-b", "build-c", "build-d"] {
            insert(
                &conn,
                ctx,
                "error[E0463]: can't find crate for `ratatui` at /x/main.rs:1:2",
                &now,
            );
        }

        let cfg = ReflectionConfig::default();
        let jobs = reflect_once(&conn, &cfg).unwrap();
        assert_eq!(jobs.len(), 1, "one cluster should trigger");
        assert_eq!(jobs[0].mode, Mode::Create);
        assert!(jobs[0].weight > cfg.theta);

        // Job persisted.
        let job_rows: i64 = conn
            .query_row("SELECT count(*) FROM synthesis_jobs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(job_rows, 1);

        // Signatures were backfilled on the base rows.
        let sig: Option<String> = conn
            .query_row(
                "SELECT signature FROM experience_logs WHERE id = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(sig.as_deref(), Some("e0463 cant find crate for ratatui"));

        // Watermark set → a second pass is a no-op.
        let again = reflect_once(&conn, &cfg).unwrap();
        assert!(again.is_empty(), "reflected logs must not be reconsidered");

        // The run was recorded.
        let runs: i64 = conn
            .query_row("SELECT count(*) FROM reflection_runs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(runs, 1);
    }

    #[test]
    fn recurrence_after_a_job_becomes_an_update() {
        let conn = Connection::open_in_memory().unwrap();
        base_table(&conn);
        let now = Utc::now().to_rfc3339();
        let err = "error[E0463]: can't find crate for `ratatui` at /x.rs:1";

        for ctx in ["a", "b", "c"] {
            insert(&conn, ctx, err, &now);
        }
        let cfg = ReflectionConfig::default();
        let first = reflect_once(&conn, &cfg).unwrap();
        assert_eq!(first[0].mode, Mode::Create);

        // Same failure recurs later → new rows, same cluster key.
        for ctx in ["d", "e", "f"] {
            insert(&conn, ctx, err, &now);
        }
        let second = reflect_once(&conn, &cfg).unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].mode, Mode::Update, "recurrence should update, not re-create");
    }
}
