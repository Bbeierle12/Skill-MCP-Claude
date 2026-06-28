//! Fetching the work queue and grouping logs into clusters.
//!
//! Two-tier clustering (see `docs/self-improving/03-REFLECTION-LOOP.md §3`):
//! - **T1 (exact):** bucket by identical normalized signature — does the heavy lifting.
//! - **T2 (lexical):** merge T1 buckets whose signatures have token Jaccard ≥ threshold,
//!   catching near-duplicates the normalizer didn't fully collapse.

use std::collections::{BTreeMap, HashSet};

use rusqlite::{params, Connection, Result};

use super::normalize::{cluster_key, normalize_signature};
use super::LogRow;

/// A group of logs that share (after T1+T2) the same root signature.
#[derive(Debug, Clone)]
pub struct Cluster {
    /// Idempotency key = FNV-1a hash of the representative signature.
    pub key: String,
    /// Representative (most populous) signature for the cluster.
    pub signature: String,
    /// All distinct member signatures merged into this cluster.
    pub member_signatures: Vec<String>,
    /// The logs belonging to this cluster.
    pub logs: Vec<LogRow>,
    /// Count of distinct `task_context` values (breadth).
    pub distinct_contexts: usize,
    /// Fraction of error logs in the cluster that are unresolved (0.0..=1.0).
    pub resolution_gap: f64,
}

impl Cluster {
    fn from_logs(signature: String, member_signatures: Vec<String>, logs: Vec<LogRow>) -> Self {
        let distinct_contexts = logs
            .iter()
            .map(|l| l.task_context.as_str())
            .collect::<HashSet<_>>()
            .len();
        let n = logs.len().max(1) as f64;
        let unresolved = logs
            .iter()
            .filter(|l| l.event_type == "error" && !l.resolved)
            .count() as f64;
        Self {
            key: cluster_key(&signature),
            signature,
            member_signatures,
            distinct_contexts,
            resolution_gap: unresolved / n,
            logs,
        }
    }

    /// Number of logs in the cluster.
    pub fn n(&self) -> usize {
        self.logs.len()
    }
}

/// Fetch unreflected `error`/`setup` logs (the work queue), deriving `event_type`,
/// `severity`, and `resolved` for legacy rows that predate the reflection columns.
pub fn fetch_unreflected(conn: &Connection) -> Result<Vec<LogRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_context, error_trace, resolution, timestamp,
                signature, event_type, severity, resolved, skill_applied
         FROM experience_logs
         WHERE reflected_at IS NULL
         ORDER BY id",
    )?;
    let rows = stmt.query_map([], |r| {
        let error_trace: Option<String> = r.get(2)?;
        let resolution: Option<String> = r.get(3)?;
        let event_type: Option<String> = r.get(6)?;
        let severity: Option<i64> = r.get(7)?;
        let resolved_col: Option<i64> = r.get(8)?;
        let has_err = error_trace.is_some();
        let has_res = resolution.is_some();
        let derived_event = event_type.unwrap_or_else(|| {
            if has_err {
                "error".to_string()
            } else if has_res {
                "success".to_string()
            } else {
                "setup".to_string()
            }
        });
        Ok(LogRow {
            id: r.get(0)?,
            task_context: r.get(1)?,
            error_trace,
            resolution,
            timestamp: r.get(4)?,
            signature: r.get(5)?,
            event_type: derived_event,
            severity: severity.unwrap_or(2),
            resolved: resolved_col.map_or(has_res, |v| v != 0),
            skill_applied: r.get(9)?,
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        let row = row?;
        if row.event_type == "error" || row.event_type == "setup" {
            out.push(row);
        }
    }
    Ok(out)
}

/// Compute and persist a `signature` for any row that lacks one, also setting it on the
/// in-memory `LogRow`. Errors use `error_trace`; setup steps fall back to `task_context`.
pub fn backfill_signatures(conn: &Connection, logs: &mut [LogRow]) -> Result<()> {
    for log in logs.iter_mut() {
        if log.signature.is_none() {
            let src = log.error_trace.as_deref().unwrap_or(&log.task_context);
            let sig = normalize_signature(src);
            conn.execute(
                "UPDATE experience_logs SET signature = ?1 WHERE id = ?2",
                params![sig, log.id],
            )?;
            log.signature = Some(sig);
        }
    }
    Ok(())
}

/// Token-set Jaccard similarity of two signatures.
fn jaccard(a: &str, b: &str) -> f64 {
    let sa: HashSet<&str> = a.split_whitespace().collect();
    let sb: HashSet<&str> = b.split_whitespace().collect();
    let union = sa.union(&sb).count();
    if union == 0 {
        return 1.0;
    }
    sa.intersection(&sb).count() as f64 / union as f64
}

fn find(parent: &mut [usize], mut i: usize) -> usize {
    while parent[i] != i {
        parent[i] = parent[parent[i]];
        i = parent[i];
    }
    i
}

/// Group logs into clusters via T1 exact buckets then T2 Jaccard merge.
/// Logs without a signature are skipped (call [`backfill_signatures`] first).
pub fn cluster_logs(logs: Vec<LogRow>, jaccard_threshold: f64) -> Vec<Cluster> {
    // T1: exact-signature buckets.
    let mut buckets: BTreeMap<String, Vec<LogRow>> = BTreeMap::new();
    for log in logs {
        if let Some(sig) = log.signature.clone() {
            buckets.entry(sig).or_default().push(log);
        }
    }

    let keys: Vec<String> = buckets.keys().cloned().collect();
    let mut parent: Vec<usize> = (0..keys.len()).collect();

    // T2: union buckets whose signatures are lexically near.
    for i in 0..keys.len() {
        for j in (i + 1)..keys.len() {
            if jaccard(&keys[i], &keys[j]) >= jaccard_threshold {
                let (ri, rj) = (find(&mut parent, i), find(&mut parent, j));
                if ri != rj {
                    parent[ri] = rj;
                }
            }
        }
    }

    // Collect members by union-find root.
    let mut groups: BTreeMap<usize, (Vec<LogRow>, Vec<(String, usize)>)> = BTreeMap::new();
    for (idx, key) in keys.iter().enumerate() {
        let root = find(&mut parent, idx);
        let members = buckets.remove(key).unwrap_or_default();
        let count = members.len();
        let entry = groups.entry(root).or_default();
        entry.0.extend(members);
        entry.1.push((key.clone(), count));
    }

    let mut clusters: Vec<Cluster> = groups
        .into_values()
        .map(|(logs, mut sigs)| {
            // Representative = most populous signature; lexicographic tie-break.
            sigs.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
            let rep = sigs[0].0.clone();
            let member_signatures = sigs.into_iter().map(|(s, _)| s).collect();
            Cluster::from_logs(rep, member_signatures, logs)
        })
        .collect();

    // Deterministic order.
    clusters.sort_by(|a, b| a.key.cmp(&b.key));
    clusters
}

#[cfg(test)]
mod tests {
    use super::*;

    fn log(id: i64, ctx: &str, err: &str, sig: &str, resolved: bool) -> LogRow {
        LogRow {
            id,
            task_context: ctx.to_string(),
            error_trace: Some(err.to_string()),
            resolution: None,
            timestamp: "2026-06-27T00:00:00Z".to_string(),
            signature: Some(sig.to_string()),
            event_type: "error".to_string(),
            severity: 2,
            resolved,
            skill_applied: None,
        }
    }

    #[test]
    fn t1_groups_identical_signatures() {
        let logs = vec![
            log(1, "build-a", "e", "e0463 cant find crate for ratatui", false),
            log(2, "build-b", "e", "e0463 cant find crate for ratatui", false),
            log(3, "build-c", "e", "e0463 cant find crate for ratatui", false),
        ];
        let clusters = cluster_logs(logs, 0.7);
        assert_eq!(clusters.len(), 1);
        assert_eq!(clusters[0].n(), 3);
        assert_eq!(clusters[0].distinct_contexts, 3);
        assert!((clusters[0].resolution_gap - 1.0).abs() < 1e-9);
    }

    #[test]
    fn distinct_crates_form_distinct_clusters() {
        let logs = vec![
            log(1, "a", "e", "e0463 cant find crate for ratatui", false),
            log(2, "b", "e", "e0463 cant find crate for serde", false),
        ];
        let clusters = cluster_logs(logs, 0.7);
        assert_eq!(clusters.len(), 2);
    }

    #[test]
    fn t2_merges_near_duplicate_signatures() {
        // Jaccard(|inter|=4, |union|=5) = 0.8 ≥ 0.7 → merged.
        let logs = vec![
            log(1, "a", "e", "linker cc failed exit status", false),
            log(2, "b", "e", "linker cc failed exit code", false),
        ];
        let clusters = cluster_logs(logs, 0.7);
        assert_eq!(clusters.len(), 1, "near-duplicate signatures should merge");
        assert_eq!(clusters[0].n(), 2);
    }

    #[test]
    fn resolution_gap_reflects_resolved_share() {
        let logs = vec![
            log(1, "a", "e", "same sig here", true),
            log(2, "b", "e", "same sig here", false),
        ];
        let clusters = cluster_logs(logs, 0.7);
        assert_eq!(clusters.len(), 1);
        assert!((clusters[0].resolution_gap - 0.5).abs() < 1e-9);
    }
}
