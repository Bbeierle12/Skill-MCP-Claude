/**
 * CleanupScheduler - Automated cleanup of decayed structures
 * 
 * Server-side system for managing abandoned structure removal,
 * with configurable thresholds, batch processing, and notifications.
 * 
 * Usage:
 *   const cleanup = new CleanupScheduler({ decayManager });
 *   cleanup.tick(Date.now()); // Called from server loop
 *   const stats = cleanup.getStatistics();
 */

/**
 * Cleanup strategies
 */
export const CleanupStrategy = {
  IMMEDIATE: 'immediate',     // Remove as soon as threshold hit
  BATCHED: 'batched',         // Process in batches at intervals
  SCHEDULED: 'scheduled'      // Run at specific times
};

export class CleanupScheduler {
  /**
   * Create cleanup scheduler
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.decayManager = options.decayManager;
    this.strategy = options.strategy ?? CleanupStrategy.BATCHED;
    
    // Timing
    this.cleanupInterval = options.cleanupInterval ?? 60 * 60 * 1000; // 1 hour
    this.lastCleanup = 0;
    
    // Thresholds
    this.destroyThreshold = options.destroyThreshold ?? 0; // Health % to destroy
    this.warnThreshold = options.warnThreshold ?? 25;
    this.criticalThreshold = options.criticalThreshold ?? 10;
    
    // Batch processing
    this.batchSize = options.batchSize ?? 100;
    this.maxBatchTime = options.maxBatchTime ?? 50; // Max ms per batch
    
    // Tracking
    this.totalCleaned = 0;
    this.cleanupHistory = [];
    this.maxHistorySize = options.maxHistorySize ?? 100;
    this.pendingWarnings = new Map();
    
    // Callbacks
    this.onCleanup = options.onCleanup ?? null;
    this.onWarning = options.onWarning ?? null;
    this.onCritical = options.onCritical ?? null;
    this.onBatchComplete = options.onBatchComplete ?? null;
  }

  /**
   * Main tick - call from server loop
   * @param {number} currentTime - Current timestamp
   * @returns {Object} Tick results
   */
  tick(currentTime) {
    if (!this.decayManager) {
      return { ran: false, reason: 'No decay manager configured' };
    }

    const elapsed = currentTime - this.lastCleanup;

    if (elapsed < this.cleanupInterval) {
      return { 
        ran: false, 
        reason: 'Interval not reached', 
        nextIn: this.cleanupInterval - elapsed 
      };
    }

    this.lastCleanup = currentTime;
    return this.runCleanup();
  }

  /**
   * Execute cleanup pass
   * @returns {Object} Cleanup results
   */
  runCleanup() {
    const startTime = performance.now();
    const results = {
      ran: true,
      timestamp: Date.now(),
      destroyed: [],
      warned: [],
      critical: [],
      processed: 0,
      batchesRun: 0,
      timeSpent: 0
    };

    let processed = 0;
    let batchStart = performance.now();

    for (const [id, data] of this.decayManager.pieces) {
      // Check batch limits
      if (processed >= this.batchSize) {
        results.batchesRun++;
        
        // Check time limit
        if (performance.now() - startTime > this.maxBatchTime) {
          break;
        }
        
        processed = 0;
        batchStart = performance.now();
      }

      const piece = data.piece;
      const maxHealth = piece.maxHealth ?? 100;
      const health = piece.health ?? maxHealth;
      const healthPercent = (health / maxHealth) * 100;

      if (healthPercent <= this.destroyThreshold) {
        results.destroyed.push({
          id: piece.id,
          position: piece.position?.clone(),
          material: piece.material?.name,
          structureId: piece.structureId
        });
      } else if (healthPercent <= this.criticalThreshold) {
        results.critical.push(piece);
      } else if (healthPercent <= this.warnThreshold) {
        results.warned.push(piece);
      }

      processed++;
      results.processed++;
    }

    // Execute destruction
    for (const destroyed of results.destroyed) {
      this.decayManager.removePiece(destroyed.id);
      this.totalCleaned++;
    }

    results.timeSpent = performance.now() - startTime;

    // Record history
    this.recordHistory(results);

    // Fire callbacks
    this.fireCallbacks(results);

    return results;
  }

  /**
   * Force immediate cleanup of specific structure
   * @param {string} structureId - Structure to clean up
   * @returns {Object} Cleanup results
   */
  forceCleanupStructure(structureId) {
    if (!this.decayManager) {
      return { success: false, reason: 'No decay manager' };
    }

    const toRemove = [];

    for (const [id, data] of this.decayManager.pieces) {
      if (data.piece.structureId === structureId) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      this.decayManager.removePiece(id);
      this.totalCleaned++;
    }

    this.recordHistory({
      ran: true,
      timestamp: Date.now(),
      destroyed: toRemove.map(id => ({ id, structureId })),
      warned: [],
      critical: [],
      processed: toRemove.length,
      forced: true
    });

    return { 
      success: true, 
      removed: toRemove.length, 
      structureId 
    };
  }

  /**
   * Force cleanup of all pieces below threshold
   * @param {number} healthThreshold - Health percentage threshold
   * @returns {Object} Cleanup results
   */
  forceCleanupBelow(healthThreshold) {
    if (!this.decayManager) {
      return { success: false, reason: 'No decay manager' };
    }

    const toRemove = [];

    for (const [id, data] of this.decayManager.pieces) {
      const piece = data.piece;
      const maxHealth = piece.maxHealth ?? 100;
      const healthPercent = ((piece.health ?? maxHealth) / maxHealth) * 100;

      if (healthPercent <= healthThreshold) {
        toRemove.push({
          id,
          healthPercent,
          position: piece.position?.clone()
        });
      }
    }

    for (const item of toRemove) {
      this.decayManager.removePiece(item.id);
      this.totalCleaned++;
    }

    this.recordHistory({
      ran: true,
      timestamp: Date.now(),
      destroyed: toRemove,
      warned: [],
      critical: [],
      processed: toRemove.length,
      forced: true,
      threshold: healthThreshold
    });

    return {
      success: true,
      removed: toRemove.length,
      threshold: healthThreshold
    };
  }

  /**
   * Record cleanup in history
   */
  recordHistory(results) {
    this.cleanupHistory.push({
      timestamp: results.timestamp,
      destroyed: results.destroyed.length,
      warned: results.warned.length,
      critical: results.critical.length,
      processed: results.processed,
      forced: results.forced ?? false
    });

    // Trim history
    while (this.cleanupHistory.length > this.maxHistorySize) {
      this.cleanupHistory.shift();
    }
  }

  /**
   * Fire appropriate callbacks
   */
  fireCallbacks(results) {
    if (results.destroyed.length > 0 && this.onCleanup) {
      this.onCleanup(results.destroyed);
    }

    if (results.warned.length > 0 && this.onWarning) {
      // Group by owner for notifications
      const byOwner = this.groupByOwner(results.warned);
      for (const [ownerId, pieces] of Object.entries(byOwner)) {
        this.onWarning(ownerId, pieces);
      }
    }

    if (results.critical.length > 0 && this.onCritical) {
      const byOwner = this.groupByOwner(results.critical);
      for (const [ownerId, pieces] of Object.entries(byOwner)) {
        this.onCritical(ownerId, pieces);
      }
    }

    if (this.onBatchComplete) {
      this.onBatchComplete(results);
    }
  }

  /**
   * Group pieces by owner
   */
  groupByOwner(pieces) {
    const grouped = {};

    for (const piece of pieces) {
      const ownerId = piece.ownerId ?? piece.structureId ?? 'unknown';
      if (!grouped[ownerId]) {
        grouped[ownerId] = [];
      }
      grouped[ownerId].push(piece);
    }

    return grouped;
  }

  /**
   * Get comprehensive statistics
   * @returns {Object} Statistics
   */
  getStatistics() {
    if (!this.decayManager) {
      return { error: 'No decay manager configured' };
    }

    const stats = {
      totalTracked: 0,
      totalCleaned: this.totalCleaned,
      byHealthState: {
        healthy: 0,
        damaged: 0,
        critical: 0,
        failing: 0
      },
      byMaterial: {},
      protectedCount: 0,
      unprotectedCount: 0,
      averageHealth: 0,
      lowestHealth: 100,
      cleanupHistory: this.getHistorySummary()
    };

    let totalHealth = 0;

    for (const [id, data] of this.decayManager.pieces) {
      const piece = data.piece;
      const maxHealth = piece.maxHealth ?? 100;
      const health = piece.health ?? maxHealth;
      const healthPercent = (health / maxHealth) * 100;

      stats.totalTracked++;
      totalHealth += healthPercent;
      stats.lowestHealth = Math.min(stats.lowestHealth, healthPercent);

      // By health state
      if (healthPercent > 75) stats.byHealthState.healthy++;
      else if (healthPercent > 50) stats.byHealthState.damaged++;
      else if (healthPercent > 25) stats.byHealthState.critical++;
      else stats.byHealthState.failing++;

      // By material
      const material = piece.material?.name ?? 'Unknown';
      stats.byMaterial[material] = (stats.byMaterial[material] ?? 0) + 1;

      // Protected status
      if (this.decayManager.isPieceProtected(piece)) {
        stats.protectedCount++;
      } else {
        stats.unprotectedCount++;
      }
    }

    stats.averageHealth = stats.totalTracked > 0 
      ? totalHealth / stats.totalTracked 
      : 0;

    return stats;
  }

  /**
   * Get history summary
   */
  getHistorySummary() {
    const recent = this.cleanupHistory.slice(-10);
    
    return {
      totalRuns: this.cleanupHistory.length,
      recentRuns: recent,
      totalDestroyed: this.cleanupHistory.reduce((sum, h) => sum + h.destroyed, 0),
      averageDestroyed: this.cleanupHistory.length > 0
        ? this.cleanupHistory.reduce((sum, h) => sum + h.destroyed, 0) / this.cleanupHistory.length
        : 0
    };
  }

  /**
   * Get structures at risk (grouped pieces near decay)
   * @returns {Array} At-risk structures
   */
  getAtRiskStructures() {
    if (!this.decayManager) return [];

    const structures = new Map();

    for (const [id, data] of this.decayManager.pieces) {
      const piece = data.piece;
      const structureId = piece.structureId ?? 'unassigned';
      
      if (!structures.has(structureId)) {
        structures.set(structureId, {
          id: structureId,
          pieces: [],
          lowestHealth: 100,
          averageHealth: 0,
          criticalCount: 0
        });
      }

      const structure = structures.get(structureId);
      const maxHealth = piece.maxHealth ?? 100;
      const healthPercent = ((piece.health ?? maxHealth) / maxHealth) * 100;

      structure.pieces.push(piece);
      structure.lowestHealth = Math.min(structure.lowestHealth, healthPercent);

      if (healthPercent <= this.criticalThreshold) {
        structure.criticalCount++;
      }
    }

    // Calculate averages and filter to at-risk
    const atRisk = [];

    for (const [id, structure] of structures) {
      const totalHealth = structure.pieces.reduce((sum, p) => {
        const max = p.maxHealth ?? 100;
        return sum + ((p.health ?? max) / max) * 100;
      }, 0);

      structure.averageHealth = totalHealth / structure.pieces.length;
      structure.pieceCount = structure.pieces.length;
      delete structure.pieces; // Remove piece references for cleaner output

      if (structure.lowestHealth <= this.warnThreshold || structure.criticalCount > 0) {
        atRisk.push(structure);
      }
    }

    // Sort by lowest health
    atRisk.sort((a, b) => a.lowestHealth - b.lowestHealth);

    return atRisk;
  }

  /**
   * Estimate server entity reduction
   * @returns {Object} Reduction estimate
   */
  estimateReduction() {
    if (!this.decayManager) return { error: 'No decay manager' };

    let wouldDestroy = 0;
    let wouldWarn = 0;

    for (const [id, data] of this.decayManager.pieces) {
      const piece = data.piece;
      const maxHealth = piece.maxHealth ?? 100;
      const healthPercent = ((piece.health ?? maxHealth) / maxHealth) * 100;

      if (healthPercent <= this.destroyThreshold) {
        wouldDestroy++;
      } else if (healthPercent <= this.warnThreshold) {
        wouldWarn++;
      }
    }

    const total = this.decayManager.pieces.size;

    return {
      total,
      wouldDestroy,
      wouldWarn,
      reductionPercent: total > 0 ? (wouldDestroy / total) * 100 : 0,
      atRiskPercent: total > 0 ? ((wouldDestroy + wouldWarn) / total) * 100 : 0
    };
  }

  /**
   * Set cleanup interval
   * @param {number} intervalMs - New interval in milliseconds
   */
  setInterval(intervalMs) {
    this.cleanupInterval = Math.max(60000, intervalMs); // Minimum 1 minute
    return { interval: this.cleanupInterval };
  }

  /**
   * Set thresholds
   * @param {Object} thresholds - New thresholds
   */
  setThresholds(thresholds) {
    if (thresholds.destroy !== undefined) {
      this.destroyThreshold = Math.max(0, Math.min(100, thresholds.destroy));
    }
    if (thresholds.warn !== undefined) {
      this.warnThreshold = Math.max(0, Math.min(100, thresholds.warn));
    }
    if (thresholds.critical !== undefined) {
      this.criticalThreshold = Math.max(0, Math.min(100, thresholds.critical));
    }

    return {
      destroy: this.destroyThreshold,
      warn: this.warnThreshold,
      critical: this.criticalThreshold
    };
  }

  /**
   * Serialize state
   */
  serialize() {
    return {
      version: 1,
      totalCleaned: this.totalCleaned,
      lastCleanup: this.lastCleanup,
      cleanupHistory: this.cleanupHistory,
      thresholds: {
        destroy: this.destroyThreshold,
        warn: this.warnThreshold,
        critical: this.criticalThreshold
      }
    };
  }

  /**
   * Deserialize state
   */
  deserialize(data) {
    if (data.version !== 1) {
      throw new Error(`Unsupported cleanup scheduler version: ${data.version}`);
    }

    this.totalCleaned = data.totalCleaned;
    this.lastCleanup = data.lastCleanup;
    this.cleanupHistory = data.cleanupHistory;
    this.destroyThreshold = data.thresholds.destroy;
    this.warnThreshold = data.thresholds.warn;
    this.criticalThreshold = data.thresholds.critical;

    return { restored: true };
  }
}

export default CleanupScheduler;
