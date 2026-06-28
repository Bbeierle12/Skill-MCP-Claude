import { timingSafeEqual } from 'node:crypto';
import path from 'path';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { CorsOptions } from 'cors';

export const SKILL_NAME_PATTERN = /^[a-z0-9-]{1,50}$/;

export function envFlag(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

export function defaultAllowedOrigins(ports: number[]): Set<string> {
  const configured = splitCsv(process.env.SKILLS_ALLOWED_ORIGINS);
  if (configured.length > 0) {
    return new Set(configured);
  }

  const origins = new Set<string>();
  for (const port of ports) {
    origins.add(`http://localhost:${port}`);
    origins.add(`http://127.0.0.1:${port}`);
    origins.add(`http://[::1]:${port}`);
  }
  return origins;
}

export function createOriginGuard(allowedOrigins: Set<string>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.get('origin');
    if (!origin || allowedOrigins.has(origin)) {
      next();
      return;
    }

    res.status(403).json({ error: 'Origin is not allowed' });
  };
}

export function createCorsOptions(allowedOrigins: Set<string>): CorsOptions {
  return {
    credentials: false,
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    }
  };
}

export interface BearerAuthOptions {
  tokenEnv: string;
  requiredEnv: string;
  realm: string;
}

export function requireBearerAuth(options: BearerAuthOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!envFlag(options.requiredEnv, true)) {
      next();
      return;
    }

    const expected = process.env[options.tokenEnv] || process.env.SKILLS_HTTP_AUTH_TOKEN;
    if (!expected) {
      res.status(503).json({
        error: `${options.tokenEnv} or SKILLS_HTTP_AUTH_TOKEN must be set before this endpoint is enabled`
      });
      return;
    }

    const header = req.get('authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match || !constantTimeEqual(match[1], expected)) {
      res.setHeader('WWW-Authenticate', `Bearer realm="${options.realm}"`);
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  };
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function assertSafeSkillName(name: string): string {
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new Error('Invalid skill name');
  }
  return name;
}

export function safeJoin(baseDir: string, ...segments: string[]): string {
  const resolvedBase = path.resolve(baseDir);
  for (const segment of segments) {
    if (segment.includes('\0')) {
      throw new Error('Path contains a null byte');
    }
  }

  const resolvedTarget = path.resolve(resolvedBase, ...segments);
  const relative = path.relative(resolvedBase, resolvedTarget);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolvedTarget;
  }

  throw new Error('Path escapes the allowed directory');
}

export function safeRelativePath(input: string): string {
  if (!input || input.includes('\0')) {
    throw new Error('Invalid relative path');
  }

  const normalizedInput = input.replace(/\\/g, '/');
  if (normalizedInput.startsWith('/') || path.win32.isAbsolute(input)) {
    throw new Error('Absolute paths are not allowed');
  }

  const normalized = path.posix.normalize(normalizedInput);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Path traversal is not allowed');
  }

  return normalized;
}

export function isPathInside(baseDir: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedBase, resolvedTarget);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function minimalCommandEnv(): NodeJS.ProcessEnv {
  const allowed = [
    'PATH',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'XDG_CONFIG_HOME',
    'CLAUDE_CONFIG_DIR',
    'ANTHROPIC_API_KEY'
  ];

  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  return env;
}
