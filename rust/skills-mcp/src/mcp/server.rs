//! MCP Server implementation.
//!
//! This is a placeholder that will be fully implemented once the
//! Rust MCP SDK is available and integrated.

use std::sync::Arc;

use tracing::info;

use crate::index::SkillIndexer;
use super::tools::ServiceContext;

/// MCP Server for the Skills service.
///
/// Handles MCP protocol communication and routes tool calls to handlers.
pub struct McpServer {
    ctx: ServiceContext,
}

impl McpServer {
    /// Create a new MCP server.
    pub fn new(skills_dir: impl AsRef<std::path::Path>) -> Self {
        let indexer = Arc::new(SkillIndexer::new(skills_dir));

        // Initial index load
        if let Err(e) = indexer.reload() {
            tracing::error!("Failed to load initial index: {}", e);
        }

        let ctx = ServiceContext::new(indexer);

        Self { ctx }
    }

    /// Get the service context.
    pub fn context(&self) -> &ServiceContext {
        &self.ctx
    }

    /// Start the MCP server.
    ///
    /// This will be implemented to handle stdio transport and MCP protocol
    /// once the Rust MCP SDK is integrated.
    pub async fn run(&self) -> Result<(), McpError> {
        info!("Starting MCP server...");

        // TODO: Implement MCP protocol handling
        // 1. Set up stdio transport
        // 2. Register tools with MCP runtime
        // 3. Handle incoming requests
        // 4. Route to appropriate tool handlers

        // Placeholder - will be replaced with actual MCP runtime
        info!("MCP server running (placeholder implementation)");

        // Keep running until shutdown signal
        tokio::signal::ctrl_c()
            .await
            .map_err(|e| McpError::Runtime(e.to_string()))?;

        info!("Shutting down MCP server...");
        Ok(())
    }

    /// Reload the skill index.
    pub fn reload(&self) -> Result<(), crate::index::IndexError> {
        self.ctx.indexer.reload()
    }
}

/// MCP server errors.
#[derive(Debug, thiserror::Error)]
pub enum McpError {
    #[error("Failed to initialize: {0}")]
    Init(String),

    #[error("Runtime error: {0}")]
    Runtime(String),

    #[error("Protocol error: {0}")]
    Protocol(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_server_creation() {
        let temp_dir = TempDir::new().unwrap();

        // Create a test skill
        let skill_dir = temp_dir.path().join("test-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("_meta.json"),
            r#"{"name": "test-skill", "description": "Test"}"#,
        )
        .unwrap();
        fs::write(skill_dir.join("SKILL.md"), "# Test").unwrap();

        let server = McpServer::new(temp_dir.path());
        let ctx = server.context();

        // Verify the index was loaded
        let index = ctx.indexer.get_skill_index();
        assert_eq!(index.len(), 1);
    }
}
