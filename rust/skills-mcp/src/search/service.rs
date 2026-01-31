//! Search service implementation.

use std::sync::Arc;

use tracing::debug;

use crate::index::SkillIndexer;
use crate::models::{MatchType, SearchOptions, SearchResult, SearchResults, SkillMeta};

use super::extract_snippet;

/// Search service for querying skills and content.
pub struct SearchService {
    indexer: Arc<SkillIndexer>,
}

impl SearchService {
    /// Default context size for snippets.
    const DEFAULT_SNIPPET_CONTEXT: usize = 50;

    /// Create a new search service.
    pub fn new(indexer: Arc<SkillIndexer>) -> Self {
        Self { indexer }
    }

    /// Search skills by metadata (name, description, tags, triggers).
    pub fn search_skills(&self, query: &str, options: SearchOptions) -> SearchResults {
        let skill_index = self.indexer.get_skill_index();
        let query_lower = query.to_lowercase();
        let terms: Vec<&str> = query_lower.split_whitespace().collect();

        let mut results = Vec::new();

        for skill in &skill_index.skills {
            if let Some(result) = self.match_skill(skill, &query_lower, &terms) {
                // Apply domain filter if set
                if let Some(ref domains) = options.domains {
                    if !domains.contains(&skill.name) {
                        continue;
                    }
                }

                // Apply match type filter if set
                if let Some(ref match_types) = options.match_types {
                    if !match_types.contains(&result.match_type) {
                        continue;
                    }
                }

                // Apply min score filter
                if let Some(min_score) = options.min_score {
                    if result.score < min_score {
                        continue;
                    }
                }

                results.push(result);
            }
        }

        debug!(
            "Skill search '{}' found {} results",
            query,
            results.len()
        );

        SearchResults::new(query.to_string(), results, options.limit)
    }

    /// Search content by full-text matching.
    pub fn search_content(&self, query: &str, options: SearchOptions) -> SearchResults {
        let content_index = self.indexer.get_content_index();
        let query_lower = query.to_lowercase();
        let terms: Vec<&str> = query_lower.split_whitespace().collect();

        let mut results = Vec::new();

        for (_, entry) in content_index.iter() {
            // Apply domain filter
            if let Some(ref domains) = options.domains {
                if !domains.contains(&entry.domain) {
                    continue;
                }
            }

            // Check for matches
            let match_count: usize = terms.iter().map(|t| entry.count_matches(t)).sum();

            if match_count == 0 {
                continue;
            }

            // Calculate TF-IDF-like score
            let tf = match_count as f64 / entry.word_count.max(1) as f64;
            let score = tf * MatchType::Content.weight();

            // Apply min score filter
            if let Some(min_score) = options.min_score {
                if score < min_score {
                    continue;
                }
            }

            // Extract snippet
            let snippet = extract_snippet(&entry.content, &query_lower, Self::DEFAULT_SNIPPET_CONTEXT);

            let mut result = SearchResult::new(entry.domain.clone(), score, MatchType::Content)
                .with_file(entry.file.clone());

            if let Some(sub) = &entry.sub_skill {
                result = result.with_sub_skill(sub.clone());
            }

            if let Some(snippet) = snippet {
                result = result.with_snippet(snippet);
            }

            results.push(result);
        }

        debug!(
            "Content search '{}' found {} results",
            query,
            results.len()
        );

        SearchResults::new(query.to_string(), results, options.limit)
    }

    /// Combined search across both skills and content.
    pub fn search_all(&self, query: &str, options: SearchOptions) -> SearchResults {
        let skill_results = self.search_skills(query, options.clone());
        let content_results = self.search_content(query, options.clone());

        // Merge and deduplicate results
        let mut all_results = skill_results.results;

        for content_result in content_results.results {
            // Check if we already have a result for this domain/sub_skill
            let exists = all_results.iter().any(|r| {
                r.domain == content_result.domain && r.sub_skill == content_result.sub_skill
            });

            if !exists {
                all_results.push(content_result);
            }
        }

        SearchResults::new(query.to_string(), all_results, options.limit)
    }

    /// Match a skill against search terms.
    fn match_skill(
        &self,
        skill: &SkillMeta,
        query: &str,
        terms: &[&str],
    ) -> Option<SearchResult> {
        let name_lower = skill.name.to_lowercase();
        let desc_lower = skill.description.to_lowercase();

        // Exact name match (highest priority)
        if name_lower == query {
            return Some(SearchResult::new(
                skill.name.clone(),
                1.0 * MatchType::Name.weight(),
                MatchType::Name,
            ));
        }

        // Name contains query
        if name_lower.contains(query) {
            return Some(SearchResult::new(
                skill.name.clone(),
                0.8 * MatchType::Name.weight(),
                MatchType::Name,
            ));
        }

        // Check tags first (before triggers, since all_triggers includes tags)
        let tags: Vec<String> = skill.tags.iter().map(|s| s.to_lowercase()).collect();
        for tag in &tags {
            if tag == query || tag.contains(query) {
                return Some(SearchResult::new(
                    skill.name.clone(),
                    0.9 * MatchType::Tags.weight(),
                    MatchType::Tags,
                ));
            }
        }

        // Check sub-skill triggers (only the actual triggers, not tags)
        if let Some(subs) = &skill.sub_skills {
            for sub in subs {
                for trigger in &sub.triggers {
                    let trigger_lower = trigger.to_lowercase();
                    if trigger_lower == query || trigger_lower.contains(query) {
                        return Some(SearchResult::new(
                            skill.name.clone(),
                            0.9 * MatchType::Triggers.weight(),
                            MatchType::Triggers,
                        ));
                    }
                }
            }
        }

        // Description match
        let term_matches: usize = terms
            .iter()
            .filter(|t| desc_lower.contains(*t))
            .count();

        if term_matches > 0 {
            let score = (term_matches as f64 / terms.len() as f64) * MatchType::Description.weight();
            return Some(
                SearchResult::new(skill.name.clone(), score, MatchType::Description)
                    .with_snippet(skill.description.clone()),
            );
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::SubSkillMeta;
    use std::fs;
    use tempfile::TempDir;

    fn create_test_skill(dir: &std::path::Path, meta: &SkillMeta) {
        let skill_dir = dir.join(&meta.name);
        fs::create_dir_all(&skill_dir).unwrap();

        let meta_json = serde_json::to_string_pretty(&meta).unwrap();
        fs::write(skill_dir.join("_meta.json"), meta_json).unwrap();

        let content = format!("# {}\n\n{}", meta.name, meta.description);
        fs::write(skill_dir.join("SKILL.md"), content).unwrap();
    }

    #[test]
    fn test_search_by_name() {
        let temp_dir = TempDir::new().unwrap();

        let meta = SkillMeta {
            name: "forms".to_string(),
            description: "Form handling patterns".to_string(),
            tags: vec!["validation".to_string()],
            sub_skills: None,
            source: None,
        };
        create_test_skill(temp_dir.path(), &meta);

        let indexer = Arc::new(SkillIndexer::new(temp_dir.path()));
        indexer.reload().unwrap();

        let service = SearchService::new(indexer);
        let results = service.search_skills("forms", SearchOptions::default());

        assert!(!results.is_empty());
        assert_eq!(results.top().unwrap().domain, "forms");
        assert_eq!(results.top().unwrap().match_type, MatchType::Name);
    }

    #[test]
    fn test_search_by_tag() {
        let temp_dir = TempDir::new().unwrap();

        let meta = SkillMeta {
            name: "forms".to_string(),
            description: "Form handling patterns".to_string(),
            tags: vec!["schema-validation".to_string(), "input".to_string()],
            sub_skills: None,
            source: None,
        };
        create_test_skill(temp_dir.path(), &meta);

        let indexer = Arc::new(SkillIndexer::new(temp_dir.path()));
        indexer.reload().unwrap();

        let service = SearchService::new(indexer);
        // Search for a term that's only in tags, not in name/description/triggers
        let results = service.search_skills("schema-validation", SearchOptions::default());

        assert!(!results.is_empty());
        assert_eq!(results.top().unwrap().match_type, MatchType::Tags);
    }

    #[test]
    fn test_search_by_trigger() {
        let temp_dir = TempDir::new().unwrap();

        let meta = SkillMeta {
            name: "forms".to_string(),
            description: "Form handling patterns".to_string(),
            tags: vec![],
            sub_skills: Some(vec![SubSkillMeta {
                name: "react".to_string(),
                file: "react/SKILL.md".to_string(),
                triggers: vec!["useForm".to_string(), "react-hook-form".to_string()],
            }]),
            source: None,
        };
        create_test_skill(temp_dir.path(), &meta);

        let indexer = Arc::new(SkillIndexer::new(temp_dir.path()));
        indexer.reload().unwrap();

        let service = SearchService::new(indexer);
        let results = service.search_skills("useForm", SearchOptions::default());

        assert!(!results.is_empty());
        assert_eq!(results.top().unwrap().match_type, MatchType::Triggers);
    }

    #[test]
    fn test_search_no_results() {
        let temp_dir = TempDir::new().unwrap();

        let meta = SkillMeta {
            name: "forms".to_string(),
            description: "Form handling patterns".to_string(),
            tags: vec![],
            sub_skills: None,
            source: None,
        };
        create_test_skill(temp_dir.path(), &meta);

        let indexer = Arc::new(SkillIndexer::new(temp_dir.path()));
        indexer.reload().unwrap();

        let service = SearchService::new(indexer);
        let results = service.search_skills("nonexistent", SearchOptions::default());

        assert!(results.is_empty());
    }
}
