//! Skills MCP Server - Rust Implementation
//!
//! This crate provides a Rust implementation of the Skills MCP server,
//! originally written in Python/TypeScript. It includes:
//!
//! - **Skill indexing**: Scan directories and build metadata/content indexes
//! - **Search**: Full-text and metadata-based skill discovery
//! - **Validation**: Schema validation for skill metadata
//! - **MCP Server**: Model Context Protocol server for Claude integration
//! - **HTTP API**: REST API for skill management
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                        Skills MCP                           │
//! ├─────────────────────────────────────────────────────────────┤
//! │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
//! │  │ MCP Server  │  │  API Server │  │    File Watcher     │  │
//! │  │  (stdio)    │  │   (HTTP)    │  │  (auto-reload)      │  │
//! │  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
//! │         │                │                    │             │
//! │         └────────────────┼────────────────────┘             │
//! │                          │                                  │
//! │                   ┌──────┴──────┐                           │
//! │                   │   Service   │                           │
//! │                   │   Context   │                           │
//! │                   └──────┬──────┘                           │
//! │                          │                                  │
//! │         ┌────────────────┼────────────────┐                 │
//! │         │                │                │                 │
//! │  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐         │
//! │  │   Indexer   │  │   Search    │  │   Stats     │         │
//! │  │             │  │   Service   │  │   Tracker   │         │
//! │  └──────┬──────┘  └─────────────┘  └─────────────┘         │
//! │         │                                                   │
//! │  ┌──────┴──────┐                                           │
//! │  │ Skill Index │                                           │
//! │  │Content Index│                                           │
//! │  └─────────────┘                                           │
//! │                                                             │
//! │                    ┌─────────────┐                          │
//! │                    │  Validation │                          │
//! │                    └─────────────┘                          │
//! └─────────────────────────────────────────────────────────────┘
//! ```
//!
//! # Quick Start
//!
//! ```rust,no_run
//! use std::sync::Arc;
//! use skills_mcp::index::SkillIndexer;
//! use skills_mcp::search::SearchService;
//! use skills_mcp::models::SearchOptions;
//!
//! // Create an indexer pointing to your skills directory
//! let indexer = Arc::new(SkillIndexer::new("./skills"));
//! indexer.reload().unwrap();
//!
//! // Create a search service
//! let search = SearchService::new(indexer);
//!
//! // Search for skills
//! let results = search.search_skills("forms", SearchOptions::with_limit(5));
//! for result in &results.results {
//!     println!("{}: {:.2}", result.domain, result.score);
//! }
//! ```
//!
//! # Running the Servers
//!
//! ## MCP Server (for Claude Desktop)
//!
//! ```rust,no_run
//! use skills_mcp::mcp::McpServer;
//!
//! #[tokio::main]
//! async fn main() {
//!     let server = McpServer::new("./skills");
//!     server.run().await.unwrap();
//! }
//! ```
//!
//! ## HTTP API Server
//!
//! ```rust,no_run
//! use skills_mcp::api::ApiServer;
//!
//! #[tokio::main]
//! async fn main() {
//!     let server = ApiServer::new("./skills");
//!     server.run().await.unwrap();
//! }
//! ```

#![warn(missing_docs)]
#![warn(clippy::all)]

pub mod api;
pub mod index;
pub mod mcp;
pub mod models;
pub mod search;
pub mod validation;

/// Re-export commonly used types.
pub mod prelude {
    pub use crate::api::ApiServer;
    pub use crate::index::SkillIndexer;
    pub use crate::mcp::McpServer;
    pub use crate::models::{
        MatchType, SearchOptions, SearchResult, SearchResults, SkillContent, SkillIndex,
        SkillMeta, SubSkillContent, SubSkillMeta, UsageStats, ValidationResult,
    };
    pub use crate::search::SearchService;
    pub use crate::validation::{validate_meta, validate_skills};
}

/// Crate version.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Crate name.
pub const NAME: &str = env!("CARGO_PKG_NAME");
