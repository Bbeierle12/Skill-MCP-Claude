/**
 * Smoke tests for the published Skills MCP server.
 *
 * These boot the real server over an in-memory transport and drive it through
 * a real MCP client, asserting that:
 *   - the server initializes and advertises every expected tool,
 *   - each tool's happy path returns a well-formed result, and
 *   - invalid input fails loudly rather than silently returning junk.
 *
 * The suite indexes a temporary, deterministic skills fixture instead of the
 * repo's real skills/ directory so assertions stay stable as skills change.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServiceContext, buildServer } from '../src/server.js';

/** Every tool the server is contractually expected to expose. */
const EXPECTED_TOOLS = [
  'skills_list',
  'skills_get',
  'skills_get_sub',
  'skills_get_batch',
  'skills_search',
  'skills_search_content',
  'skills_reload',
  'skills_stats',
  'skills_validate',
  'skills_create',
  'skills_update',
  'skills_delete',
  'skills_export'
].sort();

let skillsDir: string;
let client: Client;

/** Build a small, deterministic skills directory to index. */
async function setupFixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'skills-smoke-'));

  // A router skill with a sub-skill and a references/ directory.
  const formsDir = path.join(dir, 'forms');
  await mkdir(path.join(formsDir, 'references'), { recursive: true });
  await writeFile(
    path.join(formsDir, '_meta.json'),
    JSON.stringify({
      name: 'forms',
      description: 'Building and validating forms with Zod and React.',
      tags: ['forms', 'validation', 'zod'],
      sub_skills: [
        { name: 'react', file: 'references/react.md', triggers: ['useform', 'hook'] }
      ]
    })
  );
  await writeFile(
    path.join(formsDir, 'SKILL.md'),
    '# Forms\n\nForm validation patterns with Zod.\n'
  );
  await writeFile(
    path.join(formsDir, 'references', 'react.md'),
    '# React Forms\n\nThe useForm hook handles form state.\n'
  );

  // A second, flat skill with no sub-skills.
  const dashDir = path.join(dir, 'dashboard');
  await mkdir(dashDir, { recursive: true });
  await writeFile(
    path.join(dashDir, '_meta.json'),
    JSON.stringify({
      name: 'dashboard',
      description: 'Dashboard layout and charting components.',
      tags: ['ui', 'charts']
    })
  );
  await writeFile(path.join(dashDir, 'SKILL.md'), '# Dashboard\n\nLayout and charts.\n');

  return dir;
}

/**
 * Extract a tool result's structured payload.
 *
 * Tools return structured data via `structuredContent`; some also serialize it
 * into the text block. Prefer the structured field and fall back to parsing the
 * text block as JSON.
 */
function parseJsonResult(result: {
  structuredContent?: unknown;
  content?: Array<{ type: string; text?: string }>;
}): unknown {
  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }
  const textBlock = result.content?.find(c => c.type === 'text');
  expect(textBlock?.text).toBeTruthy();
  return JSON.parse(textBlock!.text!);
}

beforeAll(async () => {
  skillsDir = await setupFixture();

  const ctx = createServiceContext(skillsDir);
  await ctx.indexer.reload();
  const server = buildServer(ctx);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'smoke-test-client', version: '1.0.0' });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ]);
});

afterAll(async () => {
  await client?.close();
  if (skillsDir) {
    await rm(skillsDir, { recursive: true, force: true });
  }
});

describe('server initialization', () => {
  it('boots and advertises exactly the expected tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOLS);
  });

  it('exposes a description and input schema for every tool', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description, `${tool.name} should have a description`).toBeTruthy();
      expect(tool.inputSchema, `${tool.name} should have an input schema`).toBeTruthy();
      expect(tool.inputSchema.type).toBe('object');
    }
  });
});

describe('read tools (happy path)', () => {
  it('skills_list returns the indexed skills', async () => {
    const result = await client.callTool({
      name: 'skills_list',
      arguments: { response_format: 'json' }
    });
    expect(result.isError).toBeFalsy();

    const data = parseJsonResult(result) as { total: number; skills: Array<{ name: string }> };
    expect(data.total).toBe(2);
    expect(data.skills.map(s => s.name).sort()).toEqual(['dashboard', 'forms']);
  });

  it('skills_get returns a skill\'s content and sub-skills', async () => {
    const result = await client.callTool({
      name: 'skills_get',
      arguments: { name: 'forms', response_format: 'json' }
    });
    expect(result.isError).toBeFalsy();

    const data = parseJsonResult(result) as {
      name: string;
      content: string;
      subSkills: string[];
    };
    expect(data.name).toBe('forms');
    expect(data.content).toContain('Form validation patterns');
    expect(data.subSkills).toEqual(['react']);
  });

  it('skills_get_sub returns sub-skill content', async () => {
    const result = await client.callTool({
      name: 'skills_get_sub',
      arguments: { domain: 'forms', sub_skill: 'react', response_format: 'json' }
    });
    expect(result.isError).toBeFalsy();

    const data = parseJsonResult(result) as { content: string };
    expect(data.content).toContain('useForm hook');
  });

  it('skills_get_batch loads multiple entries in one call', async () => {
    const result = await client.callTool({
      name: 'skills_get_batch',
      arguments: {
        requests: [{ domain: 'forms' }, { domain: 'forms', sub_skill: 'react' }],
        response_format: 'json'
      }
    });
    expect(result.isError).toBeFalsy();

    const data = parseJsonResult(result) as { results: unknown[] };
    expect(data.results).toHaveLength(2);
  });
});

describe('search tools (happy path)', () => {
  it('skills_search matches by metadata', async () => {
    const result = await client.callTool({
      name: 'skills_search',
      arguments: { query: 'forms', response_format: 'json' }
    });
    expect(result.isError).toBeFalsy();

    const data = parseJsonResult(result) as { results: Array<{ domain: string }> };
    expect(data.results.some(r => r.domain === 'forms')).toBe(true);
  });

  it('skills_search_content matches inside file bodies', async () => {
    const result = await client.callTool({
      name: 'skills_search_content',
      arguments: { query: 'useform', response_format: 'json' }
    });
    expect(result.isError).toBeFalsy();

    const data = parseJsonResult(result) as { results: Array<{ domain: string }> };
    expect(data.results.some(r => r.domain === 'forms')).toBe(true);
  });
});

describe('admin tools (happy path)', () => {
  it('skills_reload re-indexes from disk', async () => {
    const result = await client.callTool({ name: 'skills_reload', arguments: {} });
    expect(result.isError).toBeFalsy();

    const data = parseJsonResult(result) as { skillCount: number };
    expect(data.skillCount).toBe(2);
  });

  it('skills_stats reports usage and index size', async () => {
    const result = await client.callTool({
      name: 'skills_stats',
      arguments: { response_format: 'json' }
    });
    expect(result.isError).toBeFalsy();

    const data = parseJsonResult(result) as { skillCount: number };
    expect(data.skillCount).toBe(2);
  });

  it('skills_validate passes on a well-formed fixture', async () => {
    const result = await client.callTool({
      name: 'skills_validate',
      arguments: { response_format: 'json' }
    });
    expect(result.isError).toBeFalsy();

    const data = parseJsonResult(result) as { valid: boolean; skillsChecked: number };
    expect(data.valid).toBe(true);
    expect(data.skillsChecked).toBe(2);
  });
});

describe('invalid input fails loudly', () => {
  it('reports an explicit error when input violates the schema', async () => {
    // skills_get requires `name`; omitting it must surface a loud validation
    // error rather than running the handler with undefined input.
    const result = await client.callTool({
      name: 'skills_get',
      arguments: { response_format: 'json' }
    });
    expect(result.isError).toBe(true);
    const textBlock = (result.content as Array<{ type: string; text?: string }>).find(
      c => c.type === 'text'
    );
    expect(textBlock?.text).toMatch(/validation|Invalid arguments|Required/i);
  });

  it('returns an explicit error for a missing skill', async () => {
    const result = await client.callTool({
      name: 'skills_get',
      arguments: { name: 'does-not-exist', response_format: 'json' }
    });
    expect(result.isError).toBe(true);
    const textBlock = (result.content as Array<{ type: string; text?: string }>).find(
      c => c.type === 'text'
    );
    expect(textBlock?.text).toContain('not found');
  });

  it('returns an explicit error for a missing sub-skill', async () => {
    const result = await client.callTool({
      name: 'skills_get_sub',
      arguments: { domain: 'forms', sub_skill: 'nope', response_format: 'json' }
    });
    expect(result.isError).toBe(true);
  });
});
