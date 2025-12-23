#!/usr/bin/env node
/**
 * Skills MCP Server
 *
 * MCP server for skill discovery and retrieval.
 * Provides tools for listing, searching, and loading skills.
 *
 * Usage:
 *   node dist/index.js
 *
 * Environment variables:
 *   SKILLS_DIR - Path to skills directory (default: ../skills)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { getSkillsDir } from './constants.js';
import { SkillIndexer, SearchService, FileWatcher, StatsTracker } from './services/index.js';
import { registerAllTools } from './tools/index.js';
import type { ServiceContext } from './types.js';

async function main(): Promise<void> {
  const skillsDir = getSkillsDir();

  console.error('[Skills MCP Server] Starting...');
  console.error(`[Skills MCP Server] Skills directory: ${skillsDir}`);

  // Initialize services
  const indexer = new SkillIndexer(skillsDir);
  const search = new SearchService(indexer);
  const stats = new StatsTracker();

  // Pre-load indexes
  const { skillCount, contentFilesIndexed } = await indexer.reload();
  console.error(`[Skills MCP Server] Indexed ${skillCount} skills, ${contentFilesIndexed} content files`);

  // Create service context
  const ctx: ServiceContext = {
    indexer,
    search,
    stats,
    skillsDir
  };

  // Create MCP server
  const server = new McpServer({
    name: 'skills-mcp-server',
    version: '1.0.0'
  });

  // Register all tools
  registerAllTools(server, ctx);

  // Start file watcher
  const watcher = new FileWatcher(skillsDir, async () => {
    await indexer.reload();
  });
  watcher.start();

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[Skills MCP Server] Ready and listening via stdio');

  // Graceful shutdown
  const shutdown = (): void => {
    console.error('[Skills MCP Server] Shutting down...');
    watcher.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[Skills MCP Server] Fatal error:', error);
  process.exit(1);
});
