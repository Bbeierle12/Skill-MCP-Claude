/**
 * DecayManager - Manages decay for building pieces
 * 
 * Implements timer-based decay with material-specific rates,
 * damage states for visual feedback, and protection zone support.
 * 
 * Usage:
 *   const decay = new DecayManager({ mode: 'rust' });
 *   decay.addPiece(piece);
 *   decay.tick(Date.now()); // Called from game loop
 */

import * as THREE from 'three';

/**
 * Decay modes matching game styles
 */
export const DecayMode = {
  RUST: 'rust',       // Fast decay (hours), Tool Cupboard protection
  ARK: 'ark',         // Slow decay (days), tribe-based protection
  VALHEIM: 'valheim', // No decay, durability damage from weather
  CUSTOM: 'custom'    // User-defined rates
};

/**
 * Default decay rates by material (seconds to full decay)
 */
export const DefaultDecayRates = {
  rust: {
    TWIG: { time: 1 * 60 * 60, canProtect: false },
    WOOD: { time: 3 * 60 * 60, canProtect: true },
    STONE: { time: 5 * 60 * 60, canProtect: true },
    METAL: { time: 8 * 60 * 60, canProtect: true },
    ARMORED: { time: 12 * 60 * 60, canProtect: true }
  },
  ark: {
    THATCH: { time: 4 * 24 * 60 * 60, canProtect: true },
    WOOD: { time: 8 * 24 * 60 * 60, canProtect: true },
    STONE: { time: 12 * 24 * 60 * 60, canProtect: true },
    METAL: { time: 16 * 24 * 60 * 60, canProtect: true },
    TEK: { time: 20 * 24 * 60 * 60, canProtect: true }
  },
  valheim: {
    WOOD: { time: Infinity, canProtect: false },
    STONE: { time: Infinity, canProtect: false },
    IRON: { time: Infinity, canProtect: false }
  }
};

/**
 * Damage state definitions
 */
export const DamageState = {
  HEALTHY: 'healthy',
  DAMAGED: 'damaged',
  CRITICAL: 'critical',
  FAILING: 'failing'
};

export class DecayManager {
  /**
   * Create decay manager
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.mode = options.mode ?? DecayMode.RUST;
    this.decayRates = options.decayRates ?? DefaultDecayRates[this.mode] ?? DefaultDecayRates.rust;
    this.decayMultiplier = options.decayMultiplier ?? 1.0;
    this.tickInterval = options.tickInterval ?? 60; // Seconds between decay checks
    this.enabled = options.enabled ?? true;
    
    // Piece tracking
    this.pieces = new Map();
    this.protectedAreas = [];
    
    // Timing
    this.lastTick = 0;
    this.totalDecayTicks = 0;
    
    // Damage state thresholds
    this.damageThresholds = options.damageThresholds ?? [
      { threshold: 0.75, state: DamageState.HEALTHY },
      { threshold: 0.50, state: DamageState.DAMAGED },
      { threshold: 0.25, state: DamageState.CRITICAL },
      { threshold: 0.00, state: DamageState.FAILING }
    ];
    
    // Event callbacks
    this.onPieceDecayed = options.onPieceDecayed ?? null;
    this.onDamageStateChanged = options.onDamageStateChanged ?? null;
    this.onDecayTick = options.onDecayTick ?? null;
  }

  /**
   * Add piece to decay tracking
   * @param {Object} piece - Building piece to track
   */
  addPiece(piece) {
    if (this.pieces.has(piece.id)) {
      return { success: false, reason: 'Piece already tracked' };
    }

    const data = {
      piece,
      addedTime: Date.now(),
      lastDecayTime: Date.now(),
      damageState: this.calculateDamageState(piece),
      totalDecayDamage: 0
    };

    this.pieces.set(piece.id, data);

    return { success: true, data };
  }

  /**
   * Remove piece from decay tracking
   * @param {string} pieceId - ID of piece to remove
   */
  removePiece(pieceId) {
    const existed = this.pieces.has(pieceId);
    this.pieces.delete(pieceId);
    return { success: existed };
  }

  /**
   * Add a protected area (Tool Cupboard, etc.)
   * @param {Object} area - Protection area with contains() method
   */
  addProtectedArea(area) {
    this.protectedAreas.push(area);
    return { areaCount: this.protectedAreas.length };
  }

  /**
   * Remove a protected area
   * @param {string} areaId - ID of area to remove
   */
  removeProtectedArea(areaId) {
    const before = this.protectedAreas.length;
    this.protectedAreas = this.protectedAreas.filter(a => a.id !== areaId);
    return { removed: before - this.protectedAreas.length };
  }

  /**
   * Main decay tick - call from game loop
   * @param {number} currentTime - Current timestamp (ms)
   * @returns {Object} Tick results
   */
  tick(currentTime) {
    if (!this.enabled) {
      return { ran: false, reason: 'Decay disabled' };
    }

    const deltaMs = currentTime - this.lastTick;
    const deltaSeconds = deltaMs / 1000;

    if (deltaSeconds < this.tickInterval) {
      return { ran: false, reason: 'Interval not reached', nextIn: this.tickInterval - deltaSeconds };
    }

    this.lastTick = currentTime;
    this.totalDecayTicks++;

    const results = {
      ran: true,
      tickNumber: this.totalDecayTicks,
      deltaTime: deltaSeconds,
      decayed: 0,
      destroyed: 0,
      stateChanges: 0,
      toDestroy: []
    };

    // Process each piece
    for (const [id, data] of this.pieces) {
      const piece = data.piece;
      
      // Check protection
      const isProtected = this.isPieceProtected(piece);
      
      // Calculate decay damage
      const damage = this.calculateDecayDamage(piece, deltaSeconds, isProtected);
      
      if (damage > 0) {
        // Apply damage
        piece.health = Math.max(0, (piece.health ?? piece.maxHealth ?? 100) - damage);
        data.totalDecayDamage += damage;
        results.decayed++;

        // Update damage state
        const newState = this.calculateDamageState(piece);
        if (newState !== data.damageState) {
          const oldState = data.damageState;
          data.damageState = newState;
          results.stateChanges++;

          if (this.onDamageStateChanged) {
            this.onDamageStateChanged(piece, newState, oldState);
          }
        }

        // Mark for destruction if depleted
        if (piece.health <= 0) {
          results.toDestroy.push(id);
        }
      }
    }

    // Destroy depleted pieces
    for (const id of results.toDestroy) {
      const data = this.pieces.get(id);
      if (data && this.onPieceDecayed) {
        this.onPieceDecayed(data.piece);
      }
      this.pieces.delete(id);
      results.destroyed++;
    }

    // Callback
    if (this.onDecayTick) {
      this.onDecayTick(results);
    }

    return results;
  }

  /**
   * Check if piece is in a protected area
   * @param {Object} piece - Piece to check
   * @returns {boolean} Whether piece is protected
   */
  isPieceProtected(piece) {
    for (const area of this.protectedAreas) {
      // Area must contain piece position
      if (area.contains && area.contains(piece.position)) {
        // Area must have upkeep (if applicable)
        if (typeof area.hasUpkeep === 'function') {
          if (area.hasUpkeep()) {
            return true;
          }
        } else {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Calculate decay damage for a piece
   * @param {Object} piece - Piece to calculate for
   * @param {number} deltaTime - Time elapsed (seconds)
   * @param {boolean} isProtected - Whether piece is protected
   * @returns {number} Damage to apply
   */
  calculateDecayDamage(piece, deltaTime, isProtected) {
    const materialName = piece.material?.name?.toUpperCase() ?? 'WOOD';
    const decayInfo = this.decayRates[materialName];

    if (!decayInfo) return 0;

    // Check if material can be protected
    if (isProtected && decayInfo.canProtect) {
      return 0;
    }

    // No decay if infinite time
    if (decayInfo.time === Infinity) return 0;

    // Calculate decay rate (HP per second)
    const maxHealth = piece.maxHealth ?? 100;
    const decayRate = maxHealth / decayInfo.time;

    // Apply multiplier and delta time
    return decayRate * deltaTime * this.decayMultiplier;
  }

  /**
   * Calculate damage state from piece health
   * @param {Object} piece - Piece to check
   * @returns {string} Damage state
   */
  calculateDamageState(piece) {
    const maxHealth = piece.maxHealth ?? 100;
    const health = piece.health ?? maxHealth;
    const healthPercent = health / maxHealth;

    for (const { threshold, state } of this.damageThresholds) {
      if (healthPercent >= threshold) {
        return state;
      }
    }

    return DamageState.FAILING;
  }

  /**
   * Get decay status for a piece (for UI)
   * @param {string} pieceId - ID of piece
   * @returns {Object|null} Decay status
   */
  getDecayStatus(pieceId) {
    const data = this.pieces.get(pieceId);
    if (!data) return null;

    const piece = data.piece;
    const isProtected = this.isPieceProtected(piece);
    const materialName = piece.material?.name?.toUpperCase() ?? 'WOOD';
    const decayInfo = this.decayRates[materialName];

    // Calculate time until decay completes
    let timeToDecay = Infinity;
    if (decayInfo && !isProtected && decayInfo.time !== Infinity) {
      const healthPercent = (piece.health ?? piece.maxHealth) / piece.maxHealth;
      timeToDecay = decayInfo.time * healthPercent / this.decayMultiplier;
    }

    return {
      pieceId,
      health: piece.health ?? piece.maxHealth,
      maxHealth: piece.maxHealth ?? 100,
      healthPercent: ((piece.health ?? piece.maxHealth) / (piece.maxHealth ?? 100)) * 100,
      damageState: data.damageState,
      isProtected,
      canProtect: decayInfo?.canProtect ?? false,
      timeToDecay,
      timeToDecayFormatted: this.formatTime(timeToDecay),
      material: materialName,
      totalDecayDamage: data.totalDecayDamage
    };
  }

  /**
   * Get all pieces in a specific damage state
   * @param {string} state - Damage state to filter by
   * @returns {Array} Pieces in that state
   */
  getPiecesByState(state) {
    const result = [];
    for (const [id, data] of this.pieces) {
      if (data.damageState === state) {
        result.push(data.piece);
      }
    }
    return result;
  }

  /**
   * Get summary statistics
   * @returns {Object} Decay statistics
   */
  getStatistics() {
    const stats = {
      total: 0,
      protected: 0,
      byState: {
        [DamageState.HEALTHY]: 0,
        [DamageState.DAMAGED]: 0,
        [DamageState.CRITICAL]: 0,
        [DamageState.FAILING]: 0
      },
      byMaterial: {}
    };

    for (const [id, data] of this.pieces) {
      stats.total++;
      stats.byState[data.damageState]++;

      const material = data.piece.material?.name ?? 'Unknown';
      stats.byMaterial[material] = (stats.byMaterial[material] ?? 0) + 1;

      if (this.isPieceProtected(data.piece)) {
        stats.protected++;
      }
    }

    return stats;
  }

  /**
   * Repair piece to full health
   * @param {string} pieceId - ID of piece to repair
   * @returns {Object} Repair result
   */
  repairPiece(pieceId) {
    const data = this.pieces.get(pieceId);
    if (!data) {
      return { success: false, reason: 'Piece not found' };
    }

    const piece = data.piece;
    const damageTaken = (piece.maxHealth ?? 100) - (piece.health ?? 0);
    
    piece.health = piece.maxHealth ?? 100;
    data.damageState = DamageState.HEALTHY;
    data.totalDecayDamage = 0;

    return {
      success: true,
      repaired: damageTaken,
      newHealth: piece.health
    };
  }

  /**
   * Set decay multiplier (for server admin)
   * @param {number} multiplier - New multiplier
   */
  setDecayMultiplier(multiplier) {
    this.decayMultiplier = Math.max(0, multiplier);
    return { multiplier: this.decayMultiplier };
  }

  /**
   * Enable or disable decay
   * @param {boolean} enabled - Whether decay is enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    return { enabled: this.enabled };
  }

  /**
   * Format time in human-readable format
   * @param {number} seconds - Time in seconds
   * @returns {string} Formatted time
   */
  formatTime(seconds) {
    if (seconds === Infinity) return 'Never';
    if (seconds <= 0) return 'Now';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  /**
   * Serialize state for saving
   * @returns {Object} Serialized state
   */
  serialize() {
    const pieces = [];
    for (const [id, data] of this.pieces) {
      pieces.push({
        id,
        health: data.piece.health,
        addedTime: data.addedTime,
        lastDecayTime: data.lastDecayTime,
        damageState: data.damageState,
        totalDecayDamage: data.totalDecayDamage
      });
    }

    return {
      version: 1,
      mode: this.mode,
      decayMultiplier: this.decayMultiplier,
      enabled: this.enabled,
      lastTick: this.lastTick,
      totalDecayTicks: this.totalDecayTicks,
      pieces
    };
  }

  /**
   * Restore state from saved data
   * @param {Object} data - Saved state
   * @param {Map} pieceMap - Map of piece IDs to piece objects
   */
  deserialize(data, pieceMap) {
    if (data.version !== 1) {
      throw new Error(`Unsupported decay save version: ${data.version}`);
    }

    this.mode = data.mode;
    this.decayMultiplier = data.decayMultiplier;
    this.enabled = data.enabled;
    this.lastTick = data.lastTick;
    this.totalDecayTicks = data.totalDecayTicks;

    this.pieces.clear();
    for (const saved of data.pieces) {
      const piece = pieceMap.get(saved.id);
      if (piece) {
        piece.health = saved.health;
        this.pieces.set(saved.id, {
          piece,
          addedTime: saved.addedTime,
          lastDecayTime: saved.lastDecayTime,
          damageState: saved.damageState,
          totalDecayDamage: saved.totalDecayDamage
        });
      }
    }

    return { restored: this.pieces.size };
  }
}

export default DecayManager;
