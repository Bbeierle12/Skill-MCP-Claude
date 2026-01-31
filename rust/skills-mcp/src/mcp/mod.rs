//! MCP Server implementation.
//!
//! This module will contain the MCP protocol handlers and tool registration
//! once the Rust MCP SDK is integrated.
//!
//! Tools to implement:
//! - list_skills: Enumerate available skill domains
//! - get_skill: Load main SKILL.md content
//! - get_sub_skill: Retrieve specific sub-skill content
//! - get_skills_batch: Fetch multiple skills in one call
//! - search_skills: Query by metadata (names, tags, triggers)
//! - search_content: Full-text markdown search with snippets
//! - reload_index: Refresh skill index from disk
//! - get_stats: Return usage statistics
//! - validate_skills: Check skill structure and metadata

pub mod tools;
mod server;

pub use server::McpServer;
pub use tools::*;
