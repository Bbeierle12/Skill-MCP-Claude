//! MCP tool definitions and handlers.
//!
//! Each function here corresponds to an MCP tool that will be registered
//! with the MCP server.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::index::SkillIndexer;
use crate::models::*;
use crate::search::SearchService;
use crate::validation::validate_skills;

/// Service context shared across all tool handlers.
pub struct ServiceContext {
    /// The skill indexer for loading skill metadata and content.
    pub indexer: Arc<SkillIndexer>,
    /// The search service for querying skills.
    pub search: SearchService,
    /// Usage statistics tracker.
    pub stats: Arc<parking_lot::RwLock<UsageStats>>,
}

impl ServiceContext {
    /// Create a new service context.
    pub fn new(indexer: Arc<SkillIndexer>) -> Self {
        let search = SearchService::new(Arc::clone(&indexer));
        let stats = Arc::new(parking_lot::RwLock::new(UsageStats::new()));

        Self {
            indexer,
            search,
            stats,
        }
    }

    /// Record a tool call for statistics.
    pub fn track_tool_call(&self, tool_name: &str) {
        self.stats.write().record_tool_call(tool_name);
    }

    /// Record a skill load for statistics.
    pub fn track_skill_load(&self, skill_name: &str) {
        self.stats.write().record_skill_load(skill_name);
    }
}

// ============================================================================
// Tool: list_skills
// ============================================================================

/// Response for list_skills tool.
#[derive(Debug, Serialize)]
pub struct ListSkillsResponse {
    /// List of skill summaries.
    pub skills: Vec<SkillSummary>,
    /// Total number of skills.
    pub total: usize,
}

/// Summary info for a skill.
#[derive(Debug, Serialize)]
pub struct SkillSummary {
    /// Skill name/identifier.
    pub name: String,
    /// Short description of the skill.
    pub description: String,
    /// Tags for categorization.
    pub tags: Vec<String>,
    /// Names of sub-skills within this skill.
    pub sub_skills: Vec<String>,
}

/// List all available skill domains.
pub fn list_skills(ctx: &ServiceContext) -> ListSkillsResponse {
    ctx.track_tool_call("list_skills");

    let index = ctx.indexer.get_skill_index();

    let skills: Vec<SkillSummary> = index
        .skills
        .iter()
        .map(|s| SkillSummary {
            name: s.name.clone(),
            description: s.description.clone(),
            tags: s.tags.clone(),
            sub_skills: s.sub_skill_names().iter().map(|n| n.to_string()).collect(),
        })
        .collect();

    let total = skills.len();

    ListSkillsResponse { skills, total }
}

// ============================================================================
// Tool: get_skill
// ============================================================================

/// Request for get_skill tool.
#[derive(Debug, Deserialize)]
pub struct GetSkillRequest {
    /// Name of the skill to retrieve.
    pub name: String,
}

/// Get the main SKILL.md content for a skill.
pub fn get_skill(ctx: &ServiceContext, req: GetSkillRequest) -> Result<SkillContent, ErrorResponse> {
    ctx.track_tool_call("get_skill");
    ctx.track_skill_load(&req.name);

    ctx.indexer
        .read_skill_content(&req.name)
        .map_err(|e| ErrorResponse::new(e.to_string()))
}

// ============================================================================
// Tool: get_sub_skill
// ============================================================================

/// Request for get_sub_skill tool.
#[derive(Debug, Deserialize)]
pub struct GetSubSkillRequest {
    /// Parent skill domain name.
    pub domain: String,
    /// Name of the sub-skill to retrieve.
    pub sub_skill: String,
}

/// Get sub-skill content.
pub fn get_sub_skill(
    ctx: &ServiceContext,
    req: GetSubSkillRequest,
) -> Result<SubSkillContent, ErrorResponse> {
    ctx.track_tool_call("get_sub_skill");
    ctx.track_skill_load(&format!("{}:{}", req.domain, req.sub_skill));

    ctx.indexer
        .read_sub_skill_content(&req.domain, &req.sub_skill)
        .map_err(|e| ErrorResponse::new(e.to_string()))
}

// ============================================================================
// Tool: get_skills_batch
// ============================================================================

/// Request for get_skills_batch tool.
#[derive(Debug, Deserialize)]
pub struct GetSkillsBatchRequest {
    /// List of skill/sub-skill requests to process.
    pub requests: Vec<BatchRequest>,
}

/// Response for get_skills_batch tool.
#[derive(Debug, Serialize)]
pub struct GetSkillsBatchResponse {
    /// Results for each requested skill.
    pub results: Vec<BatchResponseItem>,
}

/// Load multiple skills in a single request.
pub fn get_skills_batch(ctx: &ServiceContext, req: GetSkillsBatchRequest) -> GetSkillsBatchResponse {
    ctx.track_tool_call("get_skills_batch");

    let results: Vec<BatchResponseItem> = req
        .requests
        .into_iter()
        .map(|r| {
            if let Some(sub_skill) = r.sub_skill {
                ctx.track_skill_load(&format!("{}:{}", r.domain, sub_skill));

                match ctx.indexer.read_sub_skill_content(&r.domain, &sub_skill) {
                    Ok(content) => BatchResponseItem::SubSkill(content),
                    Err(e) => BatchResponseItem::error(r.domain, e.to_string()),
                }
            } else {
                ctx.track_skill_load(&r.domain);

                match ctx.indexer.read_skill_content(&r.domain) {
                    Ok(content) => BatchResponseItem::Skill(content),
                    Err(e) => BatchResponseItem::error(r.domain, e.to_string()),
                }
            }
        })
        .collect();

    GetSkillsBatchResponse { results }
}

// ============================================================================
// Tool: search_skills
// ============================================================================

/// Request for search_skills tool.
#[derive(Debug, Deserialize)]
pub struct SearchSkillsRequest {
    /// Search query string.
    pub query: String,
    /// Maximum number of results to return.
    #[serde(default)]
    pub limit: Option<usize>,
}

/// Search skills by metadata.
pub fn search_skills(ctx: &ServiceContext, req: SearchSkillsRequest) -> SearchResults {
    ctx.track_tool_call("search_skills");

    let options = SearchOptions {
        limit: req.limit.or(Some(10)),
        ..Default::default()
    };

    let results = ctx.search.search_skills(&req.query, options);

    ctx.stats
        .write()
        .record_search(req.query, results.total_matches);

    results
}

// ============================================================================
// Tool: search_content
// ============================================================================

/// Request for search_content tool.
#[derive(Debug, Deserialize)]
pub struct SearchContentRequest {
    /// Search query string for full-text search.
    pub query: String,
    /// Maximum number of results to return.
    #[serde(default)]
    pub limit: Option<usize>,
}

/// Search content by full-text matching.
pub fn search_content(ctx: &ServiceContext, req: SearchContentRequest) -> SearchResults {
    ctx.track_tool_call("search_content");

    let options = SearchOptions {
        limit: req.limit.or(Some(10)),
        ..Default::default()
    };

    let results = ctx.search.search_content(&req.query, options);

    ctx.stats
        .write()
        .record_search(req.query, results.total_matches);

    results
}

// ============================================================================
// Tool: reload_index
// ============================================================================

/// Response for reload_index tool.
#[derive(Debug, Serialize)]
pub struct ReloadIndexResponse {
    /// Whether the reload succeeded.
    pub success: bool,
    /// Number of skills in the index after reload.
    pub skill_count: usize,
    /// Number of content entries in the index after reload.
    pub content_entries: usize,
    /// Error message if reload failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Reload the skill index from disk.
pub fn reload_index(ctx: &ServiceContext) -> ReloadIndexResponse {
    ctx.track_tool_call("reload_index");

    match ctx.indexer.reload() {
        Ok(()) => {
            let skill_index = ctx.indexer.get_skill_index();
            let content_index = ctx.indexer.get_content_index();

            ReloadIndexResponse {
                success: true,
                skill_count: skill_index.len(),
                content_entries: content_index.len(),
                error: None,
            }
        }
        Err(e) => ReloadIndexResponse {
            success: false,
            skill_count: 0,
            content_entries: 0,
            error: Some(e.to_string()),
        },
    }
}

// ============================================================================
// Tool: get_stats
// ============================================================================

/// Get usage statistics.
pub fn get_stats(ctx: &ServiceContext) -> UsageStats {
    ctx.track_tool_call("get_stats");
    ctx.stats.read().clone()
}

// ============================================================================
// Tool: validate_skills
// ============================================================================

/// Validate all skills.
pub fn validate_skills_tool(ctx: &ServiceContext) -> ValidationResult {
    ctx.track_tool_call("validate_skills");
    validate_skills(Arc::clone(&ctx.indexer))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn create_test_context() -> (TempDir, ServiceContext) {
        let temp_dir = TempDir::new().unwrap();

        // Create a test skill
        let skill_dir = temp_dir.path().join("test-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("_meta.json"),
            r#"{"name": "test-skill", "description": "A test skill"}"#,
        )
        .unwrap();
        fs::write(skill_dir.join("SKILL.md"), "# Test Skill\n\nContent here.").unwrap();

        let indexer = Arc::new(SkillIndexer::new(temp_dir.path()));
        indexer.reload().unwrap();

        let ctx = ServiceContext::new(indexer);

        (temp_dir, ctx)
    }

    #[test]
    fn test_list_skills() {
        let (_temp, ctx) = create_test_context();

        let response = list_skills(&ctx);
        assert_eq!(response.total, 1);
        assert_eq!(response.skills[0].name, "test-skill");
    }

    #[test]
    fn test_get_skill() {
        let (_temp, ctx) = create_test_context();

        let req = GetSkillRequest {
            name: "test-skill".to_string(),
        };

        let response = get_skill(&ctx, req).unwrap();
        assert_eq!(response.name, "test-skill");
        assert!(response.content.contains("Test Skill"));
    }

    #[test]
    fn test_search_skills() {
        let (_temp, ctx) = create_test_context();

        let req = SearchSkillsRequest {
            query: "test".to_string(),
            limit: None,
        };

        let response = search_skills(&ctx, req);
        assert!(!response.is_empty());
    }

    #[test]
    fn test_stats_tracking() {
        let (_temp, ctx) = create_test_context();

        // Make some calls
        list_skills(&ctx);
        list_skills(&ctx);
        get_skill(
            &ctx,
            GetSkillRequest {
                name: "test-skill".to_string(),
            },
        )
        .unwrap();

        let stats = get_stats(&ctx);
        assert_eq!(*stats.tool_calls.get("list_skills").unwrap(), 2);
        assert_eq!(*stats.tool_calls.get("get_skill").unwrap(), 1);
        assert_eq!(*stats.skill_loads.get("test-skill").unwrap(), 1);
    }
}
