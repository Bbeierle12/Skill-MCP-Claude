//! API route handlers.
//!
//! These handlers correspond to the Flask routes in skills_manager_api.py.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::mcp::tools::ServiceContext;
use crate::models::{ErrorResponse, SkillMeta};

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

pub async fn create_skill(
    State(state): State<AppState>,
    Json(req): Json<CreateSkillRequest>,
) -> Result<(StatusCode, Json<SkillDetails>), (StatusCode, Json<ErrorResponse>)> {
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

    std::fs::create_dir_all(&skill_dir).map_err(|e| {
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

    std::fs::write(skill_dir.join("_meta.json"), meta_json).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(format!("Failed to write _meta.json: {}", e))),
        )
    })?;

    // Create SKILL.md
    std::fs::write(skill_dir.join("SKILL.md"), &req.content).map_err(|e| {
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

pub async fn update_skill(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(req): Json<UpdateSkillRequest>,
) -> Result<Json<SkillDetails>, (StatusCode, Json<ErrorResponse>)> {
    let skills_dir = state.indexer.skills_dir();
    let skill_dir = skills_dir.join(&name);

    if !skill_dir.exists() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("Skill '{}' not found", name))),
        ));
    }

    // Load existing meta
    let meta_path = skill_dir.join("_meta.json");
    let meta_content = std::fs::read_to_string(&meta_path).map_err(|e| {
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
    std::fs::write(&meta_path, meta_json).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(format!("Failed to write _meta.json: {}", e))),
        )
    })?;

    // Update content if provided
    let content = if let Some(new_content) = req.content {
        std::fs::write(skill_dir.join("SKILL.md"), &new_content).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::new(format!("Failed to write SKILL.md: {}", e))),
            )
        })?;
        new_content
    } else {
        std::fs::read_to_string(skill_dir.join("SKILL.md")).unwrap_or_default()
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
    let skills_dir = state.indexer.skills_dir();
    let skill_dir = skills_dir.join(&name);

    if !skill_dir.exists() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new(format!("Skill '{}' not found", name))),
        ));
    }

    std::fs::remove_dir_all(&skill_dir).map_err(|e| {
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
) -> impl IntoResponse {
    use crate::models::SearchOptions;

    let options = SearchOptions::with_limit(query.limit);
    let results = state.search.search_skills(&query.q, options);

    Json(results)
}
