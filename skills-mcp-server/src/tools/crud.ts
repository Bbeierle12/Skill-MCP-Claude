/**
 * CRUD Tools
 * Tools for creating, updating, deleting, and exporting skills
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'fs/promises';
import path from 'path';
import archiver from 'archiver';
import { Writable } from 'stream';
import type { ServiceContext } from '../types.js';
import {
  CreateSkillInputSchema,
  UpdateSkillInputSchema,
  DeleteSkillInputSchema,
  ExportSkillInputSchema,
  type CreateSkillInput,
  type UpdateSkillInput,
  type DeleteSkillInput,
  type ExportSkillInput
} from '../schemas/tools.js';
import { toolError, toolSuccessJson, handleFsError } from '../utils/errors.js';
import { SKILL_FILE, META_FILE } from '../constants.js';

/**
 * Generate SKILL.md content from template
 */
function generateSkillContent(name: string, description: string, template: string): string {
  const title = name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  const lines: string[] = [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    `# ${title}`,
    '',
    '## Overview',
    '',
    description,
    '',
    '## When to Use',
    '',
    '- [Add trigger conditions here]',
    ''
  ];

  if (template !== 'minimal') {
    lines.push(
      '## Quick Start',
      '',
      '```',
      '// Add example code here',
      '```',
      '',
      '## Best Practices',
      '',
      '- [Add best practices here]',
      '',
      '## Examples',
      '',
      '[Add practical examples here]',
      ''
    );
  }

  if (template === 'with-sub-skills') {
    lines.push(
      '## Sub-Skills',
      '',
      'This skill has the following sub-skills:',
      '',
      '| Sub-skill | Description |',
      '|-----------|-------------|',
      '| example | Example sub-skill |',
      '',
      'Use `skills_get_sub` to load specific sub-skill content.',
      ''
    );
  }

  return lines.join('\n');
}

/**
 * Register all CRUD tools on the MCP server
 */
export function registerCrudTools(server: McpServer, ctx: ServiceContext): void {
  // skills_create
  server.registerTool(
    'skills_create',
    {
      title: 'Create New Skill',
      description: `Create a new skill with proper structure and metadata.

Creates a skill directory with:
- _meta.json with provided metadata
- SKILL.md with template content
- Optional references/ directory (for 'with-sub-skills' template)

Args:
  - name (string): Skill name (lowercase, hyphens only, e.g., 'my-new-skill')
  - description (string): Skill description (10-500 chars)
  - tags (string[], optional): Tags for discoverability (1-15 tags)
  - template ('minimal' | 'standard' | 'with-sub-skills'): Scaffold template

Returns:
  Confirmation with created file paths.

Examples:
  - "Create a docker skill" -> name: "docker", template: "standard"
  - "Create a testing skill with sub-skills" -> name: "testing", template: "with-sub-skills"`,
      inputSchema: CreateSkillInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (params: CreateSkillInput) => {
      ctx.stats.trackToolCall('skills_create');

      const skillDir = path.join(ctx.skillsDir, params.name);

      // Check if skill already exists
      try {
        await fs.access(skillDir);
        return toolError(`Skill '${params.name}' already exists. Use skills_update to modify it.`);
      } catch {
        // Directory doesn't exist, good to proceed
      }

      try {
        // Create skill directory
        await fs.mkdir(skillDir, { recursive: true });

        const createdFiles: string[] = [];

        // Create _meta.json
        const meta: {
          name: string;
          description: string;
          tags: string[];
          sub_skills: Array<{ name: string; file: string; triggers: string[] }>;
          source: string;
        } = {
          name: params.name,
          description: params.description,
          tags: params.tags || [],
          sub_skills: [],
          source: 'created'
        };
        await fs.writeFile(
          path.join(skillDir, META_FILE),
          JSON.stringify(meta, null, 2)
        );
        createdFiles.push(META_FILE);

        // Create SKILL.md
        const content = generateSkillContent(params.name, params.description, params.template);
        await fs.writeFile(
          path.join(skillDir, SKILL_FILE),
          content
        );
        createdFiles.push(SKILL_FILE);

        // Create references/ for with-sub-skills template
        if (params.template === 'with-sub-skills') {
          const refsDir = path.join(skillDir, 'references');
          await fs.mkdir(refsDir);
          createdFiles.push('references/');

          // Create an example sub-skill
          await fs.writeFile(
            path.join(refsDir, 'example.md'),
            '# Example Sub-Skill\n\nAdd content here.\n'
          );
          createdFiles.push('references/example.md');

          // Update meta with sub-skill
          meta.sub_skills = [{
            name: 'example',
            file: 'references/example.md',
            triggers: []
          }];
          await fs.writeFile(
            path.join(skillDir, META_FILE),
            JSON.stringify(meta, null, 2)
          );
        }

        // Trigger index reload
        await ctx.indexer.reload();

        const output = {
          created: true,
          name: params.name,
          path: skillDir,
          files: createdFiles
        };

        return toolSuccessJson(
          `Skill '${params.name}' created successfully.\n` +
          `Location: ${skillDir}\n` +
          `Files: ${createdFiles.join(', ')}`,
          output
        );
      } catch (error) {
        return toolError(handleFsError(error, `Creating skill '${params.name}'`));
      }
    }
  );

  // skills_update
  server.registerTool(
    'skills_update',
    {
      title: 'Update Skill',
      description: `Update an existing skill's content or metadata.

Can update:
- SKILL.md content
- Description in _meta.json
- Tags in _meta.json

Args:
  - name (string): Skill name to update
  - content (string, optional): New SKILL.md content
  - description (string, optional): New description
  - tags (string[], optional): New tags

At least one of content, description, or tags must be provided.

Returns:
  Confirmation of what was updated.

Examples:
  - "Update forms skill description" -> name: "forms", description: "New description"
  - "Add tags to docker skill" -> name: "docker", tags: ["containers", "devops"]`,
      inputSchema: UpdateSkillInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: UpdateSkillInput) => {
      ctx.stats.trackToolCall('skills_update');

      const skillDir = path.join(ctx.skillsDir, params.name);

      // Check if skill exists
      if (!await ctx.indexer.skillExists(params.name)) {
        return toolError(`Skill '${params.name}' not found. Use skills_list to see available skills.`);
      }

      const updated: string[] = [];

      try {
        // Update SKILL.md if content provided
        if (params.content !== undefined) {
          await fs.writeFile(
            path.join(skillDir, SKILL_FILE),
            params.content
          );
          updated.push('SKILL.md');
        }

        // Update _meta.json if description or tags provided
        if (params.description !== undefined || params.tags !== undefined) {
          const metaPath = path.join(skillDir, META_FILE);
          const metaContent = await fs.readFile(metaPath, 'utf-8');
          const meta = JSON.parse(metaContent);

          if (params.description !== undefined) {
            meta.description = params.description;
            updated.push('description');
          }

          if (params.tags !== undefined) {
            meta.tags = params.tags;
            updated.push('tags');
          }

          await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
        }

        // Trigger index reload
        await ctx.indexer.reload();

        const output = {
          updated: true,
          name: params.name,
          changes: updated
        };

        return toolSuccessJson(
          `Skill '${params.name}' updated successfully.\n` +
          `Updated: ${updated.join(', ')}`,
          output
        );
      } catch (error) {
        return toolError(handleFsError(error, `Updating skill '${params.name}'`));
      }
    }
  );

  // skills_delete
  server.registerTool(
    'skills_delete',
    {
      title: 'Delete Skill',
      description: `Delete a skill and all its files.

This is a destructive operation. Set confirm=true to proceed.

Args:
  - name (string): Skill name to delete
  - confirm (boolean): Must be true to proceed (safety check)

Returns:
  Confirmation of deletion.

Examples:
  - "Delete the test-skill" -> name: "test-skill", confirm: true`,
      inputSchema: DeleteSkillInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (params: DeleteSkillInput) => {
      ctx.stats.trackToolCall('skills_delete');

      // Safety check
      if (!params.confirm) {
        return toolError(
          `Deletion not confirmed. Set confirm=true to delete skill '${params.name}'. ` +
          `This will permanently remove the skill and all its files.`
        );
      }

      const skillDir = path.join(ctx.skillsDir, params.name);

      // Check if skill exists
      if (!await ctx.indexer.skillExists(params.name)) {
        return toolError(`Skill '${params.name}' not found.`);
      }

      try {
        // Delete the skill directory recursively
        await fs.rm(skillDir, { recursive: true, force: true });

        // Trigger index reload
        await ctx.indexer.reload();

        const output = {
          deleted: true,
          name: params.name
        };

        return toolSuccessJson(
          `Skill '${params.name}' deleted successfully.`,
          output
        );
      } catch (error) {
        return toolError(handleFsError(error, `Deleting skill '${params.name}'`));
      }
    }
  );

  // skills_export
  server.registerTool(
    'skills_export',
    {
      title: 'Export Skill',
      description: `Export a skill as a base64-encoded ZIP file.

Exports all skill files including SKILL.md, _meta.json,
and optionally scripts/ directory.

Args:
  - name (string): Skill name to export
  - include_scripts (boolean): Include scripts/ directory (default: true)

Returns:
  Base64-encoded ZIP file content.

Examples:
  - "Export the forms skill" -> name: "forms"
  - "Export mcp-builder without scripts" -> name: "mcp-builder", include_scripts: false`,
      inputSchema: ExportSkillInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (params: ExportSkillInput) => {
      ctx.stats.trackToolCall('skills_export');

      const skillDir = path.join(ctx.skillsDir, params.name);

      // Check if skill exists
      if (!await ctx.indexer.skillExists(params.name)) {
        return toolError(`Skill '${params.name}' not found.`);
      }

      try {
        // Create ZIP in memory
        const chunks: Buffer[] = [];
        const writableStream = new Writable({
          write(chunk, _encoding, callback) {
            chunks.push(chunk);
            callback();
          }
        });

        const archive = archiver('zip', { zlib: { level: 9 } });

        const archivePromise = new Promise<void>((resolve, reject) => {
          archive.on('error', reject);
          writableStream.on('finish', resolve);
        });

        archive.pipe(writableStream);

        // Add skill directory to archive
        archive.directory(skillDir, params.name, (entry) => {
          // Optionally exclude scripts/
          if (!params.include_scripts && entry.name?.includes('scripts/')) {
            return false;
          }
          return entry;
        });

        await archive.finalize();
        await archivePromise;

        const zipBuffer = Buffer.concat(chunks);
        const base64 = zipBuffer.toString('base64');

        const output = {
          name: params.name,
          filename: `${params.name}.zip`,
          size: zipBuffer.length,
          base64
        };

        return toolSuccessJson(
          `Skill '${params.name}' exported successfully.\n` +
          `Size: ${zipBuffer.length} bytes\n` +
          `The ZIP content is in base64 format in the response.`,
          output
        );
      } catch (error) {
        return toolError(handleFsError(error, `Exporting skill '${params.name}'`));
      }
    }
  );
}
