/**
 * Read Tools
 * Tools for listing and retrieving skill content
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServiceContext, SkillContent, SubSkillContent, SubSkillMeta } from '../types.js';
import {
  ListSkillsInputSchema,
  GetSkillInputSchema,
  GetSubSkillInputSchema,
  GetBatchInputSchema,
  type ListSkillsInput,
  type GetSkillInput,
  type GetSubSkillInput,
  type GetBatchInput
} from '../schemas/tools.js';
import { toolError, toolSuccess, toolSuccessJson } from '../utils/errors.js';
import {
  formatSkillListMarkdown,
  formatSkillContentMarkdown,
  formatSubSkillContentMarkdown,
  truncateIfNeeded
} from '../utils/format.js';

/**
 * Register all read tools on the MCP server
 */
export function registerReadTools(server: McpServer, ctx: ServiceContext): void {
  // skills_list
  server.registerTool(
    'skills_list',
    {
      title: 'List All Skills',
      description: `List all available skill domains with descriptions and sub-skills.

Use this tool to discover what skills are available before loading specific content.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format:
  {
    "total": number,
    "skills": [
      {
        "name": string,
        "description": string,
        "tags": string[],
        "sub_skills": string[]
      }
    ]
  }

Examples:
  - "What skills are available?" -> no params needed
  - "List all skills in JSON" -> response_format: "json"`,
      inputSchema: ListSkillsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: ListSkillsInput) => {
      ctx.stats.trackToolCall('skills_list');

      const index = await ctx.indexer.getSkillIndex();
      const skills = index.skills;

      if (params.response_format === 'json') {
        const output = {
          total: skills.length,
          skills: skills.map(s => ({
            name: s.name,
            description: s.description,
            tags: s.tags || [],
            sub_skills: (s.sub_skills || []).map(sub => sub.name)
          }))
        };
        return toolSuccessJson(JSON.stringify(output, null, 2), output);
      }

      return toolSuccess(formatSkillListMarkdown(skills));
    }
  );

  // skills_get
  server.registerTool(
    'skills_get',
    {
      title: 'Get Skill Content',
      description: `Load a skill's main SKILL.md content.

For skills with sub-skills, this returns the overview/router content.
Use skills_get_sub to load specific sub-skill content.

Args:
  - name (string): Skill domain name (e.g., 'forms', 'mcp-builder')
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  The skill's SKILL.md content, plus metadata about available sub-skills.

Examples:
  - "Load the forms skill" -> name: "forms"
  - "Get mcp-builder documentation" -> name: "mcp-builder"`,
      inputSchema: GetSkillInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: GetSkillInput) => {
      ctx.stats.trackToolCall('skills_get');
      ctx.stats.trackSkillLoad(params.name);

      // Check if skill exists
      const meta = await ctx.indexer.getSkillMeta(params.name);
      if (!meta) {
        return toolError(`Skill '${params.name}' not found. Use skills_list to see available skills.`);
      }

      // Read content
      const content = await ctx.indexer.readSkillContent(params.name);
      if (!content) {
        return toolError(`Could not read SKILL.md for '${params.name}'.`);
      }

      const hasRefs = await ctx.indexer.hasReferences(params.name);

      const skillContent: SkillContent = {
        name: params.name,
        content,
        subSkills: (meta.sub_skills || []).map((s: SubSkillMeta) => s.name),
        hasReferences: hasRefs
      };

      if (params.response_format === 'json') {
        return toolSuccessJson(JSON.stringify(skillContent, null, 2), skillContent);
      }

      return toolSuccess(formatSkillContentMarkdown(skillContent));
    }
  );

  // skills_get_sub
  server.registerTool(
    'skills_get_sub',
    {
      title: 'Get Sub-Skill Content',
      description: `Load a specific sub-skill's content from a domain.

Args:
  - domain (string): Parent skill domain (e.g., 'forms', 'building')
  - sub_skill (string): Sub-skill name (e.g., 'validation', 'react')
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  The sub-skill's markdown content.

Examples:
  - "Get React form patterns" -> domain: "forms", sub_skill: "react"
  - "Load multiplayer building docs" -> domain: "building", sub_skill: "multiplayer"`,
      inputSchema: GetSubSkillInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: GetSubSkillInput) => {
      ctx.stats.trackToolCall('skills_get_sub');
      ctx.stats.trackSkillLoad(`${params.domain}/${params.sub_skill}`);

      // Check if domain exists
      const meta = await ctx.indexer.getSkillMeta(params.domain);
      if (!meta) {
        return toolError(`Domain '${params.domain}' not found. Use skills_list to see available skills.`);
      }

      // Check if sub-skill exists
      const subMeta = meta.sub_skills?.find((s: SubSkillMeta) => s.name === params.sub_skill);
      if (!subMeta) {
        const available = (meta.sub_skills || []).map((s: SubSkillMeta) => s.name).join(', ');
        return toolError(
          `Sub-skill '${params.sub_skill}' not found in '${params.domain}'. ` +
          `Available sub-skills: ${available || 'none'}`
        );
      }

      // Read content
      const content = await ctx.indexer.readSubSkillContent(params.domain, params.sub_skill);
      if (!content) {
        return toolError(`Could not read file '${subMeta.file}' for sub-skill '${params.sub_skill}'.`);
      }

      const subSkillContent: SubSkillContent = {
        domain: params.domain,
        subSkill: params.sub_skill,
        content
      };

      if (params.response_format === 'json') {
        return toolSuccessJson(JSON.stringify(subSkillContent, null, 2), subSkillContent);
      }

      return toolSuccess(formatSubSkillContentMarkdown(subSkillContent));
    }
  );

  // skills_get_batch
  server.registerTool(
    'skills_get_batch',
    {
      title: 'Batch Get Skills',
      description: `Load multiple skills or sub-skills in a single request.

More efficient than multiple individual calls when loading several skills.

Args:
  - requests (array): Array of {domain, sub_skill?} objects (max 20)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Array of results, one per request.

Examples:
  - Load forms and its react sub-skill:
    requests: [
      {"domain": "forms", "sub_skill": null},
      {"domain": "forms", "sub_skill": "react"}
    ]`,
      inputSchema: GetBatchInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: GetBatchInput) => {
      ctx.stats.trackToolCall('skills_get_batch');

      const results: Array<SkillContent | SubSkillContent | { error: string }> = [];

      for (const req of params.requests) {
        if (req.sub_skill) {
          // Get sub-skill
          ctx.stats.trackSkillLoad(`${req.domain}/${req.sub_skill}`);

          const meta = await ctx.indexer.getSkillMeta(req.domain);
          if (!meta) {
            results.push({ error: `Domain '${req.domain}' not found` });
            continue;
          }

          const content = await ctx.indexer.readSubSkillContent(req.domain, req.sub_skill);
          if (!content) {
            results.push({ error: `Sub-skill '${req.sub_skill}' not found in '${req.domain}'` });
            continue;
          }

          results.push({
            domain: req.domain,
            subSkill: req.sub_skill,
            content
          });
        } else {
          // Get main skill
          ctx.stats.trackSkillLoad(req.domain);

          const meta = await ctx.indexer.getSkillMeta(req.domain);
          if (!meta) {
            results.push({ error: `Skill '${req.domain}' not found` });
            continue;
          }

          const content = await ctx.indexer.readSkillContent(req.domain);
          if (!content) {
            results.push({ error: `Could not read SKILL.md for '${req.domain}'` });
            continue;
          }

          const hasRefs = await ctx.indexer.hasReferences(req.domain);
          results.push({
            name: req.domain,
            content,
            subSkills: (meta.sub_skills || []).map((s: SubSkillMeta) => s.name),
            hasReferences: hasRefs
          });
        }
      }

      if (params.response_format === 'json') {
        const output = { results };
        return toolSuccessJson(JSON.stringify(output, null, 2), output);
      }

      // Format as markdown
      const lines: string[] = [`# Batch Results (${results.length})`];
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        lines.push('');
        lines.push(`## Request ${i + 1}`);

        if ('error' in result) {
          lines.push(`**Error**: ${result.error}`);
        } else if ('subSkill' in result) {
          lines.push(`**${result.domain} > ${result.subSkill}**`);
          lines.push('');
          lines.push(result.content);
        } else {
          lines.push(`**${result.name}**`);
          if (result.subSkills.length > 0) {
            lines.push(`*Sub-skills: ${result.subSkills.join(', ')}*`);
          }
          lines.push('');
          lines.push(result.content);
        }
      }

      return toolSuccess(truncateIfNeeded(lines.join('\n')));
    }
  );
}
