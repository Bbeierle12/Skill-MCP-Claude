import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';

import {
  assertSafeSkillName,
  defaultAllowedOrigins,
  requireBearerAuth,
  safeJoin,
  safeRelativePath
} from '../src/utils/security.js';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.SKILLS_ALLOWED_ORIGINS;
  delete process.env.SKILLS_HTTP_AUTH_TOKEN;
  delete process.env.TEST_TOKEN;
  delete process.env.TEST_AUTH_REQUIRED;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('safe path helpers', () => {
  it('accepts paths that stay inside the base directory', () => {
    const target = safeJoin('/tmp/skills', 'forms', 'SKILL.md');
    expect(target).toBe(path.resolve('/tmp/skills/forms/SKILL.md'));
  });

  it('rejects traversal and sibling-prefix escapes', () => {
    expect(() => safeJoin('/tmp/skills', '..', 'secrets')).toThrow(/escapes/);
    expect(() => safeJoin('/tmp/skills', '../skills-evil/file.md')).toThrow(/escapes/);
  });

  it('normalizes safe relative paths and rejects unsafe ones', () => {
    expect(safeRelativePath('references\\react.md')).toBe('references/react.md');
    expect(() => safeRelativePath('../outside.md')).toThrow(/traversal/i);
    expect(() => safeRelativePath('/etc/passwd')).toThrow(/absolute/i);
    expect(() => safeRelativePath('file\x00.md')).toThrow(/invalid/i);
  });

  it('enforces strict skill names for route parameters', () => {
    expect(assertSafeSkillName('valid-skill-123')).toBe('valid-skill-123');
    expect(() => assertSafeSkillName('Bad_Name')).toThrow(/invalid/i);
    expect(() => assertSafeSkillName('../escape')).toThrow(/invalid/i);
  });
});

describe('origin defaults', () => {
  it('defaults to loopback browser origins only', () => {
    const origins = defaultAllowedOrigins([5050]);
    expect(origins.has('http://localhost:5050')).toBe(true);
    expect(origins.has('http://127.0.0.1:5050')).toBe(true);
    expect(origins.has('https://example.com')).toBe(false);
  });

  it('uses configured origins when supplied', () => {
    process.env.SKILLS_ALLOWED_ORIGINS = 'https://connector.example, https://admin.example';
    const origins = defaultAllowedOrigins([5050]);
    expect([...origins].sort()).toEqual(['https://admin.example', 'https://connector.example']);
  });
});

describe('bearer auth middleware', () => {
  function invokeAuth(headers: Record<string, string> = {}): {
    nextCalled: boolean;
    statusCode?: number;
    body?: unknown;
  } {
    const req = {
      get(name: string): string | undefined {
        return headers[name.toLowerCase()];
      }
    } as Request;

    let statusCode: number | undefined;
    let body: unknown;
    const res = {
      setHeader() {
        return this;
      },
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        return this;
      }
    } as unknown as Response;

    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    requireBearerAuth({
      tokenEnv: 'TEST_TOKEN',
      requiredEnv: 'TEST_AUTH_REQUIRED',
      realm: 'test'
    })(req, res, next);

    return { nextCalled, statusCode, body };
  }

  it('fails closed when auth is required and no token is configured', () => {
    const result = invokeAuth();
    expect(result.nextCalled).toBe(false);
    expect(result.statusCode).toBe(503);
  });

  it('allows explicit opt-out for tests or trusted local dev', () => {
    process.env.TEST_AUTH_REQUIRED = 'false';
    const result = invokeAuth();
    expect(result.nextCalled).toBe(true);
  });

  it('accepts a valid bearer token and rejects invalid tokens', () => {
    process.env.TEST_TOKEN = 'secret-token';
    expect(invokeAuth({ authorization: 'Bearer secret-token' }).nextCalled).toBe(true);

    const rejected = invokeAuth({ authorization: 'Bearer wrong-token' });
    expect(rejected.nextCalled).toBe(false);
    expect(rejected.statusCode).toBe(401);
  });
});
