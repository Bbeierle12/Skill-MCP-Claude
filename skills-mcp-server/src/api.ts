#!/usr/bin/env node
/**
 * Skills Manager REST API
 *
 * Express server providing REST API for the web UI.
 * Serves skills-manager.html and provides endpoints for skill management.
 *
 * Usage:
 *   node dist/api.js
 *
 * Environment variables:
 *   SKILLS_DIR - Path to skills directory (default: ../skills)
 *   API_PORT - Port to listen on (default: 5050)
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import multer from 'multer';

import { getSkillsDir, API_PORT, SKILL_FILE, META_FILE } from './constants.js';
import { SkillIndexer, FileWatcher } from './services/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize services
const skillsDir = getSkillsDir();
const indexer = new SkillIndexer(skillsDir);

// File upload configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

// Create Express app
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static files (skills-manager.html)
const htmlPath = path.resolve(__dirname, '..', '..', 'skills-manager.html');
app.get('/', async (_req: Request, res: Response) => {
  try {
    const html = await fs.readFile(htmlPath, 'utf-8');
    res.type('html').send(html);
  } catch {
    res.status(404).send('skills-manager.html not found');
  }
});

// Error handler middleware
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// ============================================================================
// SKILLS API
// ============================================================================

/**
 * GET /api/skills - List all skills
 */
app.get('/api/skills', asyncHandler(async (_req: Request, res: Response) => {
  const index = await indexer.getSkillIndex();
  res.json({
    skills: index.skills,
    total: index.skills.length
  });
}));

/**
 * GET /api/skills/:name - Get skill details
 */
app.get('/api/skills/:name', asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params;
  const skillPath = path.join(skillsDir, name);

  try {
    await fs.access(skillPath);
  } catch {
    res.status(404).json({ error: `Skill '${name}' not found` });
    return;
  }

  // Read _meta.json
  let meta;
  try {
    const metaContent = await fs.readFile(path.join(skillPath, META_FILE), 'utf-8');
    meta = JSON.parse(metaContent);
  } catch {
    meta = { name, description: '', tags: [], sub_skills: [] };
  }

  // Read SKILL.md
  let content = '';
  try {
    content = await fs.readFile(path.join(skillPath, SKILL_FILE), 'utf-8');
  } catch {
    // No content
  }

  // Count files
  const files = await countFiles(skillPath);

  res.json({
    ...meta,
    content,
    path: skillPath,
    fileCount: files
  });
}));

/**
 * POST /api/skills - Create new skill
 */
app.post('/api/skills', asyncHandler(async (req: Request, res: Response) => {
  const { name, description, tags, content } = req.body;

  if (!name || !description) {
    res.status(400).json({ error: 'Name and description are required' });
    return;
  }

  const sanitizedName = sanitizeName(name);
  const skillPath = path.join(skillsDir, sanitizedName);

  // Check if exists
  try {
    await fs.access(skillPath);
    res.status(409).json({ error: `Skill '${sanitizedName}' already exists` });
    return;
  } catch {
    // Good, doesn't exist
  }

  // Create directory
  await fs.mkdir(skillPath, { recursive: true });

  // Create _meta.json
  const meta = {
    name: sanitizedName,
    description,
    tags: tags || [],
    sub_skills: [],
    source: 'api'
  };
  await fs.writeFile(
    path.join(skillPath, META_FILE),
    JSON.stringify(meta, null, 2)
  );

  // Create SKILL.md
  const skillContent = content || generateDefaultContent(sanitizedName, description);
  await fs.writeFile(path.join(skillPath, SKILL_FILE), skillContent);

  await indexer.reload();

  res.json({
    success: true,
    name: sanitizedName,
    path: skillPath
  });
}));

/**
 * PUT /api/skills/:name - Update skill
 */
app.put('/api/skills/:name', asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params;
  const { description, tags, content } = req.body;

  const skillPath = path.join(skillsDir, name);

  try {
    await fs.access(skillPath);
  } catch {
    res.status(404).json({ error: `Skill '${name}' not found` });
    return;
  }

  // Update _meta.json if description or tags provided
  if (description !== undefined || tags !== undefined) {
    const metaPath = path.join(skillPath, META_FILE);
    let meta;
    try {
      const metaContent = await fs.readFile(metaPath, 'utf-8');
      meta = JSON.parse(metaContent);
    } catch {
      meta = { name, description: '', tags: [], sub_skills: [] };
    }

    if (description !== undefined) meta.description = description;
    if (tags !== undefined) meta.tags = tags;

    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
  }

  // Update SKILL.md if content provided
  if (content !== undefined) {
    await fs.writeFile(path.join(skillPath, SKILL_FILE), content);
  }

  await indexer.reload();

  res.json({ success: true, name });
}));

/**
 * DELETE /api/skills/:name - Delete skill
 */
app.delete('/api/skills/:name', asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params;
  const skillPath = path.join(skillsDir, name);

  try {
    await fs.access(skillPath);
  } catch {
    res.status(404).json({ error: `Skill '${name}' not found` });
    return;
  }

  await fs.rm(skillPath, { recursive: true, force: true });
  await indexer.reload();

  res.json({ success: true, name });
}));

// ============================================================================
// IMPORT API
// ============================================================================

/**
 * POST /api/import/folder - Import skill from folder path
 */
app.post('/api/import/folder', asyncHandler(async (req: Request, res: Response) => {
  const { path: sourcePath, overwrite } = req.body;

  if (!sourcePath) {
    res.status(400).json({ error: 'Path is required' });
    return;
  }

  // Check source exists
  try {
    const stat = await fs.stat(sourcePath);
    if (!stat.isDirectory()) {
      res.status(400).json({ error: 'Path must be a directory' });
      return;
    }
  } catch {
    res.status(400).json({ error: 'Source path not found' });
    return;
  }

  // Determine skill name
  const folderName = path.basename(sourcePath);
  const sanitizedName = sanitizeName(folderName);
  const destPath = path.join(skillsDir, sanitizedName);

  // Check if exists
  try {
    await fs.access(destPath);
    if (!overwrite) {
      res.status(409).json({ error: `Skill '${sanitizedName}' already exists` });
      return;
    }
    await fs.rm(destPath, { recursive: true, force: true });
  } catch {
    // Good, doesn't exist
  }

  // Copy directory
  await copyDir(sourcePath, destPath);

  // Ensure _meta.json exists
  const metaPath = path.join(destPath, META_FILE);
  try {
    await fs.access(metaPath);
  } catch {
    // Create default meta
    const meta = {
      name: sanitizedName,
      description: `Imported from ${folderName}`,
      tags: [],
      sub_skills: [],
      source: 'imported'
    };
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
  }

  const fileCount = await countFiles(destPath);
  await indexer.reload();

  res.json({
    success: true,
    name: sanitizedName,
    path: destPath,
    fileCount
  });
}));

/**
 * POST /api/import/files - Import via multipart file upload
 */
app.post('/api/import/files', upload.array('files'), asyncHandler(async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  const { name } = req.body;

  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No files provided' });
    return;
  }

  if (!name) {
    res.status(400).json({ error: 'Skill name is required' });
    return;
  }

  const sanitizedName = sanitizeName(name);
  const skillPath = path.join(skillsDir, sanitizedName);

  // Create skill directory
  await fs.mkdir(skillPath, { recursive: true });

  // Write files
  for (const file of files) {
    // Security: prevent path traversal
    if (file.originalname.includes('..')) {
      continue;
    }

    const filePath = path.join(skillPath, file.originalname);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, file.buffer);
  }

  // Ensure _meta.json exists
  const metaPath = path.join(skillPath, META_FILE);
  try {
    await fs.access(metaPath);
  } catch {
    const meta = {
      name: sanitizedName,
      description: 'Uploaded skill',
      tags: [],
      sub_skills: [],
      source: 'file-upload'
    };
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
  }

  await indexer.reload();

  res.json({
    success: true,
    name: sanitizedName,
    fileCount: files.length
  });
}));

/**
 * POST /api/import/json - Import via JSON with base64 content
 */
app.post('/api/import/json', asyncHandler(async (req: Request, res: Response) => {
  const { name, files } = req.body;

  if (!name || !files || !Array.isArray(files)) {
    res.status(400).json({ error: 'Name and files array required' });
    return;
  }

  const sanitizedName = sanitizeName(name);
  const skillPath = path.join(skillsDir, sanitizedName);

  // Create skill directory
  await fs.mkdir(skillPath, { recursive: true });

  // Write files
  for (const file of files) {
    // Security: prevent path traversal
    if (file.path.includes('..')) {
      continue;
    }

    const filePath = path.join(skillPath, file.path);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    const content = file.base64
      ? Buffer.from(file.content, 'base64')
      : file.content;
    await fs.writeFile(filePath, content);
  }

  // Ensure _meta.json exists
  const metaPath = path.join(skillPath, META_FILE);
  try {
    await fs.access(metaPath);
  } catch {
    const meta = {
      name: sanitizedName,
      description: 'Imported skill',
      tags: [],
      sub_skills: [],
      source: 'json-upload'
    };
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
  }

  await indexer.reload();

  res.json({
    success: true,
    name: sanitizedName,
    fileCount: files.length
  });
}));

// ============================================================================
// BROWSE API
// ============================================================================

/**
 * GET /api/browse - Browse filesystem
 */
app.get('/api/browse', asyncHandler(async (req: Request, res: Response) => {
  let browsePath = (req.query.path as string) || '';

  // Handle Windows drives
  if (!browsePath || browsePath === '/' || browsePath === '\\') {
    // On Windows, list drive letters
    if (process.platform === 'win32') {
      const drives: string[] = [];
      for (let i = 65; i <= 90; i++) {
        const drive = `${String.fromCharCode(i)}:\\`;
        try {
          await fs.access(drive);
          drives.push(drive);
        } catch {
          // Drive doesn't exist
        }
      }
      res.json({
        path: '',
        parent: null,
        directories: drives.map(d => ({ name: d, path: d })),
        files: []
      });
      return;
    }
    browsePath = '/';
  }

  try {
    const entries = await fs.readdir(browsePath, { withFileTypes: true });

    const directories: Array<{ name: string; path: string; isSkill: boolean }> = [];
    const files: Array<{ name: string; path: string }> = [];

    for (const entry of entries.slice(0, 100)) {
      // Skip hidden files
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(browsePath, entry.name);

      if (entry.isDirectory()) {
        // Check if it's a skill directory
        let isSkill = false;
        try {
          await fs.access(path.join(fullPath, SKILL_FILE));
          isSkill = true;
        } catch {
          // Not a skill
        }

        directories.push({
          name: entry.name,
          path: fullPath,
          isSkill
        });
      } else if (entry.isFile()) {
        files.push({
          name: entry.name,
          path: fullPath
        });
      }
    }

    // Sort
    directories.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      path: browsePath,
      parent: path.dirname(browsePath),
      directories: directories.slice(0, 100),
      files: files.slice(0, 100)
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'EACCES') {
      res.status(403).json({ error: 'Permission denied' });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
}));

// ============================================================================
// CLAUDE CLI API
// ============================================================================

/**
 * GET /api/claude/status - Check Claude CLI availability
 */
app.get('/api/claude/status', asyncHandler(async (_req: Request, res: Response) => {
  const claudePath = await findClaudeCli();

  if (!claudePath) {
    res.json({ available: false, error: 'Claude CLI not found' });
    return;
  }

  try {
    const version = await runCommand(claudePath, ['--version'], 5000);
    res.json({
      available: true,
      path: claudePath,
      version: version.trim()
    });
  } catch (error) {
    res.json({
      available: false,
      path: claudePath,
      error: (error as Error).message
    });
  }
}));

/**
 * POST /api/claude/run - Run a prompt with Claude CLI
 */
app.post('/api/claude/run', asyncHandler(async (req: Request, res: Response) => {
  const { prompt, skillContext } = req.body;

  if (!prompt) {
    res.status(400).json({ error: 'Prompt is required' });
    return;
  }

  const claudePath = await findClaudeCli();
  if (!claudePath) {
    res.status(400).json({ error: 'Claude CLI not found' });
    return;
  }

  let fullPrompt = prompt;
  if (skillContext) {
    fullPrompt = `Context:\n${skillContext}\n\nTask:\n${prompt}`;
  }

  try {
    const result = await runCommand(claudePath, ['-p', fullPrompt], 120000, skillsDir);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
}));

/**
 * POST /api/claude/generate-skill - Generate a new skill with Claude
 */
app.post('/api/claude/generate-skill', asyncHandler(async (req: Request, res: Response) => {
  const { idea } = req.body;

  if (!idea) {
    res.status(400).json({ error: 'Skill idea is required' });
    return;
  }

  const claudePath = await findClaudeCli();
  if (!claudePath) {
    res.status(400).json({ error: 'Claude CLI not found' });
    return;
  }

  const prompt = `Generate a SKILL.md file for a Claude Code skill with the following idea:

${idea}

The file should follow this structure:
---
name: skill-name-here
description: One line description here
---

# Skill Name

## Overview
What this skill helps with.

## When to Use
- Trigger condition 1
- Trigger condition 2

## Quick Start
\`\`\`code
Example usage
\`\`\`

## Best Practices
- Practice 1
- Practice 2

## Examples
Practical examples here.

Return ONLY the SKILL.md content, no additional explanation.`;

  try {
    const result = await runCommand(claudePath, ['-p', prompt], 180000, skillsDir);

    // Parse name and description from frontmatter
    const nameMatch = result.match(/^name:\s*(.+)$/m);
    const descMatch = result.match(/^description:\s*(.+)$/m);

    res.json({
      success: true,
      content: result,
      suggestedName: nameMatch ? nameMatch[1].trim() : null,
      suggestedDescription: descMatch ? descMatch[1].trim() : null
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
}));

/**
 * POST /api/claude/improve-skill - Improve an existing skill with Claude
 */
app.post('/api/claude/improve-skill', asyncHandler(async (req: Request, res: Response) => {
  const { name, request } = req.body;

  if (!name || !request) {
    res.status(400).json({ error: 'Skill name and improvement request required' });
    return;
  }

  const claudePath = await findClaudeCli();
  if (!claudePath) {
    res.status(400).json({ error: 'Claude CLI not found' });
    return;
  }

  // Read current skill content
  const skillPath = path.join(skillsDir, name, SKILL_FILE);
  let currentContent;
  try {
    currentContent = await fs.readFile(skillPath, 'utf-8');
  } catch {
    res.status(404).json({ error: `Skill '${name}' not found` });
    return;
  }

  const prompt = `Here is a SKILL.md file:

\`\`\`
${currentContent}
\`\`\`

Please improve it based on this request:
${request}

Return ONLY the improved SKILL.md content, no additional explanation.`;

  try {
    const result = await runCommand(claudePath, ['-p', prompt], 180000, skillsDir);

    res.json({
      success: true,
      improved: result,
      original: currentContent
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
}));

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function generateDefaultContent(name: string, description: string): string {
  const title = name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return `---
name: ${name}
description: ${description}
---

# ${title}

## Overview

${description}

## When to Use

- [Add trigger conditions here]

## Quick Start

\`\`\`
// Add example code here
\`\`\`

## Best Practices

- [Add best practices here]

## Examples

[Add practical examples here]
`;
}

async function countFiles(dir: string): Promise<number> {
  let count = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += await countFiles(path.join(dir, entry.name));
    } else {
      count++;
    }
  }

  return count;
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function findClaudeCli(): Promise<string | null> {
  const possiblePaths = [
    'claude',
    process.env.HOME ? path.join(process.env.HOME, '.claude', 'claude.exe') : null,
    process.env.HOME ? path.join(process.env.HOME, '.claude', 'local', 'claude.exe') : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.claude', 'claude.exe') : null
  ].filter(Boolean) as string[];

  for (const p of possiblePaths) {
    try {
      await fs.access(p);
      return p;
    } catch {
      // Try next path
    }
  }

  // Try which/where
  try {
    const result = await runCommand(
      process.platform === 'win32' ? 'where' : 'which',
      ['claude'],
      5000
    );
    return result.trim().split('\n')[0];
  } catch {
    return null;
  }
}

function runCommand(cmd: string, args: string[], timeout: number, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      shell: true,
      timeout
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `Process exited with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

// ============================================================================
// ERROR HANDLER
// ============================================================================

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[API Error]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ============================================================================
// START SERVER
// ============================================================================

async function main(): Promise<void> {
  console.error('[Skills API] Starting...');
  console.error(`[Skills API] Skills directory: ${skillsDir}`);

  // Initialize index
  const { skillCount, contentFilesIndexed } = await indexer.reload();
  console.error(`[Skills API] Indexed ${skillCount} skills, ${contentFilesIndexed} content files`);

  // Start file watcher
  const watcher = new FileWatcher(skillsDir, async () => {
    await indexer.reload();
  });
  watcher.start();

  // Start server
  app.listen(API_PORT, () => {
    console.error(`[Skills API] Listening on http://localhost:${API_PORT}`);
  });
}

main().catch((error) => {
  console.error('[Skills API] Fatal error:', error);
  process.exit(1);
});
