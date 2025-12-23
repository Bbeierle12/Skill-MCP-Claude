/**
 * Zod schemas for _meta.json validation
 */

import { z } from 'zod';

/**
 * Sub-skill schema for nested skill references
 */
export const SubSkillSchema = z.object({
  name: z.string()
    .min(1, 'Sub-skill name is required')
    .describe('Sub-skill identifier'),
  file: z.string()
    .min(1, 'Sub-skill file path is required')
    .describe('Relative path to sub-skill markdown file'),
  triggers: z.array(z.string())
    .optional()
    .describe('Trigger words for search discovery')
}).strict();

/**
 * Main _meta.json schema
 */
export const MetaSchema = z.object({
  name: z.string()
    .min(1, 'Skill name is required')
    .regex(/^[a-z0-9-]+$/, 'Name must be lowercase alphanumeric with hyphens')
    .describe('Skill name matching directory name'),
  description: z.string()
    .min(1, 'Description is required')
    .describe('Human-readable skill description'),
  tags: z.array(z.string())
    .optional()
    .describe('Tags for search discovery'),
  sub_skills: z.array(SubSkillSchema)
    .optional()
    .describe('Sub-skills for router/parent skills'),
  source: z.string()
    .optional()
    .describe('Source of the skill (e.g., "imported", "claude-examples")')
}).strict();

/**
 * Inferred types from Zod schemas
 */
export type SubSkillMeta = z.infer<typeof SubSkillSchema>;
export type SkillMeta = z.infer<typeof MetaSchema>;

/**
 * Validate _meta.json content and return typed result
 */
export function validateMeta(content: unknown): { success: true; data: SkillMeta } | { success: false; error: string } {
  const result = MetaSchema.safeParse(content);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')
  };
}
