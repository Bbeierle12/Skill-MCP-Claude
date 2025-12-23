/**
 * Validator Service
 * Validates skill structure and metadata
 */

import fs from 'fs/promises';
import path from 'path';
import type { ValidationResult } from '../types.js';
import { validateMeta } from '../schemas/meta.js';
import { SKILL_FILE, META_FILE, REFERENCE_DIRS } from '../constants.js';

export class Validator {
  constructor(private skillsDir: string) {}

  /**
   * Validate all skills or a specific skill
   */
  async validate(skillName?: string): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let skillsChecked = 0;

    if (skillName) {
      // Validate single skill
      const result = await this.validateSkill(skillName);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
      skillsChecked = 1;
    } else {
      // Validate all skills
      let entries: string[];
      try {
        entries = await fs.readdir(this.skillsDir);
      } catch (error) {
        return {
          valid: false,
          errors: [`Failed to read skills directory: ${(error as Error).message}`],
          warnings: [],
          skillsChecked: 0
        };
      }

      for (const entry of entries) {
        const entryPath = path.join(this.skillsDir, entry);

        let stat;
        try {
          stat = await fs.stat(entryPath);
        } catch {
          continue;
        }

        if (!stat.isDirectory()) {
          continue;
        }

        const result = await this.validateSkill(entry);
        errors.push(...result.errors);
        warnings.push(...result.warnings);
        skillsChecked++;
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      skillsChecked
    };
  }

  /**
   * Validate a single skill
   */
  private async validateSkill(skillName: string): Promise<{ errors: string[]; warnings: string[] }> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const skillDir = path.join(this.skillsDir, skillName);

    // Check skill directory exists
    try {
      const stat = await fs.stat(skillDir);
      if (!stat.isDirectory()) {
        errors.push(`${skillName}: Not a directory`);
        return { errors, warnings };
      }
    } catch {
      errors.push(`${skillName}: Directory not found`);
      return { errors, warnings };
    }

    // Check _meta.json exists and is valid
    const metaPath = path.join(skillDir, META_FILE);
    let meta;
    try {
      const metaContent = await fs.readFile(metaPath, 'utf-8');
      const metaJson = JSON.parse(metaContent);

      const validation = validateMeta(metaJson);
      if (!validation.success) {
        errors.push(`${skillName}/${META_FILE}: ${validation.error}`);
      } else {
        meta = validation.data;

        // Validate name matches directory
        if (meta.name !== skillName) {
          errors.push(`${skillName}: name field '${meta.name}' doesn't match directory`);
        }
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        errors.push(`${skillName}: Missing ${META_FILE}`);
      } else if (error instanceof SyntaxError) {
        errors.push(`${skillName}/${META_FILE}: Invalid JSON`);
      } else {
        errors.push(`${skillName}/${META_FILE}: ${err.message}`);
      }
    }

    // Check SKILL.md exists
    const skillFilePath = path.join(skillDir, SKILL_FILE);
    try {
      await fs.access(skillFilePath);
    } catch {
      errors.push(`${skillName}: Missing ${SKILL_FILE}`);
    }

    // Validate sub-skill files exist
    if (meta?.sub_skills) {
      for (const sub of meta.sub_skills) {
        const subFilePath = path.join(skillDir, sub.file);
        try {
          await fs.access(subFilePath);
        } catch {
          errors.push(`${skillName}: Sub-skill file not found: ${sub.file}`);
        }
      }
    }

    // Warnings for missing optional content
    if (!meta?.tags || meta.tags.length === 0) {
      warnings.push(`${skillName}: No tags defined (reduces discoverability)`);
    }

    if (!meta?.sub_skills || meta.sub_skills.length === 0) {
      // Check if there's a references directory
      let hasRefs = false;
      for (const refDir of REFERENCE_DIRS) {
        try {
          const refPath = path.join(skillDir, refDir);
          const stat = await fs.stat(refPath);
          if (stat.isDirectory()) {
            hasRefs = true;
            break;
          }
        } catch {
          continue;
        }
      }

      if (hasRefs) {
        warnings.push(`${skillName}: Has reference files but no sub_skills defined in metadata`);
      }
    }

    return { errors, warnings };
  }
}
