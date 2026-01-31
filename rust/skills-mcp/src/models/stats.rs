//! Usage statistics and tracking types.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A recorded search query.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchEntry {
    /// The search query string.
    pub query: String,

    /// When the search was performed.
    pub timestamp: DateTime<Utc>,

    /// Number of results returned.
    pub result_count: usize,
}

impl SearchEntry {
    /// Create a new search entry.
    pub fn new(query: String, result_count: usize) -> Self {
        Self {
            query,
            timestamp: Utc::now(),
            result_count,
        }
    }
}

/// Server usage statistics.
///
/// Corresponds to `UsageStats` in TypeScript.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageStats {
    /// Count of each tool invocation.
    pub tool_calls: HashMap<String, u64>,

    /// Count of each skill loaded.
    pub skill_loads: HashMap<String, u64>,

    /// Recent search queries (limited buffer).
    pub searches: Vec<SearchEntry>,

    /// Server start time.
    pub start_time: DateTime<Utc>,
}

impl UsageStats {
    /// Maximum number of search entries to retain.
    const MAX_SEARCHES: usize = 100;

    /// Create new empty stats.
    pub fn new() -> Self {
        Self {
            tool_calls: HashMap::new(),
            skill_loads: HashMap::new(),
            searches: Vec::new(),
            start_time: Utc::now(),
        }
    }

    /// Record a tool call.
    pub fn record_tool_call(&mut self, tool_name: &str) {
        *self.tool_calls.entry(tool_name.to_string()).or_insert(0) += 1;
    }

    /// Record a skill load.
    pub fn record_skill_load(&mut self, skill_name: &str) {
        *self.skill_loads.entry(skill_name.to_string()).or_insert(0) += 1;
    }

    /// Record a search query.
    pub fn record_search(&mut self, query: String, result_count: usize) {
        self.searches.push(SearchEntry::new(query, result_count));

        // Trim to max size (keep most recent)
        if self.searches.len() > Self::MAX_SEARCHES {
            self.searches.remove(0);
        }
    }

    /// Get total tool calls.
    pub fn total_tool_calls(&self) -> u64 {
        self.tool_calls.values().sum()
    }

    /// Get total skill loads.
    pub fn total_skill_loads(&self) -> u64 {
        self.skill_loads.values().sum()
    }

    /// Get uptime duration.
    pub fn uptime(&self) -> chrono::Duration {
        Utc::now() - self.start_time
    }

    /// Get uptime as human-readable string.
    pub fn uptime_string(&self) -> String {
        let duration = self.uptime();
        let secs = duration.num_seconds();

        if secs < 60 {
            format!("{}s", secs)
        } else if secs < 3600 {
            format!("{}m {}s", secs / 60, secs % 60)
        } else if secs < 86400 {
            format!("{}h {}m", secs / 3600, (secs % 3600) / 60)
        } else {
            format!("{}d {}h", secs / 86400, (secs % 86400) / 3600)
        }
    }

    /// Get most used tools.
    pub fn top_tools(&self, limit: usize) -> Vec<(&String, &u64)> {
        let mut tools: Vec<_> = self.tool_calls.iter().collect();
        tools.sort_by(|a, b| b.1.cmp(a.1));
        tools.truncate(limit);
        tools
    }

    /// Get most loaded skills.
    pub fn top_skills(&self, limit: usize) -> Vec<(&String, &u64)> {
        let mut skills: Vec<_> = self.skill_loads.iter().collect();
        skills.sort_by(|a, b| b.1.cmp(a.1));
        skills.truncate(limit);
        skills
    }

    /// Get recent searches.
    pub fn recent_searches(&self, limit: usize) -> Vec<&SearchEntry> {
        self.searches.iter().rev().take(limit).collect()
    }
}

impl Default for UsageStats {
    fn default() -> Self {
        Self::new()
    }
}

/// Validation result for skill checks.
///
/// Corresponds to `ValidationResult` in TypeScript.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    /// Whether all checks passed.
    pub valid: bool,

    /// Critical errors that must be fixed.
    pub errors: Vec<String>,

    /// Non-critical warnings.
    pub warnings: Vec<String>,

    /// Number of skills checked.
    pub skills_checked: usize,
}

impl ValidationResult {
    /// Create a passing result.
    pub fn pass(skills_checked: usize) -> Self {
        Self {
            valid: true,
            errors: Vec::new(),
            warnings: Vec::new(),
            skills_checked,
        }
    }

    /// Create a failing result.
    pub fn fail(errors: Vec<String>, skills_checked: usize) -> Self {
        Self {
            valid: false,
            errors,
            warnings: Vec::new(),
            skills_checked,
        }
    }

    /// Add an error.
    pub fn add_error(&mut self, error: String) {
        self.errors.push(error);
        self.valid = false;
    }

    /// Add a warning.
    pub fn add_warning(&mut self, warning: String) {
        self.warnings.push(warning);
    }

    /// Merge another result into this one.
    pub fn merge(&mut self, other: ValidationResult) {
        self.errors.extend(other.errors);
        self.warnings.extend(other.warnings);
        self.skills_checked += other.skills_checked;
        self.valid = self.valid && self.errors.is_empty();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_usage_stats_tracking() {
        let mut stats = UsageStats::new();

        stats.record_tool_call("list_skills");
        stats.record_tool_call("list_skills");
        stats.record_tool_call("get_skill");
        stats.record_skill_load("forms");
        stats.record_search("validation".to_string(), 5);

        assert_eq!(stats.total_tool_calls(), 3);
        assert_eq!(*stats.tool_calls.get("list_skills").unwrap(), 2);
        assert_eq!(stats.total_skill_loads(), 1);
        assert_eq!(stats.searches.len(), 1);
    }

    #[test]
    fn test_validation_result() {
        let mut result = ValidationResult::pass(10);
        assert!(result.valid);

        result.add_error("Missing _meta.json".to_string());
        assert!(!result.valid);
        assert_eq!(result.errors.len(), 1);

        result.add_warning("No tags defined".to_string());
        assert_eq!(result.warnings.len(), 1);
    }
}
