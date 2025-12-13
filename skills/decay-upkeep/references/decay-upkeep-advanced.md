# Decay & Upkeep Advanced

Survival games use decay and upkeep systems to solve two problems simultaneously: preventing infinite resource hoarding and cleaning up abandoned player structures from servers. Rust pioneered the modern approach with Tool Cupboards, creating a gameplay mechanic that directly addresses server performance concerns while adding strategic depth.

## The Dual Purpose of Decay

Decay is often misunderstood as purely punitive. In reality, well-designed decay systems serve critical functions. On the gameplay side, decay creates resource sinks that maintain economic pressure, encourages active base maintenance as a core loop, limits infinite vertical progression (bases can't grow forever without cost), and creates risk/reward decisions around base size. On the technical side, decay provides automatic garbage collection for abandoned structures, prevents entity bloat on long-running servers, and reduces collision/rendering overhead over time.

The Rust development team explicitly designed their decay system around server health. Their devblog states that a typical wipe reaches 150-200k entities, and decay is the primary mechanism keeping that number manageable.

## Decay Rate Design

Different materials decay at different rates, creating a progression system where better materials require more investment but last longer.

### Material Decay Rates (Rust Pattern)

```javascript
const DecayRates = {
  TWIG: {
    name: 'Twig',
    baseDecayTime: 1 * 60 * 60,      // 1 hour to full decay
    healthDecayPercent: 100,          // Loses all HP
    protectedDecayTime: null,         // Cannot be protected
    tier: 0
  },
  WOOD: {
    name: 'Wood', 
    baseDecayTime: 3 * 60 * 60,       // 3 hours
    healthDecayPercent: 100,
    protectedDecayTime: Infinity,     // No decay when protected
    tier: 1
  },
  STONE: {
    name: 'Stone',
    baseDecayTime: 5 * 60 * 60,       // 5 hours
    healthDecayPercent: 100,
    protectedDecayTime: Infinity,
    tier: 2
  },
  METAL: {
    name: 'Metal',
    baseDecayTime: 8 * 60 * 60,       // 8 hours
    healthDecayPercent: 100,
    protectedDecayTime: Infinity,
    tier: 3
  },
  ARMORED: {
    name: 'Armored',
    baseDecayTime: 12 * 60 * 60,      // 12 hours
    healthDecayPercent: 100,
    protectedDecayTime: Infinity,
    tier: 4
  }
};
```

### Decay Formula

```javascript
/**
 * Calculate decay damage per tick
 * @param {Object} piece - Building piece
 * @param {number} deltaTime - Time since last tick (seconds)
 * @param {boolean} isProtected - Whether piece is in protected area
 * @returns {number} Health to remove
 */
function calculateDecayDamage(piece, deltaTime, isProtected) {
  const material = DecayRates[piece.material.name.toUpperCase()];
  
  if (!material) return 0;
  
  // No decay if protected (and material can be protected)
  if (isProtected && material.protectedDecayTime === Infinity) {
    return 0;
  }
  
  // Calculate decay rate (HP per second)
  const decayTime = isProtected 
    ? material.protectedDecayTime 
    : material.baseDecayTime;
    
  if (!decayTime || decayTime === Infinity) return 0;
  
  const maxHealth = piece.maxHealth ?? 100;
  const decayPercent = material.healthDecayPercent / 100;
  const totalDecay = maxHealth * decayPercent;
  
  // HP per second
  const decayRate = totalDecay / decayTime;
  
  return decayRate * deltaTime;
}
```

### Decay Tick Implementation

```javascript
/**
 * DecayManager - Manages decay for all building pieces
 */
export class DecayManager {
  constructor(options = {}) {
    this.pieces = new Map();
    this.protectedAreas = [];
    this.decayMultiplier = options.decayMultiplier ?? 1.0;
    this.tickInterval = options.tickInterval ?? 60; // Check every 60 seconds
    this.lastTick = 0;
    this.enabled = options.enabled ?? true;
    
    // Damage states for visual feedback
    this.damageStates = options.damageStates ?? [
      { threshold: 0.75, name: 'healthy', color: 0x00ff00 },
      { threshold: 0.50, name: 'damaged', color: 0xffff00 },
      { threshold: 0.25, name: 'critical', color: 0xff8800 },
      { threshold: 0.00, name: 'failing', color: 0xff0000 }
    ];
  }

  addPiece(piece) {
    this.pieces.set(piece.id, {
      piece,
      lastDecayTime: Date.now(),
      damageState: 'healthy'
    });
  }

  removePiece(pieceId) {
    this.pieces.delete(pieceId);
  }

  addProtectedArea(area) {
    this.protectedAreas.push(area);
  }

  removeProtectedArea(areaId) {
    this.protectedAreas = this.protectedAreas.filter(a => a.id !== areaId);
  }

  /**
   * Main decay tick - call from game loop
   */
  tick(currentTime) {
    if (!this.enabled) return { decayed: 0, destroyed: 0 };

    const deltaTime = (currentTime - this.lastTick) / 1000;
    
    if (deltaTime < this.tickInterval) {
      return { decayed: 0, destroyed: 0, skipped: true };
    }

    this.lastTick = currentTime;

    let decayedCount = 0;
    let destroyedCount = 0;
    const toDestroy = [];

    for (const [id, data] of this.pieces) {
      const { piece } = data;
      const isProtected = this.isProtected(piece);
      
      const damage = calculateDecayDamage(
        piece, 
        deltaTime, 
        isProtected
      ) * this.decayMultiplier;

      if (damage > 0) {
        piece.health = Math.max(0, (piece.health ?? piece.maxHealth) - damage);
        decayedCount++;
        
        // Update damage state
        const newState = this.getDamageState(piece);
        if (newState !== data.damageState) {
          data.damageState = newState;
          this.onDamageStateChanged?.(piece, newState);
        }
        
        // Mark for destruction if health depleted
        if (piece.health <= 0) {
          toDestroy.push(id);
        }
      }
    }

    // Destroy depleted pieces
    for (const id of toDestroy) {
      const data = this.pieces.get(id);
      this.onPieceDecayed?.(data.piece);
      this.pieces.delete(id);
      destroyedCount++;
    }

    return { decayed: decayedCount, destroyed: destroyedCount };
  }

  /**
   * Check if piece is in a protected area
   */
  isProtected(piece) {
    for (const area of this.protectedAreas) {
      if (area.contains(piece.position)) {
        // Also check if upkeep is paid
        if (area.hasUpkeep?.() ?? true) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Get damage state based on health percentage
   */
  getDamageState(piece) {
    const healthPercent = (piece.health ?? piece.maxHealth) / piece.maxHealth;
    
    for (const state of this.damageStates) {
      if (healthPercent >= state.threshold) {
        return state.name;
      }
    }
    
    return this.damageStates[this.damageStates.length - 1].name;
  }

  /**
   * Get decay status for UI
   */
  getDecayStatus(piece) {
    const data = this.pieces.get(piece.id);
    if (!data) return null;

    const isProtected = this.isProtected(piece);
    const material = DecayRates[piece.material?.name?.toUpperCase()];
    
    let timeToDecay = Infinity;
    if (material && !isProtected) {
      const healthPercent = piece.health / piece.maxHealth;
      timeToDecay = material.baseDecayTime * healthPercent;
    }

    return {
      health: piece.health,
      maxHealth: piece.maxHealth,
      healthPercent: (piece.health / piece.maxHealth) * 100,
      damageState: data.damageState,
      isProtected,
      timeToDecay: isProtected ? Infinity : timeToDecay,
      material: material?.name ?? 'Unknown'
    };
  }
}
```

## Tool Cupboard System

The Tool Cupboard (TC) is Rust's elegant solution to decay prevention. It creates a spherical protection zone where placing pieces requires authorization, and pieces within the zone don't decay as long as the TC has resources.

### Protection Mechanics

```javascript
/**
 * ToolCupboard - Protection zone with upkeep system
 */
export class ToolCupboard {
  constructor(options = {}) {
    this.id = options.id ?? `tc_${Date.now()}`;
    this.position = options.position ?? new THREE.Vector3();
    this.radius = options.radius ?? 30;
    this.radiusSquared = this.radius * this.radius;
    
    // Authorization
    this.authorizedPlayers = new Set(options.authorizedPlayers ?? []);
    this.ownerId = options.ownerId ?? null;
    
    // Resource storage
    this.resources = new Map();
    this.maxStorage = options.maxStorage ?? {
      wood: 10000,
      stone: 10000,
      metal: 5000,
      highQuality: 1000
    };
    
    // Upkeep tracking
    this.lastUpkeepTime = Date.now();
    this.upkeepInterval = options.upkeepInterval ?? 24 * 60 * 60 * 1000; // 24 hours
    this.upkeepBuffer = options.upkeepBuffer ?? 3 * 24 * 60 * 60 * 1000; // 3 days max
    
    // Pieces in range
    this.protectedPieces = new Set();
  }

  /**
   * Check if position is within protection radius
   */
  contains(position) {
    const dx = position.x - this.position.x;
    const dy = position.y - this.position.y;
    const dz = position.z - this.position.z;
    return (dx * dx + dy * dy + dz * dz) <= this.radiusSquared;
  }

  /**
   * Check if player is authorized
   */
  isAuthorized(playerId) {
    return this.authorizedPlayers.has(playerId) || playerId === this.ownerId;
  }

  /**
   * Authorize a player
   */
  authorize(playerId, authorizingPlayerId) {
    if (!this.isAuthorized(authorizingPlayerId)) {
      return { success: false, reason: 'Not authorized to add players' };
    }
    
    this.authorizedPlayers.add(playerId);
    return { success: true };
  }

  /**
   * Deauthorize a player
   */
  deauthorize(playerId) {
    if (playerId === this.ownerId) {
      return { success: false, reason: 'Cannot deauthorize owner' };
    }
    
    this.authorizedPlayers.delete(playerId);
    return { success: true };
  }

  /**
   * Deposit resources for upkeep
   */
  depositResources(resources) {
    const deposited = {};
    
    for (const [type, amount] of Object.entries(resources)) {
      const current = this.resources.get(type) ?? 0;
      const max = this.maxStorage[type] ?? Infinity;
      const canDeposit = Math.min(amount, max - current);
      
      if (canDeposit > 0) {
        this.resources.set(type, current + canDeposit);
        deposited[type] = canDeposit;
      }
    }
    
    return { deposited, storage: this.getResourceStatus() };
  }

  /**
   * Withdraw resources from storage
   */
  withdrawResources(resources) {
    const withdrawn = {};
    
    for (const [type, amount] of Object.entries(resources)) {
      const current = this.resources.get(type) ?? 0;
      const canWithdraw = Math.min(amount, current);
      
      if (canWithdraw > 0) {
        this.resources.set(type, current - canWithdraw);
        withdrawn[type] = canWithdraw;
      }
    }
    
    return { withdrawn, storage: this.getResourceStatus() };
  }

  /**
   * Get current resource storage status
   */
  getResourceStatus() {
    const status = {};
    
    for (const type of Object.keys(this.maxStorage)) {
      status[type] = {
        current: this.resources.get(type) ?? 0,
        max: this.maxStorage[type]
      };
    }
    
    return status;
  }

  /**
   * Calculate upkeep cost based on protected pieces
   */
  calculateUpkeepCost() {
    const cost = { wood: 0, stone: 0, metal: 0, highQuality: 0 };
    
    for (const piece of this.protectedPieces) {
      const pieceCost = this.getPieceUpkeepCost(piece);
      for (const [type, amount] of Object.entries(pieceCost)) {
        cost[type] = (cost[type] ?? 0) + amount;
      }
    }
    
    return cost;
  }

  /**
   * Get upkeep cost for a single piece
   */
  getPieceUpkeepCost(piece) {
    const baseCosts = {
      TWIG: { wood: 1 },
      WOOD: { wood: 5 },
      STONE: { stone: 10, wood: 2 },
      METAL: { metal: 5, stone: 5 },
      ARMORED: { highQuality: 2, metal: 10 }
    };
    
    return baseCosts[piece.material?.name?.toUpperCase()] ?? { wood: 1 };
  }

  /**
   * Check if upkeep resources are available
   */
  hasUpkeep() {
    const cost = this.calculateUpkeepCost();
    
    for (const [type, amount] of Object.entries(cost)) {
      const available = this.resources.get(type) ?? 0;
      if (available < amount) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Process upkeep payment
   */
  processUpkeep() {
    const cost = this.calculateUpkeepCost();
    
    if (!this.hasUpkeep()) {
      return { success: false, reason: 'Insufficient resources', required: cost };
    }
    
    // Deduct resources
    for (const [type, amount] of Object.entries(cost)) {
      const current = this.resources.get(type) ?? 0;
      this.resources.set(type, current - amount);
    }
    
    this.lastUpkeepTime = Date.now();
    
    return { success: true, cost, nextUpkeep: this.getTimeUntilNextUpkeep() };
  }

  /**
   * Get time until next upkeep is due
   */
  getTimeUntilNextUpkeep() {
    const elapsed = Date.now() - this.lastUpkeepTime;
    return Math.max(0, this.upkeepInterval - elapsed);
  }

  /**
   * Get time until decay starts (buffer runs out)
   */
  getTimeUntilDecay() {
    const cost = this.calculateUpkeepCost();
    let minDuration = this.upkeepBuffer;
    
    for (const [type, amount] of Object.entries(cost)) {
      if (amount === 0) continue;
      
      const available = this.resources.get(type) ?? 0;
      const intervals = Math.floor(available / amount);
      const duration = intervals * this.upkeepInterval;
      
      minDuration = Math.min(minDuration, duration);
    }
    
    return minDuration;
  }

  /**
   * Register a piece as protected
   */
  registerPiece(piece) {
    if (this.contains(piece.position)) {
      this.protectedPieces.add(piece);
      return true;
    }
    return false;
  }

  /**
   * Unregister a piece
   */
  unregisterPiece(piece) {
    this.protectedPieces.delete(piece);
  }

  /**
   * Get status for UI display
   */
  getStatus() {
    const cost = this.calculateUpkeepCost();
    
    return {
      id: this.id,
      position: this.position.clone(),
      radius: this.radius,
      authorizedCount: this.authorizedPlayers.size,
      protectedPieces: this.protectedPieces.size,
      resources: this.getResourceStatus(),
      upkeepCost: cost,
      hasUpkeep: this.hasUpkeep(),
      timeUntilUpkeep: this.getTimeUntilNextUpkeep(),
      timeUntilDecay: this.getTimeUntilDecay()
    };
  }
}
```

## Upkeep Scaling

The Rust pattern scales upkeep costs non-linearly with base size, creating a natural limit on sustainable base sizes.

```javascript
/**
 * UpkeepSystem - Manages upkeep calculations and scaling
 */
export class UpkeepSystem {
  constructor(options = {}) {
    this.scalingMode = options.scalingMode ?? 'exponential';
    this.baseCostMultiplier = options.baseCostMultiplier ?? 1.0;
    
    // Scaling brackets (Rust-inspired)
    this.brackets = options.brackets ?? [
      { pieces: 15, multiplier: 1.0 },    // First 15 pieces: 1x
      { pieces: 50, multiplier: 1.5 },    // 16-50: 1.5x
      { pieces: 100, multiplier: 2.0 },   // 51-100: 2x
      { pieces: 200, multiplier: 3.0 },   // 101-200: 3x
      { pieces: Infinity, multiplier: 5.0 } // 200+: 5x
    ];
  }

  /**
   * Calculate scaled upkeep for a Tool Cupboard
   */
  calculateScaledUpkeep(toolCupboard) {
    const pieces = Array.from(toolCupboard.protectedPieces);
    const baseCost = toolCupboard.calculateUpkeepCost();
    
    // Sort pieces by value (higher tier first for bracket calculation)
    pieces.sort((a, b) => {
      const tierA = this.getMaterialTier(a.material);
      const tierB = this.getMaterialTier(b.material);
      return tierB - tierA;
    });

    // Calculate per-piece costs with brackets
    let pieceCount = 0;
    const scaledCost = {};
    
    for (const piece of pieces) {
      const multiplier = this.getBracketMultiplier(pieceCount);
      const pieceCost = toolCupboard.getPieceUpkeepCost(piece);
      
      for (const [type, amount] of Object.entries(pieceCost)) {
        const scaled = amount * multiplier * this.baseCostMultiplier;
        scaledCost[type] = (scaledCost[type] ?? 0) + scaled;
      }
      
      pieceCount++;
    }

    // Round up to integers
    for (const type of Object.keys(scaledCost)) {
      scaledCost[type] = Math.ceil(scaledCost[type]);
    }

    return {
      baseCost,
      scaledCost,
      pieceCount,
      scalingFactor: this.getAverageScaling(pieceCount)
    };
  }

  /**
   * Get bracket multiplier for piece count
   */
  getBracketMultiplier(pieceIndex) {
    let cumulative = 0;
    
    for (const bracket of this.brackets) {
      cumulative += bracket.pieces;
      if (pieceIndex < cumulative) {
        return bracket.multiplier;
      }
    }
    
    return this.brackets[this.brackets.length - 1].multiplier;
  }

  /**
   * Get average scaling for piece count
   */
  getAverageScaling(totalPieces) {
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
   * Get material tier for sorting
   */
  getMaterialTier(material) {
    const tiers = { TWIG: 0, WOOD: 1, STONE: 2, METAL: 3, ARMORED: 4 };
    return tiers[material?.name?.toUpperCase()] ?? 0;
  }

  /**
   * Preview upkeep cost for adding pieces
   */
  previewAddition(toolCupboard, newPieces) {
    // Create temporary cupboard state
    const tempPieces = new Set(toolCupboard.protectedPieces);
    newPieces.forEach(p => tempPieces.add(p));
    
    const currentCost = this.calculateScaledUpkeep(toolCupboard);
    
    // Calculate with new pieces
    const tempTC = {
      ...toolCupboard,
      protectedPieces: tempPieces,
      calculateUpkeepCost: toolCupboard.calculateUpkeepCost.bind(toolCupboard),
      getPieceUpkeepCost: toolCupboard.getPieceUpkeepCost.bind(toolCupboard)
    };
    
    const newCost = this.calculateScaledUpkeep(tempTC);
    
    // Calculate increase
    const increase = {};
    for (const type of Object.keys(newCost.scaledCost)) {
      increase[type] = (newCost.scaledCost[type] ?? 0) - (currentCost.scaledCost[type] ?? 0);
    }
    
    return {
      currentCost: currentCost.scaledCost,
      newCost: newCost.scaledCost,
      increase,
      newPieceCount: tempPieces.size
    };
  }
}
```

## Server Cleanup Scheduler

For server administrators, automatic cleanup of abandoned structures is essential for maintaining performance.

```javascript
/**
 * CleanupScheduler - Automated cleanup of decayed structures
 */
export class CleanupScheduler {
  constructor(options = {}) {
    this.decayManager = options.decayManager;
    this.cleanupInterval = options.cleanupInterval ?? 60 * 60 * 1000; // 1 hour
    this.lastCleanup = 0;
    
    // Cleanup thresholds
    this.destroyThreshold = options.destroyThreshold ?? 0; // Health % to destroy
    this.warnThreshold = options.warnThreshold ?? 25; // Health % to warn owners
    
    // Batch processing
    this.batchSize = options.batchSize ?? 100;
    
    // Callbacks
    this.onCleanup = options.onCleanup ?? null;
    this.onWarning = options.onWarning ?? null;
  }

  /**
   * Run cleanup check
   */
  tick(currentTime) {
    if (currentTime - this.lastCleanup < this.cleanupInterval) {
      return { ran: false };
    }

    this.lastCleanup = currentTime;
    return this.runCleanup();
  }

  /**
   * Execute cleanup pass
   */
  runCleanup() {
    const destroyed = [];
    const warned = [];
    let processed = 0;

    for (const [id, data] of this.decayManager.pieces) {
      if (processed >= this.batchSize) break;
      
      const piece = data.piece;
      const healthPercent = (piece.health / piece.maxHealth) * 100;
      
      if (healthPercent <= this.destroyThreshold) {
        destroyed.push(piece);
        this.decayManager.removePiece(id);
      } else if (healthPercent <= this.warnThreshold) {
        warned.push(piece);
      }
      
      processed++;
    }

    // Notify callbacks
    if (destroyed.length > 0 && this.onCleanup) {
      this.onCleanup(destroyed);
    }
    
    if (warned.length > 0 && this.onWarning) {
      this.onWarning(warned);
    }

    return {
      ran: true,
      destroyed: destroyed.length,
      warned: warned.length,
      processed
    };
  }

  /**
   * Force immediate cleanup of specific structure
   */
  forceCleanup(structureId) {
    const pieces = [];
    
    for (const [id, data] of this.decayManager.pieces) {
      if (data.piece.structureId === structureId) {
        pieces.push(id);
      }
    }
    
    for (const id of pieces) {
      this.decayManager.removePiece(id);
    }
    
    return { removed: pieces.length };
  }

  /**
   * Get decay statistics for server admin
   */
  getStatistics() {
    let total = 0;
    let healthy = 0;
    let damaged = 0;
    let critical = 0;
    let decaying = 0;
    
    for (const [id, data] of this.decayManager.pieces) {
      total++;
      
      switch (data.damageState) {
        case 'healthy': healthy++; break;
        case 'damaged': damaged++; break;
        case 'critical': critical++; break;
        case 'failing': decaying++; break;
      }
    }
    
    return {
      total,
      healthy,
      damaged,
      critical,
      decaying,
      protectedAreas: this.decayManager.protectedAreas.length
    };
  }
}
```

## Raid Delay Mechanics

Many games delay decay for recently-raided bases to prevent abuse (destroying part of a base to let decay finish it).

```javascript
/**
 * RaidProtection - Delays decay after combat damage
 */
export class RaidProtection {
  constructor(options = {}) {
    this.protectionDuration = options.protectionDuration ?? 30 * 60 * 1000; // 30 min
    this.raidedStructures = new Map(); // structureId -> timestamp
  }

  /**
   * Mark structure as raided (combat damage received)
   */
  markRaided(structureId) {
    this.raidedStructures.set(structureId, Date.now());
  }

  /**
   * Check if structure has raid protection
   */
  hasProtection(structureId) {
    const raidTime = this.raidedStructures.get(structureId);
    if (!raidTime) return false;
    
    const elapsed = Date.now() - raidTime;
    if (elapsed > this.protectionDuration) {
      this.raidedStructures.delete(structureId);
      return false;
    }
    
    return true;
  }

  /**
   * Get remaining protection time
   */
  getRemainingProtection(structureId) {
    const raidTime = this.raidedStructures.get(structureId);
    if (!raidTime) return 0;
    
    const elapsed = Date.now() - raidTime;
    return Math.max(0, this.protectionDuration - elapsed);
  }

  /**
   * Integrate with decay manager
   */
  wrapDecayManager(decayManager) {
    const originalIsProtected = decayManager.isProtected.bind(decayManager);
    
    decayManager.isProtected = (piece) => {
      // Check raid protection first
      if (piece.structureId && this.hasProtection(piece.structureId)) {
        return true;
      }
      
      // Fall back to normal protection check
      return originalIsProtected(piece);
    };
  }
}
```

## Integration Checklist

When implementing decay and upkeep:

- [ ] Define decay rates for each material tier
- [ ] Implement Tool Cupboard or equivalent protection system
- [ ] Add resource storage with capacity limits
- [ ] Implement upkeep cost calculation with scaling
- [ ] Create visual feedback for damage states
- [ ] Add server-side cleanup scheduler
- [ ] Consider raid delay mechanics
- [ ] Test with various base sizes for balance
- [ ] Add UI for upkeep status and time remaining
- [ ] Network upkeep state in multiplayer

## Related References

- `structural-physics` skill - Damage states feed into collapse
- `multiplayer-building` skill - Sync decay and upkeep state
- `performance-at-scale` skill - Cleanup helps entity management
