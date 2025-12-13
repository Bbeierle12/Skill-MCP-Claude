/**
 * BlueprintManager - Save, load, and share building designs
 * 
 * Serializes building structures into portable blueprints that can be
 * saved, shared, and placed elsewhere. Used in games like Rust, 
 * Satisfactory, and No Man's Sky for building prefabs.
 * 
 * Usage:
 *   const blueprints = new BlueprintManager();
 *   const { blueprint } = blueprints.save(selectedPieces, 'My Base');
 *   const { pieces } = blueprints.load(blueprint.id, newPosition);
 */

import * as THREE from 'three';

/**
 * Blueprint format version for compatibility
 */
export const BLUEPRINT_VERSION = 1;

/**
 * Blueprint validation result
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether blueprint is valid
 * @property {Array} errors - List of validation errors
 * @property {Array} warnings - List of warnings
 */

export class BlueprintManager {
  /**
   * Create blueprint manager
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.blueprints = new Map();
    this.maxBlueprints = options.maxBlueprints ?? 100;
    this.maxPiecesPerBlueprint = options.maxPiecesPerBlueprint ?? 500;
    
    // Storage backend
    this.storage = options.storage ?? null;
    this.storageKey = options.storageKey ?? 'building_blueprints';
    
    // Thumbnail generation
    this.thumbnailEnabled = options.thumbnailEnabled ?? true;
    this.thumbnailSize = options.thumbnailSize ?? 128;
    
    // Event callbacks
    this.onSave = options.onSave ?? null;
    this.onLoad = options.onLoad ?? null;
    this.onDelete = options.onDelete ?? null;
    
    // Load existing blueprints from storage
    if (this.storage) {
      this.loadFromStorage();
    }
  }

  /**
   * Save pieces as a blueprint
   * @param {Array} pieces - Building pieces to save
   * @param {string} name - Blueprint name
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Save result with blueprint
   */
  save(pieces, name, metadata = {}) {
    // Validation
    if (!pieces || pieces.length === 0) {
      return { success: false, reason: 'No pieces provided' };
    }
    
    if (pieces.length > this.maxPiecesPerBlueprint) {
      return { 
        success: false, 
        reason: `Exceeds maximum pieces (${this.maxPiecesPerBlueprint})` 
      };
    }
    
    if (this.blueprints.size >= this.maxBlueprints) {
      return { 
        success: false, 
        reason: `Blueprint limit reached (${this.maxBlueprints})` 
      };
    }

    // Calculate bounds and origin
    const bounds = this.calculateBounds(pieces);
    const origin = this.calculateOrigin(bounds);

    // Convert pieces to relative coordinates
    const blueprintPieces = pieces.map(piece => this.serializePiece(piece, origin));

    // Adjust bounds to be relative
    const relativeBounds = {
      min: {
        x: bounds.min.x - origin.x,
        y: bounds.min.y - origin.y,
        z: bounds.min.z - origin.z
      },
      max: {
        x: bounds.max.x - origin.x,
        y: bounds.max.y - origin.y,
        z: bounds.max.z - origin.z
      }
    };

    // Create blueprint object
    const blueprint = {
      id: this.generateId(),
      version: BLUEPRINT_VERSION,
      name: name || 'Untitled Blueprint',
      created: Date.now(),
      modified: Date.now(),
      bounds: relativeBounds,
      size: {
        x: relativeBounds.max.x - relativeBounds.min.x,
        y: relativeBounds.max.y - relativeBounds.min.y,
        z: relativeBounds.max.z - relativeBounds.min.z
      },
      pieces: blueprintPieces,
      metadata: {
        author: metadata.author ?? 'Unknown',
        description: metadata.description ?? '',
        tags: metadata.tags ?? [],
        pieceCount: pieces.length,
        materialCounts: this.countMaterials(pieces),
        thumbnail: null
      }
    };

    // Store blueprint
    this.blueprints.set(blueprint.id, blueprint);
    
    // Persist to storage
    this.persistBlueprint(blueprint);

    // Callback
    if (this.onSave) {
      this.onSave(blueprint);
    }

    return { success: true, blueprint };
  }

  /**
   * Load blueprint and generate pieces at position
   * @param {string} blueprintId - Blueprint to load
   * @param {THREE.Vector3} position - World position to place at
   * @param {number} rotation - Y-axis rotation in radians
   * @returns {Object} Load result with pieces array
   */
  load(blueprintId, position, rotation = 0) {
    const blueprint = this.blueprints.get(blueprintId);
    
    if (!blueprint) {
      return { success: false, reason: 'Blueprint not found' };
    }

    // Validate version compatibility
    if (blueprint.version > BLUEPRINT_VERSION) {
      return { 
        success: false, 
        reason: `Blueprint version ${blueprint.version} not supported` 
      };
    }

    // Generate pieces with world positions
    const pieces = blueprint.pieces.map(piece => 
      this.deserializePiece(piece, position, rotation)
    );

    // Update last used time
    blueprint.metadata.lastUsed = Date.now();
    this.persistBlueprint(blueprint);

    // Callback
    if (this.onLoad) {
      this.onLoad(blueprint, pieces);
    }

    return { success: true, pieces, blueprint };
  }

  /**
   * Preview blueprint without placing (for ghost display)
   * @param {string} blueprintId - Blueprint to preview
   * @param {THREE.Vector3} position - Preview position
   * @param {number} rotation - Y-axis rotation
   * @returns {Object} Preview data
   */
  preview(blueprintId, position, rotation = 0) {
    const result = this.load(blueprintId, position, rotation);
    
    if (result.success) {
      return {
        success: true,
        pieces: result.pieces,
        bounds: this.getTransformedBounds(result.blueprint, position, rotation)
      };
    }
    
    return result;
  }

  /**
   * Get blueprint by ID
   * @param {string} blueprintId - Blueprint ID
   * @returns {Object|null} Blueprint or null
   */
  get(blueprintId) {
    return this.blueprints.get(blueprintId) ?? null;
  }

  /**
   * Delete a blueprint
   * @param {string} blueprintId - Blueprint to delete
   * @returns {Object} Delete result
   */
  delete(blueprintId) {
    const blueprint = this.blueprints.get(blueprintId);
    
    if (!blueprint) {
      return { success: false, reason: 'Blueprint not found' };
    }
    
    this.blueprints.delete(blueprintId);
    this.removeFromStorage(blueprintId);
    
    if (this.onDelete) {
      this.onDelete(blueprint);
    }
    
    return { success: true };
  }

  /**
   * Rename a blueprint
   * @param {string} blueprintId - Blueprint to rename
   * @param {string} newName - New name
   * @returns {Object} Rename result
   */
  rename(blueprintId, newName) {
    const blueprint = this.blueprints.get(blueprintId);
    
    if (!blueprint) {
      return { success: false, reason: 'Blueprint not found' };
    }
    
    blueprint.name = newName;
    blueprint.modified = Date.now();
    this.persistBlueprint(blueprint);
    
    return { success: true, blueprint };
  }

  /**
   * Update blueprint metadata
   * @param {string} blueprintId - Blueprint to update
   * @param {Object} updates - Metadata updates
   * @returns {Object} Update result
   */
  updateMetadata(blueprintId, updates) {
    const blueprint = this.blueprints.get(blueprintId);
    
    if (!blueprint) {
      return { success: false, reason: 'Blueprint not found' };
    }
    
    Object.assign(blueprint.metadata, updates);
    blueprint.modified = Date.now();
    this.persistBlueprint(blueprint);
    
    return { success: true, blueprint };
  }

  /**
   * List all blueprints
   * @param {Object} options - Filter and sort options
   * @returns {Array} Blueprint summaries
   */
  list(options = {}) {
    let blueprints = Array.from(this.blueprints.values());
    
    // Filter by tag
    if (options.tag) {
      blueprints = blueprints.filter(bp => 
        bp.metadata.tags.includes(options.tag)
      );
    }
    
    // Filter by search term
    if (options.search) {
      const term = options.search.toLowerCase();
      blueprints = blueprints.filter(bp => 
        bp.name.toLowerCase().includes(term) ||
        bp.metadata.description.toLowerCase().includes(term)
      );
    }
    
    // Sort
    const sortField = options.sortBy ?? 'modified';
    const sortDir = options.sortDir ?? 'desc';
    
    blueprints.sort((a, b) => {
      let aVal = sortField === 'name' ? a.name : a[sortField];
      let bVal = sortField === 'name' ? b.name : b[sortField];
      
      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }
      
      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === 'desc' ? -comparison : comparison;
    });
    
    // Return summaries
    return blueprints.map(bp => ({
      id: bp.id,
      name: bp.name,
      pieceCount: bp.metadata.pieceCount,
      size: bp.size,
      tags: bp.metadata.tags,
      created: bp.created,
      modified: bp.modified,
      thumbnail: bp.metadata.thumbnail
    }));
  }

  /**
   * Export blueprint as JSON string
   * @param {string} blueprintId - Blueprint to export
   * @returns {string|null} JSON string or null
   */
  export(blueprintId) {
    const blueprint = this.blueprints.get(blueprintId);
    
    if (!blueprint) return null;
    
    // Create export copy without internal fields
    const exportData = {
      ...blueprint,
      exportedAt: Date.now(),
      exportVersion: BLUEPRINT_VERSION
    };
    
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import blueprint from JSON string
   * @param {string} jsonString - JSON blueprint data
   * @returns {Object} Import result
   */
  import(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      
      // Validate structure
      const validation = this.validateBlueprint(data);
      if (!validation.valid) {
        return { 
          success: false, 
          reason: 'Invalid blueprint format',
          errors: validation.errors 
        };
      }
      
      // Generate new ID to avoid conflicts
      const blueprint = {
        ...data,
        id: this.generateId(),
        imported: true,
        importedAt: Date.now(),
        modified: Date.now()
      };
      
      // Store
      this.blueprints.set(blueprint.id, blueprint);
      this.persistBlueprint(blueprint);
      
      return { success: true, blueprint };
      
    } catch (e) {
      return { success: false, reason: `Parse error: ${e.message}` };
    }
  }

  /**
   * Validate blueprint structure
   * @param {Object} data - Blueprint data to validate
   * @returns {ValidationResult} Validation result
   */
  validateBlueprint(data) {
    const errors = [];
    const warnings = [];
    
    // Required fields
    if (!data.pieces || !Array.isArray(data.pieces)) {
      errors.push('Missing or invalid pieces array');
    }
    
    if (!data.name) {
      warnings.push('Missing name, will use default');
    }
    
    // Version check
    if (data.version && data.version > BLUEPRINT_VERSION) {
      errors.push(`Unsupported version: ${data.version}`);
    }
    
    // Piece validation
    if (data.pieces) {
      for (let i = 0; i < data.pieces.length; i++) {
        const piece = data.pieces[i];
        
        if (!piece.type) {
          errors.push(`Piece ${i}: missing type`);
        }
        
        if (!piece.localPosition) {
          errors.push(`Piece ${i}: missing localPosition`);
        }
      }
      
      if (data.pieces.length > this.maxPiecesPerBlueprint) {
        errors.push(`Too many pieces: ${data.pieces.length} (max: ${this.maxPiecesPerBlueprint})`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Duplicate a blueprint
   * @param {string} blueprintId - Blueprint to duplicate
   * @param {string} newName - Name for duplicate
   * @returns {Object} Duplicate result
   */
  duplicate(blueprintId, newName) {
    const original = this.blueprints.get(blueprintId);
    
    if (!original) {
      return { success: false, reason: 'Blueprint not found' };
    }
    
    const duplicate = {
      ...JSON.parse(JSON.stringify(original)),
      id: this.generateId(),
      name: newName || `${original.name} (Copy)`,
      created: Date.now(),
      modified: Date.now()
    };
    
    this.blueprints.set(duplicate.id, duplicate);
    this.persistBlueprint(duplicate);
    
    return { success: true, blueprint: duplicate };
  }

  /**
   * Calculate bounding box of pieces
   */
  calculateBounds(pieces) {
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    
    for (const piece of pieces) {
      const pos = piece.position;
      min.x = Math.min(min.x, pos.x);
      min.y = Math.min(min.y, pos.y);
      min.z = Math.min(min.z, pos.z);
      max.x = Math.max(max.x, pos.x);
      max.y = Math.max(max.y, pos.y);
      max.z = Math.max(max.z, pos.z);
    }
    
    return { min, max };
  }

  /**
   * Calculate blueprint origin (center bottom)
   */
  calculateOrigin(bounds) {
    return new THREE.Vector3(
      (bounds.min.x + bounds.max.x) / 2,
      bounds.min.y, // Keep Y at base
      (bounds.min.z + bounds.max.z) / 2
    );
  }

  /**
   * Serialize a piece for storage
   */
  serializePiece(piece, origin) {
    return {
      type: piece.type,
      localPosition: {
        x: piece.position.x - origin.x,
        y: piece.position.y - origin.y,
        z: piece.position.z - origin.z
      },
      rotation: {
        x: piece.rotation?.x ?? 0,
        y: piece.rotation?.y ?? 0,
        z: piece.rotation?.z ?? 0
      },
      material: piece.material?.name ?? 'wood',
      variant: piece.variant ?? null,
      customData: piece.customData ?? null
    };
  }

  /**
   * Deserialize a piece to world coordinates
   */
  deserializePiece(piece, worldOrigin, rotation) {
    // Rotate local position around Y axis
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    
    const rotatedX = piece.localPosition.x * cos - piece.localPosition.z * sin;
    const rotatedZ = piece.localPosition.x * sin + piece.localPosition.z * cos;
    
    return {
      type: piece.type,
      position: new THREE.Vector3(
        worldOrigin.x + rotatedX,
        worldOrigin.y + piece.localPosition.y,
        worldOrigin.z + rotatedZ
      ),
      rotation: new THREE.Euler(
        piece.rotation.x,
        piece.rotation.y + rotation,
        piece.rotation.z
      ),
      material: { name: piece.material },
      variant: piece.variant,
      customData: piece.customData
    };
  }

  /**
   * Get transformed bounds for a blueprint placement
   */
  getTransformedBounds(blueprint, position, rotation) {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const bounds = blueprint.bounds;
    
    // Rotate corners
    const corners = [
      { x: bounds.min.x, z: bounds.min.z },
      { x: bounds.max.x, z: bounds.min.z },
      { x: bounds.max.x, z: bounds.max.z },
      { x: bounds.min.x, z: bounds.max.z }
    ];
    
    const transformed = corners.map(c => ({
      x: position.x + (c.x * cos - c.z * sin),
      z: position.z + (c.x * sin + c.z * cos)
    }));
    
    return {
      min: {
        x: Math.min(...transformed.map(c => c.x)),
        y: position.y + bounds.min.y,
        z: Math.min(...transformed.map(c => c.z))
      },
      max: {
        x: Math.max(...transformed.map(c => c.x)),
        y: position.y + bounds.max.y,
        z: Math.max(...transformed.map(c => c.z))
      }
    };
  }

  /**
   * Count materials in piece collection
   */
  countMaterials(pieces) {
    const counts = {};
    
    for (const piece of pieces) {
      const material = piece.material?.name ?? 'unknown';
      counts[material] = (counts[material] ?? 0) + 1;
    }
    
    return counts;
  }

  /**
   * Generate unique ID
   */
  generateId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 8);
    return `bp_${timestamp}_${random}`;
  }

  /**
   * Persist blueprint to storage
   */
  persistBlueprint(blueprint) {
    if (!this.storage) return;
    
    try {
      const all = JSON.parse(this.storage.getItem(this.storageKey) || '{}');
      all[blueprint.id] = blueprint;
      this.storage.setItem(this.storageKey, JSON.stringify(all));
    } catch (e) {
      console.warn('Failed to persist blueprint:', e);
    }
  }

  /**
   * Remove blueprint from storage
   */
  removeFromStorage(blueprintId) {
    if (!this.storage) return;
    
    try {
      const all = JSON.parse(this.storage.getItem(this.storageKey) || '{}');
      delete all[blueprintId];
      this.storage.setItem(this.storageKey, JSON.stringify(all));
    } catch (e) {
      console.warn('Failed to remove blueprint from storage:', e);
    }
  }

  /**
   * Load all blueprints from storage
   */
  loadFromStorage() {
    if (!this.storage) return;
    
    try {
      const all = JSON.parse(this.storage.getItem(this.storageKey) || '{}');
      
      for (const [id, blueprint] of Object.entries(all)) {
        this.blueprints.set(id, blueprint);
      }
    } catch (e) {
      console.warn('Failed to load blueprints from storage:', e);
    }
  }

  /**
   * Clear all blueprints
   */
  clear() {
    this.blueprints.clear();
    
    if (this.storage) {
      this.storage.removeItem(this.storageKey);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    let totalPieces = 0;
    
    for (const bp of this.blueprints.values()) {
      totalPieces += bp.metadata.pieceCount;
    }
    
    return {
      count: this.blueprints.size,
      maxBlueprints: this.maxBlueprints,
      totalPieces,
      averagePieces: this.blueprints.size > 0 
        ? Math.round(totalPieces / this.blueprints.size) 
        : 0
    };
  }
}

export default BlueprintManager;
