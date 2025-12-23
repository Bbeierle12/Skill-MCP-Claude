/**
 * Search Service
 * Provides metadata and full-text search across skills
 */

import type { SearchResult } from '../types.js';
import type { SkillIndexer } from './indexer.js';
import { extractSnippet } from '../utils/snippet.js';

export class SearchService {
  constructor(private indexer: SkillIndexer) {}

  /**
   * Search skills by metadata (name, description, tags, triggers)
   */
  async searchSkills(query: string, limit: number = 10): Promise<SearchResult[]> {
    const index = await this.indexer.getSkillIndex();
    const queryLower = query.toLowerCase().trim();
    const results: SearchResult[] = [];

    for (const skill of index.skills) {
      // Check domain-level matches with scoring
      let score = 0;
      let matchType: SearchResult['matchType'] = 'name';

      const nameLower = skill.name.toLowerCase();
      const descLower = skill.description.toLowerCase();

      // Name match (highest for exact, high for partial)
      if (nameLower === queryLower) {
        score = 1.0;
        matchType = 'name';
      } else if (nameLower.includes(queryLower)) {
        score = 0.9;
        matchType = 'name';
      }
      // Description match
      else if (descLower.includes(queryLower)) {
        score = 0.7;
        matchType = 'description';
      }
      // Tags match
      else if (skill.tags?.some(t => t.toLowerCase().includes(queryLower))) {
        score = 0.8;
        matchType = 'tags';
      }

      if (score > 0) {
        results.push({
          domain: skill.name,
          subSkill: null,
          score,
          matchType
        });
      }

      // Check sub-skills
      for (const sub of skill.sub_skills || []) {
        let subScore = 0;
        let subMatchType: SearchResult['matchType'] = 'name';

        const subNameLower = sub.name.toLowerCase();

        if (subNameLower === queryLower) {
          subScore = 0.95;
          subMatchType = 'name';
        } else if (subNameLower.includes(queryLower)) {
          subScore = 0.85;
          subMatchType = 'name';
        } else if (sub.triggers?.some(t => t.toLowerCase().includes(queryLower))) {
          subScore = 0.9;
          subMatchType = 'triggers';
        }

        if (subScore > 0) {
          results.push({
            domain: skill.name,
            subSkill: sub.name,
            score: subScore,
            matchType: subMatchType
          });
        }
      }
    }

    // Sort by score descending, then by domain name
    return results
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.domain.localeCompare(b.domain);
      })
      .slice(0, limit);
  }

  /**
   * Full-text content search with improved ranking
   */
  async searchContent(query: string, limit: number = 10): Promise<SearchResult[]> {
    const contentIndex = await this.indexer.getContentIndex();
    const queryLower = query.toLowerCase().trim();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    const results: SearchResult[] = [];

    for (const [_key, entry] of Object.entries(contentIndex)) {
      let score = 0;

      // Exact phrase match (highest priority)
      if (entry.content.includes(queryLower)) {
        score = 1.0;

        // Boost for matches in headings
        if (entry.headings.some(h => h.includes(queryLower))) {
          score = 1.3;
        }
        // Boost for matches in first 500 chars (intro/overview)
        else if (entry.content.slice(0, 500).includes(queryLower)) {
          score = 1.2;
        }
      }
      // All words present (medium priority)
      else if (queryWords.length > 0 && queryWords.every(w => entry.content.includes(w))) {
        score = 0.7;

        // Frequency bonus (more occurrences = higher score)
        const matches = queryWords.reduce((sum, w) => {
          const regex = new RegExp(escapeRegex(w), 'g');
          return sum + (entry.content.match(regex)?.length || 0);
        }, 0);
        score += Math.min(matches * 0.03, 0.2);

        // Heading bonus
        if (queryWords.some(w => entry.headings.some(h => h.includes(w)))) {
          score += 0.1;
        }
      }
      // Partial word matches (lower priority)
      else if (queryWords.length > 0) {
        const matchCount = queryWords.filter(w => entry.content.includes(w)).length;
        if (matchCount > 0) {
          score = 0.3 * (matchCount / queryWords.length);
        }
      }

      if (score > 0) {
        results.push({
          domain: entry.domain,
          subSkill: entry.subSkill,
          score: Math.round(score * 1000) / 1000,
          matchType: 'content',
          snippet: extractSnippet(entry.content, queryLower, 150),
          file: entry.file
        });
      }
    }

    // Sort by score descending
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
