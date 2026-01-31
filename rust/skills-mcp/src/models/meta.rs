//! Skill metadata types matching `_meta.json` schema.

use serde::{Deserialize, Serialize};

/// Sub-skill reference within a parent skill.
///
/// Corresponds to `SubSkillMeta` in TypeScript.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SubSkillMeta {
    /// Sub-skill identifier (e.g., "validation", "react")
    pub name: String,

    /// Relative path to the sub-skill markdown file
    pub file: String,

    /// Optional keywords for search discovery
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub triggers: Vec<String>,
}

/// Primary skill metadata from `_meta.json`.
///
/// Corresponds to `SkillMeta` in TypeScript and validates against `MetaSchema`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SkillMeta {
    /// Skill identifier - must match directory name.
    /// Lowercase alphanumeric with hyphens only.
    pub name: String,

    /// Human-readable description of what the skill provides.
    pub description: String,

    /// Optional search tags for discovery.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,

    /// Optional nested sub-skills for domain/router skills.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sub_skills: Option<Vec<SubSkillMeta>>,

    /// Optional origin indicator (e.g., "community", "official").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

impl SkillMeta {
    /// Check if this skill has sub-skills (is a router/domain skill).
    pub fn has_sub_skills(&self) -> bool {
        self.sub_skills
            .as_ref()
            .map(|s| !s.is_empty())
            .unwrap_or(false)
    }

    /// Get sub-skill names if any.
    pub fn sub_skill_names(&self) -> Vec<&str> {
        self.sub_skills
            .as_ref()
            .map(|subs| subs.iter().map(|s| s.name.as_str()).collect())
            .unwrap_or_default()
    }

    /// Find a sub-skill by name.
    pub fn find_sub_skill(&self, name: &str) -> Option<&SubSkillMeta> {
        self.sub_skills
            .as_ref()
            .and_then(|subs| subs.iter().find(|s| s.name == name))
    }

    /// Get all trigger words (skill-level tags + sub-skill triggers).
    pub fn all_triggers(&self) -> Vec<&str> {
        let mut triggers: Vec<&str> = self.tags.iter().map(|s| s.as_str()).collect();

        if let Some(subs) = &self.sub_skills {
            for sub in subs {
                triggers.extend(sub.triggers.iter().map(|s| s.as_str()));
            }
        }

        triggers
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deserialize_minimal_meta() {
        let json = r#"{
            "name": "test-skill",
            "description": "A test skill"
        }"#;

        let meta: SkillMeta = serde_json::from_str(json).unwrap();
        assert_eq!(meta.name, "test-skill");
        assert_eq!(meta.description, "A test skill");
        assert!(meta.tags.is_empty());
        assert!(!meta.has_sub_skills());
    }

    #[test]
    fn test_deserialize_full_meta() {
        let json = r#"{
            "name": "forms",
            "description": "Form handling patterns",
            "tags": ["validation", "input", "react-hook-form"],
            "sub_skills": [
                {
                    "name": "react",
                    "file": "react/SKILL.md",
                    "triggers": ["useForm", "react-hook-form"]
                },
                {
                    "name": "validation",
                    "file": "validation/SKILL.md"
                }
            ],
            "source": "official"
        }"#;

        let meta: SkillMeta = serde_json::from_str(json).unwrap();
        assert_eq!(meta.name, "forms");
        assert!(meta.has_sub_skills());
        assert_eq!(meta.sub_skill_names(), vec!["react", "validation"]);

        let react_sub = meta.find_sub_skill("react").unwrap();
        assert_eq!(react_sub.triggers, vec!["useForm", "react-hook-form"]);
    }

    #[test]
    fn test_all_triggers() {
        let meta = SkillMeta {
            name: "forms".to_string(),
            description: "Form handling".to_string(),
            tags: vec!["forms".to_string(), "input".to_string()],
            sub_skills: Some(vec![SubSkillMeta {
                name: "react".to_string(),
                file: "react/SKILL.md".to_string(),
                triggers: vec!["useForm".to_string()],
            }]),
            source: None,
        };

        let triggers = meta.all_triggers();
        assert!(triggers.contains(&"forms"));
        assert!(triggers.contains(&"input"));
        assert!(triggers.contains(&"useForm"));
    }
}
