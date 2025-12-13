/**
 * SelectionManager - Multi-selection and group operations
 * 
 * Handles piece selection including single click, shift+click additive,
 * and box/lasso selection. Enables batch operations like copy, delete,
 * upgrade on multiple pieces at once.
 * 
 * Usage:
 *   const selection = new SelectionManager({ maxSelection: 100 });
 *   selection.select(piece);
 *   selection.boxSelect(startPoint, endPoint, camera, allPieces);
 *   const selected = selection.getSelection();
 *   selection.clearSelection();
 */

import * as THREE from 'three';

/**
 * Selection modes
 */
export const SelectionMode = {
  SINGLE: 'single',
  ADDITIVE: 'additive',
  SUBTRACTIVE: 'subtractive',
  TOGGLE: 'toggle'
};

export class SelectionManager {
  /**
   * Create selection manager
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.selected = new Set();
    this.maxSelection = options.maxSelection ?? 500;
    
    // Visual feedback
    this.highlightEnabled = options.highlightEnabled ?? true;
    this.highlightColor = new THREE.Color(options.highlightColor ?? 0x00aaff);
    this.highlightIntensity = options.highlightIntensity ?? 0.4;
    this.outlineEnabled = options.outlineEnabled ?? true;
    
    // Selection box visualization
    this.boxHelper = null;
    this.boxMaterial = new THREE.LineBasicMaterial({ 
      color: options.boxColor ?? 0x00aaff,
      linewidth: 2
    });
    
    // Hover state
    this.hoveredPiece = null;
    this.hoverColor = new THREE.Color(options.hoverColor ?? 0xffff00);
    
    // Callbacks
    this.onSelectionChanged = options.onSelectionChanged ?? null;
    this.onHoverChanged = options.onHoverChanged ?? null;
  }

  /**
   * Select a single piece
   * @param {Object} piece - Piece to select
   * @param {string} mode - Selection mode
   * @returns {Object} Selection result
   */
  select(piece, mode = SelectionMode.SINGLE) {
    if (!piece) {
      return { success: false, reason: 'No piece provided' };
    }

    switch (mode) {
      case SelectionMode.SINGLE:
        return this.selectSingle(piece);
      case SelectionMode.ADDITIVE:
        return this.selectAdditive(piece);
      case SelectionMode.SUBTRACTIVE:
        return this.deselectPiece(piece);
      case SelectionMode.TOGGLE:
        return this.togglePiece(piece);
      default:
        return this.selectSingle(piece);
    }
  }

  /**
   * Select single piece, clearing previous selection
   */
  selectSingle(piece) {
    this.clearSelection(false); // Don't notify yet
    
    this.selected.add(piece);
    this.applyHighlight(piece, true);
    
    this.notifyChange();
    
    return { success: true, count: 1 };
  }

  /**
   * Add piece to selection
   */
  selectAdditive(piece) {
    if (this.selected.has(piece)) {
      return { success: true, count: this.selected.size, alreadySelected: true };
    }
    
    if (this.selected.size >= this.maxSelection) {
      return { success: false, reason: 'Selection limit reached' };
    }
    
    this.selected.add(piece);
    this.applyHighlight(piece, true);
    
    this.notifyChange();
    
    return { success: true, count: this.selected.size };
  }

  /**
   * Remove piece from selection
   */
  deselectPiece(piece) {
    if (!this.selected.has(piece)) {
      return { success: true, count: this.selected.size, wasSelected: false };
    }
    
    this.selected.delete(piece);
    this.applyHighlight(piece, false);
    
    this.notifyChange();
    
    return { success: true, count: this.selected.size };
  }

  /**
   * Toggle piece selection state
   */
  togglePiece(piece) {
    if (this.selected.has(piece)) {
      return this.deselectPiece(piece);
    } else {
      return this.selectAdditive(piece);
    }
  }

  /**
   * Select multiple pieces
   * @param {Array} pieces - Pieces to select
   * @param {boolean} additive - Add to existing selection
   * @returns {Object} Selection result
   */
  selectMultiple(pieces, additive = false) {
    if (!additive) {
      this.clearSelection(false);
    }
    
    let added = 0;
    let skipped = 0;
    
    for (const piece of pieces) {
      if (this.selected.size >= this.maxSelection) {
        skipped += pieces.length - added - skipped;
        break;
      }
      
      if (!this.selected.has(piece)) {
        this.selected.add(piece);
        this.applyHighlight(piece, true);
        added++;
      } else {
        skipped++;
      }
    }
    
    this.notifyChange();
    
    return { 
      success: true, 
      added, 
      skipped,
      total: this.selected.size 
    };
  }

  /**
   * Box/rectangle selection
   * @param {Object} startNDC - Start point in normalized device coordinates
   * @param {Object} endNDC - End point in normalized device coordinates
   * @param {THREE.Camera} camera - Active camera
   * @param {Array} pieces - All selectable pieces
   * @param {boolean} additive - Add to existing selection
   * @returns {Object} Selection result
   */
  boxSelect(startNDC, endNDC, camera, pieces, additive = false) {
    // Normalize box coordinates
    const minX = Math.min(startNDC.x, endNDC.x);
    const maxX = Math.max(startNDC.x, endNDC.x);
    const minY = Math.min(startNDC.y, endNDC.y);
    const maxY = Math.max(startNDC.y, endNDC.y);
    
    // Find pieces within box
    const toSelect = [];
    
    for (const piece of pieces) {
      const screenPos = this.worldToNDC(piece.position, camera);
      
      if (screenPos && 
          screenPos.x >= minX && screenPos.x <= maxX &&
          screenPos.y >= minY && screenPos.y <= maxY) {
        toSelect.push(piece);
      }
    }
    
    return this.selectMultiple(toSelect, additive);
  }

  /**
   * Sphere/radius selection
   * @param {THREE.Vector3} center - Center point in world space
   * @param {number} radius - Selection radius
   * @param {Array} pieces - All selectable pieces
   * @param {boolean} additive - Add to existing selection
   * @returns {Object} Selection result
   */
  radiusSelect(center, radius, pieces, additive = false) {
    const radiusSquared = radius * radius;
    const toSelect = [];
    
    for (const piece of pieces) {
      const distSquared = center.distanceToSquared(piece.position);
      if (distSquared <= radiusSquared) {
        toSelect.push(piece);
      }
    }
    
    return this.selectMultiple(toSelect, additive);
  }

  /**
   * Select all pieces of a specific type
   * @param {string} type - Piece type to select
   * @param {Array} pieces - All selectable pieces
   * @param {boolean} additive - Add to existing selection
   * @returns {Object} Selection result
   */
  selectByType(type, pieces, additive = false) {
    const toSelect = pieces.filter(p => p.type === type);
    return this.selectMultiple(toSelect, additive);
  }

  /**
   * Select all pieces of a specific material
   * @param {string} material - Material name to select
   * @param {Array} pieces - All selectable pieces
   * @param {boolean} additive - Add to existing selection
   * @returns {Object} Selection result
   */
  selectByMaterial(material, pieces, additive = false) {
    const toSelect = pieces.filter(p => 
      p.material?.name?.toLowerCase() === material.toLowerCase()
    );
    return this.selectMultiple(toSelect, additive);
  }

  /**
   * Select connected/adjacent pieces (flood fill)
   * @param {Object} startPiece - Starting piece
   * @param {Function} getNeighbors - Function to get neighboring pieces
   * @param {number} maxDepth - Maximum connection depth
   * @returns {Object} Selection result
   */
  selectConnected(startPiece, getNeighbors, maxDepth = Infinity) {
    const visited = new Set();
    const queue = [{ piece: startPiece, depth: 0 }];
    const toSelect = [];
    
    while (queue.length > 0) {
      const { piece, depth } = queue.shift();
      
      if (visited.has(piece.id)) continue;
      if (depth > maxDepth) continue;
      
      visited.add(piece.id);
      toSelect.push(piece);
      
      if (toSelect.length >= this.maxSelection) break;
      
      // Get neighbors and add to queue
      const neighbors = getNeighbors(piece);
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.id)) {
          queue.push({ piece: neighbor, depth: depth + 1 });
        }
      }
    }
    
    return this.selectMultiple(toSelect, false);
  }

  /**
   * Invert selection within a set of pieces
   * @param {Array} pieces - All selectable pieces
   * @returns {Object} Selection result
   */
  invertSelection(pieces) {
    const currentlySelected = new Set(this.selected);
    this.clearSelection(false);
    
    const toSelect = pieces.filter(p => !currentlySelected.has(p));
    return this.selectMultiple(toSelect, false);
  }

  /**
   * Clear all selection
   * @param {boolean} notify - Whether to trigger callback
   */
  clearSelection(notify = true) {
    for (const piece of this.selected) {
      this.applyHighlight(piece, false);
    }
    
    this.selected.clear();
    
    if (notify) {
      this.notifyChange();
    }
  }

  /**
   * Get current selection as array
   * @returns {Array} Selected pieces
   */
  getSelection() {
    return Array.from(this.selected);
  }

  /**
   * Get selection count
   * @returns {number} Number of selected pieces
   */
  getCount() {
    return this.selected.size;
  }

  /**
   * Check if a piece is selected
   * @param {Object} piece - Piece to check
   * @returns {boolean} Whether piece is selected
   */
  isSelected(piece) {
    return this.selected.has(piece);
  }

  /**
   * Check if selection is empty
   * @returns {boolean} Whether selection is empty
   */
  isEmpty() {
    return this.selected.size === 0;
  }

  /**
   * Set hover state for a piece
   * @param {Object} piece - Piece being hovered (null to clear)
   */
  setHovered(piece) {
    // Clear previous hover
    if (this.hoveredPiece && this.hoveredPiece !== piece) {
      if (!this.isSelected(this.hoveredPiece)) {
        this.applyHighlight(this.hoveredPiece, false);
      } else {
        // Restore selection highlight
        this.applyHighlight(this.hoveredPiece, true);
      }
    }
    
    this.hoveredPiece = piece;
    
    // Apply hover highlight
    if (piece && !this.isSelected(piece)) {
      this.applyHoverHighlight(piece);
    }
    
    if (this.onHoverChanged) {
      this.onHoverChanged(piece);
    }
  }

  /**
   * Get bounding box of selection
   * @returns {Object|null} Bounding box with min, max, center, size
   */
  getBounds() {
    if (this.selected.size === 0) return null;
    
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    
    for (const piece of this.selected) {
      const pos = piece.position;
      min.x = Math.min(min.x, pos.x);
      min.y = Math.min(min.y, pos.y);
      min.z = Math.min(min.z, pos.z);
      max.x = Math.max(max.x, pos.x);
      max.y = Math.max(max.y, pos.y);
      max.z = Math.max(max.z, pos.z);
    }
    
    const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
    const size = new THREE.Vector3().subVectors(max, min);
    
    return { min, max, center, size };
  }

  /**
   * Get center of selection
   * @returns {THREE.Vector3|null} Center point
   */
  getCenter() {
    const bounds = this.getBounds();
    return bounds?.center ?? null;
  }

  /**
   * Get selection statistics
   * @returns {Object} Selection statistics
   */
  getStats() {
    const byType = {};
    const byMaterial = {};
    
    for (const piece of this.selected) {
      // Count by type
      const type = piece.type ?? 'unknown';
      byType[type] = (byType[type] ?? 0) + 1;
      
      // Count by material
      const material = piece.material?.name ?? 'unknown';
      byMaterial[material] = (byMaterial[material] ?? 0) + 1;
    }
    
    return {
      count: this.selected.size,
      maxSelection: this.maxSelection,
      byType,
      byMaterial,
      bounds: this.getBounds()
    };
  }

  /**
   * Apply visual highlight to piece
   */
  applyHighlight(piece, highlighted) {
    if (!this.highlightEnabled) return;
    if (!piece.mesh) return;
    
    if (highlighted) {
      // Store original material if not already stored
      if (!piece.mesh.userData.originalEmissive) {
        piece.mesh.userData.originalEmissive = piece.mesh.material.emissive?.clone();
        piece.mesh.userData.originalEmissiveIntensity = piece.mesh.material.emissiveIntensity;
      }
      
      // Apply highlight
      if (piece.mesh.material.emissive) {
        piece.mesh.material.emissive.copy(this.highlightColor);
        piece.mesh.material.emissiveIntensity = this.highlightIntensity;
      }
    } else {
      // Restore original material
      if (piece.mesh.userData.originalEmissive !== undefined) {
        if (piece.mesh.material.emissive) {
          piece.mesh.material.emissive.copy(piece.mesh.userData.originalEmissive);
          piece.mesh.material.emissiveIntensity = piece.mesh.userData.originalEmissiveIntensity;
        }
        
        delete piece.mesh.userData.originalEmissive;
        delete piece.mesh.userData.originalEmissiveIntensity;
      }
    }
  }

  /**
   * Apply hover highlight (different from selection)
   */
  applyHoverHighlight(piece) {
    if (!this.highlightEnabled) return;
    if (!piece.mesh) return;
    
    // Store original if not stored
    if (!piece.mesh.userData.originalEmissive) {
      piece.mesh.userData.originalEmissive = piece.mesh.material.emissive?.clone();
      piece.mesh.userData.originalEmissiveIntensity = piece.mesh.material.emissiveIntensity;
    }
    
    // Apply hover color (dimmer than selection)
    if (piece.mesh.material.emissive) {
      piece.mesh.material.emissive.copy(this.hoverColor);
      piece.mesh.material.emissiveIntensity = this.highlightIntensity * 0.5;
    }
  }

  /**
   * Convert world position to normalized device coordinates
   */
  worldToNDC(position, camera) {
    const vector = position.clone().project(camera);
    
    // Check if behind camera
    if (vector.z > 1) return null;
    
    return { x: vector.x, y: vector.y };
  }

  /**
   * Notify selection change
   */
  notifyChange() {
    if (this.onSelectionChanged) {
      this.onSelectionChanged(this.getSelection(), this.getStats());
    }
  }

  /**
   * Create visual selection box for drawing
   * @param {THREE.Scene} scene - Scene to add box to
   * @returns {Object} Box controller
   */
  createSelectionBox(scene) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(8 * 3); // 8 corners
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const indices = new Uint16Array([
      0, 1, 1, 2, 2, 3, 3, 0, // Bottom
      4, 5, 5, 6, 6, 7, 7, 4, // Top
      0, 4, 1, 5, 2, 6, 3, 7  // Verticals
    ]);
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    
    const box = new THREE.LineSegments(geometry, this.boxMaterial);
    box.visible = false;
    scene.add(box);
    
    return {
      show: () => { box.visible = true; },
      hide: () => { box.visible = false; },
      update: (start, end, camera) => {
        // Update box geometry based on screen coordinates
        // This would project the 2D box into 3D space
        box.visible = true;
      },
      dispose: () => {
        scene.remove(box);
        geometry.dispose();
      }
    };
  }

  /**
   * Dispose of resources
   */
  dispose() {
    this.clearSelection(false);
    this.boxMaterial.dispose();
  }
}

export default SelectionManager;
