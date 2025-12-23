/**
 * File Watcher Service
 * Watches skills directory for changes and triggers index reload
 */

import chokidar from 'chokidar';
import { EventEmitter } from 'events';
import path from 'path';
import { FILE_WATCHER_DEBOUNCE_MS, SKILL_FILE, META_FILE } from '../constants.js';

export interface FileWatcherEvents {
  reloaded: () => void;
  error: (error: Error) => void;
}

export class FileWatcher extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(
    private skillsDir: string,
    private onReload: () => Promise<void>
  ) {
    super();
  }

  /**
   * Start watching the skills directory
   */
  start(): void {
    if (this.watcher) {
      console.error('File watcher already running');
      return;
    }

    this.watcher = chokidar.watch(this.skillsDir, {
      ignored: [
        /(^|[/\\])\../, // Ignore dotfiles
        /node_modules/,
        /\.git/,
        /dist/,
        /__pycache__/
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      },
      depth: 3 // Only watch up to 3 levels deep
    });

    const handleChange = (eventPath: string, eventType: string) => {
      if (this.isRelevantFile(eventPath)) {
        console.error(`[FileWatcher] ${eventType}: ${path.relative(this.skillsDir, eventPath)}`);
        this.debouncedReload();
      }
    };

    this.watcher
      .on('add', (p) => handleChange(p, 'add'))
      .on('change', (p) => handleChange(p, 'change'))
      .on('unlink', (p) => handleChange(p, 'unlink'))
      .on('addDir', (p) => handleChange(p, 'addDir'))
      .on('unlinkDir', (p) => handleChange(p, 'unlinkDir'))
      .on('error', (error) => {
        console.error('[FileWatcher] Error:', error);
        this.emit('error', error);
      });

    console.error(`[FileWatcher] Started watching: ${this.skillsDir}`);
  }

  /**
   * Check if a file change is relevant to the skill index
   */
  private isRelevantFile(filePath: string): boolean {
    const basename = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // Always relevant: _meta.json and SKILL.md
    if (basename === META_FILE || basename === SKILL_FILE) {
      return true;
    }

    // Relevant: .md files (sub-skills, references)
    if (ext === '.md') {
      return true;
    }

    // Relevant: directory changes (new/deleted skills)
    if (!ext) {
      return true;
    }

    return false;
  }

  /**
   * Debounced reload to prevent rapid successive reloads
   */
  private debouncedReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      console.error('[FileWatcher] Changes detected, reloading index...');
      try {
        await this.onReload();
        this.emit('reloaded');
        console.error('[FileWatcher] Index reloaded successfully');
      } catch (error) {
        console.error('[FileWatcher] Reload error:', error);
        this.emit('error', error as Error);
      }
    }, FILE_WATCHER_DEBOUNCE_MS);
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    console.error('[FileWatcher] Stopped');
  }

  /**
   * Check if watcher is running
   */
  isRunning(): boolean {
    return this.watcher !== null;
  }
}
