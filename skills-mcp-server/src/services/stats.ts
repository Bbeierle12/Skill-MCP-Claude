/**
 * Stats Tracker Service
 * Tracks usage statistics for the skills server
 */

import type { UsageStats, SearchEntry } from '../types.js';
import { MAX_RECENT_SEARCHES } from '../constants.js';

export class StatsTracker {
  private stats: UsageStats;

  constructor() {
    this.stats = {
      toolCalls: {},
      skillLoads: {},
      searches: [],
      startTime: new Date().toISOString()
    };
  }

  /**
   * Track a tool call
   */
  trackToolCall(toolName: string): void {
    if (!this.stats.toolCalls[toolName]) {
      this.stats.toolCalls[toolName] = 0;
    }
    this.stats.toolCalls[toolName]++;
  }

  /**
   * Track a skill load
   */
  trackSkillLoad(domain: string): void {
    if (!this.stats.skillLoads[domain]) {
      this.stats.skillLoads[domain] = 0;
    }
    this.stats.skillLoads[domain]++;
  }

  /**
   * Track a search query
   */
  trackSearch(query: string, resultCount: number): void {
    const entry: SearchEntry = {
      query,
      timestamp: new Date().toISOString(),
      resultCount
    };

    this.stats.searches.push(entry);

    // Keep only the most recent searches
    if (this.stats.searches.length > MAX_RECENT_SEARCHES) {
      this.stats.searches = this.stats.searches.slice(-MAX_RECENT_SEARCHES);
    }
  }

  /**
   * Get current statistics
   */
  getStats(): UsageStats {
    return {
      ...this.stats,
      // Return a copy of arrays/objects to prevent mutation
      toolCalls: { ...this.stats.toolCalls },
      skillLoads: { ...this.stats.skillLoads },
      searches: [...this.stats.searches]
    };
  }

  /**
   * Get uptime in seconds
   */
  getUptimeSeconds(): number {
    const start = new Date(this.stats.startTime);
    const now = new Date();
    return Math.floor((now.getTime() - start.getTime()) / 1000);
  }

  /**
   * Get total tool calls
   */
  getTotalToolCalls(): number {
    return Object.values(this.stats.toolCalls).reduce((sum, count) => sum + count, 0);
  }

  /**
   * Get total skill loads
   */
  getTotalSkillLoads(): number {
    return Object.values(this.stats.skillLoads).reduce((sum, count) => sum + count, 0);
  }

  /**
   * Get most used tools (sorted)
   */
  getMostUsedTools(limit: number = 10): Array<{ tool: string; count: number }> {
    return Object.entries(this.stats.toolCalls)
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Get most loaded skills (sorted)
   */
  getMostLoadedSkills(limit: number = 10): Array<{ skill: string; count: number }> {
    return Object.entries(this.stats.skillLoads)
      .map(([skill, count]) => ({ skill, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Reset statistics
   */
  reset(): void {
    this.stats = {
      toolCalls: {},
      skillLoads: {},
      searches: [],
      startTime: new Date().toISOString()
    };
  }
}
