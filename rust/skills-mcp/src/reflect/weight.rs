//! Cluster weighting, the trigger gate, and SynthesisJob emission.
//!
//! Weight (see `docs/self-improving/03-REFLECTION-LOOP.md §5`):
//! `W = F · B · S · G · boost` where
//! - `F` = recency-decayed frequency (half-life `H` days),
//! - `B = 1 + log2(distinct_contexts)` (breadth),
//! - `S = 1 + 0.25 · mean(severity)` (severity 0..4 → 1.0..2.0),
//! - `G = 0.5 + resolution_gap` (unsolved pain),
//! - `boost = 1.5` if an applied skill failed to prevent the error, else `1.0`.

use chrono::{DateTime, Utc};
use std::collections::HashSet;

use super::cluster::Cluster;
use super::LogRow;

/// Tunable thresholds for the reflection pass. All values are config, not constants.
#[derive(Debug, Clone)]
pub struct ReflectionConfig {
    /// Recency decay half-life in days.
    pub half_life_days: f64,
    /// Minimum cluster size to ever act (never synthesize from one-offs).
    pub n_min: usize,
    /// Weight threshold a cluster must exceed to emit a job.
    pub theta: f64,
    /// Max representative logs to attach to a job.
    pub k_reps: usize,
}

impl Default for ReflectionConfig {
    fn default() -> Self {
        Self {
            half_life_days: 14.0,
            n_min: 3,
            theta: 2.0,
            k_reps: 12,
        }
    }
}

/// Whether a job creates a new skill or updates an existing one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Mode {
    /// No existing skill addresses this cluster.
    Create,
    /// An existing skill (named) already addresses it; extend/refresh it.
    Update,
}

/// The reflection engine's output: a budgeted, weighted cluster ready for synthesis.
#[derive(Debug, Clone)]
pub struct SynthesisJob {
    /// Cluster idempotency key.
    pub cluster_key: String,
    /// Create vs. update.
    pub mode: Mode,
    /// Target skill name for updates; `None` for creates.
    pub target_skill: Option<String>,
    /// Representative signature.
    pub signature: String,
    /// Computed cluster weight at trigger time.
    pub weight: f64,
    /// Distinct task contexts in the cluster.
    pub distinct_contexts: usize,
    /// Unsolved fraction.
    pub resolution_gap: f64,
    /// Budget-fitted representative log ids (the evidence sent to synthesis).
    pub rep_ids: Vec<i64>,
}

/// Age of a log in days relative to `now`. Unparseable timestamps are treated as
/// age 0 (maximum recency) rather than dropped.
fn age_days(timestamp: &str, now: DateTime<Utc>) -> f64 {
    match DateTime::parse_from_rfc3339(timestamp) {
        Ok(t) => {
            let secs = (now - t.with_timezone(&Utc)).num_seconds();
            (secs as f64 / 86_400.0).max(0.0)
        }
        Err(_) => 0.0,
    }
}

/// Compute the cluster weight `W`.
pub fn cluster_weight(c: &Cluster, now: DateTime<Utc>, cfg: &ReflectionConfig) -> f64 {
    if c.logs.is_empty() {
        return 0.0;
    }
    let lambda = std::f64::consts::LN_2 / cfg.half_life_days;

    let f: f64 = c
        .logs
        .iter()
        .map(|l| (-lambda * age_days(&l.timestamp, now)).exp())
        .sum();

    let b = 1.0 + (c.distinct_contexts.max(1) as f64).log2();

    let mean_sev = c.logs.iter().map(|l| l.severity as f64).sum::<f64>() / c.logs.len() as f64;
    let s = 1.0 + 0.25 * mean_sev;

    let g = 0.5 + c.resolution_gap;

    let boost = if c
        .logs
        .iter()
        .any(|l| l.skill_applied.is_some() && !l.resolved)
    {
        1.5
    } else {
        1.0
    };

    f * b * s * g * boost
}

/// Evaluate a cluster against the trigger heuristic. Returns a job iff
/// `n ≥ n_min` and `W ≥ theta`. `covered_by` names an existing skill already
/// addressing this cluster (→ `Update`); `None` → `Create`.
pub fn evaluate(
    c: &Cluster,
    now: DateTime<Utc>,
    cfg: &ReflectionConfig,
    covered_by: Option<&str>,
) -> Option<SynthesisJob> {
    let weight = cluster_weight(c, now, cfg);
    if c.n() < cfg.n_min || weight < cfg.theta {
        return None;
    }
    // A cluster only exists because errors recurred; if a skill already covers it,
    // that skill demonstrably failed → update it. No coverage → create.
    let (mode, target_skill) = match covered_by {
        Some(name) => (Mode::Update, Some(name.to_string())),
        None => (Mode::Create, None),
    };
    Some(SynthesisJob {
        cluster_key: c.key.clone(),
        mode,
        target_skill,
        signature: c.signature.clone(),
        weight,
        distinct_contexts: c.distinct_contexts,
        resolution_gap: c.resolution_gap,
        rep_ids: select_representatives(c, cfg.k_reps),
    })
}

/// Pick up to `k` representative log ids: one per distinct context first (diversity,
/// preferring logs that show a fix), then fill the remaining budget by id.
///
/// Full token-budget arithmetic against a specific model window lives in the synthesis
/// engine (`04`); here we cap evidence and guarantee context diversity.
fn select_representatives(c: &Cluster, k: usize) -> Vec<i64> {
    let mut logs: Vec<&LogRow> = c.logs.iter().collect();
    // Logs with a resolution (worked fixes) first, then stable by id.
    logs.sort_by(|a, b| {
        b.resolution
            .is_some()
            .cmp(&a.resolution.is_some())
            .then(a.id.cmp(&b.id))
    });

    let mut picked: Vec<i64> = Vec::new();
    let mut seen_ctx: HashSet<&str> = HashSet::new();
    for log in &logs {
        if picked.len() >= k {
            break;
        }
        if seen_ctx.insert(log.task_context.as_str()) {
            picked.push(log.id);
        }
    }
    for log in &logs {
        if picked.len() >= k {
            break;
        }
        if !picked.contains(&log.id) {
            picked.push(log.id);
        }
    }
    picked
}

/// Rough token estimate for a piece of text (≈ chars / 4). Used by the synthesis
/// layer's budget math; exposed here as the shared estimator.
pub fn estimate_tokens(text: &str) -> usize {
    text.len().div_ceil(4)
}

/// A provisional, schema-valid skill name slugged from a signature. The synthesis
/// engine may rename; this is the placeholder used when emitting a job.
pub fn proposed_skill_name(signature: &str) -> String {
    let slug: String = signature
        .split_whitespace()
        .take(4)
        .collect::<Vec<_>>()
        .join("-")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        "reflected-skill".to_string()
    } else {
        slug.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reflect::cluster::cluster_logs;

    fn err_log(id: i64, ctx: &str, sig: &str, ts: &str) -> LogRow {
        LogRow {
            id,
            task_context: ctx.to_string(),
            error_trace: Some("boom".to_string()),
            resolution: None,
            timestamp: ts.to_string(),
            signature: Some(sig.to_string()),
            event_type: "error".to_string(),
            severity: 2,
            resolved: false,
            skill_applied: None,
        }
    }

    fn cluster_of(logs: Vec<LogRow>) -> Cluster {
        cluster_logs(logs, 0.7).pop().unwrap()
    }

    #[test]
    fn recent_recurring_cluster_outweighs_old_one() {
        let now = Utc::now();
        let recent = cluster_of(vec![
            err_log(1, "a", "sig x", &now.to_rfc3339()),
            err_log(2, "b", "sig x", &now.to_rfc3339()),
            err_log(3, "c", "sig x", &now.to_rfc3339()),
        ]);
        let old_ts = (now - chrono::Duration::days(120)).to_rfc3339();
        let old = cluster_of(vec![
            err_log(4, "a", "sig y", &old_ts),
            err_log(5, "b", "sig y", &old_ts),
            err_log(6, "c", "sig y", &old_ts),
        ]);
        let cfg = ReflectionConfig::default();
        assert!(cluster_weight(&recent, now, &cfg) > cluster_weight(&old, now, &cfg));
    }

    #[test]
    fn below_n_min_does_not_trigger() {
        let now = Utc::now();
        let c = cluster_of(vec![
            err_log(1, "a", "sig z", &now.to_rfc3339()),
            err_log(2, "b", "sig z", &now.to_rfc3339()),
        ]);
        let cfg = ReflectionConfig::default(); // n_min = 3
        assert!(evaluate(&c, now, &cfg, None).is_none());
    }

    #[test]
    fn strong_cluster_creates_a_job() {
        let now = Utc::now();
        let c = cluster_of(vec![
            err_log(1, "a", "sig q", &now.to_rfc3339()),
            err_log(2, "b", "sig q", &now.to_rfc3339()),
            err_log(3, "c", "sig q", &now.to_rfc3339()),
        ]);
        let cfg = ReflectionConfig::default();
        let job = evaluate(&c, now, &cfg, None).expect("should trigger");
        assert_eq!(job.mode, Mode::Create);
        assert!(job.target_skill.is_none());
        assert_eq!(job.rep_ids.len(), 3); // one per distinct context
    }

    #[test]
    fn coverage_makes_it_an_update() {
        let now = Utc::now();
        let c = cluster_of(vec![
            err_log(1, "a", "sig u", &now.to_rfc3339()),
            err_log(2, "b", "sig u", &now.to_rfc3339()),
            err_log(3, "c", "sig u", &now.to_rfc3339()),
        ]);
        let cfg = ReflectionConfig::default();
        let job = evaluate(&c, now, &cfg, Some("cargo-build-recovery")).unwrap();
        assert_eq!(job.mode, Mode::Update);
        assert_eq!(job.target_skill.as_deref(), Some("cargo-build-recovery"));
    }

    #[test]
    fn proposed_name_is_slug_safe() {
        let name = proposed_skill_name("e0463 cant find crate for ratatui");
        assert_eq!(name, "e0463-cant-find-crate");
        assert!(name.chars().all(|c| c.is_ascii_lowercase()
            || c.is_ascii_digit()
            || c == '-'));
    }
}
