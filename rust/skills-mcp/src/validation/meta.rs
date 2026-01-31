//! Metadata validation.

use regex::Regex;

use crate::models::SkillMeta;

/// Validate skill metadata.
///
/// Returns a list of validation errors, or empty if valid.
pub fn validate_meta(meta: &SkillMeta) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();

    // Validate name format: lowercase alphanumeric with hyphens
    let name_regex = Regex::new(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$").unwrap();
    if !name_regex.is_match(&meta.name) {
        errors.push(format!(
            "name: must be lowercase alphanumeric with hyphens, got '{}'",
            meta.name
        ));
    }

    // Validate name length
    if meta.name.is_empty() {
        errors.push("name: cannot be empty".to_string());
    } else if meta.name.len() > 50 {
        errors.push(format!(
            "name: must be 50 characters or less, got {}",
            meta.name.len()
        ));
    }

    // Validate description
    if meta.description.is_empty() {
        errors.push("description: cannot be empty".to_string());
    }

    // Validate sub-skills if present
    if let Some(sub_skills) = &meta.sub_skills {
        for (i, sub) in sub_skills.iter().enumerate() {
            // Validate sub-skill name
            if sub.name.is_empty() {
                errors.push(format!("sub_skills[{}].name: cannot be empty", i));
            }

            // Validate sub-skill file
            if sub.file.is_empty() {
                errors.push(format!("sub_skills[{}].file: cannot be empty", i));
            } else if !sub.file.ends_with(".md") {
                errors.push(format!(
                    "sub_skills[{}].file: must end with .md, got '{}'",
                    i, sub.file
                ));
            }
        }

        // Check for duplicate sub-skill names
        let mut seen_names = std::collections::HashSet::new();
        for sub in sub_skills {
            if !seen_names.insert(&sub.name) {
                errors.push(format!(
                    "sub_skills: duplicate name '{}'",
                    sub.name
                ));
            }
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Validation result with additional context.
#[derive(Debug)]
#[allow(dead_code)]
pub struct ValidationError {
    /// The field that failed validation.
    pub field: String,
    /// The validation error message.
    pub message: String,
}

impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.field, self.message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::SubSkillMeta;

    #[test]
    fn test_valid_minimal_meta() {
        let meta = SkillMeta {
            name: "forms".to_string(),
            description: "Form handling patterns".to_string(),
            tags: vec![],
            sub_skills: None,
            source: None,
        };

        assert!(validate_meta(&meta).is_ok());
    }

    #[test]
    fn test_valid_full_meta() {
        let meta = SkillMeta {
            name: "component-library".to_string(),
            description: "React component patterns".to_string(),
            tags: vec!["react".to_string(), "ui".to_string()],
            sub_skills: Some(vec![
                SubSkillMeta {
                    name: "buttons".to_string(),
                    file: "buttons/SKILL.md".to_string(),
                    triggers: vec!["Button".to_string()],
                },
            ]),
            source: Some("official".to_string()),
        };

        assert!(validate_meta(&meta).is_ok());
    }

    #[test]
    fn test_invalid_name_format() {
        let meta = SkillMeta {
            name: "Invalid Name".to_string(),
            description: "Test".to_string(),
            tags: vec![],
            sub_skills: None,
            source: None,
        };

        let result = validate_meta(&meta);
        assert!(result.is_err());
        assert!(result.unwrap_err()[0].contains("name:"));
    }

    #[test]
    fn test_invalid_name_uppercase() {
        let meta = SkillMeta {
            name: "Forms".to_string(),
            description: "Test".to_string(),
            tags: vec![],
            sub_skills: None,
            source: None,
        };

        let result = validate_meta(&meta);
        assert!(result.is_err());
    }

    #[test]
    fn test_empty_description() {
        let meta = SkillMeta {
            name: "forms".to_string(),
            description: "".to_string(),
            tags: vec![],
            sub_skills: None,
            source: None,
        };

        let result = validate_meta(&meta);
        assert!(result.is_err());
        assert!(result.unwrap_err()[0].contains("description:"));
    }

    #[test]
    fn test_invalid_sub_skill_file() {
        let meta = SkillMeta {
            name: "forms".to_string(),
            description: "Test".to_string(),
            tags: vec![],
            sub_skills: Some(vec![SubSkillMeta {
                name: "react".to_string(),
                file: "react/SKILL.txt".to_string(), // Wrong extension
                triggers: vec![],
            }]),
            source: None,
        };

        let result = validate_meta(&meta);
        assert!(result.is_err());
        assert!(result.unwrap_err()[0].contains("must end with .md"));
    }

    #[test]
    fn test_duplicate_sub_skill_names() {
        let meta = SkillMeta {
            name: "forms".to_string(),
            description: "Test".to_string(),
            tags: vec![],
            sub_skills: Some(vec![
                SubSkillMeta {
                    name: "react".to_string(),
                    file: "react/SKILL.md".to_string(),
                    triggers: vec![],
                },
                SubSkillMeta {
                    name: "react".to_string(), // Duplicate
                    file: "react2/SKILL.md".to_string(),
                    triggers: vec![],
                },
            ]),
            source: None,
        };

        let result = validate_meta(&meta);
        assert!(result.is_err());
        assert!(result.unwrap_err().iter().any(|e| e.contains("duplicate")));
    }

    #[test]
    fn test_single_char_name() {
        let meta = SkillMeta {
            name: "a".to_string(),
            description: "Single char name".to_string(),
            tags: vec![],
            sub_skills: None,
            source: None,
        };

        assert!(validate_meta(&meta).is_ok());
    }
}
