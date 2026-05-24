/**
 * Server factory
 *
 * Builds the Skills MCP server and its service context independently of any
 * transport. Keeping this separate from index.ts lets tests construct a fully
 * wired server without starting the stdio transport or the file watcher.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { SkillIndexer, SearchService, StatsTracker } from './services/index.js';
import { registerAllTools } from './tools/index.js';
import type { ServiceContext } from './types.js';

/** Server name advertised over the MCP protocol */
export const SERVER_NAME = 'skills-mcp-server';

/** Server version advertised over the MCP protocol */
export const SERVER_VERSION = '1.0.0';

/**
 * Construct the service context (indexer, search, stats) for a skills directory.
 *
 * Indexes are lazily built on first access; callers that want them warm should
 * await `ctx.indexer.reload()` before serving requests.
 */
export function createServiceContext(skillsDir: string): ServiceContext {
  const indexer = new SkillIndexer(skillsDir);
  const search = new SearchService(indexer);
  const stats = new StatsTracker();

  return { indexer, search, stats, skillsDir };
}

/**
 * Build an MCP server with all tools registered against the given context.
 */
export function buildServer(ctx: ServiceContext): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });

  registerAllTools(server, ctx);

  return server;
}
