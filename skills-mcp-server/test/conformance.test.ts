/**
 * Conformance test for the canonical _meta contract (TypeScript side).
 *
 * The TypeScript (ajv) and Python (jsonschema) validators load the SAME schema
 * (schema/meta.schema.json) and the SAME fixtures (schema/fixtures/*.json). This
 * test and its Python twin (tests/test_meta_conformance.py) prove the two
 * adapters converge: both accept the good fixture and both reject the bad one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

import { validateMeta } from '../src/schemas/meta.js';

// schema/fixtures lives at the repo root: test -> skills-mcp-server -> root.
const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'schema',
  'fixtures'
);

function load(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf-8'));
}

describe('canonical _meta conformance', () => {
  it('accepts the shared valid fixture', () => {
    const result = validateMeta(load('meta.valid.json'));
    expect(result.success).toBe(true);
  });

  it('rejects the shared invalid fixture', () => {
    const result = validateMeta(load('meta.invalid.json'));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/name/);
    }
  });

  it.each([
    { description: 'missing name' },
    { name: 'ok' }, // missing description
    { name: 'Bad_Name', description: 'uppercase + underscore' },
    { name: 'ok', description: 'x', type: 'bogus' },
    { name: 'ok', description: 'x', relevance_tier: 'Z' },
    { name: 'ok', description: 'x', extra_field: true },
    { name: 'ok', description: 'x', tags: 'not-a-list' },
  ])('rejects known-bad shape %#', (meta) => {
    expect(validateMeta(meta).success).toBe(false);
  });
});
