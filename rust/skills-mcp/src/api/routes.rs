//! API route handlers.
//!
//! These handlers correspond to the Flask routes in skills_manager_api.py.

use std::path::Path as StdPath;
use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use tokio::fs as async_fs;

use crate::mcp::tools::ServiceContext;
use crate::models::{ErrorResponse, SkillMeta};

// ============================================================================
// Path Traversal Protection
// ============================================================================

/// Maximum allowed skill name length
const MAX_SKILL_NAME_LENGTH: usize = 100;

/// Maximum allowed description length
const MAX_DESCRIPTION_LENGTH: usize = 1000;

/// Maximum allowed content length (1 MB)
const MAX_CONTENT_LENGTH: usize = 1_000_000;

/// Maximum number of tags per skill
const MAX_TAGS_COUNT: usize = 20;

/// Maximum length of each tag
const MAX_TAG_LENGTH: usize = 50;

/// Characters that are not allowed in skill names
const FORBIDDEN_CHARS: &[char] = &['/', '\\', '\0', ':', '*', '?', '"', '<', '>', '|'];

/// Validates that a skill name is safe and doesn't contain path traversal sequences.
///
/// Returns `Ok(())` if the name is valid, or an error response if not.
fn validate_skill_name(name: &str) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    // Check for empty name
    if name.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new("Skill name cannot be empty".to_string())),
        ));
    }

    // Check length
    if name.len() > MAX_SKILL_NAME_LENGTH {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(format!(
                "Skill name too long (max {} characters)",
                MAX_SKILL_NAME_LENGTH
            ))),
        ));
    }

    // Check for path traversal sequences
    if name.contains("..") {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(
                "Skill name cannot contain '..'".to_string(),
            )),
        ));
    }

    // Check for forbidden characters
    if name.chars().any(|c| FORBIDDEN_CHARS.contains(&c)) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(
                "Skill name contains invalid characters".to_string(),
            )),
        ));
    }

    // Check name doesn't start with a dot (hidden files)
    if name.starts_with('.') {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(
                "Skill name cannot start with '.'".to_string(),
            )),
        ));
    }

    Ok(())
}

/// Validates that a resolved path is within the skills directory.
///
/// This provides defense-in-depth against path traversal attacks.
fn validate_skill_path(
    skill_path: &StdPath,
    skills_dir: &StdPath,
) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    // Canonicalize both paths to resolve any symlinks and relative components
    let canonical_skills_dir = match skills_dir.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            // If skills_dir doesn't exist or can't be canonicalized, use it as-is
            skills_dir.to_path_buf()
        }
    };

    // For skill_path, it may not exist yet (for create operations)
    // So we canonicalize the parent (skills_dir) and check the name component
    let skill_name = match skill_path.file_name() {
        Some(name) => name,
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new("Invalid skill path".to_string())),
            ));
        }
    };

    // Build expected path from canonical skills dir
    let expected_path = canonical_skills_dir.join(skill_name);

    // If the skill path exists, canonicalize it and compare
    if skill_path.exists() {
        let canonical_skill_path = match skill_path.canonicalize() {
            Ok(p) => p,
            Err(e) => {
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse::new(format!(
                        "Failed to resolve skill path: {}",
                        e
                    ))),
                ));
            }
        };

        // Ensure the canonical path starts with the skills directory
        if !canonical_skill_path.starts_with(&canonical_skills_dir) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new(
                    "Skill path is outside skills directory".to_string(),
                )),
            ));
        }
    } else {
        // For paths that don't exist yet, verify the constructed path matches
        if skill_path != expected_path {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new(
                    "Invalid skill path construction".to_string(),
                )),
            ));
        }
    }

    Ok(())
}

/// Application state shared across routes.
pub type AppState = Arc<ServiceContext>;

// ============================================================================
// GET /api/skills - List all skills
// ============================================================================

#[derive(Debug, Serialize)]
pub struct SkillListItem {
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    pub sub_skills: Vec<String>,
    pub file_count: usize,
}

pub async fn list_skills(State(state): State<AppState>) -> impl IntoResponse {
    let index = state.indexer.get_skill_index();

    let skills: Vec<SkillListItem> = index
        .skills
        .iter()
        .map(|s| {
            let file_count = if s.has_sub_skills() {
                s.sub_skills.as_ref().map(|ss| ss.len()).unwrap_or(0) + 1
            } else {
                1
            };

            SkillListItem {
                name: s.name.clone(),
                description: s.description.clone(),
                tags: s.tags.clone(),
                sub_skills: s.sub_skill_names().iter().map(|n| n.to_string()).collect(),
                file_count,
            }
        })
        .collect();

    Json(skills)
}

// ============================================================================
// GET /api/skills/:name - Get skill details
// ============================================================================

#[derive(Debug, Serialize)]
pub struct SkillDetails {
    pub name: String,
    pub description: String,
    pub content: String,
    pub tags: Vec<String>,
    pub sub_skills: Vec<SubSkillInfo>,
    pub has_references: bool,
}

#[derive(Debug, Serialize)]
pub struct SubSkillInfo {
    pub name: String,
    pub file: String,
    pub triggers: Vec<String>,
}

pub async fn get_skill(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<SkillDetails>, (StatusCode, Json<ErrorResponse>)> {
    // Validate skill name to prevent path traversal
    validate_skill_name(&name)?;

    let meta = state
        .indexer
        .get_skill_meta(&name)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(format!("Skill '{}' not found", name))),
            )
        })?;

    let content = state
        .indexer
        .read_skill_content(&name)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::new(e.to_string())),
            )
        })?;

    let sub_skills = meta
        .sub_skills
        .as_ref()
        .map(|subs| {
            subs.iter()
                .map(|s| SubSkillInfo {
                    name: s.name.clone(),
                    file: s.file.clone(),
                    triggers: s.triggers.clone(),
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(Json(SkillDetails {
        name: meta.name,
        description: meta.description,
        content: content.content,
        tags: meta.tags,
        sub_skills,
        has_references: content.has_references,
    }))
}

// ============================================================================
// POST /api/skills - Create skill
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct CreateSkillRequest {
    pub name: String,
    pub description: String,
    pub content: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

impl CreateSkillRequest {
    /// Validate the request fields.
    fn validate(&self) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
        // Validate description length
        if self.description.len() > MAX_DESCRIPTION_LENGTH {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new(format!(
                    "Description too long (max {} characters)",
                    MAX_DESCRIPTION_LENGTH
                ))),
            ));
        }

        // Validate content length
        if self.content.len() > MAX_CONTENT_LENGTH {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new(format!(
                    "Content too long (max {} bytes)",
                    MAX_CONTENT_LENGTH
                ))),
            ));
        }

        // Validate tags count
        if self.tags.len() > MAX_TAGS_COUNT {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new(format!(
                    "Too many tags (max {})",
                    MAX_TAGS_COUNT
                ))),
            ));
        }

        // Validate individual tag lengths
        for tag in &self.tags {
            if tag.len() > MAX_TAG_LENGTH {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse::new(format!(
                        "Tag '{}' too long (max {} characters)",
                        tag, MAX_TAG_LENGTH
                    ))),
                ));
            }
            if tag.is_empty() {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse::new("Tags cannot be empty".to_string())),
                ));
            }
        }

        Ok(())
    }
}

pub async fn create_skill(
    State(state): State<AppState>,
    Json(req): Json<CreateSkillRequest>,
) -> Result<(StatusCode, Json<SkillDetails>), (StatusCode, Json<ErrorResponse>)> {
    // Validate skill name to prevent path traversal
    validate_skill_name(&req.name)?;

    // Validate request fields
    req.validate()?;

    // Check if skill already exists
    if state.indexer.skill_exists(&req.name) {
        return Err((
            StatusCode::CONFLICT,
            Json(ErrorResponse::new(format!(
                "Skill '{}' already exists",
                req.name
            ))),
        ));
    }

    // Create skill directory and files
    let skills_dir = state.indexer.skills_dir();
    let skill_dir = skills_dir.join(&req.name);

    // Validate the constructed path is within skills directory
    validate_skill_path(&skill_dir, skills_dir)?;

    async_fs::create_dir_all(&skill_dir).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(format!("Failed to create directory: {}", e))),
        )
    })?;

    // Create _meta.json
    let meta = SkillMeta {
        name: req.name.clone(),
        description: req.description.clone(),
        tags: req.tags.clone(),
        sub_skills: None,
        source: None,
    };

    let meta_json = serde_json::to_string_pretty(&meta).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(format!("Failed to serialize meta: {}", e))),
        )
    })?;

    async_fs::write(skill_dir.join("_meta.json"), meta_json).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(format!("Failed to write _meta.json: {}", e))),
        )
    })?;

    // Create SKILL.md
    async_fs::write(skill_dir.join("SKILL.md"), &req.content).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(format!("Failed to write SKILL.md: {}", e))),
        )
    })?;

    // Reload index
    state.indexer.reload().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(format!("Failed to reload index: {}", e))),
        )
    })?;

    Ok((
        StatusCode::CREATED,
        Json(SkillDetails {
            name: req.name,
            description: req.description,
            content: req.content,
            tags: req.tags,
            sub_skills: vec![],
            has_references: false,
        }),
    ))
}

// ============================================================================
// PUT /api/skills/:name - Update skill
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct UpdateSkillRequest {
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

impl UpdateSkillRequest {
    /// Validate the request fields.
    fn validate(&self) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
        // Validate description length if provided
        if let Some(ref desc) = self.description {
            if desc.len() > MAX_DESCRIPTION_LENGTH {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse::new(format!(
                        "Description too long (max {} characters)",
                        MAX_DESCRIPTION_LENGTH
                    ))),
                ));
            }
        }

        // Validate content length if provided
        if let Some(ref content) = self.content {
            if content.len() > MAX_CONTENT_LENGTH {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse::new(format!(
                        "Content too long (max {} bytes)",
                        MAX_CONTENT_LENGTH
                    ))),
                ));
            }
        }

        // Validate tags if provided
        if let Some(ref tags) = self.tags {
            if tags.len() > MAX_TAGS_COUNT {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse::new(format!(
                        "Too many tags (max {})",
                        MAX_TAGS_COUNT
                    ))),
                ));
            }

            for tag in tags {
                if tag.len() > MAX_TAG_LENGTH {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        Json(ErrorResponse::new(format!(
                            "Tag '{}' too long (max {} characters)",
                            tag, MAX_TAG_LENGTH
                        ))),
                    ));
                }
                if tag.is_empty() {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        Json(ErrorResponse::new("Tags cannot be empty".to_string())),
                    ));
                }
            }
        }

        Ok(())
    }
}

pub async fn update_skill(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(req): Json<UpdateSkillRequest>,
) -> Result<Json<SkillDetails>, (StatusCode, Json<ErrorResponse>)> {
    // Validate skill name to prevent path traversal
    validate_skill_name(&name)?;

    // Validate request fields
    req.validate()?;

    let skills_dir = state.indexer.skills_dir();
    let skill_dir = skills_dir.join(&name);

    // Validate the constructed path is within skills directory
    validate_skill_path(&skill_dir, skills_dir)?;

    if !skill_dir.exists() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("Skill '{}' not found", name))),
        ));
    }

    // Load existing meta
    let meta_path = skill_dir.join("_meta.json");
    let meta_content = async_fs::read_to_string(&meta_path).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(format!("Failed to read _meta.json: {}", e))),
        )
    })?;

    let mut meta: SkillMeta = serde_json::from_str(&meta_content).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(format!("Failed to parse _meta.json: {}", e))),
        )
    })?;

    // Update fields
    if let Some(description) = req.description {
        meta.description = description;
    }
    if let Some(tags) = req.tags {
        meta.tags = tags;
    }

    // Save updated meta
    let meta_json = serde_json::to_string_pretty(&meta).unwrap();
    async_fs::write(&meta_path, meta_json).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(format!("Failed to write _meta.json: {}", e))),
        )
    })?;

    // Update content if provided
    let content = if let Some(new_content) = req.content {
        async_fs::write(skill_dir.join("SKILL.md"), &new_content).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::new(format!("Failed to write SKILL.md: {}", e))),
            )
        })?;
        new_content
    } else {
        async_fs::read_to_string(skill_dir.join("SKILL.md")).await.unwrap_or_default()
    };

    // Reload index
    let _ = state.indexer.reload();

    let sub_skills = meta
        .sub_skills
        .as_ref()
        .map(|subs| {
            subs.iter()
                .map(|s| SubSkillInfo {
                    name: s.name.clone(),
                    file: s.file.clone(),
                    triggers: s.triggers.clone(),
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(Json(SkillDetails {
        name: meta.name,
        description: meta.description,
        content,
        tags: meta.tags,
        sub_skills,
        has_references: state.indexer.has_references(&name),
    }))
}

// ============================================================================
// DELETE /api/skills/:name - Delete skill
// ============================================================================

pub async fn delete_skill(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    // Validate skill name to prevent path traversal
    validate_skill_name(&name)?;

    let skills_dir = state.indexer.skills_dir();
    let skill_dir = skills_dir.join(&name);

    // Validate the constructed path is within skills directory
    validate_skill_path(&skill_dir, skills_dir)?;

    if !skill_dir.exists() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("Skill '{}' not found", name))),
        ));
    }

    async_fs::remove_dir_all(&skill_dir).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(format!("Failed to delete skill: {}", e))),
        )
    })?;

    // Reload index
    let _ = state.indexer.reload();

    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// POST /api/reload - Reload index
// ============================================================================

#[derive(Debug, Serialize)]
pub struct ReloadResponse {
    pub success: bool,
    pub skill_count: usize,
}

pub async fn reload_index(State(state): State<AppState>) -> impl IntoResponse {
    match state.indexer.reload() {
        Ok(()) => {
            let count = state.indexer.get_skill_index().len();
            Json(ReloadResponse {
                success: true,
                skill_count: count,
            })
        }
        Err(_) => Json(ReloadResponse {
            success: false,
            skill_count: 0,
        }),
    }
}

// ============================================================================
// GET /api/search - Search skills
// ============================================================================

/// Maximum allowed search query length
const MAX_SEARCH_QUERY_LENGTH: usize = 1000;

/// Maximum allowed search limit
const MAX_SEARCH_LIMIT: usize = 100;

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: String,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    10
}

pub async fn search_skills(
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<SearchQuery>,
) -> Result<Json<crate::models::SearchResults>, (StatusCode, Json<ErrorResponse>)> {
    use crate::models::SearchOptions;

    // Validate query length
    if query.q.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new("Search query cannot be empty".to_string())),
        ));
    }

    if query.q.len() > MAX_SEARCH_QUERY_LENGTH {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(format!(
                "Search query too long (max {} characters)",
                MAX_SEARCH_QUERY_LENGTH
            ))),
        ));
    }

    // Clamp limit to valid range
    let limit = query.limit.clamp(1, MAX_SEARCH_LIMIT);

    let options = SearchOptions::with_limit(limit);
    let results = state.search.search_skills(&query.q, options);

    Ok(Json(results))
}
