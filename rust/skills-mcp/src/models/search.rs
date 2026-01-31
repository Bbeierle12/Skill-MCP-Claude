//! Search result types and related structures.

use serde::{Deserialize, Serialize};

/// How a search result was matched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MatchType {
    /// Matched skill name.
    Name,
    /// Matched description.
    Description,
    /// Matched tags.
    Tags,
    /// Matched trigger words.
    Triggers,
    /// Matched content body.
    Content,
}

impl MatchType {
    /// Get the weight multiplier for this match type.
    /// Higher weights indicate more relevant matches.
    pub fn weight(&self) -> f64 {
        match self {
            MatchType::Name => 3.0,
            MatchType::Triggers => 2.5,
            MatchType::Tags => 2.0,
            MatchType::Description => 1.5,
            MatchType::Content => 1.0,
        }
    }
}

/// A single search result.
///
/// Corresponds to `SearchResult` in TypeScript.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    /// Skill domain name.
    pub domain: String,

    /// Sub-skill name if matched within a sub-skill.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sub_skill: Option<String>,

    /// Relevance score (0.0 to 1.0+).
    pub score: f64,

    /// How the match was found.
    pub match_type: MatchType,

    /// Optional excerpt showing match context.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,

    /// Optional file path for content matches.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
}

impl SearchResult {
    /// Create a new search result.
    pub fn new(domain: String, score: f64, match_type: MatchType) -> Self {
        Self {
            domain,
            sub_skill: None,
            score,
            match_type,
            snippet: None,
            file: None,
        }
    }

    /// Set sub-skill.
    pub fn with_sub_skill(mut self, sub_skill: String) -> Self {
        self.sub_skill = Some(sub_skill);
        self
    }

    /// Set snippet.
    pub fn with_snippet(mut self, snippet: String) -> Self {
        self.snippet = Some(snippet);
        self
    }

    /// Set file path.
    pub fn with_file(mut self, file: String) -> Self {
        self.file = Some(file);
        self
    }

    /// Get a display-friendly identifier.
    pub fn display_id(&self) -> String {
        match &self.sub_skill {
            Some(sub) => format!("{}:{}", self.domain, sub),
            None => self.domain.clone(),
        }
    }
}

impl PartialEq for SearchResult {
    fn eq(&self, other: &Self) -> bool {
        self.domain == other.domain && self.sub_skill == other.sub_skill
    }
}

impl Eq for SearchResult {}

impl PartialOrd for SearchResult {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for SearchResult {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Sort by score descending
        other
            .score
            .partial_cmp(&self.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    }
}

/// Search query options.
#[derive(Debug, Clone, Default)]
pub struct SearchOptions {
    /// Maximum number of results to return.
    pub limit: Option<usize>,

    /// Minimum score threshold.
    pub min_score: Option<f64>,

    /// Only search specific match types.
    pub match_types: Option<Vec<MatchType>>,

    /// Filter to specific domains.
    pub domains: Option<Vec<String>>,
}

impl SearchOptions {
    /// Create with a limit.
    pub fn with_limit(limit: usize) -> Self {
        Self {
            limit: Some(limit),
            ..Default::default()
        }
    }

    /// Set minimum score.
    pub fn min_score(mut self, score: f64) -> Self {
        self.min_score = Some(score);
        self
    }

    /// Filter to specific domains.
    pub fn domains(mut self, domains: Vec<String>) -> Self {
        self.domains = Some(domains);
        self
    }
}

/// Results from a search operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResults {
    /// Matched results, sorted by relevance.
    pub results: Vec<SearchResult>,

    /// Original query.
    pub query: String,

    /// Total matches before limit applied.
    pub total_matches: usize,

    /// Whether results were truncated.
    pub truncated: bool,
}

impl SearchResults {
    /// Create new search results.
    pub fn new(query: String, mut results: Vec<SearchResult>, limit: Option<usize>) -> Self {
        // Sort by score descending
        results.sort();

        let total_matches = results.len();
        let truncated = limit.map(|l| total_matches > l).unwrap_or(false);

        if let Some(limit) = limit {
            results.truncate(limit);
        }

        Self {
            results,
            query,
            total_matches,
            truncated,
        }
    }

    /// Check if any results were found.
    pub fn is_empty(&self) -> bool {
        self.results.is_empty()
    }

    /// Get result count.
    pub fn len(&self) -> usize {
        self.results.len()
    }

    /// Get the top result if any.
    pub fn top(&self) -> Option<&SearchResult> {
        self.results.first()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_match_type_weights() {
        assert!(MatchType::Name.weight() > MatchType::Content.weight());
        assert!(MatchType::Triggers.weight() > MatchType::Tags.weight());
    }

    #[test]
    fn test_search_result_ordering() {
        let mut results = vec![
            SearchResult::new("low".to_string(), 0.3, MatchType::Content),
            SearchResult::new("high".to_string(), 0.9, MatchType::Name),
            SearchResult::new("mid".to_string(), 0.6, MatchType::Tags),
        ];

        results.sort();

        assert_eq!(results[0].domain, "high");
        assert_eq!(results[1].domain, "mid");
        assert_eq!(results[2].domain, "low");
    }

    #[test]
    fn test_search_results_truncation() {
        let results = vec![
            SearchResult::new("a".to_string(), 0.9, MatchType::Name),
            SearchResult::new("b".to_string(), 0.8, MatchType::Name),
            SearchResult::new("c".to_string(), 0.7, MatchType::Name),
        ];

        let search_results = SearchResults::new("test".to_string(), results, Some(2));

        assert_eq!(search_results.len(), 2);
        assert_eq!(search_results.total_matches, 3);
        assert!(search_results.truncated);
    }
}
