//! Skill indexer implementation.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::RwLock;
use tracing::{debug, error, info};
use walkdir::WalkDir;

use crate::models::{
    ContentIndex, ContentIndexEntry, SkillContent, SkillIndex, SkillMeta, SubSkillContent,
};
use crate::validation::validate_meta;

/// Combined index structure for atomic updates.
///
/// This ensures that skill_index and content_index are always consistent
/// by updating them together in a single write operation.
#[derive(Clone)]
struct CombinedIndex {
    skill_index: SkillIndex,
    content_index: ContentIndex,
}

impl CombinedIndex {
    fn new() -> Self {
        Self {
            skill_index: SkillIndex::new(),
            content_index: ContentIndex::new(),
        }
    }
}

/// Validates that a file path from metadata doesn't escape the skill directory.
///
/// Returns `Ok(canonical_path)` if the path is safe, `Err` otherwise.
fn validate_sub_skill_path(skill_dir: &Path, file: &str) -> Result<PathBuf, IndexError> {
    // Check for obvious path traversal sequences
    if file.contains("..") {
        return Err(IndexError::ValidationError(format!(
            "Sub-skill file path contains '..': {}",
            file
        )));
    }

    // Check for absolute paths
    if file.starts_with('/') || file.starts_with('\\') {
        return Err(IndexError::ValidationError(format!(
            "Sub-skill file path cannot be absolute: {}",
            file
        )));
    }

    // On Windows, also check for drive letters
    if file.len() >= 2 && file.chars().nth(1) == Some(':') {
        return Err(IndexError::ValidationError(format!(
            "Sub-skill file path cannot be absolute: {}",
            file
        )));
    }

    let file_path = skill_dir.join(file);

    // If the file exists, canonicalize and verify it's within skill_dir
    if file_path.exists() {
        let canonical_path = file_path.canonicalize().map_err(|e| {
            IndexError::ReadError(format!("Failed to resolve path {}: {}", file_path.display(), e))
        })?;

        let canonical_skill_dir = skill_dir.canonicalize().map_err(|e| {
            IndexError::ReadError(format!(
                "Failed to resolve skill directory {}: {}",
                skill_dir.display(),
                e
            ))
        })?;

        if !canonical_path.starts_with(&canonical_skill_dir) {
            return Err(IndexError::ValidationError(format!(
                "Sub-skill file path escapes skill directory: {}",
                file
            )));
        }

        Ok(canonical_path)
    } else {
        // File doesn't exist - this is an error anyway
        Err(IndexError::NotFound(format!(
            "Sub-skill file not found: {}",
            file_path.display()
        )))
    }
}

/// Skill indexer that manages metadata and content indexes.
pub struct SkillIndexer {
    /// Path to the skills directory.
    skills_dir: PathBuf,

    /// Combined index protected by a single lock for atomic updates.
    /// This ensures skill_index and content_index are always consistent.
    index: Arc<RwLock<CombinedIndex>>,
}

impl SkillIndexer {
    /// Create a new indexer for the given skills directory.
    pub fn new(skills_dir: impl AsRef<Path>) -> Self {
        Self {
            skills_dir: skills_dir.as_ref().to_path_buf(),
            index: Arc::new(RwLock::new(CombinedIndex::new())),
        }
    }

    /// Get the skills directory path.
    pub fn skills_dir(&self) -> &Path {
        &self.skills_dir
    }

    /// Reload both indexes from disk.
    ///
    /// This performs an atomic update of both indexes to ensure consistency.
    /// Readers will see either the old state or the new state, never a mix.
    pub fn reload(&self) -> Result<(), IndexError> {
        info!("Reloading skill indexes from {:?}", self.skills_dir);

        // Build new indexes outside the lock
        let skill_index = self.build_skill_index()?;
        let content_index = self.build_content_index(&skill_index)?;

        // Capture counts before moving into the combined index
        let skill_count = skill_index.len();
        let content_count = content_index.len();

        // Atomic update: replace both indexes in a single write operation
        let combined = CombinedIndex {
            skill_index,
            content_index,
        };
        *self.index.write() = combined;

        info!(
            "Index reload complete: {} skills, {} content entries",
            skill_count, content_count
        );

        Ok(())
    }

    /// Get the current skill index.
    pub fn get_skill_index(&self) -> SkillIndex {
        self.index.read().skill_index.clone()
    }

    /// Get the current content index.
    pub fn get_content_index(&self) -> ContentIndex {
        self.index.read().content_index.clone()
    }

    // ========================================================================
    // Incremental Index Updates
    // ========================================================================

    /// Update a single skill in the index without rebuilding everything.
    ///
    /// This is more efficient than `reload()` when only one skill has changed.
    pub fn update_skill(&self, name: &str) -> Result<(), IndexError> {
        let skill_dir = self.skills_dir.join(name);

        // Check if skill directory exists
        if !skill_dir.is_dir() {
            // Skill was deleted, remove it from index
            return self.remove_skill(name);
        }

        // Load the skill metadata
        let meta_path = skill_dir.join("_meta.json");
        if !meta_path.exists() {
            debug!("Skill {} missing _meta.json, removing from index", name);
            return self.remove_skill(name);
        }

        let meta = self.load_meta(&meta_path)?;

        // Validate metadata
        if let Err(validation_errors) = validate_meta(&meta) {
            for err in validation_errors {
                debug!("Validation error for {}: {}", name, err);
            }
        }

        // Build content entries for this skill
        let mut content_entries = Vec::new();

        // Index main SKILL.md
        let skill_md = skill_dir.join("SKILL.md");
        if skill_md.exists() {
            if let Ok(content) = fs::read_to_string(&skill_md) {
                content_entries.push(ContentIndexEntry::new(
                    name.to_string(),
                    None,
                    "SKILL.md".to_string(),
                    content,
                ));
            }
        }

        // Index sub-skills
        if let Some(ref sub_skills) = meta.sub_skills {
            for sub in sub_skills {
                let sub_path = skill_dir.join(&sub.file);
                if sub_path.exists() {
                    if let Ok(content) = fs::read_to_string(&sub_path) {
                        content_entries.push(ContentIndexEntry::new(
                            name.to_string(),
                            Some(sub.name.clone()),
                            sub.file.clone(),
                            content,
                        ));
                    }
                }
            }
        }

        // Index references directory if present
        let refs_dir = skill_dir.join("references");
        if refs_dir.is_dir() {
            for entry in WalkDir::new(&refs_dir)
                .follow_links(true)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }

                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if ext != "md" && ext != "markdown" {
                    continue;
                }

                if let Ok(content) = fs::read_to_string(path) {
                    let relative = path.strip_prefix(&skill_dir).unwrap_or(path);
                    content_entries.push(ContentIndexEntry::new(
                        name.to_string(),
                        None,
                        relative.to_string_lossy().to_string(),
                        content,
                    ));
                }
            }
        }

        // Atomically update the index
        {
            let mut index = self.index.write();

            // Remove old entries for this skill
            index.skill_index.skills.retain(|s| s.name != name);
            index.content_index.entries.retain(|_key, entry| entry.domain != name);

            // Add updated entries
            index.skill_index.skills.push(meta);
            index.skill_index.skills.sort_by(|a, b| a.name.cmp(&b.name));

            for entry in content_entries {
                index.content_index.insert(entry);
            }
        }

        debug!("Incrementally updated skill: {}", name);
        Ok(())
    }

    /// Remove a skill from the index.
    pub fn remove_skill(&self, name: &str) -> Result<(), IndexError> {
        let mut index = self.index.write();

        let before_skills = index.skill_index.skills.len();
        let before_content = index.content_index.entries.len();

        // Remove skill metadata
        index.skill_index.skills.retain(|s| s.name != name);

        // Remove content entries
        index.content_index.entries.retain(|_key, entry| entry.domain != name);

        let removed_skills = before_skills - index.skill_index.skills.len();
        let removed_content = before_content - index.content_index.entries.len();

        debug!(
            "Removed skill {} from index ({} skills, {} content entries removed)",
            name, removed_skills, removed_content
        );

        Ok(())
    }

    /// Determine which skill was affected by a file change.
    ///
    /// Returns the skill name if the path is within a skill directory.
    pub fn skill_from_path(&self, path: &Path) -> Option<String> {
        // Try to get the path relative to skills_dir
        let relative = path.strip_prefix(&self.skills_dir).ok()?;

        // The first component should be the skill name
        let skill_name = relative.components().next()?;

        match skill_name {
            std::path::Component::Normal(name) => {
                let name_str = name.to_str()?;
                // Skip hidden directories
                if name_str.starts_with('.') || name_str.starts_with('_') {
                    return None;
                }
                Some(name_str.to_string())
            }
            _ => None,
        }
    }

    /// Get metadata for a specific skill.
    pub fn get_skill_meta(&self, name: &str) -> Option<SkillMeta> {
        self.index.read().skill_index.find(name).cloned()
    }

    /// Check if a skill exists.
    pub fn skill_exists(&self, name: &str) -> bool {
        self.skills_dir.join(name).is_dir()
    }

    /// Check if a skill has a references directory.
    pub fn has_references(&self, name: &str) -> bool {
        self.skills_dir.join(name).join("references").is_dir()
    }

    /// Read main SKILL.md content for a skill.
    pub fn read_skill_content(&self, name: &str) -> Result<SkillContent, IndexError> {
        let skill_dir = self.skills_dir.join(name);
        let skill_md = skill_dir.join("SKILL.md");

        if !skill_md.exists() {
            return Err(IndexError::NotFound(format!(
                "SKILL.md not found for '{}'",
                name
            )));
        }

        let content = fs::read_to_string(&skill_md).map_err(|e| {
            IndexError::ReadError(format!("Failed to read {}: {}", skill_md.display(), e))
        })?;

        let meta = self.get_skill_meta(name);
        let sub_skills = meta
            .as_ref()
            .and_then(|m| m.sub_skills.as_ref())
            .map(|subs| subs.iter().map(|s| s.name.clone()).collect())
            .unwrap_or_default();

        let has_references = self.has_references(name);

        Ok(SkillContent::new(name.to_string(), content)
            .with_sub_skills(sub_skills)
            .with_references(has_references))
    }

    /// Read sub-skill content.
    pub fn read_sub_skill_content(
        &self,
        domain: &str,
        sub_skill: &str,
    ) -> Result<SubSkillContent, IndexError> {
        let meta = self
            .get_skill_meta(domain)
            .ok_or_else(|| IndexError::NotFound(format!("Skill '{}' not found", domain)))?;

        let sub_meta = meta.find_sub_skill(sub_skill).ok_or_else(|| {
            IndexError::NotFound(format!(
                "Sub-skill '{}' not found in '{}'",
                sub_skill, domain
            ))
        })?;

        // Validate that the sub-skill file path doesn't escape the skill directory
        let skill_dir = self.skills_dir.join(domain);
        let file_path = validate_sub_skill_path(&skill_dir, &sub_meta.file)?;

        let content = fs::read_to_string(&file_path).map_err(|e| {
            IndexError::ReadError(format!("Failed to read {}: {}", file_path.display(), e))
        })?;

        Ok(SubSkillContent::new(
            domain.to_string(),
            sub_skill.to_string(),
            content,
        ))
    }

    /// Build the skill metadata index by scanning directories.
    fn build_skill_index(&self) -> Result<SkillIndex, IndexError> {
        let mut skills = Vec::new();
        let mut errors = Vec::new();

        if !self.skills_dir.exists() {
            return Err(IndexError::NotFound(format!(
                "Skills directory not found: {:?}",
                self.skills_dir
            )));
        }

        // Read each subdirectory as a potential skill
        let entries = fs::read_dir(&self.skills_dir).map_err(|e| {
            IndexError::ReadError(format!(
                "Failed to read skills directory {:?}: {}",
                self.skills_dir, e
            ))
        })?;

        for entry in entries.flatten() {
            let path = entry.path();

            // Skip non-directories and hidden files
            if !path.is_dir() {
                continue;
            }

            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();

            if name.starts_with('.') || name.starts_with('_') {
                continue;
            }

            // Try to load _meta.json
            let meta_path = path.join("_meta.json");
            if !meta_path.exists() {
                errors.push(format!("{}: Missing _meta.json", name));
                continue;
            }

            match self.load_meta(&meta_path) {
                Ok(meta) => {
                    // Validate the metadata
                    if let Err(validation_errors) = validate_meta(&meta) {
                        for err in validation_errors {
                            errors.push(format!("{}: {}", name, err));
                        }
                    }
                    skills.push(meta);
                }
                Err(e) => {
                    errors.push(format!("{}: {}", name, e));
                }
            }
        }

        // Sort skills by name
        skills.sort_by(|a, b| a.name.cmp(&b.name));

        debug!("Built skill index: {} skills, {} errors", skills.len(), errors.len());

        Ok(SkillIndex::with_skills(skills, errors))
    }

    /// Build the content index for full-text search.
    fn build_content_index(&self, skill_index: &SkillIndex) -> Result<ContentIndex, IndexError> {
        let mut content_index = ContentIndex::new();

        for skill in &skill_index.skills {
            // Index main SKILL.md
            let skill_md = self.skills_dir.join(&skill.name).join("SKILL.md");
            if skill_md.exists() {
                if let Ok(content) = fs::read_to_string(&skill_md) {
                    content_index.insert(ContentIndexEntry::new(
                        skill.name.clone(),
                        None,
                        "SKILL.md".to_string(),
                        content,
                    ));
                }
            }

            // Index sub-skills
            if let Some(sub_skills) = &skill.sub_skills {
                for sub in sub_skills {
                    let sub_path = self.skills_dir.join(&skill.name).join(&sub.file);
                    if sub_path.exists() {
                        if let Ok(content) = fs::read_to_string(&sub_path) {
                            content_index.insert(ContentIndexEntry::new(
                                skill.name.clone(),
                                Some(sub.name.clone()),
                                sub.file.clone(),
                                content,
                            ));
                        }
                    }
                }
            }

            // Index references directory if present
            let refs_dir = self.skills_dir.join(&skill.name).join("references");
            if refs_dir.is_dir() {
                self.index_directory(&mut content_index, &skill.name, &refs_dir);
            }
        }

        debug!("Built content index: {} entries", content_index.len());

        Ok(content_index)
    }

    /// Index all markdown files in a directory.
    fn index_directory(&self, index: &mut ContentIndex, domain: &str, dir: &Path) {
        for entry in WalkDir::new(dir)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();

            if !path.is_file() {
                continue;
            }

            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext != "md" && ext != "markdown" {
                continue;
            }

            if let Ok(content) = fs::read_to_string(path) {
                let relative = path
                    .strip_prefix(&self.skills_dir.join(domain))
                    .unwrap_or(path);

                index.insert(ContentIndexEntry::new(
                    domain.to_string(),
                    None,
                    relative.to_string_lossy().to_string(),
                    content,
                ));
            }
        }
    }

    /// Load and parse _meta.json file.
    fn load_meta(&self, path: &Path) -> Result<SkillMeta, IndexError> {
        let content = fs::read_to_string(path)
            .map_err(|e| IndexError::ReadError(format!("Failed to read {:?}: {}", path, e)))?;

        serde_json::from_str(&content).map_err(|e| {
            IndexError::ParseError(format!("Failed to parse {:?}: {}", path, e))
        })
    }
}

/// Errors that can occur during indexing.
#[derive(Debug, thiserror::Error)]
pub enum IndexError {
    /// The requested skill or resource was not found.
    #[error("Not found: {0}")]
    NotFound(String),

    /// Failed to read a file from disk.
    #[error("Read error: {0}")]
    ReadError(String),

    /// Failed to parse a file (e.g., invalid JSON).
    #[error("Parse error: {0}")]
    ParseError(String),

    /// The skill metadata failed validation.
    #[error("Validation error: {0}")]
    ValidationError(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn create_test_skill(dir: &Path, name: &str, description: &str) {
        let skill_dir = dir.join(name);
        fs::create_dir_all(&skill_dir).unwrap();

        // Create _meta.json
        let meta = format!(
            r#"{{"name": "{}", "description": "{}"}}"#,
            name, description
        );
        fs::write(skill_dir.join("_meta.json"), meta).unwrap();

        // Create SKILL.md
        let content = format!("# {}\n\n{}", name, description);
        fs::write(skill_dir.join("SKILL.md"), content).unwrap();
    }

    #[test]
    fn test_indexer_basic() {
        let temp_dir = TempDir::new().unwrap();
        create_test_skill(temp_dir.path(), "test-skill", "A test skill");

        let indexer = SkillIndexer::new(temp_dir.path());
        indexer.reload().unwrap();

        let index = indexer.get_skill_index();
        assert_eq!(index.len(), 1);
        assert!(index.find("test-skill").is_some());
    }

    #[test]
    fn test_read_skill_content() {
        let temp_dir = TempDir::new().unwrap();
        create_test_skill(temp_dir.path(), "forms", "Form handling patterns");

        let indexer = SkillIndexer::new(temp_dir.path());
        indexer.reload().unwrap();

        let content = indexer.read_skill_content("forms").unwrap();
        assert_eq!(content.name, "forms");
        assert!(content.content.contains("Form handling patterns"));
    }

    #[test]
    fn test_missing_skill() {
        let temp_dir = TempDir::new().unwrap();
        let indexer = SkillIndexer::new(temp_dir.path());
        indexer.reload().unwrap();

        let result = indexer.read_skill_content("nonexistent");
        assert!(result.is_err());
    }
}
