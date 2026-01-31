//! Skill indexer implementation.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::RwLock;
use tracing::{debug, error, info, warn};
use walkdir::WalkDir;

use crate::models::{
    ContentIndex, ContentIndexEntry, SkillContent, SkillIndex, SkillMeta, SubSkillContent,
};
use crate::validation::validate_meta;

/// Skill indexer that manages metadata and content indexes.
pub struct SkillIndexer {
    /// Path to the skills directory.
    skills_dir: PathBuf,

    /// Cached skill metadata index.
    skill_index: Arc<RwLock<SkillIndex>>,

    /// Cached content index for full-text search.
    content_index: Arc<RwLock<ContentIndex>>,
}

impl SkillIndexer {
    /// Create a new indexer for the given skills directory.
    pub fn new(skills_dir: impl AsRef<Path>) -> Self {
        Self {
            skills_dir: skills_dir.as_ref().to_path_buf(),
            skill_index: Arc::new(RwLock::new(SkillIndex::new())),
            content_index: Arc::new(RwLock::new(ContentIndex::new())),
        }
    }

    /// Get the skills directory path.
    pub fn skills_dir(&self) -> &Path {
        &self.skills_dir
    }

    /// Reload both indexes from disk.
    pub fn reload(&self) -> Result<(), IndexError> {
        info!("Reloading skill indexes from {:?}", self.skills_dir);

        let skill_index = self.build_skill_index()?;
        let content_index = self.build_content_index(&skill_index)?;

        *self.skill_index.write() = skill_index;
        *self.content_index.write() = content_index;

        info!(
            "Index reload complete: {} skills, {} content entries",
            self.skill_index.read().len(),
            self.content_index.read().len()
        );

        Ok(())
    }

    /// Get the current skill index.
    pub fn get_skill_index(&self) -> SkillIndex {
        self.skill_index.read().clone()
    }

    /// Get the current content index.
    pub fn get_content_index(&self) -> ContentIndex {
        self.content_index.read().clone()
    }

    /// Get metadata for a specific skill.
    pub fn get_skill_meta(&self, name: &str) -> Option<SkillMeta> {
        self.skill_index.read().find(name).cloned()
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

        let file_path = self.skills_dir.join(domain).join(&sub_meta.file);

        if !file_path.exists() {
            return Err(IndexError::NotFound(format!(
                "Sub-skill file not found: {}",
                file_path.display()
            )));
        }

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
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Read error: {0}")]
    ReadError(String),

    #[error("Parse error: {0}")]
    ParseError(String),

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
