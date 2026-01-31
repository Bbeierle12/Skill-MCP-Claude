//! HTTP API Server implementation.
//!
//! Provides REST endpoints for skill management, matching the Flask API
//! in skills_manager_api.py.

mod routes;
mod server;

pub use server::ApiServer;
