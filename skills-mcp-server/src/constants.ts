/**
 * Shared constants for the Skills MCP Server
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Maximum response size in characters to prevent context overflow */
export const CHARACTER_LIMIT = 50000;

/** Maximum batch request size */
export const MAX_BATCH_SIZE = 20;

/** Default skills directory - can be overridden via SKILLS_DIR env var */
export const DEFAULT_SKILLS_DIR = path.resolve(__dirname, '..', '..', 'skills');

/** Get the skills directory, checking env var first */
export function getSkillsDir(): string {
  return process.env.SKILLS_DIR || DEFAULT_SKILLS_DIR;
}

/** Express API port */
export const API_PORT = parseInt(process.env.API_PORT || '5050', 10);

/** File watcher debounce time in milliseconds */
export const FILE_WATCHER_DEBOUNCE_MS = 500;

/** Maximum search results */
export const MAX_SEARCH_RESULTS = 50;

/** Default search limit */
export const DEFAULT_SEARCH_LIMIT = 10;

/** Maximum recent searches to keep in stats */
export const MAX_RECENT_SEARCHES = 100;

/** Skill file names */
export const SKILL_FILE = 'SKILL.md';
export const META_FILE = '_meta.json';

/** Valid reference directory names */
export const REFERENCE_DIRS = ['references', 'reference'];

/** Scripts directory name */
export const SCRIPTS_DIR = 'scripts';
