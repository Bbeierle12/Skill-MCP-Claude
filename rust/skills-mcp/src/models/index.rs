//! Index data structures for skill metadata and content.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::SkillMeta;

/// Aggregated skill metadata index.
///
/// Corresponds to `SkillIndex` in TypeScript.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillIndex {
    /// All loaded skill metadata.
    pub skills: Vec<SkillMeta>,

    /// Errors encountered during index building.
    #[serde(default)]
    pub validation_errors: Vec<String>,

    /// ISO timestamp of last index update.
    pub last_updated: DateTime<Utc>,
}

impl SkillIndex {
    /// Create a new empty index.
    pub fn new() -> Self {
        Self {
            skills: Vec::new(),
            validation_errors: Vec::new(),
            last_updated: Utc::now(),
        }
    }

    /// Create index with skills and errors.
    pub fn with_skills(skills: Vec<SkillMeta>, errors: Vec<String>) -> Self {
        Self {
            skills,
            validation_errors: errors,
            last_updated: Utc::now(),
        }
    }

    /// Find a skill by name.
    pub fn find(&self, name: &str) -> Option<&SkillMeta> {
        self.skills.iter().find(|s| s.name == name)
    }

    /// Get skill count.
    pub fn len(&self) -> usize {
        self.skills.len()
    }

    /// Check if index is empty.
    pub fn is_empty(&self) -> bool {
        self.skills.is_empty()
    }

    /// Check if there were validation errors.
    pub fn has_errors(&self) -> bool {
        !self.validation_errors.is_empty()
    }
}

impl Default for SkillIndex {
    fn default() -> Self {
        Self::new()
    }
}

/// Single entry in the content index for full-text search.
///
/// Corresponds to `ContentIndexEntry` in TypeScript.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentIndexEntry {
    /// Parent skill domain.
    pub domain: String,

    /// Sub-skill name if this is sub-skill content, None for main SKILL.md.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sub_skill: Option<String>,

    /// Relative file path.
    pub file: String,

    /// Lowercase searchable content.
    pub content: String,

    /// Word count for TF-IDF calculations.
    pub word_count: usize,

    /// Extracted markdown headings.
    #[serde(default)]
    pub headings: Vec<String>,
}

impl ContentIndexEntry {
    /// Create a new content index entry.
    pub fn new(
        domain: String,
        sub_skill: Option<String>,
        file: String,
        content: String,
    ) -> Self {
        let word_count = content.split_whitespace().count();
        let headings = Self::extract_headings(&content);
        let content_lower = content.to_lowercase();

        Self {
            domain,
            sub_skill,
            file,
            content: content_lower,
            word_count,
            headings,
        }
    }

    /// Extract markdown headings from content.
    fn extract_headings(content: &str) -> Vec<String> {
        content
            .lines()
            .filter(|line| line.starts_with('#'))
            .map(|line| line.trim_start_matches('#').trim().to_string())
            .collect()
    }

    /// Check if this entry matches a search term.
    pub fn matches(&self, term: &str) -> bool {
        let term_lower = term.to_lowercase();
        self.content.contains(&term_lower)
    }

    /// Count occurrences of a term.
    pub fn count_matches(&self, term: &str) -> usize {
        let term_lower = term.to_lowercase();
        self.content.matches(&term_lower).count()
    }

    /// Generate a unique key for this entry.
    pub fn key(&self) -> String {
        match &self.sub_skill {
            Some(sub) => format!("{}:{}", self.domain, sub),
            None => self.domain.clone(),
        }
    }
}

/// Full content index mapping keys to entries.
///
/// Corresponds to `ContentIndex` in TypeScript.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ContentIndex {
    /// Map of unique keys to content entries.
    pub entries: HashMap<String, ContentIndexEntry>,

    /// ISO timestamp of last index update.
    pub last_updated: DateTime<Utc>,
}

impl ContentIndex {
    /// Create a new empty content index.
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
            last_updated: Utc::now(),
        }
    }

    /// Add an entry to the index.
    pub fn insert(&mut self, entry: ContentIndexEntry) {
        let key = entry.key();
        self.entries.insert(key, entry);
        self.last_updated = Utc::now();
    }

    /// Get an entry by key.
    pub fn get(&self, key: &str) -> Option<&ContentIndexEntry> {
        self.entries.get(key)
    }

    /// Get entries for a specific domain.
    pub fn get_domain_entries(&self, domain: &str) -> Vec<&ContentIndexEntry> {
        self.entries
            .values()
            .filter(|e| e.domain == domain)
            .collect()
    }

    /// Get total entry count.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Check if index is empty.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Iterate over all entries.
    pub fn iter(&self) -> impl Iterator<Item = (&String, &ContentIndexEntry)> {
        self.entries.iter()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_skill_index_operations() {
        let meta = SkillMeta {
            name: "test".to_string(),
            description: "Test skill".to_string(),
            tags: vec![],
            sub_skills: None,
            source: None,
        };

        let index = SkillIndex::with_skills(vec![meta.clone()], vec![]);
        assert_eq!(index.len(), 1);
        assert!(!index.has_errors());
        assert!(index.find("test").is_some());
        assert!(index.find("nonexistent").is_none());
    }

    #[test]
    fn test_content_index_entry() {
        let entry = ContentIndexEntry::new(
            "forms".to_string(),
            Some("react".to_string()),
            "react/SKILL.md".to_string(),
            "# React Forms\n\nUse `useForm` hook for validation.".to_string(),
        );

        assert_eq!(entry.key(), "forms:react");
        assert!(entry.matches("useForm"));
        assert!(entry.matches("USEFORM")); // case insensitive
        assert!(!entry.matches("angular"));
        assert_eq!(entry.headings, vec!["React Forms"]);
    }

    #[test]
    fn test_content_index() {
        let mut index = ContentIndex::new();

        let entry1 = ContentIndexEntry::new(
            "forms".to_string(),
            None,
            "SKILL.md".to_string(),
            "Form handling patterns".to_string(),
        );

        let entry2 = ContentIndexEntry::new(
            "forms".to_string(),
            Some("react".to_string()),
            "react/SKILL.md".to_string(),
            "React form patterns".to_string(),
        );

        index.insert(entry1);
        index.insert(entry2);

        assert_eq!(index.len(), 2);
        assert!(index.get("forms").is_some());
        assert!(index.get("forms:react").is_some());
        assert_eq!(index.get_domain_entries("forms").len(), 2);
    }
}
