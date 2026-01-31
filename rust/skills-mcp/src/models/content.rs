//! Content retrieval types.

use serde::{Deserialize, Serialize};

/// Full skill content response.
///
/// Corresponds to `SkillContent` in TypeScript.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillContent {
    /// Skill name/identifier.
    pub name: String,

    /// SKILL.md content.
    pub content: String,

    /// Available sub-skill names.
    #[serde(default)]
    pub sub_skills: Vec<String>,

    /// Whether this skill has a references directory.
    pub has_references: bool,
}

impl SkillContent {
    /// Create a new skill content response.
    pub fn new(name: String, content: String) -> Self {
        Self {
            name,
            content,
            sub_skills: Vec::new(),
            has_references: false,
        }
    }

    /// Set sub-skills.
    pub fn with_sub_skills(mut self, sub_skills: Vec<String>) -> Self {
        self.sub_skills = sub_skills;
        self
    }

    /// Set has_references.
    pub fn with_references(mut self, has_references: bool) -> Self {
        self.has_references = has_references;
        self
    }
}

/// Sub-skill content response.
///
/// Corresponds to `SubSkillContent` in TypeScript.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubSkillContent {
    /// Parent skill domain.
    pub domain: String,

    /// Sub-skill name.
    pub sub_skill: String,

    /// Sub-skill markdown content.
    pub content: String,
}

impl SubSkillContent {
    /// Create a new sub-skill content response.
    pub fn new(domain: String, sub_skill: String, content: String) -> Self {
        Self {
            domain,
            sub_skill,
            content,
        }
    }
}

/// Batch request item for loading multiple skills.
///
/// Corresponds to `BatchRequest` in TypeScript.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchRequest {
    /// Skill domain name.
    pub domain: String,

    /// Optional sub-skill name. None means load main SKILL.md.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sub_skill: Option<String>,
}

impl BatchRequest {
    /// Create a request for main skill content.
    pub fn skill(domain: String) -> Self {
        Self {
            domain,
            sub_skill: None,
        }
    }

    /// Create a request for sub-skill content.
    pub fn sub_skill(domain: String, sub_skill: String) -> Self {
        Self {
            domain,
            sub_skill: Some(sub_skill),
        }
    }
}

/// Response item for batch loading.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum BatchResponseItem {
    /// Skill content.
    Skill(SkillContent),
    /// Sub-skill content.
    SubSkill(SubSkillContent),
    /// Error loading content.
    Error {
        /// The skill domain that failed to load.
        domain: String,
        /// The error message describing what went wrong.
        error: String,
    },
}

impl BatchResponseItem {
    /// Create an error response.
    pub fn error(domain: String, error: String) -> Self {
        Self::Error { domain, error }
    }

    /// Check if this is an error.
    pub fn is_error(&self) -> bool {
        matches!(self, Self::Error { .. })
    }
}

/// Response format options.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResponseFormat {
    /// Return as markdown text.
    #[default]
    Markdown,
    /// Return as JSON.
    Json,
}

/// Template options for skill generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillTemplate {
    /// Minimal template with just essentials.
    Minimal,
    /// Standard template with common sections.
    #[default]
    Standard,
    /// Full template with sub-skills structure.
    WithSubSkills,
}

/// Standard error response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorResponse {
    /// Error message.
    pub error: String,
}

impl ErrorResponse {
    /// Create a new error response.
    pub fn new(error: impl Into<String>) -> Self {
        Self {
            error: error.into(),
        }
    }
}

impl From<String> for ErrorResponse {
    fn from(error: String) -> Self {
        Self::new(error)
    }
}

impl From<&str> for ErrorResponse {
    fn from(error: &str) -> Self {
        Self::new(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_skill_content_builder() {
        let content = SkillContent::new("forms".to_string(), "# Forms\n\nContent...".to_string())
            .with_sub_skills(vec!["react".to_string(), "validation".to_string()])
            .with_references(true);

        assert_eq!(content.name, "forms");
        assert_eq!(content.sub_skills.len(), 2);
        assert!(content.has_references);
    }

    #[test]
    fn test_batch_request() {
        let skill_req = BatchRequest::skill("forms".to_string());
        assert!(skill_req.sub_skill.is_none());

        let sub_req = BatchRequest::sub_skill("forms".to_string(), "react".to_string());
        assert_eq!(sub_req.sub_skill, Some("react".to_string()));
    }

    #[test]
    fn test_batch_response_item() {
        let error = BatchResponseItem::error("forms".to_string(), "Not found".to_string());
        assert!(error.is_error());

        let skill = BatchResponseItem::Skill(SkillContent::new(
            "forms".to_string(),
            "content".to_string(),
        ));
        assert!(!skill.is_error());
    }
}
