/**
 * _meta.json validation.
 *
 * The field set lives in exactly ONE place: schema/meta.schema.json at the repo
 * root — the canonical contract shared with the Python (jsonschema) and Rust
 * validators. This module is a thin ajv adapter over that file; it deliberately
 * does NOT define the schema itself.
 */

import { Ajv, type ErrorObject } from 'ajv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import type { SkillMeta } from '../types.js';

export type { SkillMeta, SubSkillMeta } from '../types.js';

// schema/meta.schema.json lives at the repo root.
// This file resolves to src/schemas (dev/test) or dist/schemas (built); both are
// three levels below the repo root.
const SCHEMA_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'schema',
  'meta.schema.json'
);

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));
const ajv = new Ajv({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);

/**
 * Validate _meta.json content against the canonical schema and return a typed
 * result. Mirrors the Python `core.meta_schema.validate_meta` contract.
 */
export function validateMeta(
  content: unknown
): { success: true; data: SkillMeta } | { success: false; error: string } {
  if (validateSchema(content)) {
    return { success: true, data: content as SkillMeta };
  }
  const error = (validateSchema.errors ?? [])
    .map((e: ErrorObject) => {
      const loc = e.instancePath ? e.instancePath.replace(/^\//, '').replace(/\//g, '.') : '';
      const extra =
        e.keyword === 'additionalProperties' &&
        e.params &&
        'additionalProperty' in e.params
          ? ` (${(e.params as { additionalProperty: string }).additionalProperty})`
          : '';
      return `${loc ? `${loc}: ` : ''}${e.message ?? 'invalid'}${extra}`;
    })
    .join('; ');
  return { success: false, error };
}
