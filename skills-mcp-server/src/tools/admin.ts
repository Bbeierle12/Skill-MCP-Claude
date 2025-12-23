/**
 * Admin Tools
 * Tools for managing the skills server (reload, stats, validate)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServiceContext } from '../types.js';
import { Validator } from '../services/validator.js';
import {
  ReloadInputSchema,
  StatsInputSchema,
  ValidateInputSchema,
  type ReloadInput,
  type StatsInput,
  type ValidateInput
} from '../schemas/tools.js';
import { toolSuccess, toolSuccessJson } from '../utils/errors.js';
import { formatStatsMarkdown, formatValidationMarkdown } from '../utils/format.js';

/**
 * Register all admin tools on the MCP server
 */
export function registerAdminTools(server: McpServer, ctx: ServiceContext): void {
  // skills_reload
  server.registerTool(
    'skills_reload',
    {
      title: 'Reload Skill Index',
      description: `Reload the skill index from disk.

Use this after adding, modifying, or deleting skill files.
The file watcher also auto-reloads, but this forces an immediate refresh.

Args:
  None

Returns:
  Confirmation with count of skills and files indexed.

Examples:
  - After adding a new skill manually
  - After modifying _meta.json files
  - To verify changes were detected`,
      inputSchema: ReloadInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (_params: ReloadInput) => {
      ctx.stats.trackToolCall('skills_reload');

      const result = await ctx.indexer.reload();

      const output = {
        status: 'reloaded',
        skillCount: result.skillCount,
        contentFilesIndexed: result.contentFilesIndexed,
        timestamp: new Date().toISOString()
      };

      return toolSuccessJson(
        `Index reloaded successfully.\n` +
        `- Skills: ${result.skillCount}\n` +
        `- Content files indexed: ${result.contentFilesIndexed}`,
        output
      );
    }
  );

  // skills_stats
  server.registerTool(
    'skills_stats',
    {
      title: 'Get Server Statistics',
      description: `Get usage statistics for the skills server.

Shows which tools are most used, which skills are most loaded,
recent searches, and uptime information.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Usage statistics including tool calls, skill loads, and searches.

Examples:
  - "Show server stats" -> no params
  - "Get usage metrics in JSON" -> response_format: "json"`,
      inputSchema: StatsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: StatsInput) => {
      ctx.stats.trackToolCall('skills_stats');

      const stats = ctx.stats.getStats();
      const index = await ctx.indexer.getSkillIndex();
      const contentIndex = await ctx.indexer.getContentIndex();

      if (params.response_format === 'json') {
        const output = {
          ...stats,
          skillCount: index.skills.length,
          contentFilesIndexed: Object.keys(contentIndex).length,
          validationErrors: index.validationErrors.length
        };
        return toolSuccessJson(JSON.stringify(output, null, 2), output);
      }

      return toolSuccess(formatStatsMarkdown(
        stats,
        index.skills.length,
        Object.keys(contentIndex).length
      ));
    }
  );

  // skills_validate
  server.registerTool(
    'skills_validate',
    {
      title: 'Validate Skills',
      description: `Validate skill metadata and file structure.

Checks for missing files, invalid JSON, schema violations,
and other structural issues.

Args:
  - skill_name (string, optional): Specific skill to validate (omit for all)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Validation results with errors and warnings.

Examples:
  - "Validate all skills" -> no params
  - "Check the forms skill" -> skill_name: "forms"`,
      inputSchema: ValidateInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: ValidateInput) => {
      ctx.stats.trackToolCall('skills_validate');

      const validator = new Validator(ctx.skillsDir);
      const result = await validator.validate(params.skill_name);

      if (params.response_format === 'json') {
        return toolSuccessJson(JSON.stringify(result, null, 2), result);
      }

      return toolSuccess(formatValidationMarkdown(result));
    }
  );
}
