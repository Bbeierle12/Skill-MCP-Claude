/**
 * GhostPreview - Transparent placement preview system
 * 
 * Shows a semi-transparent preview of what will be placed before the
 * player commits. Changes color based on placement validity (green = valid,
 * red = invalid). Essential for good building UX.
 * 
 * Usage:
 *   const ghost = new GhostPreview(scene);
 *   ghost.show('wall', cursorPosition, rotation);
 *   ghost.setValid(canPlaceHere);
 *   ghost.updatePosition(newPosition);
 *   ghost.hide();
 */

import * as THREE from 'three';

/**
 * Ghost preview states
 */
export const GhostState = {
  HIDDEN: 'hidden',
  VALID: 'valid',
  INVALID: 'invalid',
  BLOCKED: 'blocked'
};

export class GhostPreview {
  /**
   * Create ghost preview system
   * @param {THREE.Scene} scene - Scene to add ghosts to
   * @param {Object} options - Configuration options
   */
  constructor(scene, options = {}) {
    this.scene = scene;
    
    // Appearance
    this.validColor = new THREE.Color(options.validColor ?? 0x00ff00);
    this.invalidColor = new THREE.Color(options.invalidColor ?? 0xff0000);
    this.blockedColor = new THREE.Color(options.blockedColor ?? 0xff8800);
    this.opacity = options.opacity ?? 0.5;
    this.wireframe = options.wireframe ?? false;
    
    // Animation
    this.pulseEnabled = options.pulseEnabled ?? true;
    this.pulseSpeed = options.pulseSpeed ?? 3;
    this.pulseAmount = options.pulseAmount ?? 0.3;
    this.pulsePhase = 0;
    
    // State
    this.state = GhostState.HIDDEN;
    this.currentType = null;
    this.activeGhost = null;
    
    // Mesh cache
    this.meshCache = new Map();
    
    // External mesh factory (optional)
    this.meshFactory = options.meshFactory ?? null;
    
    // Snap settings
    this.snapEnabled = options.snapEnabled ?? true;
    this.snapGrid = options.snapGrid ?? 1;
    this.snapRotation = options.snapRotation ?? Math.PI / 4; // 45 degrees
    
    // Group for blueprint previews
    this.blueprintGroup = null;
  }

  /**
   * Show ghost preview at position
   * @param {string} pieceType - Type of piece to preview
   * @param {THREE.Vector3} position - World position
   * @param {THREE.Euler|number} rotation - Rotation (Euler or Y angle)
   * @returns {THREE.Mesh} The ghost mesh
   */
  show(pieceType, position, rotation = 0) {
    // Hide current ghost if different type
    if (this.activeGhost && this.currentType !== pieceType) {
      this.hide();
    }

    // Get or create ghost mesh
    let ghost = this.meshCache.get(pieceType);
    
    if (!ghost) {
      ghost = this.createGhostMesh(pieceType);
      this.meshCache.set(pieceType, ghost);
    }

    // Apply position (with optional snapping)
    const snappedPos = this.snapEnabled 
      ? this.snapPosition(position) 
      : position;
    ghost.position.copy(snappedPos);

    // Apply rotation
    if (typeof rotation === 'number') {
      ghost.rotation.set(0, rotation, 0);
    } else if (rotation instanceof THREE.Euler) {
      ghost.rotation.copy(rotation);
    }

    // Add to scene if not already
    if (!ghost.parent) {
      this.scene.add(ghost);
    }

    ghost.visible = true;
    this.activeGhost = ghost;
    this.currentType = pieceType;
    this.state = GhostState.VALID;
    
    // Set initial valid color
    this.setGhostColor(ghost, this.validColor);

    return ghost;
  }

  /**
   * Hide current ghost preview
   */
  hide() {
    if (this.activeGhost) {
      this.activeGhost.visible = false;
    }
    
    if (this.blueprintGroup) {
      this.blueprintGroup.visible = false;
    }
    
    this.state = GhostState.HIDDEN;
  }

  /**
   * Update ghost position
   * @param {THREE.Vector3} position - New position
   * @param {THREE.Euler|number} rotation - Optional new rotation
   */
  updatePosition(position, rotation = null) {
    if (!this.activeGhost) return;

    const snappedPos = this.snapEnabled 
      ? this.snapPosition(position) 
      : position;
    
    this.activeGhost.position.copy(snappedPos);

    if (rotation !== null) {
      if (typeof rotation === 'number') {
        this.activeGhost.rotation.y = this.snapEnabled
          ? this.snapRotationValue(rotation)
          : rotation;
      } else if (rotation instanceof THREE.Euler) {
        this.activeGhost.rotation.copy(rotation);
      }
    }
  }

  /**
   * Set validity state (changes color)
   * @param {boolean} isValid - Whether placement is valid
   * @param {string} reason - Optional reason for invalidity
   */
  setValid(isValid, reason = null) {
    if (!this.activeGhost && !this.blueprintGroup) return;

    const target = this.blueprintGroup ?? this.activeGhost;
    
    if (isValid) {
      this.state = GhostState.VALID;
      this.setGhostColor(target, this.validColor);
    } else {
      this.state = reason === 'blocked' ? GhostState.BLOCKED : GhostState.INVALID;
      const color = this.state === GhostState.BLOCKED 
        ? this.blockedColor 
        : this.invalidColor;
      this.setGhostColor(target, color);
    }
  }

  /**
   * Update animation (call from render loop)
   * @param {number} deltaTime - Time since last frame
   */
  update(deltaTime) {
    if (this.state === GhostState.HIDDEN || !this.pulseEnabled) return;

    this.pulsePhase += deltaTime * this.pulseSpeed;
    
    // Calculate pulsing opacity
    const pulse = (Math.sin(this.pulsePhase) + 1) / 2;
    const opacity = this.opacity * (1 - this.pulseAmount + pulse * this.pulseAmount);

    const target = this.blueprintGroup ?? this.activeGhost;
    if (target) {
      this.setGhostOpacity(target, opacity);
    }
  }

  /**
   * Show blueprint preview (multiple pieces)
   * @param {Array} pieces - Pieces to preview
   * @param {THREE.Vector3} position - Blueprint origin position
   * @param {number} rotation - Y-axis rotation
   * @returns {THREE.Group} The preview group
   */
  showBlueprint(pieces, position, rotation = 0) {
    this.hide();

    // Create group for blueprint
    this.blueprintGroup = new THREE.Group();
    this.blueprintGroup.name = 'blueprint-preview';

    // Create ghost for each piece
    for (const piece of pieces) {
      const ghost = this.createGhostMesh(piece.type);
      ghost.position.copy(piece.position);
      
      if (piece.rotation) {
        ghost.rotation.copy(piece.rotation);
      }
      
      this.blueprintGroup.add(ghost);
    }

    // Position and rotate the group
    const snappedPos = this.snapEnabled 
      ? this.snapPosition(position) 
      : position;
    
    this.blueprintGroup.position.copy(snappedPos);
    this.blueprintGroup.rotation.y = rotation;

    this.scene.add(this.blueprintGroup);
    this.state = GhostState.VALID;
    this.setGhostColor(this.blueprintGroup, this.validColor);

    return this.blueprintGroup;
  }

  /**
   * Update blueprint preview position
   * @param {THREE.Vector3} position - New position
   * @param {number} rotation - New Y rotation
   */
  updateBlueprintPosition(position, rotation = null) {
    if (!this.blueprintGroup) return;

    const snappedPos = this.snapEnabled 
      ? this.snapPosition(position) 
      : position;
    
    this.blueprintGroup.position.copy(snappedPos);

    if (rotation !== null) {
      this.blueprintGroup.rotation.y = this.snapEnabled
        ? this.snapRotationValue(rotation)
        : rotation;
    }
  }

  /**
   * Rotate current ghost by increment
   * @param {number} angle - Angle to rotate by (radians)
   */
  rotate(angle) {
    const target = this.blueprintGroup ?? this.activeGhost;
    if (!target) return;

    target.rotation.y += angle;

    if (this.snapEnabled) {
      target.rotation.y = this.snapRotationValue(target.rotation.y);
    }
  }

  /**
   * Create ghost mesh for piece type
   */
  createGhostMesh(pieceType) {
    let geometry;

    // Use factory if provided
    if (this.meshFactory) {
      try {
        const baseMesh = this.meshFactory.createMesh(pieceType);
        geometry = baseMesh.geometry.clone();
      } catch (e) {
        geometry = this.getDefaultGeometry(pieceType);
      }
    } else {
      geometry = this.getDefaultGeometry(pieceType);
    }

    // Create semi-transparent material
    const material = new THREE.MeshBasicMaterial({
      color: this.validColor,
      transparent: true,
      opacity: this.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      wireframe: this.wireframe
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 999; // Render on top
    mesh.userData.isGhost = true;

    return mesh;
  }

  /**
   * Get default geometry for piece type
   */
  getDefaultGeometry(pieceType) {
    const geometries = {
      foundation: () => new THREE.BoxGeometry(4, 0.2, 4),
      wall: () => new THREE.BoxGeometry(4, 3, 0.2),
      floor: () => new THREE.BoxGeometry(4, 0.1, 4),
      ceiling: () => new THREE.BoxGeometry(4, 0.1, 4),
      pillar: () => new THREE.BoxGeometry(0.5, 3, 0.5),
      roof: () => this.createRoofGeometry(),
      ramp: () => this.createRampGeometry(),
      stairs: () => this.createStairsGeometry(),
      door: () => new THREE.BoxGeometry(1.2, 2.5, 0.2),
      window: () => new THREE.BoxGeometry(2, 1.5, 0.2),
      fence: () => new THREE.BoxGeometry(4, 1.5, 0.1),
      halfWall: () => new THREE.BoxGeometry(4, 1.5, 0.2)
    };

    const factory = geometries[pieceType] ?? (() => new THREE.BoxGeometry(1, 1, 1));
    return factory();
  }

  /**
   * Create angled roof geometry
   */
  createRoofGeometry() {
    const geometry = new THREE.BufferGeometry();
    
    const vertices = new Float32Array([
      // Triangle face 1
      -2, 0, -2,   2, 0, -2,   0, 1.5, 0,
      // Triangle face 2
      2, 0, -2,   2, 0, 2,   0, 1.5, 0,
      // Triangle face 3
      2, 0, 2,   -2, 0, 2,   0, 1.5, 0,
      // Triangle face 4
      -2, 0, 2,   -2, 0, -2,   0, 1.5, 0,
      // Bottom face
      -2, 0, -2,   -2, 0, 2,   2, 0, 2,
      -2, 0, -2,   2, 0, 2,   2, 0, -2
    ]);
    
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    
    return geometry;
  }

  /**
   * Create ramp geometry
   */
  createRampGeometry() {
    const geometry = new THREE.BufferGeometry();
    
    const vertices = new Float32Array([
      // Ramp surface
      -2, 0, 2,   2, 0, 2,   2, 2, -2,
      -2, 0, 2,   2, 2, -2,   -2, 2, -2,
      // Bottom
      -2, 0, 2,   -2, 0, -2,   2, 0, -2,
      -2, 0, 2,   2, 0, -2,   2, 0, 2,
      // Sides
      -2, 0, 2,   -2, 2, -2,   -2, 0, -2,
      2, 0, 2,   2, 0, -2,   2, 2, -2,
      // Back
      -2, 2, -2,   2, 2, -2,   2, 0, -2,
      -2, 2, -2,   2, 0, -2,   -2, 0, -2
    ]);
    
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    
    return geometry;
  }

  /**
   * Create stairs geometry (simplified)
   */
  createStairsGeometry() {
    const group = new THREE.Group();
    const stepCount = 6;
    const stepHeight = 0.5;
    const stepDepth = 0.5;
    const width = 2;

    for (let i = 0; i < stepCount; i++) {
      const stepGeo = new THREE.BoxGeometry(width, stepHeight, stepDepth);
      const step = new THREE.Mesh(stepGeo);
      step.position.set(0, i * stepHeight + stepHeight / 2, -i * stepDepth);
      group.add(step);
    }

    // Merge into single geometry
    const geometry = new THREE.BoxGeometry(width, stepCount * stepHeight, stepCount * stepDepth);
    return geometry;
  }

  /**
   * Set color of ghost mesh or group
   */
  setGhostColor(target, color) {
    if (target.material) {
      target.material.color.copy(color);
    }

    if (target.children) {
      target.children.forEach(child => {
        if (child.material) {
          child.material.color.copy(color);
        }
      });
    }
  }

  /**
   * Set opacity of ghost mesh or group
   */
  setGhostOpacity(target, opacity) {
    if (target.material) {
      target.material.opacity = opacity;
    }

    if (target.children) {
      target.children.forEach(child => {
        if (child.material) {
          child.material.opacity = opacity;
        }
      });
    }
  }

  /**
   * Snap position to grid
   */
  snapPosition(position) {
    return new THREE.Vector3(
      Math.round(position.x / this.snapGrid) * this.snapGrid,
      Math.round(position.y / this.snapGrid) * this.snapGrid,
      Math.round(position.z / this.snapGrid) * this.snapGrid
    );
  }

  /**
   * Snap rotation to increments
   */
  snapRotationValue(rotation) {
    return Math.round(rotation / this.snapRotation) * this.snapRotation;
  }

  /**
   * Get current ghost position
   */
  getPosition() {
    const target = this.blueprintGroup ?? this.activeGhost;
    return target?.position.clone() ?? null;
  }

  /**
   * Get current ghost rotation
   */
  getRotation() {
    const target = this.blueprintGroup ?? this.activeGhost;
    return target?.rotation.clone() ?? null;
  }

  /**
   * Get current state
   */
  getState() {
    return this.state;
  }

  /**
   * Check if ghost is currently valid
   */
  isValid() {
    return this.state === GhostState.VALID;
  }

  /**
   * Check if ghost is visible
   */
  isVisible() {
    return this.state !== GhostState.HIDDEN;
  }

  /**
   * Configure snap settings
   */
  setSnapSettings(grid, rotation) {
    if (grid !== undefined) this.snapGrid = grid;
    if (rotation !== undefined) this.snapRotation = rotation;
  }

  /**
   * Enable or disable snapping
   */
  setSnapEnabled(enabled) {
    this.snapEnabled = enabled;
  }

  /**
   * Dispose of all resources
   */
  dispose() {
    this.hide();

    // Dispose cached meshes
    for (const [type, mesh] of this.meshCache) {
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
      if (mesh.parent) mesh.parent.remove(mesh);
    }

    this.meshCache.clear();

    // Dispose blueprint group
    if (this.blueprintGroup) {
      this.blueprintGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      
      if (this.blueprintGroup.parent) {
        this.blueprintGroup.parent.remove(this.blueprintGroup);
      }
      
      this.blueprintGroup = null;
    }
  }
}

export default GhostPreview;
