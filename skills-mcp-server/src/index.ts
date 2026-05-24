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

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { getSkillsDir } from './constants.js';
import { FileWatcher } from './services/index.js';
import { createServiceContext, buildServer } from './server.js';

async function main(): Promise<void> {
  const skillsDir = getSkillsDir();

  console.error('[Skills MCP Server] Starting...');
  console.error(`[Skills MCP Server] Skills directory: ${skillsDir}`);

  // Initialize services
  const ctx = createServiceContext(skillsDir);

  // Pre-load indexes
  const { skillCount, contentFilesIndexed } = await ctx.indexer.reload();
  console.error(`[Skills MCP Server] Indexed ${skillCount} skills, ${contentFilesIndexed} content files`);

  // Create MCP server with all tools registered
  const server = buildServer(ctx);

  // Start file watcher
  const watcher = new FileWatcher(skillsDir, async () => {
    await ctx.indexer.reload();
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
