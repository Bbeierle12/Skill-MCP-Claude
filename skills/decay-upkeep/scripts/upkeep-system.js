/**
 * UpkeepSystem - Manages upkeep calculations and resource scaling
 * 
 * Implements Rust-style upkeep scaling where larger bases cost
 * progressively more resources to maintain.
 * 
 * Usage:
 *   const upkeep = new UpkeepSystem({ scalingMode: 'exponential' });
 *   const cost = upkeep.calculateScaledUpkeep(toolCupboard);
 *   const preview = upkeep.previewAddition(toolCupboard, newPieces);
 */

/**
 * Scaling modes for upkeep costs
 */
export const ScalingMode = {
  LINEAR: 'linear',           // Constant cost per piece
  EXPONENTIAL: 'exponential', // Rust-style brackets
  LOGARITHMIC: 'logarithmic', // Slower scaling for casual games
  FLAT: 'flat'                // No scaling
};

/**
 * Default upkeep costs per piece by material
 */
export const DefaultUpkeepCosts = {
  TWIG: { wood: 1 },
  WOOD: { wood: 5 },
  STONE: { stone: 10, wood: 2 },
  METAL: { metal: 5, stone: 5 },
  ARMORED: { highQuality: 2, metal: 10 },
  THATCH: { thatch: 5, fiber: 2 }
};

/**
 * Default scaling brackets (Rust-inspired)
 */
export const DefaultBrackets = [
  { pieces: 15, multiplier: 1.0 },
  { pieces: 50, multiplier: 1.5 },
  { pieces: 100, multiplier: 2.0 },
  { pieces: 200, multiplier: 3.0 },
  { pieces: Infinity, multiplier: 5.0 }
];

export class UpkeepSystem {
  /**
   * Create upkeep system
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.scalingMode = options.scalingMode ?? ScalingMode.EXPONENTIAL;
    this.baseCostMultiplier = options.baseCostMultiplier ?? 1.0;
    this.brackets = options.brackets ?? DefaultBrackets;
    this.upkeepCosts = options.upkeepCosts ?? DefaultUpkeepCosts;
    this.upkeepInterval = options.upkeepInterval ?? 24 * 60 * 60 * 1000; // 24 hours
    
    // Tier ordering for bracket calculation
    this.materialTiers = options.materialTiers ?? {
      TWIG: 0, THATCH: 0,
      WOOD: 1,
      STONE: 2,
      METAL: 3,
      ARMORED: 4, TEK: 4
    };
  }

  /**
   * Calculate scaled upkeep for a protection zone
   * @param {Object} protectionZone - Tool Cupboard or equivalent
   * @returns {Object} Upkeep calculation results
   */
  calculateScaledUpkeep(protectionZone) {
    const pieces = this.getPiecesFromZone(protectionZone);
    
    if (pieces.length === 0) {
      return {
        baseCost: {},
        scaledCost: {},
        pieceCount: 0,
        scalingFactor: 1.0
      };
    }

    // Sort pieces by tier (higher tier first for bracket calculation)
    const sortedPieces = [...pieces].sort((a, b) => {
      const tierA = this.getMaterialTier(a.material);
      const tierB = this.getMaterialTier(b.material);
      return tierB - tierA;
    });

    // Calculate base cost (unscaled)
    const baseCost = this.calculateBaseCost(pieces);

    // Calculate scaled cost based on mode
    let scaledCost;
    switch (this.scalingMode) {
      case ScalingMode.EXPONENTIAL:
        scaledCost = this.calculateExponentialCost(sortedPieces);
        break;
      case ScalingMode.LINEAR:
        scaledCost = this.calculateLinearCost(pieces);
        break;
      case ScalingMode.LOGARITHMIC:
        scaledCost = this.calculateLogarithmicCost(pieces);
        break;
      case ScalingMode.FLAT:
      default:
        scaledCost = { ...baseCost };
    }

    // Apply base multiplier
    for (const resource of Object.keys(scaledCost)) {
      scaledCost[resource] = Math.ceil(scaledCost[resource] * this.baseCostMultiplier);
    }

    return {
      baseCost,
      scaledCost,
      pieceCount: pieces.length,
      scalingFactor: this.calculateAverageScaling(pieces.length),
      perInterval: this.upkeepInterval,
      perHour: this.calculatePerHour(scaledCost)
    };
  }

  /**
   * Get pieces from protection zone
   */
  getPiecesFromZone(zone) {
    if (zone.protectedPieces instanceof Set) {
      return Array.from(zone.protectedPieces);
    }
    if (Array.isArray(zone.protectedPieces)) {
      return zone.protectedPieces;
    }
    if (typeof zone.getProtectedPieces === 'function') {
      return zone.getProtectedPieces();
    }
    return [];
  }

  /**
   * Calculate base (unscaled) upkeep cost
   */
  calculateBaseCost(pieces) {
    const cost = {};

    for (const piece of pieces) {
      const pieceCost = this.getPieceUpkeepCost(piece);
      for (const [resource, amount] of Object.entries(pieceCost)) {
        cost[resource] = (cost[resource] ?? 0) + amount;
      }
    }

    return cost;
  }

  /**
   * Calculate exponential (bracket-based) cost
   */
  calculateExponentialCost(sortedPieces) {
    const cost = {};
    let pieceIndex = 0;

    for (const piece of sortedPieces) {
      const multiplier = this.getBracketMultiplier(pieceIndex);
      const pieceCost = this.getPieceUpkeepCost(piece);

      for (const [resource, amount] of Object.entries(pieceCost)) {
        cost[resource] = (cost[resource] ?? 0) + (amount * multiplier);
      }

      pieceIndex++;
    }

    // Round up
    for (const resource of Object.keys(cost)) {
      cost[resource] = Math.ceil(cost[resource]);
    }

    return cost;
  }

  /**
   * Calculate linear cost (constant multiplier)
   */
  calculateLinearCost(pieces) {
    const cost = this.calculateBaseCost(pieces);
    const multiplier = 1 + (pieces.length * 0.01); // 1% increase per piece

    for (const resource of Object.keys(cost)) {
      cost[resource] = Math.ceil(cost[resource] * multiplier);
    }

    return cost;
  }

  /**
   * Calculate logarithmic cost (slower scaling)
   */
  calculateLogarithmicCost(pieces) {
    const cost = this.calculateBaseCost(pieces);
    const multiplier = 1 + Math.log10(Math.max(1, pieces.length));

    for (const resource of Object.keys(cost)) {
      cost[resource] = Math.ceil(cost[resource] * multiplier);
    }

    return cost;
  }

  /**
   * Get upkeep cost for a single piece
   */
  getPieceUpkeepCost(piece) {
    const materialName = piece.material?.name?.toUpperCase() ?? 'WOOD';
    return this.upkeepCosts[materialName] ?? this.upkeepCosts.WOOD ?? { wood: 1 };
  }

  /**
   * Get material tier for sorting
   */
  getMaterialTier(material) {
    const name = material?.name?.toUpperCase() ?? 'WOOD';
    return this.materialTiers[name] ?? 1;
  }

  /**
   * Get bracket multiplier for piece index
   */
  getBracketMultiplier(pieceIndex) {
    let cumulative = 0;

    for (const bracket of this.brackets) {
      if (pieceIndex < cumulative + bracket.pieces) {
        return bracket.multiplier;
      }
      cumulative += bracket.pieces;
    }

    return this.brackets[this.brackets.length - 1].multiplier;
  }

  /**
   * Calculate average scaling factor for piece count
   */
  calculateAverageScaling(totalPieces) {
    if (totalPieces === 0) return 1.0;

    let totalMultiplier = 0;
    let cumulative = 0;

    for (const bracket of this.brackets) {
      const bracketEnd = Math.min(cumulative + bracket.pieces, totalPieces);
      const piecesInBracket = Math.max(0, bracketEnd - cumulative);

      totalMultiplier += piecesInBracket * bracket.multiplier;
      cumulative = bracketEnd;

      if (cumulative >= totalPieces) break;
    }

    return totalMultiplier / totalPieces;
  }

  /**
   * Calculate per-hour resource drain
   */
  calculatePerHour(cost) {
    const hoursPerInterval = this.upkeepInterval / (60 * 60 * 1000);
    const perHour = {};

    for (const [resource, amount] of Object.entries(cost)) {
      perHour[resource] = amount / hoursPerInterval;
    }

    return perHour;
  }

  /**
   * Preview upkeep cost for adding pieces
   * @param {Object} protectionZone - Current protection zone
   * @param {Array} newPieces - Pieces to add
   * @returns {Object} Preview of cost changes
   */
  previewAddition(protectionZone, newPieces) {
    const currentPieces = this.getPiecesFromZone(protectionZone);
    const currentCost = this.calculateScaledUpkeep(protectionZone);

    // Create temporary zone with new pieces
    const combinedPieces = [...currentPieces, ...newPieces];
    const tempZone = {
      protectedPieces: combinedPieces
    };

    const newCost = this.calculateScaledUpkeep(tempZone);

    // Calculate increase
    const increase = {};
    const allResources = new Set([
      ...Object.keys(currentCost.scaledCost),
      ...Object.keys(newCost.scaledCost)
    ]);

    for (const resource of allResources) {
      const current = currentCost.scaledCost[resource] ?? 0;
      const updated = newCost.scaledCost[resource] ?? 0;
      increase[resource] = updated - current;
    }

    return {
      currentCost: currentCost.scaledCost,
      newCost: newCost.scaledCost,
      increase,
      currentPieceCount: currentPieces.length,
      newPieceCount: combinedPieces.length,
      piecesAdded: newPieces.length,
      currentScaling: currentCost.scalingFactor,
      newScaling: newCost.scalingFactor
    };
  }

  /**
   * Preview upkeep cost for removing pieces
   */
  previewRemoval(protectionZone, piecesToRemove) {
    const currentPieces = this.getPiecesFromZone(protectionZone);
    const currentCost = this.calculateScaledUpkeep(protectionZone);

    // Create set of IDs to remove
    const removeIds = new Set(piecesToRemove.map(p => p.id));
    const remainingPieces = currentPieces.filter(p => !removeIds.has(p.id));

    const tempZone = {
      protectedPieces: remainingPieces
    };

    const newCost = this.calculateScaledUpkeep(tempZone);

    // Calculate savings
    const savings = {};
    for (const resource of Object.keys(currentCost.scaledCost)) {
      const current = currentCost.scaledCost[resource] ?? 0;
      const updated = newCost.scaledCost[resource] ?? 0;
      savings[resource] = current - updated;
    }

    return {
      currentCost: currentCost.scaledCost,
      newCost: newCost.scaledCost,
      savings,
      currentPieceCount: currentPieces.length,
      newPieceCount: remainingPieces.length,
      piecesRemoved: piecesToRemove.length
    };
  }

  /**
   * Calculate time until resources run out
   * @param {Object} protectionZone - Protection zone with resources
   * @returns {Object} Time calculations
   */
  calculateTimeUntilEmpty(protectionZone) {
    const cost = this.calculateScaledUpkeep(protectionZone);
    const resources = this.getResourcesFromZone(protectionZone);

    let minIntervals = Infinity;
    let limitingResource = null;

    for (const [resource, needed] of Object.entries(cost.scaledCost)) {
      if (needed === 0) continue;

      const available = resources[resource] ?? 0;
      const intervals = Math.floor(available / needed);

      if (intervals < minIntervals) {
        minIntervals = intervals;
        limitingResource = resource;
      }
    }

    const timeMs = minIntervals * this.upkeepInterval;

    return {
      intervals: minIntervals,
      timeMs,
      timeFormatted: this.formatTime(timeMs),
      limitingResource,
      resourceStatus: this.getResourceStatus(protectionZone, cost.scaledCost)
    };
  }

  /**
   * Get resources from protection zone
   */
  getResourcesFromZone(zone) {
    if (zone.resources instanceof Map) {
      return Object.fromEntries(zone.resources);
    }
    if (typeof zone.getResources === 'function') {
      return zone.getResources();
    }
    return zone.resources ?? {};
  }

  /**
   * Get detailed resource status
   */
  getResourceStatus(zone, cost) {
    const resources = this.getResourcesFromZone(zone);
    const status = {};

    for (const [resource, needed] of Object.entries(cost)) {
      const available = resources[resource] ?? 0;
      const intervals = needed > 0 ? Math.floor(available / needed) : Infinity;

      status[resource] = {
        available,
        needed,
        intervals,
        sufficient: available >= needed,
        deficit: Math.max(0, needed - available)
      };
    }

    return status;
  }

  /**
   * Get upkeep breakdown by material type
   */
  getBreakdownByMaterial(protectionZone) {
    const pieces = this.getPiecesFromZone(protectionZone);
    const breakdown = {};

    for (const piece of pieces) {
      const material = piece.material?.name ?? 'Unknown';
      if (!breakdown[material]) {
        breakdown[material] = {
          count: 0,
          baseCost: {},
          scaledCost: {}
        };
      }

      breakdown[material].count++;
      const pieceCost = this.getPieceUpkeepCost(piece);

      for (const [resource, amount] of Object.entries(pieceCost)) {
        breakdown[material].baseCost[resource] = 
          (breakdown[material].baseCost[resource] ?? 0) + amount;
      }
    }

    return breakdown;
  }

  /**
   * Format time in human-readable format
   */
  formatTime(ms) {
    if (ms === Infinity || ms < 0) return 'Forever';

    const hours = ms / (60 * 60 * 1000);

    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = Math.floor(hours % 24);
      return `${days}d ${remainingHours}h`;
    }

    if (hours >= 1) {
      return `${Math.floor(hours)}h ${Math.floor((hours % 1) * 60)}m`;
    }

    const minutes = Math.floor(ms / (60 * 1000));
    return `${minutes}m`;
  }

  /**
   * Get scaling curve data for UI visualization
   */
  getScalingCurve(maxPieces = 300) {
    const points = [];

    for (let i = 0; i <= maxPieces; i += 5) {
      points.push({
        pieces: i,
        multiplier: this.calculateAverageScaling(i),
        bracket: this.getBracketMultiplier(i)
      });
    }

    return points;
  }

  /**
   * Update configuration
   */
  setOptions(options) {
    if (options.scalingMode !== undefined) this.scalingMode = options.scalingMode;
    if (options.baseCostMultiplier !== undefined) this.baseCostMultiplier = options.baseCostMultiplier;
    if (options.brackets !== undefined) this.brackets = options.brackets;
    if (options.upkeepInterval !== undefined) this.upkeepInterval = options.upkeepInterval;
  }
}

export default UpkeepSystem;
