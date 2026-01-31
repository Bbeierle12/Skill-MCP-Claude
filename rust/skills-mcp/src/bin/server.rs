//! MCP Server binary entry point.
//!
//! Run with: cargo run --bin skills-mcp-server -- [OPTIONS]

use std::path::PathBuf;

use clap::Parser;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use skills_mcp::mcp::McpServer;

/// Skills MCP Server
#[derive(Parser, Debug)]
#[command(name = "skills-mcp-server")]
#[command(about = "MCP server for skill management and discovery")]
#[command(version)]
struct Args {
    /// Path to the skills directory
    #[arg(short, long, env = "SKILLS_DIR")]
    skills_dir: Option<PathBuf>,

    /// Enable debug logging
    #[arg(short, long)]
    debug: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // Initialize tracing
    let filter = if args.debug {
        "skills_mcp=debug,info"
    } else {
        "skills_mcp=info,warn"
    };

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| filter.into()))
        .with(tracing_subscriber::fmt::layer().with_target(false))
        .init();

    // Determine skills directory
    let skills_dir = args.skills_dir.unwrap_or_else(|| {
        // Try common locations
        let candidates = [
            PathBuf::from("./skills"),
            PathBuf::from("../skills"),
            dirs::home_dir()
                .map(|h| h.join(".skills"))
                .unwrap_or_default(),
        ];

        candidates
            .into_iter()
            .find(|p| p.exists())
            .unwrap_or_else(|| PathBuf::from("./skills"))
    });

    info!("Skills directory: {:?}", skills_dir);
    info!("Starting Skills MCP Server v{}", skills_mcp::VERSION);

    let server = McpServer::new(&skills_dir);
    server.run().await?;

    Ok(())
}
