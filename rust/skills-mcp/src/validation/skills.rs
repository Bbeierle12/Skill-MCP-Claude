//! Full skill validation including file system checks.

use std::path::Path;
use std::sync::Arc;

use tracing::debug;

use crate::index::SkillIndexer;
use crate::models::{SkillMeta, ValidationResult};

use super::validate_meta;

/// Skill validator that checks both metadata and file structure.
pub struct SkillValidator {
    indexer: Arc<SkillIndexer>,
}

impl SkillValidator {
    /// Create a new skill validator.
    pub fn new(indexer: Arc<SkillIndexer>) -> Self {
        Self { indexer }
    }

    /// Validate all skills in the index.
    pub fn validate_all(&self) -> ValidationResult {
        let index = self.indexer.get_skill_index();
        let mut result = ValidationResult::pass(index.len());

        // Check for index-level errors
        for error in &index.validation_errors {
            result.add_error(error.clone());
        }

        // Validate each skill
        for skill in &index.skills {
            self.validate_skill(skill, &mut result);
        }

        debug!(
            "Validated {} skills: {} errors, {} warnings",
            result.skills_checked,
            result.errors.len(),
            result.warnings.len()
        );

        result
    }

    /// Validate a single skill.
    fn validate_skill(&self, skill: &SkillMeta, result: &mut ValidationResult) {
        let skill_dir = self.indexer.skills_dir().join(&skill.name);

        // Validate metadata
        if let Err(errors) = validate_meta(skill) {
            for error in errors {
                result.add_error(format!("{}: {}", skill.name, error));
            }
        }

        // Check SKILL.md exists
        let skill_md = skill_dir.join("SKILL.md");
        if !skill_md.exists() {
            result.add_error(format!("{}: Missing SKILL.md", skill.name));
        } else if std::fs::metadata(&skill_md).map(|m| m.len()).unwrap_or(0) == 0 {
            result.add_warning(format!("{}: SKILL.md is empty", skill.name));
        }

        // Validate sub-skills
        if let Some(sub_skills) = &skill.sub_skills {
            for sub in sub_skills {
                let sub_file = skill_dir.join(&sub.file);
                if !sub_file.exists() {
                    result.add_error(format!(
                        "{}: Sub-skill file not found: {}",
                        skill.name, sub.file
                    ));
                }
            }
        }

        // Check for orphaned sub-skill files (warning only)
        self.check_orphaned_files(skill, &skill_dir, result);

        // Check for recommended fields
        if skill.tags.is_empty() && skill.sub_skills.is_none() {
            result.add_warning(format!(
                "{}: No tags or sub_skills defined (reduces discoverability)",
                skill.name
            ));
        }
    }

    /// Check for sub-skill files that aren't referenced in _meta.json.
    fn check_orphaned_files(&self, skill: &SkillMeta, skill_dir: &Path, result: &mut ValidationResult) {
        let referenced_files: std::collections::HashSet<_> = skill
            .sub_skills
            .as_ref()
            .map(|subs| subs.iter().map(|s| s.file.as_str()).collect())
            .unwrap_or_default();

        // Look for .md files in subdirectories
        if let Ok(entries) = std::fs::read_dir(skill_dir) {
            for entry in entries.flatten() {
                let path = entry.path();

                // Skip non-directories and special directories
                if !path.is_dir() {
                    continue;
                }

                let dir_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if dir_name.starts_with('.') || dir_name == "references" {
                    continue;
                }

                // Check for SKILL.md in this subdirectory
                let sub_skill_md = path.join("SKILL.md");
                if sub_skill_md.exists() {
                    let relative = format!("{}/SKILL.md", dir_name);
                    if !referenced_files.contains(relative.as_str()) {
                        result.add_warning(format!(
                            "{}: Unreferenced sub-skill file: {}",
                            skill.name, relative
                        ));
                    }
                }
            }
        }
    }
}

/// Validate all skills using an indexer.
pub fn validate_skills(indexer: Arc<SkillIndexer>) -> ValidationResult {
    let validator = SkillValidator::new(indexer);
    validator.validate_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::SubSkillMeta;
    use std::fs;
    use tempfile::TempDir;

    fn create_skill(dir: &Path, meta: &SkillMeta, create_files: bool) {
        let skill_dir = dir.join(&meta.name);
        fs::create_dir_all(&skill_dir).unwrap();

        let meta_json = serde_json::to_string_pretty(&meta).unwrap();
        fs::write(skill_dir.join("_meta.json"), meta_json).unwrap();

        if create_files {
            fs::write(
                skill_dir.join("SKILL.md"),
                format!("# {}\n\n{}", meta.name, meta.description),
            )
            .unwrap();

            if let Some(subs) = &meta.sub_skills {
                for sub in subs {
                    let sub_path = skill_dir.join(&sub.file);
                    if let Some(parent) = sub_path.parent() {
                        fs::create_dir_all(parent).unwrap();
                    }
                    fs::write(&sub_path, format!("# {}", sub.name)).unwrap();
                }
            }
        }
    }

    #[test]
    fn test_validate_valid_skill() {
        let temp_dir = TempDir::new().unwrap();

        let meta = SkillMeta {
            name: "forms".to_string(),
            description: "Form handling patterns".to_string(),
            tags: vec!["validation".to_string()],
            sub_skills: None,
            source: None,
        };
        create_skill(temp_dir.path(), &meta, true);

        let indexer = Arc::new(SkillIndexer::new(temp_dir.path()));
        indexer.reload().unwrap();

        let result = validate_skills(indexer);
        assert!(result.valid);
        assert!(result.errors.is_empty());
    }

    #[test]
    fn test_validate_missing_skill_md() {
        let temp_dir = TempDir::new().unwrap();

        let meta = SkillMeta {
            name: "forms".to_string(),
            description: "Form handling patterns".to_string(),
            tags: vec![],
            sub_skills: None,
            source: None,
        };
        create_skill(temp_dir.path(), &meta, false);

        let indexer = Arc::new(SkillIndexer::new(temp_dir.path()));
        indexer.reload().unwrap();

        let result = validate_skills(indexer);
        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("Missing SKILL.md")));
    }

    #[test]
    fn test_validate_missing_sub_skill_file() {
        let temp_dir = TempDir::new().unwrap();

        let meta = SkillMeta {
            name: "forms".to_string(),
            description: "Form handling patterns".to_string(),
            tags: vec![],
            sub_skills: Some(vec![SubSkillMeta {
                name: "react".to_string(),
                file: "react/SKILL.md".to_string(),
                triggers: vec![],
            }]),
            source: None,
        };

        // Create skill but don't create sub-skill file
        let skill_dir = temp_dir.path().join(&meta.name);
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("_meta.json"),
            serde_json::to_string(&meta).unwrap(),
        )
        .unwrap();
        fs::write(skill_dir.join("SKILL.md"), "# forms").unwrap();

        let indexer = Arc::new(SkillIndexer::new(temp_dir.path()));
        indexer.reload().unwrap();

        let result = validate_skills(indexer);
        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("Sub-skill file not found")));
    }

    #[test]
    fn test_validate_no_tags_warning() {
        let temp_dir = TempDir::new().unwrap();

        let meta = SkillMeta {
            name: "forms".to_string(),
            description: "Form handling patterns".to_string(),
            tags: vec![],
            sub_skills: None,
            source: None,
        };
        create_skill(temp_dir.path(), &meta, true);

        let indexer = Arc::new(SkillIndexer::new(temp_dir.path()));
        indexer.reload().unwrap();

        let result = validate_skills(indexer);
        assert!(result.valid); // Warnings don't make it invalid
        assert!(result.warnings.iter().any(|w| w.contains("No tags")));
    }
}
