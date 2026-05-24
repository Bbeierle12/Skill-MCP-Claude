/**
 * Phase 3: write-time enforcement of the canonical _meta contract.
 *
 * The CRUD tools route writes through the canonical validator, so a skill
 * cannot be persisted in an invalid state. This proves the meaningful case:
 * `skills_update` refuses to write back an _meta.json that violates the
 * canonical schema (e.g. one that was already invalid on disk), while a valid
 * update still succeeds.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServiceContext, buildServer } from '../src/server.js';

let skillsDir: string;
let client: Client;

/** Build a skills dir with one valid skill and one invalid-on-disk skill. */
async function setupFixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'skills-crud-'));

  // A conformant skill.
  const goodDir = path.join(dir, 'good');
  await mkdir(goodDir, { recursive: true });
  await writeFile(
    path.join(goodDir, '_meta.json'),
    JSON.stringify({
      name: 'good',
      description: 'A perfectly valid skill description.',
      tags: ['x']
    })
  );
  await writeFile(path.join(goodDir, 'SKILL.md'), '# Good\n\nValid skill.\n');

  // A skill whose _meta.json is canonically invalid (unknown field). The indexer
  // skips it, but its directory exists, so skills_update can still reach it.
  const brokenDir = path.join(dir, 'broken');
  await mkdir(brokenDir, { recursive: true });
  await writeFile(
    path.join(brokenDir, '_meta.json'),
    JSON.stringify({
      name: 'broken',
      description: 'Metadata carries an illegal extra field.',
      bogus: true
    })
  );
  await writeFile(path.join(brokenDir, 'SKILL.md'), '# Broken\n\nInvalid meta.\n');

  return dir;
}

function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
  return result.content?.find(c => c.type === 'text')?.text ?? '';
}

beforeAll(async () => {
  skillsDir = await setupFixture();

  const ctx = createServiceContext(skillsDir);
  await ctx.indexer.reload();
  const server = buildServer(ctx);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'crud-enforcement-client', version: '1.0.0' });

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

describe('skills_update write-time enforcement', () => {
  it('refuses to write back metadata that violates the canonical schema', async () => {
    const result = await client.callTool({
      name: 'skills_update',
      arguments: { name: 'broken', tags: ['anything'] }
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/canonical schema/i);

    // The invalid file must be left untouched (not rewritten).
    const onDisk = JSON.parse(
      await readFile(path.join(skillsDir, 'broken', '_meta.json'), 'utf-8')
    );
    expect(onDisk.bogus).toBe(true);
    expect(onDisk.tags).toBeUndefined();
  });

  it('allows a valid update to succeed', async () => {
    const result = await client.callTool({
      name: 'skills_update',
      arguments: { name: 'good', description: 'An updated, still-valid description.' }
    });

    expect(result.isError).toBeFalsy();

    const onDisk = JSON.parse(
      await readFile(path.join(skillsDir, 'good', '_meta.json'), 'utf-8')
    );
    expect(onDisk.description).toBe('An updated, still-valid description.');
  });
});
