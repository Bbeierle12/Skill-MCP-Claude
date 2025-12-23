/**
 * Search Tools
 * Tools for searching skills by metadata and content
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServiceContext } from '../types.js';
import {
  SearchInputSchema,
  SearchContentInputSchema,
  type SearchInput,
  type SearchContentInput
} from '../schemas/tools.js';
import { toolSuccess, toolSuccessJson } from '../utils/errors.js';
import { formatSearchResultsMarkdown } from '../utils/format.js';

/**
 * Register all search tools on the MCP server
 */
export function registerSearchTools(server: McpServer, ctx: ServiceContext): void {
  // skills_search
  server.registerTool(
    'skills_search',
    {
      title: 'Search Skills',
      description: `Search skills by keyword/phrase in metadata.

Searches across skill names, descriptions, tags, and trigger words.
For full-text content search, use skills_search_content instead.

Args:
  - query (string): Search term (2-200 chars)
  - limit (number): Max results to return (1-50, default: 10)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Matching skills/sub-skills ranked by relevance.

Examples:
  - "Find form-related skills" -> query: "form"
  - "Search for validation patterns" -> query: "validation"
  - "Find Zod skills" -> query: "zod"`,
      inputSchema: SearchInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: SearchInput) => {
      ctx.stats.trackToolCall('skills_search');

      const results = await ctx.search.searchSkills(params.query, params.limit);
      ctx.stats.trackSearch(params.query, results.length);

      if (params.response_format === 'json') {
        const output = {
          query: params.query,
          total: results.length,
          results
        };
        return toolSuccessJson(JSON.stringify(output, null, 2), output);
      }

      return toolSuccess(formatSearchResultsMarkdown(params.query, results));
    }
  );

  // skills_search_content
  server.registerTool(
    'skills_search_content',
    {
      title: 'Search Skill Content',
      description: `Full-text search across all skill content.

Searches the actual markdown content of SKILL.md files and reference documents.
Returns snippets showing where matches were found.

Args:
  - query (string): Search term (2-200 chars)
  - limit (number): Max results to return (1-50, default: 10)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Matching files ranked by relevance with context snippets.

Examples:
  - "Find useForm hook usage" -> query: "useForm"
  - "Search for delta compression" -> query: "delta compression"
  - "Find error handling patterns" -> query: "error handling"`,
      inputSchema: SearchContentInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: SearchContentInput) => {
      ctx.stats.trackToolCall('skills_search_content');

      const results = await ctx.search.searchContent(params.query, params.limit);
      ctx.stats.trackSearch(params.query, results.length);

      if (params.response_format === 'json') {
        const output = {
          query: params.query,
          total: results.length,
          results
        };
        return toolSuccessJson(JSON.stringify(output, null, 2), output);
      }

      return toolSuccess(formatSearchResultsMarkdown(params.query, results));
    }
  );
}
