//! HTTP API Server binary entry point.
//!
//! Run with: cargo run --bin skills-api-server -- [OPTIONS]

use std::path::PathBuf;

use clap::Parser;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use skills_mcp::api::ApiServer;

/// Skills API Server
#[derive(Parser, Debug)]
#[command(name = "skills-api-server")]
#[command(about = "HTTP API server for skill management")]
#[command(version)]
struct Args {
    /// Path to the skills directory
    #[arg(short, long, env = "SKILLS_DIR")]
    skills_dir: Option<PathBuf>,

    /// Port to listen on
    #[arg(short, long, default_value = "5050", env = "PORT")]
    port: u16,

    /// Enable debug logging
    #[arg(short, long)]
    debug: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // Initialize tracing
    let filter = if args.debug {
        "skills_mcp=debug,tower_http=debug,info"
    } else {
        "skills_mcp=info,tower_http=info,warn"
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
    info!(
        "Starting Skills API Server v{} on port {}",
        skills_mcp::VERSION,
        args.port
    );

    let server = ApiServer::with_port(&skills_dir, args.port);

    // Set up graceful shutdown
    let shutdown = async {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl+C handler");
        info!("Shutdown signal received");
    };

    server.run_with_shutdown(shutdown).await?;

    Ok(())
}
