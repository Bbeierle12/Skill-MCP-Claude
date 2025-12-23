/**
 * Response formatting utilities
 */

import type { SkillMeta, SearchResult, UsageStats, ValidationResult, SkillContent, SubSkillContent } from '../types.js';
import { CHARACTER_LIMIT } from '../constants.js';

/**
 * Format skill list as markdown
 */
export function formatSkillListMarkdown(skills: SkillMeta[]): string {
  if (skills.length === 0) {
    return 'No skills found.';
  }

  const lines: string[] = [
    `# Available Skills (${skills.length})`,
    ''
  ];

  for (const skill of skills) {
    lines.push(`## ${skill.name}`);
    lines.push(`${skill.description}`);

    if (skill.tags && skill.tags.length > 0) {
      lines.push(`**Tags**: ${skill.tags.join(', ')}`);
    }

    if (skill.sub_skills && skill.sub_skills.length > 0) {
      lines.push(`**Sub-skills**: ${skill.sub_skills.map(s => s.name).join(', ')}`);
    }

    lines.push('');
  }

  return truncateIfNeeded(lines.join('\n'));
}

/**
 * Format skill content as markdown
 */
export function formatSkillContentMarkdown(skill: SkillContent): string {
  const lines: string[] = [];

  if (skill.subSkills.length > 0) {
    lines.push(`*Available sub-skills: ${skill.subSkills.join(', ')}*`);
    lines.push('');
  }

  lines.push(skill.content);

  return truncateIfNeeded(lines.join('\n'));
}

/**
 * Format sub-skill content as markdown
 */
export function formatSubSkillContentMarkdown(subSkill: SubSkillContent): string {
  const lines: string[] = [
    `*Domain: ${subSkill.domain} > ${subSkill.subSkill}*`,
    '',
    subSkill.content
  ];

  return truncateIfNeeded(lines.join('\n'));
}

/**
 * Format search results as markdown
 */
export function formatSearchResultsMarkdown(query: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return `No results found for "${query}".`;
  }

  const lines: string[] = [
    `# Search Results: "${query}"`,
    `Found ${results.length} matches.`,
    ''
  ];

  for (const result of results) {
    const location = result.subSkill
      ? `${result.domain} > ${result.subSkill}`
      : result.domain;

    lines.push(`## ${location}`);
    lines.push(`**Score**: ${result.score.toFixed(3)} | **Match**: ${result.matchType}`);

    if (result.file) {
      lines.push(`**File**: ${result.file}`);
    }

    if (result.snippet) {
      lines.push(`> ${result.snippet}`);
    }

    lines.push('');
  }

  return truncateIfNeeded(lines.join('\n'));
}

/**
 * Format usage stats as markdown
 */
export function formatStatsMarkdown(stats: UsageStats, skillCount: number, contentFilesIndexed: number): string {
  const lines: string[] = [
    '# Skills Server Statistics',
    '',
    '## Overview',
    `- **Uptime since**: ${stats.startTime}`,
    `- **Skills indexed**: ${skillCount}`,
    `- **Content files indexed**: ${contentFilesIndexed}`,
    ''
  ];

  // Tool calls
  const toolCalls = Object.entries(stats.toolCalls).sort((a, b) => b[1] - a[1]);
  if (toolCalls.length > 0) {
    lines.push('## Tool Usage');
    for (const [tool, count] of toolCalls) {
      lines.push(`- **${tool}**: ${count} calls`);
    }
    lines.push('');
  }

  // Skill loads
  const skillLoads = Object.entries(stats.skillLoads).sort((a, b) => b[1] - a[1]);
  if (skillLoads.length > 0) {
    lines.push('## Most Loaded Skills');
    for (const [skill, count] of skillLoads.slice(0, 10)) {
      lines.push(`- **${skill}**: ${count} loads`);
    }
    lines.push('');
  }

  // Recent searches
  if (stats.searches.length > 0) {
    lines.push('## Recent Searches');
    for (const search of stats.searches.slice(-10).reverse()) {
      lines.push(`- "${search.query}" (${search.resultCount} results)`);
    }
  }

  return lines.join('\n');
}

/**
 * Format validation results as markdown
 */
export function formatValidationMarkdown(result: ValidationResult): string {
  const lines: string[] = [
    '# Skill Validation Results',
    '',
    `**Status**: ${result.valid ? '✓ All valid' : '✗ Issues found'}`,
    `**Skills checked**: ${result.skillsChecked}`,
    ''
  ];

  if (result.errors.length > 0) {
    lines.push('## Errors');
    for (const error of result.errors) {
      lines.push(`- ✗ ${error}`);
    }
    lines.push('');
  }

  if (result.warnings.length > 0) {
    lines.push('## Warnings');
    for (const warning of result.warnings) {
      lines.push(`- ⚠ ${warning}`);
    }
  }

  if (result.errors.length === 0 && result.warnings.length === 0) {
    lines.push('No issues found.');
  }

  return lines.join('\n');
}

/**
 * Truncate content if it exceeds CHARACTER_LIMIT
 */
export function truncateIfNeeded(content: string): string {
  if (content.length <= CHARACTER_LIMIT) {
    return content;
  }

  const truncated = content.slice(0, CHARACTER_LIMIT - 100);
  const lastNewline = truncated.lastIndexOf('\n');

  const finalContent = lastNewline > CHARACTER_LIMIT * 0.8
    ? truncated.slice(0, lastNewline)
    : truncated;

  return finalContent + '\n\n---\n*[Content truncated due to size limit]*';
}
