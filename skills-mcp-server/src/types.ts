/**
 * TypeScript type definitions for the Skills MCP Server
 */

/**
 * Sub-skill metadata from _meta.json
 */
export interface SubSkillMeta {
  /** Sub-skill name (e.g., "validation", "react") */
  name: string;
  /** Relative file path (e.g., "references/validation.md") */
  file: string;
  /** Trigger words for search discovery */
  triggers?: string[];
}

/**
 * Skill metadata from _meta.json
 */
export interface SkillMeta {
  /** Skill name matching directory name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Tags for search discovery */
  tags?: string[];
  /** Sub-skills for router/parent skills */
  sub_skills?: SubSkillMeta[];
  /** Source of the skill (e.g., "imported", "claude-examples") */
  source?: string;
}

/**
 * Skill index containing all loaded skills
 */
export interface SkillIndex {
  /** Array of all skill metadata */
  skills: SkillMeta[];
  /** Validation errors encountered during loading */
  validationErrors: string[];
  /** ISO timestamp of last index update */
  lastUpdated: string;
}

/**
 * Content index entry for full-text search
 */
export interface ContentIndexEntry {
  /** Parent skill domain */
  domain: string;
  /** Sub-skill name (null for main SKILL.md) */
  subSkill: string | null;
  /** Relative file path */
  file: string;
  /** Lowercased content for search */
  content: string;
  /** Word count for TF-IDF */
  wordCount: number;
  /** Extracted headings for ranking boost */
  headings: string[];
}

/**
 * Full content index keyed by "domain:file"
 */
export interface ContentIndex {
  [key: string]: ContentIndexEntry;
}

/**
 * Search result with relevance scoring
 */
export interface SearchResult {
  /** Skill domain name */
  domain: string;
  /** Sub-skill name (null for domain match) */
  subSkill: string | null;
  /** Relevance score (0-1+) */
  score: number;
  /** Type of match found */
  matchType: 'name' | 'description' | 'tags' | 'triggers' | 'content';
  /** Content snippet (for full-text search) */
  snippet?: string;
  /** File path (for full-text search) */
  file?: string;
}

/**
 * Search query entry for stats tracking
 */
export interface SearchEntry {
  /** Search query string */
  query: string;
  /** ISO timestamp */
  timestamp: string;
  /** Number of results returned */
  resultCount: number;
}

/**
 * Usage statistics
 */
export interface UsageStats {
  /** Tool call counts by tool name */
  toolCalls: Record<string, number>;
  /** Skill load counts by domain */
  skillLoads: Record<string, number>;
  /** Recent search queries */
  searches: SearchEntry[];
  /** Server start time (ISO timestamp) */
  startTime: string;
}

/**
 * Validation result for skill structure
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Critical errors */
  errors: string[];
  /** Non-critical warnings */
  warnings: string[];
  /** Number of skills checked */
  skillsChecked: number;
}

/**
 * Response format options
 */
export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json'
}

/**
 * Skill template options for creation
 */
export enum SkillTemplate {
  MINIMAL = 'minimal',
  STANDARD = 'standard',
  WITH_SUB_SKILLS = 'with-sub-skills'
}

/**
 * Service context passed to tools
 */
export interface ServiceContext {
  /** Skill indexer service */
  indexer: {
    getSkillIndex(): Promise<SkillIndex>;
    getContentIndex(): Promise<ContentIndex>;
    reload(): Promise<{ skillCount: number; contentFilesIndexed: number }>;
    skillExists(name: string): Promise<boolean>;
    getSkillMeta(name: string): Promise<SkillMeta | null>;
    readSkillContent(name: string): Promise<string | null>;
    readSubSkillContent(domain: string, subSkill: string): Promise<string | null>;
    hasReferences(name: string): Promise<boolean>;
  };
  /** Search service */
  search: {
    searchSkills(query: string, limit?: number): Promise<SearchResult[]>;
    searchContent(query: string, limit?: number): Promise<SearchResult[]>;
  };
  /** Stats tracker service */
  stats: {
    trackToolCall(toolName: string): void;
    trackSkillLoad(domain: string): void;
    trackSearch(query: string, resultCount: number): void;
    getStats(): UsageStats;
  };
  /** Skills directory path */
  skillsDir: string;
}

/**
 * Skill content returned by get operations
 */
export interface SkillContent {
  /** Skill name */
  name: string;
  /** SKILL.md content */
  content: string;
  /** Available sub-skills */
  subSkills: string[];
  /** Whether skill has reference files */
  hasReferences: boolean;
}

/**
 * Sub-skill content returned by get_sub operations
 */
export interface SubSkillContent {
  /** Parent domain */
  domain: string;
  /** Sub-skill name */
  subSkill: string;
  /** File content */
  content: string;
}

/**
 * Batch request item
 */
export interface BatchRequest {
  /** Skill domain */
  domain: string;
  /** Sub-skill name (null for main skill) */
  subSkill?: string | null;
}

/**
 * Error response structure
 */
export interface ErrorResponse {
  /** Error message */
  error: string;
}
