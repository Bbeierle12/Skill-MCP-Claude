/**
 * Tool Registration
 * Registers all MCP tools on the server
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServiceContext } from '../types.js';
import { registerReadTools } from './read.js';
import { registerSearchTools } from './search.js';
import { registerAdminTools } from './admin.js';
import { registerCrudTools } from './crud.js';

/**
 * Register all tools on the MCP server
 */
export function registerAllTools(server: McpServer, ctx: ServiceContext): void {
  // Read tools: skills_list, skills_get, skills_get_sub, skills_get_batch
  registerReadTools(server, ctx);

  // Search tools: skills_search, skills_search_content
  registerSearchTools(server, ctx);

  // Admin tools: skills_reload, skills_stats, skills_validate
  registerAdminTools(server, ctx);

  // CRUD tools: skills_create, skills_update, skills_delete, skills_export
  registerCrudTools(server, ctx);

  console.error('[Tools] Registered 13 tools');
}

export { registerReadTools } from './read.js';
export { registerSearchTools } from './search.js';
export { registerAdminTools } from './admin.js';
export { registerCrudTools } from './crud.js';
