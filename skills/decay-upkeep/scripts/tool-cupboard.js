/**
 * ToolCupboard - Protection zone with authorization and resource storage
 * 
 * Implements Rust-style Tool Cupboard mechanics: spherical protection zone,
 * player authorization, and resource storage for upkeep payment.
 * 
 * Usage:
 *   const tc = new ToolCupboard({ radius: 30, ownerId: 'player1' });
 *   tc.setPosition(position);
 *   tc.authorize('player2', 'player1');
 *   tc.depositResources({ wood: 1000 });
 */

import * as THREE from 'three';

/**
 * Authorization levels
 */
export const AuthLevel = {
  NONE: 'none',
  BUILD: 'build',       // Can build in zone
  MANAGE: 'manage',     // Can authorize others
  OWNER: 'owner'        // Full control
};

export class ToolCupboard {
  /**
   * Create Tool Cupboard
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.id = options.id ?? `tc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.position = options.position ? new THREE.Vector3().copy(options.position) : new THREE.Vector3();
    this.radius = options.radius ?? 30;
    this.radiusSquared = this.radius * this.radius;
    
    // Authorization
    this.ownerId = options.ownerId ?? null;
    this.authorizedPlayers = new Map(); // playerId -> AuthLevel
    if (this.ownerId) {
      this.authorizedPlayers.set(this.ownerId, AuthLevel.OWNER);
    }
    
    // Resource storage
    this.resources = new Map();
    this.maxStorage = options.maxStorage ?? {
      wood: 10000,
      stone: 10000,
      metal: 5000,
      highQuality: 1000,
      thatch: 5000,
      fiber: 5000
    };
    
    // Protected pieces
    this.protectedPieces = new Set();
    
    // Upkeep tracking
    this.lastUpkeepTime = Date.now();
    this.upkeepInterval = options.upkeepInterval ?? 24 * 60 * 60 * 1000;
    this.upkeepBuffer = options.upkeepBuffer ?? 3 * 24 * 60 * 60 * 1000;
    this.upkeepPaid = true;
    
    // Callbacks
    this.onAuthorized = options.onAuthorized ?? null;
    this.onDeauthorized = options.onDeauthorized ?? null;
    this.onResourcesChanged = options.onResourcesChanged ?? null;
    this.onUpkeepFailed = options.onUpkeepFailed ?? null;
  }

  /**
   * Set position of Tool Cupboard
   * @param {THREE.Vector3} position - New position
   */
  setPosition(position) {
    this.position.copy(position);
    this.updateProtectedPieces();
  }

  /**
   * Check if position is within protection radius
   * @param {THREE.Vector3} position - Position to check
   * @returns {boolean} Whether position is protected
   */
  contains(position) {
    const dx = position.x - this.position.x;
    const dy = position.y - this.position.y;
    const dz = position.z - this.position.z;
    return (dx * dx + dy * dy + dz * dz) <= this.radiusSquared;
  }

  /**
   * Get distance from TC center
   * @param {THREE.Vector3} position - Position to measure
   * @returns {number} Distance in units
   */
  getDistance(position) {
    return this.position.distanceTo(position);
  }

  /**
   * Check if player is authorized
   * @param {string} playerId - Player to check
   * @param {string} requiredLevel - Minimum auth level required
   * @returns {boolean} Whether player has required authorization
   */
  isAuthorized(playerId, requiredLevel = AuthLevel.BUILD) {
    const level = this.authorizedPlayers.get(playerId);
    if (!level) return false;
    
    const levels = [AuthLevel.NONE, AuthLevel.BUILD, AuthLevel.MANAGE, AuthLevel.OWNER];
    const playerIndex = levels.indexOf(level);
    const requiredIndex = levels.indexOf(requiredLevel);
    
    return playerIndex >= requiredIndex;
  }

  /**
   * Get player's authorization level
   * @param {string} playerId - Player to check
   * @returns {string} Authorization level
   */
  getAuthLevel(playerId) {
    return this.authorizedPlayers.get(playerId) ?? AuthLevel.NONE;
  }

  /**
   * Authorize a player
   * @param {string} playerId - Player to authorize
   * @param {string} authorizingPlayerId - Player performing authorization
   * @param {string} level - Authorization level to grant
   * @returns {Object} Result of authorization attempt
   */
  authorize(playerId, authorizingPlayerId, level = AuthLevel.BUILD) {
    // Check if authorizing player has permission
    if (!this.isAuthorized(authorizingPlayerId, AuthLevel.MANAGE)) {
      return { 
        success: false, 
        reason: 'Insufficient permissions to authorize players' 
      };
    }

    // Cannot grant higher level than own
    const authorizerLevel = this.getAuthLevel(authorizingPlayerId);
    const levels = [AuthLevel.NONE, AuthLevel.BUILD, AuthLevel.MANAGE, AuthLevel.OWNER];
    
    if (levels.indexOf(level) > levels.indexOf(authorizerLevel)) {
      return { 
        success: false, 
        reason: 'Cannot grant authorization level higher than own' 
      };
    }

    // Cannot change owner
    if (playerId === this.ownerId && level !== AuthLevel.OWNER) {
      return { 
        success: false, 
        reason: 'Cannot change owner authorization level' 
      };
    }

    this.authorizedPlayers.set(playerId, level);

    if (this.onAuthorized) {
      this.onAuthorized(playerId, level, authorizingPlayerId);
    }

    return { 
      success: true, 
      playerId, 
      level,
      totalAuthorized: this.authorizedPlayers.size 
    };
  }

  /**
   * Deauthorize a player
   * @param {string} playerId - Player to deauthorize
   * @param {string} deauthorizingPlayerId - Player performing deauthorization
   * @returns {Object} Result of deauthorization attempt
   */
  deauthorize(playerId, deauthorizingPlayerId) {
    if (!this.isAuthorized(deauthorizingPlayerId, AuthLevel.MANAGE)) {
      return { 
        success: false, 
        reason: 'Insufficient permissions to deauthorize players' 
      };
    }

    if (playerId === this.ownerId) {
      return { 
        success: false, 
        reason: 'Cannot deauthorize owner' 
      };
    }

    const hadAuth = this.authorizedPlayers.has(playerId);
    this.authorizedPlayers.delete(playerId);

    if (hadAuth && this.onDeauthorized) {
      this.onDeauthorized(playerId, deauthorizingPlayerId);
    }

    return { 
      success: hadAuth, 
      reason: hadAuth ? null : 'Player was not authorized',
      totalAuthorized: this.authorizedPlayers.size
    };
  }

  /**
   * Clear all authorizations except owner
   * @param {string} requestingPlayerId - Player requesting clear
   * @returns {Object} Result
   */
  clearAuthorizations(requestingPlayerId) {
    if (!this.isAuthorized(requestingPlayerId, AuthLevel.OWNER)) {
      return { 
        success: false, 
        reason: 'Only owner can clear all authorizations' 
      };
    }

    const count = this.authorizedPlayers.size - 1; // Exclude owner
    
    this.authorizedPlayers.clear();
    this.authorizedPlayers.set(this.ownerId, AuthLevel.OWNER);

    return { success: true, cleared: count };
  }

  /**
   * Get list of authorized players
   * @returns {Array} List of authorized players with levels
   */
  getAuthorizedPlayers() {
    const players = [];
    for (const [playerId, level] of this.authorizedPlayers) {
      players.push({ playerId, level, isOwner: playerId === this.ownerId });
    }
    return players;
  }

  /**
   * Deposit resources for upkeep
   * @param {Object} resources - Resources to deposit
   * @returns {Object} Deposit result
   */
  depositResources(resources) {
    const deposited = {};
    const rejected = {};

    for (const [type, amount] of Object.entries(resources)) {
      if (amount <= 0) continue;

      const current = this.resources.get(type) ?? 0;
      const max = this.maxStorage[type] ?? 0;

      if (max === 0) {
        rejected[type] = { amount, reason: 'Resource type not accepted' };
        continue;
      }

      const canDeposit = Math.min(amount, max - current);

      if (canDeposit > 0) {
        this.resources.set(type, current + canDeposit);
        deposited[type] = canDeposit;
      }

      if (canDeposit < amount) {
        rejected[type] = { 
          amount: amount - canDeposit, 
          reason: 'Storage full' 
        };
      }
    }

    if (Object.keys(deposited).length > 0 && this.onResourcesChanged) {
      this.onResourcesChanged('deposit', deposited);
    }

    return { 
      deposited, 
      rejected: Object.keys(rejected).length > 0 ? rejected : null,
      storage: this.getResourceStatus() 
    };
  }

  /**
   * Withdraw resources from storage
   * @param {Object} resources - Resources to withdraw
   * @param {string} playerId - Player withdrawing
   * @returns {Object} Withdrawal result
   */
  withdrawResources(resources, playerId) {
    if (!this.isAuthorized(playerId, AuthLevel.BUILD)) {
      return { success: false, reason: 'Not authorized' };
    }

    const withdrawn = {};
    const insufficient = {};

    for (const [type, amount] of Object.entries(resources)) {
      if (amount <= 0) continue;

      const current = this.resources.get(type) ?? 0;
      const canWithdraw = Math.min(amount, current);

      if (canWithdraw > 0) {
        this.resources.set(type, current - canWithdraw);
        withdrawn[type] = canWithdraw;
      }

      if (canWithdraw < amount) {
        insufficient[type] = amount - canWithdraw;
      }
    }

    if (Object.keys(withdrawn).length > 0 && this.onResourcesChanged) {
      this.onResourcesChanged('withdraw', withdrawn);
    }

    return { 
      withdrawn, 
      insufficient: Object.keys(insufficient).length > 0 ? insufficient : null,
      storage: this.getResourceStatus() 
    };
  }

  /**
   * Get current resource storage status
   * @returns {Object} Resource status
   */
  getResourceStatus() {
    const status = {};

    for (const type of Object.keys(this.maxStorage)) {
      const current = this.resources.get(type) ?? 0;
      const max = this.maxStorage[type];
      status[type] = {
        current,
        max,
        percent: max > 0 ? (current / max) * 100 : 0
      };
    }

    return status;
  }

  /**
   * Get total resources as object
   * @returns {Object} Resources
   */
  getResources() {
    return Object.fromEntries(this.resources);
  }

  /**
   * Register a piece as protected
   * @param {Object} piece - Piece to register
   * @returns {boolean} Whether piece was added
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
   * @param {Object} piece - Piece to unregister
   */
  unregisterPiece(piece) {
    this.protectedPieces.delete(piece);
  }

  /**
   * Update protected pieces (call after position change)
   */
  updateProtectedPieces() {
    for (const piece of this.protectedPieces) {
      if (!this.contains(piece.position)) {
        this.protectedPieces.delete(piece);
      }
    }
  }

  /**
   * Get protected pieces
   * @returns {Array} Array of protected pieces
   */
  getProtectedPieces() {
    return Array.from(this.protectedPieces);
  }

  /**
   * Calculate upkeep cost for protected pieces
   * @returns {Object} Upkeep cost by resource
   */
  calculateUpkeepCost() {
    const cost = {};

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
    const costs = {
      TWIG: { wood: 1 },
      WOOD: { wood: 5 },
      STONE: { stone: 10, wood: 2 },
      METAL: { metal: 5, stone: 5 },
      ARMORED: { highQuality: 2, metal: 10 }
    };

    const material = piece.material?.name?.toUpperCase() ?? 'WOOD';
    return costs[material] ?? costs.WOOD;
  }

  /**
   * Check if upkeep resources are available
   * @returns {boolean} Whether upkeep can be paid
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
   * @returns {Object} Payment result
   */
  processUpkeep() {
    const cost = this.calculateUpkeepCost();

    if (!this.hasUpkeep()) {
      this.upkeepPaid = false;
      
      if (this.onUpkeepFailed) {
        this.onUpkeepFailed(cost, this.getResources());
      }

      return { 
        success: false, 
        reason: 'Insufficient resources', 
        required: cost,
        available: this.getResources()
      };
    }

    // Deduct resources
    for (const [type, amount] of Object.entries(cost)) {
      const current = this.resources.get(type) ?? 0;
      this.resources.set(type, current - amount);
    }

    this.lastUpkeepTime = Date.now();
    this.upkeepPaid = true;

    if (this.onResourcesChanged) {
      this.onResourcesChanged('upkeep', cost);
    }

    return { 
      success: true, 
      cost, 
      nextUpkeep: this.getTimeUntilNextUpkeep(),
      storage: this.getResourceStatus()
    };
  }

  /**
   * Get time until next upkeep is due
   * @returns {number} Milliseconds until next upkeep
   */
  getTimeUntilNextUpkeep() {
    const elapsed = Date.now() - this.lastUpkeepTime;
    return Math.max(0, this.upkeepInterval - elapsed);
  }

  /**
   * Get time until decay starts
   * @returns {number} Milliseconds until decay begins
   */
  getTimeUntilDecay() {
    const cost = this.calculateUpkeepCost();
    let minIntervals = Infinity;

    for (const [type, amount] of Object.entries(cost)) {
      if (amount === 0) continue;

      const available = this.resources.get(type) ?? 0;
      const intervals = Math.floor(available / amount);
      minIntervals = Math.min(minIntervals, intervals);
    }

    const totalTime = minIntervals * this.upkeepInterval;
    return Math.min(totalTime, this.upkeepBuffer);
  }

  /**
   * Get comprehensive status for UI
   * @returns {Object} Full status
   */
  getStatus() {
    const cost = this.calculateUpkeepCost();

    return {
      id: this.id,
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      radius: this.radius,
      ownerId: this.ownerId,
      authorizedCount: this.authorizedPlayers.size,
      protectedPieceCount: this.protectedPieces.size,
      resources: this.getResourceStatus(),
      upkeepCost: cost,
      hasUpkeep: this.hasUpkeep(),
      upkeepPaid: this.upkeepPaid,
      timeUntilUpkeep: this.getTimeUntilNextUpkeep(),
      timeUntilDecay: this.getTimeUntilDecay(),
      lastUpkeepTime: this.lastUpkeepTime
    };
  }

  /**
   * Serialize for saving
   * @returns {Object} Serialized data
   */
  serialize() {
    return {
      version: 1,
      id: this.id,
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      radius: this.radius,
      ownerId: this.ownerId,
      authorizedPlayers: Array.from(this.authorizedPlayers.entries()),
      resources: Array.from(this.resources.entries()),
      lastUpkeepTime: this.lastUpkeepTime,
      upkeepPaid: this.upkeepPaid,
      protectedPieceIds: Array.from(this.protectedPieces).map(p => p.id)
    };
  }

  /**
   * Deserialize from saved data
   * @param {Object} data - Saved data
   * @param {Map} pieceMap - Map of piece IDs to pieces
   * @returns {ToolCupboard} Restored instance
   */
  static deserialize(data, pieceMap = new Map()) {
    const tc = new ToolCupboard({
      id: data.id,
      position: new THREE.Vector3(data.position.x, data.position.y, data.position.z),
      radius: data.radius,
      ownerId: data.ownerId
    });

    tc.authorizedPlayers = new Map(data.authorizedPlayers);
    tc.resources = new Map(data.resources);
    tc.lastUpkeepTime = data.lastUpkeepTime;
    tc.upkeepPaid = data.upkeepPaid;

    // Restore piece references
    for (const pieceId of data.protectedPieceIds) {
      const piece = pieceMap.get(pieceId);
      if (piece) {
        tc.protectedPieces.add(piece);
      }
    }

    return tc;
  }
}

export default ToolCupboard;
