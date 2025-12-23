/**
 * Zod schemas for MCP tool input validation
 * Following mcp-builder best practices with .strict() enforcement
 */

import { z } from 'zod';
import { MAX_BATCH_SIZE, MAX_SEARCH_RESULTS, DEFAULT_SEARCH_LIMIT } from '../constants.js';

/**
 * Response format enum schema used across all tools
 */
export const ResponseFormatSchema = z.enum(['markdown', 'json'])
  .default('markdown')
  .describe("Output format: 'markdown' for human-readable or 'json' for structured data");

// ============================================================================
// READ TOOLS
// ============================================================================

/**
 * skills_list - List all skill domains
 */
export const ListSkillsInputSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

export type ListSkillsInput = z.infer<typeof ListSkillsInputSchema>;

/**
 * skills_get - Get a skill's main SKILL.md content
 */
export const GetSkillInputSchema = z.object({
  name: z.string()
    .min(1, 'Skill name is required')
    .describe("Skill domain name (e.g., 'forms', 'mcp-builder', 'dashboard')"),
  response_format: ResponseFormatSchema
}).strict();

export type GetSkillInput = z.infer<typeof GetSkillInputSchema>;

/**
 * skills_get_sub - Get a sub-skill's content
 */
export const GetSubSkillInputSchema = z.object({
  domain: z.string()
    .min(1, 'Domain name is required')
    .describe("Parent skill domain (e.g., 'forms', 'building')"),
  sub_skill: z.string()
    .min(1, 'Sub-skill name is required')
    .describe("Sub-skill name (e.g., 'validation', 'react', 'multiplayer')"),
  response_format: ResponseFormatSchema
}).strict();

export type GetSubSkillInput = z.infer<typeof GetSubSkillInputSchema>;

/**
 * Batch request item schema
 */
export const BatchRequestSchema = z.object({
  domain: z.string().min(1, 'Domain is required'),
  sub_skill: z.string().nullable().optional()
}).strict();

/**
 * skills_get_batch - Get multiple skills/sub-skills in one request
 */
export const GetBatchInputSchema = z.object({
  requests: z.array(BatchRequestSchema)
    .min(1, 'At least one request is required')
    .max(MAX_BATCH_SIZE, `Maximum ${MAX_BATCH_SIZE} requests per batch`)
    .describe("Array of {domain, sub_skill?} objects to load"),
  response_format: ResponseFormatSchema
}).strict();

export type GetBatchInput = z.infer<typeof GetBatchInputSchema>;

// ============================================================================
// SEARCH TOOLS
// ============================================================================

/**
 * skills_search - Search by metadata (name, description, tags, triggers)
 */
export const SearchInputSchema = z.object({
  query: z.string()
    .min(2, 'Query must be at least 2 characters')
    .max(200, 'Query must not exceed 200 characters')
    .describe("Search term to match against names, descriptions, tags, and trigger words"),
  limit: z.number()
    .int()
    .min(1)
    .max(MAX_SEARCH_RESULTS)
    .default(DEFAULT_SEARCH_LIMIT)
    .describe(`Maximum results to return (1-${MAX_SEARCH_RESULTS})`),
  response_format: ResponseFormatSchema
}).strict();

export type SearchInput = z.infer<typeof SearchInputSchema>;

/**
 * skills_search_content - Full-text content search
 */
export const SearchContentInputSchema = z.object({
  query: z.string()
    .min(2, 'Query must be at least 2 characters')
    .max(200, 'Query must not exceed 200 characters')
    .describe("Search term for full-text content search across all skill files"),
  limit: z.number()
    .int()
    .min(1)
    .max(MAX_SEARCH_RESULTS)
    .default(DEFAULT_SEARCH_LIMIT)
    .describe(`Maximum results to return (1-${MAX_SEARCH_RESULTS})`),
  response_format: ResponseFormatSchema
}).strict();

export type SearchContentInput = z.infer<typeof SearchContentInputSchema>;

// ============================================================================
// ADMIN TOOLS
// ============================================================================

/**
 * skills_reload - Reload the skill index from disk
 */
export const ReloadInputSchema = z.object({}).strict();

export type ReloadInput = z.infer<typeof ReloadInputSchema>;

/**
 * skills_stats - Get usage statistics
 */
export const StatsInputSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

export type StatsInput = z.infer<typeof StatsInputSchema>;

/**
 * skills_validate - Validate skill structure and metadata
 */
export const ValidateInputSchema = z.object({
  skill_name: z.string()
    .optional()
    .describe("Specific skill to validate (omit to validate all skills)"),
  response_format: ResponseFormatSchema
}).strict();

export type ValidateInput = z.infer<typeof ValidateInputSchema>;

// ============================================================================
// CRUD TOOLS
// ============================================================================

/**
 * Skill template options
 */
export const SkillTemplateSchema = z.enum(['minimal', 'standard', 'with-sub-skills'])
  .default('standard')
  .describe("Template for skill structure: 'minimal' (just SKILL.md), 'standard' (with tags), 'with-sub-skills' (includes references/)");

/**
 * skills_create - Create a new skill scaffold
 */
export const CreateSkillInputSchema = z.object({
  name: z.string()
    .min(1, 'Name is required')
    .max(50, 'Name must not exceed 50 characters')
    .regex(/^[a-z0-9-]+$/, 'Name must be lowercase alphanumeric with hyphens only')
    .describe("Skill name (lowercase, hyphens allowed, e.g., 'my-new-skill')"),
  description: z.string()
    .min(10, 'Description must be at least 10 characters')
    .max(500, 'Description must not exceed 500 characters')
    .describe("Human-readable skill description"),
  tags: z.array(z.string())
    .min(1)
    .max(15)
    .optional()
    .describe("Tags for discoverability (1-15 tags)"),
  template: SkillTemplateSchema
}).strict();

export type CreateSkillInput = z.infer<typeof CreateSkillInputSchema>;

/**
 * skills_update - Update skill content or metadata
 */
export const UpdateSkillInputSchema = z.object({
  name: z.string()
    .min(1, 'Skill name is required')
    .describe("Name of the skill to update"),
  content: z.string()
    .optional()
    .describe("New SKILL.md content (if updating content)"),
  description: z.string()
    .min(10)
    .max(500)
    .optional()
    .describe("New description (if updating metadata)"),
  tags: z.array(z.string())
    .max(15)
    .optional()
    .describe("New tags (if updating metadata)")
}).strict().refine(
  data => data.content !== undefined || data.description !== undefined || data.tags !== undefined,
  { message: "At least one of 'content', 'description', or 'tags' must be provided" }
);

export type UpdateSkillInput = z.infer<typeof UpdateSkillInputSchema>;

/**
 * skills_delete - Delete a skill
 */
export const DeleteSkillInputSchema = z.object({
  name: z.string()
    .min(1, 'Skill name is required')
    .describe("Name of the skill to delete"),
  confirm: z.boolean()
    .default(false)
    .describe("Set to true to confirm deletion (required for safety)")
}).strict();

export type DeleteSkillInput = z.infer<typeof DeleteSkillInputSchema>;

/**
 * skills_export - Export a skill as ZIP
 */
export const ExportSkillInputSchema = z.object({
  name: z.string()
    .min(1, 'Skill name is required')
    .describe("Name of the skill to export"),
  include_scripts: z.boolean()
    .default(true)
    .describe("Include scripts/ directory in export")
}).strict();

export type ExportSkillInput = z.infer<typeof ExportSkillInputSchema>;

// ============================================================================
// SCHEMA INDEX
// ============================================================================

/**
 * Export all schemas for tool registration
 */
export const ToolSchemas = {
  // Read tools
  skills_list: ListSkillsInputSchema,
  skills_get: GetSkillInputSchema,
  skills_get_sub: GetSubSkillInputSchema,
  skills_get_batch: GetBatchInputSchema,

  // Search tools
  skills_search: SearchInputSchema,
  skills_search_content: SearchContentInputSchema,

  // Admin tools
  skills_reload: ReloadInputSchema,
  skills_stats: StatsInputSchema,
  skills_validate: ValidateInputSchema,

  // CRUD tools
  skills_create: CreateSkillInputSchema,
  skills_update: UpdateSkillInputSchema,
  skills_delete: DeleteSkillInputSchema,
  skills_export: ExportSkillInputSchema
} as const;
