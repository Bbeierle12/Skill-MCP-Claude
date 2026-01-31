//! HTTP API server implementation using Axum.
//!
//! # Rate Limiting
//!
//! Rate limiting is recommended to be implemented at the infrastructure level
//! (reverse proxy, load balancer, or API gateway) for production deployments.
//! This provides better scalability and centralized configuration.
//!
//! For development or single-instance deployments, the Python API server
//! includes built-in rate limiting (100 req/s per IP with burst of 200).

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    routing::{delete, get, post, put},
    Router,
};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::info;

use crate::index::SkillIndexer;
use crate::mcp::tools::ServiceContext;

use super::routes::{self, AppState};

/// HTTP API Server.
pub struct ApiServer {
    state: AppState,
    port: u16,
}

impl ApiServer {
    /// Default port for the API server.
    pub const DEFAULT_PORT: u16 = 5050;

    /// Create a new API server.
    pub fn new(skills_dir: impl AsRef<std::path::Path>) -> Self {
        Self::with_port(skills_dir, Self::DEFAULT_PORT)
    }

    /// Create a new API server with a specific port.
    pub fn with_port(skills_dir: impl AsRef<std::path::Path>, port: u16) -> Self {
        let indexer = Arc::new(SkillIndexer::new(skills_dir));

        // Initial index load
        if let Err(e) = indexer.reload() {
            tracing::error!("Failed to load initial index: {}", e);
        }

        let ctx = ServiceContext::new(indexer);
        let state = Arc::new(ctx);

        Self { state, port }
    }

    /// Get the application state.
    pub fn state(&self) -> &AppState {
        &self.state
    }

    /// Build the router with all routes.
    pub fn router(&self) -> Router {
        // CORS configuration
        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any);

        // API routes
        let api_routes = Router::new()
            .route("/skills", get(routes::list_skills))
            .route("/skills", post(routes::create_skill))
            .route("/skills/:name", get(routes::get_skill))
            .route("/skills/:name", put(routes::update_skill))
            .route("/skills/:name", delete(routes::delete_skill))
            .route("/reload", post(routes::reload_index))
            .route("/search", get(routes::search_skills));

        Router::new()
            .nest("/api", api_routes)
            .layer(cors)
            .layer(TraceLayer::new_for_http())
            .with_state(Arc::clone(&self.state))
    }

    /// Start the server.
    pub async fn run(&self) -> Result<(), ApiError> {
        let app = self.router();
        let addr = SocketAddr::from(([0, 0, 0, 0], self.port));

        info!("Starting API server on http://{}", addr);

        let listener = tokio::net::TcpListener::bind(addr)
            .await
            .map_err(|e| ApiError::Bind(e.to_string()))?;

        axum::serve(listener, app)
            .await
            .map_err(|e| ApiError::Serve(e.to_string()))?;

        Ok(())
    }

    /// Start the server with graceful shutdown.
    pub async fn run_with_shutdown(&self, shutdown: impl std::future::Future<Output = ()> + Send + 'static) -> Result<(), ApiError> {
        let app = self.router();
        let addr = SocketAddr::from(([0, 0, 0, 0], self.port));

        info!("Starting API server on http://{}", addr);

        let listener = tokio::net::TcpListener::bind(addr)
            .await
            .map_err(|e| ApiError::Bind(e.to_string()))?;

        // Run server with graceful shutdown using tokio::select
        tokio::select! {
            result = axum::serve(listener, app) => {
                result.map_err(|e| ApiError::Serve(e.to_string()))?;
            }
            _ = shutdown => {
                info!("Shutdown signal received");
            }
        }

        info!("API server shut down");
        Ok(())
    }
}

/// API server errors.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("Failed to bind to address: {0}")]
    Bind(String),

    #[error("Server error: {0}")]
    Serve(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use std::fs;
    use tempfile::TempDir;
    use tower::ServiceExt;

    async fn create_test_server() -> (TempDir, Router) {
        let temp_dir = TempDir::new().unwrap();

        // Create a test skill
        let skill_dir = temp_dir.path().join("test-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("_meta.json"),
            r#"{"name": "test-skill", "description": "A test skill", "tags": ["test"]}"#,
        )
        .unwrap();
        fs::write(skill_dir.join("SKILL.md"), "# Test Skill\n\nContent.").unwrap();

        let server = ApiServer::new(temp_dir.path());
        let router = server.router();

        (temp_dir, router)
    }

    #[tokio::test]
    async fn test_list_skills() {
        let (_temp, app) = create_test_server().await;

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/skills")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_get_skill() {
        let (_temp, app) = create_test_server().await;

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/skills/test-skill")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_get_nonexistent_skill() {
        let (_temp, app) = create_test_server().await;

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/skills/nonexistent")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
