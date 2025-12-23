/**
 * Skill Indexer Service
 * Builds and maintains indexes for skill metadata and content
 */

import fs from 'fs/promises';
import path from 'path';
import type { SkillIndex, ContentIndex, ContentIndexEntry, SkillMeta } from '../types.js';
import { validateMeta } from '../schemas/meta.js';
import { SKILL_FILE, META_FILE, REFERENCE_DIRS, SCRIPTS_DIR } from '../constants.js';

export class SkillIndexer {
  private skillIndex: SkillIndex | null = null;
  private contentIndex: ContentIndex | null = null;
  private skillsDir: string;

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
  }

  /**
   * Build skill index from all _meta.json files
   */
  async buildSkillIndex(): Promise<SkillIndex> {
    const skills: SkillMeta[] = [];
    const validationErrors: string[] = [];

    let entries: string[];
    try {
      entries = await fs.readdir(this.skillsDir);
    } catch (error) {
      console.error(`Failed to read skills directory: ${this.skillsDir}`, error);
      return {
        skills: [],
        validationErrors: [`Failed to read skills directory: ${(error as Error).message}`],
        lastUpdated: new Date().toISOString()
      };
    }

    for (const entry of entries) {
      const entryPath = path.join(this.skillsDir, entry);

      // Check if it's a directory
      let stat;
      try {
        stat = await fs.stat(entryPath);
      } catch {
        continue;
      }

      if (!stat.isDirectory()) {
        continue;
      }

      // Read and validate _meta.json
      const metaPath = path.join(entryPath, META_FILE);
      try {
        const metaContent = await fs.readFile(metaPath, 'utf-8');
        const metaJson = JSON.parse(metaContent);

        const validation = validateMeta(metaJson);
        if (!validation.success) {
          validationErrors.push(`${entry}: ${validation.error}`);
          continue;
        }

        // Validate name matches directory
        if (validation.data.name !== entry) {
          validationErrors.push(
            `${entry}: name field '${validation.data.name}' doesn't match directory name`
          );
        }

        skills.push(validation.data);
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') {
          validationErrors.push(`${entry}: Missing ${META_FILE}`);
        } else if (error instanceof SyntaxError) {
          validationErrors.push(`${entry}: Invalid JSON in ${META_FILE}`);
        } else {
          validationErrors.push(`${entry}: ${err.message}`);
        }
      }
    }

    this.skillIndex = {
      skills,
      validationErrors,
      lastUpdated: new Date().toISOString()
    };

    console.error(`Indexed ${skills.length} skills with ${validationErrors.length} errors`);
    return this.skillIndex;
  }

  /**
   * Build content index for full-text search
   */
  async buildContentIndex(): Promise<ContentIndex> {
    const index: ContentIndex = {};

    let entries: string[];
    try {
      entries = await fs.readdir(this.skillsDir);
    } catch {
      this.contentIndex = index;
      return index;
    }

    for (const entry of entries) {
      const skillDir = path.join(this.skillsDir, entry);

      // Check if it's a directory
      let stat;
      try {
        stat = await fs.stat(skillDir);
      } catch {
        continue;
      }

      if (!stat.isDirectory()) {
        continue;
      }

      // Index SKILL.md
      await this.indexFile(index, entry, null, SKILL_FILE, skillDir);

      // Index references directories (handles both 'references' and 'reference')
      for (const refDir of REFERENCE_DIRS) {
        await this.indexDirectory(index, entry, skillDir, refDir, '.md');
      }

      // Index scripts/*.md files
      await this.indexDirectory(index, entry, skillDir, SCRIPTS_DIR, '.md');
    }

    this.contentIndex = index;
    console.error(`Content indexed ${Object.keys(index).length} files`);
    return index;
  }

  /**
   * Index a single file
   */
  private async indexFile(
    index: ContentIndex,
    domain: string,
    subSkill: string | null,
    fileName: string,
    baseDir: string
  ): Promise<void> {
    const filePath = path.join(baseDir, fileName);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const key = `${domain}:${fileName}`;

      // Extract headings for ranking boost
      const headings = content.match(/^#{1,3}\s+.+$/gm) || [];

      const entry: ContentIndexEntry = {
        domain,
        subSkill,
        file: fileName,
        content: content.toLowerCase(),
        wordCount: content.split(/\s+/).length,
        headings: headings.map(h => h.replace(/^#+\s+/, '').toLowerCase())
      };

      index[key] = entry;
    } catch {
      // File doesn't exist, skip silently
    }
  }

  /**
   * Index all matching files in a directory
   */
  private async indexDirectory(
    index: ContentIndex,
    domain: string,
    skillDir: string,
    subDir: string,
    extension: string
  ): Promise<void> {
    const dirPath = path.join(skillDir, subDir);

    let files: string[];
    try {
      files = await fs.readdir(dirPath);
    } catch {
      return; // Directory doesn't exist
    }

    for (const file of files) {
      if (!file.endsWith(extension)) {
        continue;
      }

      const subSkillName = file.replace(extension, '');
      const relativePath = `${subDir}/${file}`;

      await this.indexFile(index, domain, subSkillName, relativePath, skillDir);
    }
  }

  /**
   * Get skill index (lazy load if needed)
   */
  async getSkillIndex(): Promise<SkillIndex> {
    if (!this.skillIndex) {
      await this.buildSkillIndex();
    }
    return this.skillIndex!;
  }

  /**
   * Get content index (lazy load if needed)
   */
  async getContentIndex(): Promise<ContentIndex> {
    if (!this.contentIndex) {
      await this.buildContentIndex();
    }
    return this.contentIndex!;
  }

  /**
   * Reload both indexes from disk
   */
  async reload(): Promise<{ skillCount: number; contentFilesIndexed: number }> {
    await this.buildSkillIndex();
    await this.buildContentIndex();

    return {
      skillCount: this.skillIndex!.skills.length,
      contentFilesIndexed: Object.keys(this.contentIndex!).length
    };
  }

  /**
   * Get a specific skill's metadata
   */
  async getSkillMeta(name: string): Promise<SkillMeta | null> {
    const index = await this.getSkillIndex();
    return index.skills.find(s => s.name === name) || null;
  }

  /**
   * Check if a skill exists
   */
  async skillExists(name: string): Promise<boolean> {
    const skillDir = path.join(this.skillsDir, name);
    try {
      const stat = await fs.stat(skillDir);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Read a skill's SKILL.md content
   */
  async readSkillContent(name: string): Promise<string | null> {
    const filePath = path.join(this.skillsDir, name, SKILL_FILE);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Read a sub-skill's content
   */
  async readSubSkillContent(domain: string, subSkill: string): Promise<string | null> {
    const meta = await this.getSkillMeta(domain);
    if (!meta) return null;

    const subMeta = meta.sub_skills?.find(s => s.name === subSkill);
    if (!subMeta) return null;

    const filePath = path.join(this.skillsDir, domain, subMeta.file);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Check if skill has references directory
   */
  async hasReferences(name: string): Promise<boolean> {
    for (const refDir of REFERENCE_DIRS) {
      const dirPath = path.join(this.skillsDir, name, refDir);
      try {
        const stat = await fs.stat(dirPath);
        if (stat.isDirectory()) return true;
      } catch {
        continue;
      }
    }
    return false;
  }
}
