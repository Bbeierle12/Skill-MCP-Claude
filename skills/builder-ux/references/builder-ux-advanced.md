# Builder UX Advanced

The UX layer sits between player intent and game state. When a player moves their cursor, the ghost preview shows what will happen. When they click, a command executes. When they press Ctrl+Z, the command reverses. This separation of concerns enables sophisticated features like blueprints (preview and place multiple pieces), batch operations (select many, operate once), and networked building (commands serialize for transmission).

## The Command Pattern

Every building action becomes a command object with `execute()` and `undo()` methods. This pattern provides undo/redo for free, enables networked replication (serialize command, send to server, execute there), supports macro recording (save command sequences), and allows validation before execution.

### Command Base Class

```javascript
/**
 * Base command class for building operations
 */
export class BuildCommand {
  constructor() {
    this.timestamp = Date.now();
    this.executed = false;
  }

  /**
   * Execute the command
   * @returns {Object} Execution result
   */
  execute() {
    throw new Error('execute() must be implemented');
  }

  /**
   * Undo the command
   * @returns {Object} Undo result
   */
  undo() {
    throw new Error('undo() must be implemented');
  }

  /**
   * Check if command can be executed
   * @returns {boolean} Whether command is valid
   */
  canExecute() {
    return true;
  }

  /**
   * Serialize for networking/saving
   * @returns {Object} Serialized command
   */
  serialize() {
    return {
      type: this.constructor.name,
      timestamp: this.timestamp,
      data: this.getData()
    };
  }

  /**
   * Get command-specific data for serialization
   * @returns {Object} Command data
   */
  getData() {
    return {};
  }
}
```

### Common Building Commands

```javascript
/**
 * Place a building piece
 */
export class PlaceCommand extends BuildCommand {
  constructor(piece, position, rotation, buildingSystem) {
    super();
    this.piece = piece;
    this.position = position.clone();
    this.rotation = rotation?.clone() ?? new THREE.Euler();
    this.buildingSystem = buildingSystem;
    this.placedPiece = null;
  }

  execute() {
    this.placedPiece = this.buildingSystem.placePiece(
      this.piece,
      this.position,
      this.rotation
    );
    this.executed = true;
    return { success: true, piece: this.placedPiece };
  }

  undo() {
    if (!this.placedPiece) return { success: false };
    
    this.buildingSystem.removePiece(this.placedPiece.id);
    this.executed = false;
    return { success: true };
  }

  canExecute() {
    return this.buildingSystem.canPlace(this.piece, this.position);
  }

  getData() {
    return {
      pieceType: this.piece.type,
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      rotation: { x: this.rotation.x, y: this.rotation.y, z: this.rotation.z }
    };
  }
}

/**
 * Remove a building piece
 */
export class RemoveCommand extends BuildCommand {
  constructor(piece, buildingSystem) {
    super();
    this.piece = piece;
    this.buildingSystem = buildingSystem;
    this.pieceData = null; // Store for undo
  }

  execute() {
    // Store piece state for undo
    this.pieceData = {
      type: this.piece.type,
      position: this.piece.position.clone(),
      rotation: this.piece.rotation.clone(),
      material: this.piece.material,
      health: this.piece.health,
      id: this.piece.id
    };
    
    this.buildingSystem.removePiece(this.piece.id);
    this.executed = true;
    return { success: true };
  }

  undo() {
    if (!this.pieceData) return { success: false };
    
    const restored = this.buildingSystem.placePiece(
      { type: this.pieceData.type, material: this.pieceData.material },
      this.pieceData.position,
      this.pieceData.rotation
    );
    
    // Restore original ID and health
    restored.id = this.pieceData.id;
    restored.health = this.pieceData.health;
    
    this.piece = restored;
    this.executed = false;
    return { success: true, piece: restored };
  }

  getData() {
    return {
      pieceId: this.piece.id,
      pieceData: this.pieceData
    };
  }
}

/**
 * Upgrade a building piece (change material)
 */
export class UpgradeCommand extends BuildCommand {
  constructor(piece, newMaterial, buildingSystem) {
    super();
    this.piece = piece;
    this.newMaterial = newMaterial;
    this.oldMaterial = piece.material;
    this.buildingSystem = buildingSystem;
  }

  execute() {
    this.oldMaterial = this.piece.material;
    this.buildingSystem.upgradePiece(this.piece.id, this.newMaterial);
    this.executed = true;
    return { success: true };
  }

  undo() {
    this.buildingSystem.upgradePiece(this.piece.id, this.oldMaterial);
    this.executed = false;
    return { success: true };
  }

  getData() {
    return {
      pieceId: this.piece.id,
      oldMaterial: this.oldMaterial?.name,
      newMaterial: this.newMaterial?.name
    };
  }
}

/**
 * Batch command - execute multiple commands as one unit
 */
export class BatchCommand extends BuildCommand {
  constructor(commands) {
    super();
    this.commands = commands;
    this.executedCommands = [];
  }

  execute() {
    this.executedCommands = [];
    
    for (const command of this.commands) {
      if (command.canExecute()) {
        command.execute();
        this.executedCommands.push(command);
      }
    }
    
    this.executed = true;
    return { 
      success: true, 
      executed: this.executedCommands.length,
      total: this.commands.length
    };
  }

  undo() {
    // Undo in reverse order
    for (let i = this.executedCommands.length - 1; i >= 0; i--) {
      this.executedCommands[i].undo();
    }
    
    this.executedCommands = [];
    this.executed = false;
    return { success: true };
  }

  getData() {
    return {
      commands: this.commands.map(c => c.serialize())
    };
  }
}
```

### Command History Manager

```javascript
/**
 * CommandHistory - Manages undo/redo stack
 */
export class CommandHistory {
  constructor(options = {}) {
    this.maxSize = options.maxSize ?? 100;
    this.undoStack = [];
    this.redoStack = [];
    
    // Callbacks
    this.onExecute = options.onExecute ?? null;
    this.onUndo = options.onUndo ?? null;
    this.onRedo = options.onRedo ?? null;
    this.onChange = options.onChange ?? null;
  }

  /**
   * Execute a command and add to history
   */
  execute(command) {
    if (!command.canExecute()) {
      return { success: false, reason: 'Command cannot be executed' };
    }

    const result = command.execute();
    
    if (result.success) {
      this.undoStack.push(command);
      this.redoStack = []; // Clear redo on new action
      
      // Enforce max size
      while (this.undoStack.length > this.maxSize) {
        this.undoStack.shift();
      }
      
      if (this.onExecute) this.onExecute(command, result);
      if (this.onChange) this.onChange();
    }
    
    return result;
  }

  /**
   * Undo last command
   */
  undo() {
    if (this.undoStack.length === 0) {
      return { success: false, reason: 'Nothing to undo' };
    }

    const command = this.undoStack.pop();
    const result = command.undo();
    
    if (result.success) {
      this.redoStack.push(command);
      if (this.onUndo) this.onUndo(command, result);
      if (this.onChange) this.onChange();
    } else {
      // Restore to stack if undo failed
      this.undoStack.push(command);
    }
    
    return result;
  }

  /**
   * Redo last undone command
   */
  redo() {
    if (this.redoStack.length === 0) {
      return { success: false, reason: 'Nothing to redo' };
    }

    const command = this.redoStack.pop();
    const result = command.execute();
    
    if (result.success) {
      this.undoStack.push(command);
      if (this.onRedo) this.onRedo(command, result);
      if (this.onChange) this.onChange();
    } else {
      // Restore to stack if redo failed
      this.redoStack.push(command);
    }
    
    return result;
  }

  /**
   * Check if undo is available
   */
  canUndo() {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available
   */
  canRedo() {
    return this.redoStack.length > 0;
  }

  /**
   * Clear all history
   */
  clear() {
    this.undoStack = [];
    this.redoStack = [];
    if (this.onChange) this.onChange();
  }

  /**
   * Get history status for UI
   */
  getStatus() {
    return {
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      lastCommand: this.undoStack[this.undoStack.length - 1]?.constructor.name ?? null
    };
  }
}
```

## Blueprint System

Blueprints serialize building designs for save/load and sharing. A good blueprint format captures piece types, relative positions, rotations, and optionally materials/upgrades.

### Blueprint Format

```javascript
/**
 * Blueprint data structure
 * @typedef {Object} Blueprint
 * @property {string} id - Unique identifier
 * @property {string} name - User-given name
 * @property {number} version - Format version
 * @property {Object} bounds - Bounding box
 * @property {Array} pieces - Piece definitions
 * @property {Object} metadata - Additional info
 */

const BlueprintSchema = {
  id: 'string',
  name: 'string',
  version: 1,
  created: 'timestamp',
  modified: 'timestamp',
  bounds: {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 0, y: 0, z: 0 }
  },
  pieces: [
    {
      type: 'string',           // wall, floor, foundation, etc.
      localPosition: { x: 0, y: 0, z: 0 }, // Relative to blueprint origin
      rotation: { x: 0, y: 0, z: 0 },
      material: 'string',       // wood, stone, metal
      variant: 'string'         // optional sub-type
    }
  ],
  metadata: {
    author: 'string',
    description: 'string',
    tags: ['string'],
    pieceCount: 0,
    thumbnail: 'base64'         // Optional preview image
  }
};
```

### Blueprint Manager

```javascript
/**
 * BlueprintManager - Save, load, and share building designs
 */
export class BlueprintManager {
  constructor(options = {}) {
    this.blueprints = new Map();
    this.storage = options.storage ?? null; // LocalStorage, IndexedDB, etc.
    this.maxBlueprints = options.maxBlueprints ?? 100;
    this.maxPiecesPerBlueprint = options.maxPiecesPerBlueprint ?? 500;
  }

  /**
   * Create blueprint from selected pieces
   */
  save(pieces, name, metadata = {}) {
    if (pieces.length === 0) {
      return { success: false, reason: 'No pieces selected' };
    }
    
    if (pieces.length > this.maxPiecesPerBlueprint) {
      return { 
        success: false, 
        reason: `Too many pieces (max ${this.maxPiecesPerBlueprint})` 
      };
    }

    // Calculate bounds and center
    const bounds = this.calculateBounds(pieces);
    const center = new THREE.Vector3(
      (bounds.min.x + bounds.max.x) / 2,
      bounds.min.y, // Keep base at y=0
      (bounds.min.z + bounds.max.z) / 2
    );

    // Convert to relative positions
    const blueprintPieces = pieces.map(piece => ({
      type: piece.type,
      localPosition: {
        x: piece.position.x - center.x,
        y: piece.position.y - center.y,
        z: piece.position.z - center.z
      },
      rotation: {
        x: piece.rotation?.x ?? 0,
        y: piece.rotation?.y ?? 0,
        z: piece.rotation?.z ?? 0
      },
      material: piece.material?.name ?? 'wood',
      variant: piece.variant ?? null
    }));

    const blueprint = {
      id: this.generateId(),
      name: name || 'Untitled Blueprint',
      version: 1,
      created: Date.now(),
      modified: Date.now(),
      bounds: {
        min: { 
          x: bounds.min.x - center.x, 
          y: bounds.min.y - center.y, 
          z: bounds.min.z - center.z 
        },
        max: { 
          x: bounds.max.x - center.x, 
          y: bounds.max.y - center.y, 
          z: bounds.max.z - center.z 
        }
      },
      pieces: blueprintPieces,
      metadata: {
        author: metadata.author ?? 'Unknown',
        description: metadata.description ?? '',
        tags: metadata.tags ?? [],
        pieceCount: pieces.length,
        thumbnail: metadata.thumbnail ?? null
      }
    };

    this.blueprints.set(blueprint.id, blueprint);
    this.persistBlueprint(blueprint);

    return { success: true, blueprint };
  }

  /**
   * Load blueprint at position
   */
  load(blueprintId, position, rotation = 0) {
    const blueprint = this.blueprints.get(blueprintId);
    if (!blueprint) {
      return { success: false, reason: 'Blueprint not found' };
    }

    // Calculate rotated positions
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    const pieces = blueprint.pieces.map(piece => {
      // Rotate local position around Y axis
      const rotatedX = piece.localPosition.x * cos - piece.localPosition.z * sin;
      const rotatedZ = piece.localPosition.x * sin + piece.localPosition.z * cos;

      return {
        type: piece.type,
        position: new THREE.Vector3(
          position.x + rotatedX,
          position.y + piece.localPosition.y,
          position.z + rotatedZ
        ),
        rotation: new THREE.Euler(
          piece.rotation.x,
          piece.rotation.y + rotation,
          piece.rotation.z
        ),
        material: { name: piece.material },
        variant: piece.variant
      };
    });

    return { success: true, pieces, blueprint };
  }

  /**
   * Preview blueprint (for ghost display)
   */
  preview(blueprintId, position, rotation = 0) {
    return this.load(blueprintId, position, rotation);
  }

  /**
   * Calculate bounding box of pieces
   */
  calculateBounds(pieces) {
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

    for (const piece of pieces) {
      min.x = Math.min(min.x, piece.position.x);
      min.y = Math.min(min.y, piece.position.y);
      min.z = Math.min(min.z, piece.position.z);
      max.x = Math.max(max.x, piece.position.x);
      max.y = Math.max(max.y, piece.position.y);
      max.z = Math.max(max.z, piece.position.z);
    }

    return { min, max };
  }

  /**
   * Delete a blueprint
   */
  delete(blueprintId) {
    if (!this.blueprints.has(blueprintId)) {
      return { success: false, reason: 'Blueprint not found' };
    }
    
    this.blueprints.delete(blueprintId);
    this.removePersisted(blueprintId);
    
    return { success: true };
  }

  /**
   * List all blueprints
   */
  list() {
    return Array.from(this.blueprints.values()).map(bp => ({
      id: bp.id,
      name: bp.name,
      pieceCount: bp.metadata.pieceCount,
      created: bp.created,
      modified: bp.modified,
      tags: bp.metadata.tags
    }));
  }

  /**
   * Export blueprint as JSON string
   */
  export(blueprintId) {
    const blueprint = this.blueprints.get(blueprintId);
    if (!blueprint) return null;
    return JSON.stringify(blueprint, null, 2);
  }

  /**
   * Import blueprint from JSON string
   */
  import(jsonString) {
    try {
      const blueprint = JSON.parse(jsonString);
      
      // Validate structure
      if (!blueprint.pieces || !Array.isArray(blueprint.pieces)) {
        return { success: false, reason: 'Invalid blueprint format' };
      }

      // Assign new ID to avoid conflicts
      blueprint.id = this.generateId();
      blueprint.modified = Date.now();

      this.blueprints.set(blueprint.id, blueprint);
      this.persistBlueprint(blueprint);

      return { success: true, blueprint };
    } catch (e) {
      return { success: false, reason: 'Failed to parse blueprint' };
    }
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return `bp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Persist blueprint to storage
   */
  persistBlueprint(blueprint) {
    if (this.storage) {
      try {
        const existing = JSON.parse(this.storage.getItem('blueprints') || '{}');
        existing[blueprint.id] = blueprint;
        this.storage.setItem('blueprints', JSON.stringify(existing));
      } catch (e) {
        console.warn('Failed to persist blueprint:', e);
      }
    }
  }

  /**
   * Remove blueprint from storage
   */
  removePersisted(blueprintId) {
    if (this.storage) {
      try {
        const existing = JSON.parse(this.storage.getItem('blueprints') || '{}');
        delete existing[blueprintId];
        this.storage.setItem('blueprints', JSON.stringify(existing));
      } catch (e) {
        console.warn('Failed to remove blueprint:', e);
      }
    }
  }

  /**
   * Load all blueprints from storage
   */
  loadFromStorage() {
    if (this.storage) {
      try {
        const existing = JSON.parse(this.storage.getItem('blueprints') || '{}');
        for (const [id, blueprint] of Object.entries(existing)) {
          this.blueprints.set(id, blueprint);
        }
      } catch (e) {
        console.warn('Failed to load blueprints:', e);
      }
    }
  }
}
```

## Ghost Preview System

Ghost previews show placement intent before commitment. The key is rendering a transparent version of the piece that updates instantly with cursor movement and provides validity feedback through color.

### Ghost Preview Implementation

```javascript
/**
 * GhostPreview - Transparent placement preview
 */
export class GhostPreview {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.ghostMeshes = new Map(); // pieceType -> mesh
    this.activeGhost = null;
    this.isVisible = false;
    
    // Appearance
    this.validColor = options.validColor ?? 0x00ff00;
    this.invalidColor = options.invalidColor ?? 0xff0000;
    this.opacity = options.opacity ?? 0.5;
    this.pulseEnabled = options.pulseEnabled ?? true;
    this.pulseSpeed = options.pulseSpeed ?? 2;
    
    // State
    this.currentValidity = true;
    this.pulsePhase = 0;
    
    // Mesh factory
    this.meshFactory = options.meshFactory ?? null;
  }

  /**
   * Show ghost at position
   */
  show(pieceType, position, rotation = new THREE.Euler()) {
    // Get or create ghost mesh
    let ghost = this.ghostMeshes.get(pieceType);
    
    if (!ghost) {
      ghost = this.createGhostMesh(pieceType);
      this.ghostMeshes.set(pieceType, ghost);
    }

    // Position and rotate
    ghost.position.copy(position);
    ghost.rotation.copy(rotation);
    
    // Add to scene if not already
    if (!ghost.parent) {
      this.scene.add(ghost);
    }
    
    ghost.visible = true;
    this.activeGhost = ghost;
    this.isVisible = true;
    
    return ghost;
  }

  /**
   * Hide current ghost
   */
  hide() {
    if (this.activeGhost) {
      this.activeGhost.visible = false;
    }
    this.isVisible = false;
  }

  /**
   * Update ghost position
   */
  updatePosition(position, rotation) {
    if (this.activeGhost) {
      this.activeGhost.position.copy(position);
      if (rotation) {
        this.activeGhost.rotation.copy(rotation);
      }
    }
  }

  /**
   * Set validity state (changes color)
   */
  setValid(isValid) {
    this.currentValidity = isValid;
    
    if (this.activeGhost) {
      const color = isValid ? this.validColor : this.invalidColor;
      this.setGhostColor(this.activeGhost, color);
    }
  }

  /**
   * Update animation (call from render loop)
   */
  update(deltaTime) {
    if (!this.isVisible || !this.pulseEnabled) return;
    
    this.pulsePhase += deltaTime * this.pulseSpeed;
    const pulse = (Math.sin(this.pulsePhase) + 1) / 2;
    const opacity = this.opacity * (0.5 + pulse * 0.5);
    
    if (this.activeGhost) {
      this.setGhostOpacity(this.activeGhost, opacity);
    }
  }

  /**
   * Create ghost mesh for piece type
   */
  createGhostMesh(pieceType) {
    let geometry;
    
    // Use factory if provided
    if (this.meshFactory) {
      const baseMesh = this.meshFactory.create(pieceType);
      geometry = baseMesh.geometry.clone();
    } else {
      // Default geometries
      geometry = this.getDefaultGeometry(pieceType);
    }

    const material = new THREE.MeshBasicMaterial({
      color: this.validColor,
      transparent: true,
      opacity: this.opacity,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 999; // Render on top
    
    return mesh;
  }

  /**
   * Get default geometry for piece type
   */
  getDefaultGeometry(pieceType) {
    switch (pieceType) {
      case 'foundation':
        return new THREE.BoxGeometry(4, 0.2, 4);
      case 'wall':
        return new THREE.BoxGeometry(4, 3, 0.2);
      case 'floor':
        return new THREE.BoxGeometry(4, 0.1, 4);
      case 'pillar':
        return new THREE.BoxGeometry(0.5, 3, 0.5);
      case 'roof':
        return new THREE.BoxGeometry(4, 0.2, 4);
      case 'door':
        return new THREE.BoxGeometry(1, 2.5, 0.2);
      default:
        return new THREE.BoxGeometry(1, 1, 1);
    }
  }

  /**
   * Set ghost mesh color
   */
  setGhostColor(mesh, color) {
    if (mesh.material) {
      mesh.material.color.setHex(color);
    }
    
    // Handle multi-material meshes
    if (mesh.children) {
      mesh.children.forEach(child => {
        if (child.material) {
          child.material.color.setHex(color);
        }
      });
    }
  }

  /**
   * Set ghost mesh opacity
   */
  setGhostOpacity(mesh, opacity) {
    if (mesh.material) {
      mesh.material.opacity = opacity;
    }
    
    if (mesh.children) {
      mesh.children.forEach(child => {
        if (child.material) {
          child.material.opacity = opacity;
        }
      });
    }
  }

  /**
   * Show blueprint preview (multiple pieces)
   */
  showBlueprint(pieces) {
    this.hideAll();
    
    const group = new THREE.Group();
    group.name = 'blueprint-preview';
    
    for (const piece of pieces) {
      const ghost = this.createGhostMesh(piece.type);
      ghost.position.copy(piece.position);
      if (piece.rotation) {
        ghost.rotation.copy(piece.rotation);
      }
      group.add(ghost);
    }
    
    this.scene.add(group);
    this.activeGhost = group;
    this.isVisible = true;
    
    return group;
  }

  /**
   * Hide all ghosts
   */
  hideAll() {
    if (this.activeGhost) {
      this.scene.remove(this.activeGhost);
      this.activeGhost = null;
    }
    this.isVisible = false;
  }

  /**
   * Dispose of all ghost meshes
   */
  dispose() {
    this.hideAll();
    
    for (const [type, mesh] of this.ghostMeshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    
    this.ghostMeshes.clear();
  }
}
```

## Selection System

Multi-select enables batch operations. Box selection, shift-click to add, and group operations are standard patterns.

### Selection Manager

```javascript
/**
 * SelectionManager - Handle piece selection and group operations
 */
export class SelectionManager {
  constructor(options = {}) {
    this.selected = new Set();
    this.maxSelection = options.maxSelection ?? 500;
    
    // Visual feedback
    this.highlightColor = options.highlightColor ?? 0x00aaff;
    this.selectionOutline = options.selectionOutline ?? true;
    
    // Callbacks
    this.onSelectionChanged = options.onSelectionChanged ?? null;
  }

  /**
   * Select a single piece
   */
  select(piece, additive = false) {
    if (!additive) {
      this.clearSelection();
    }
    
    if (this.selected.size >= this.maxSelection) {
      return { success: false, reason: 'Selection limit reached' };
    }
    
    this.selected.add(piece);
    this.highlightPiece(piece, true);
    
    if (this.onSelectionChanged) {
      this.onSelectionChanged(this.getSelection());
    }
    
    return { success: true, count: this.selected.size };
  }

  /**
   * Deselect a piece
   */
  deselect(piece) {
    if (this.selected.has(piece)) {
      this.selected.delete(piece);
      this.highlightPiece(piece, false);
      
      if (this.onSelectionChanged) {
        this.onSelectionChanged(this.getSelection());
      }
    }
  }

  /**
   * Toggle piece selection
   */
  toggle(piece) {
    if (this.selected.has(piece)) {
      this.deselect(piece);
    } else {
      this.select(piece, true);
    }
  }

  /**
   * Clear all selection
   */
  clearSelection() {
    for (const piece of this.selected) {
      this.highlightPiece(piece, false);
    }
    this.selected.clear();
    
    if (this.onSelectionChanged) {
      this.onSelectionChanged([]);
    }
  }

  /**
   * Select multiple pieces
   */
  selectMultiple(pieces, additive = false) {
    if (!additive) {
      this.clearSelection();
    }
    
    let added = 0;
    for (const piece of pieces) {
      if (this.selected.size >= this.maxSelection) break;
      
      if (!this.selected.has(piece)) {
        this.selected.add(piece);
        this.highlightPiece(piece, true);
        added++;
      }
    }
    
    if (this.onSelectionChanged) {
      this.onSelectionChanged(this.getSelection());
    }
    
    return { success: true, added, total: this.selected.size };
  }

  /**
   * Box selection - select pieces within screen rectangle
   */
  boxSelect(startPoint, endPoint, camera, pieces, additive = false) {
    // Create frustum from selection rectangle
    const frustum = this.createSelectionFrustum(startPoint, endPoint, camera);
    
    const toSelect = [];
    for (const piece of pieces) {
      if (frustum.containsPoint(piece.position)) {
        toSelect.push(piece);
      }
    }
    
    return this.selectMultiple(toSelect, additive);
  }

  /**
   * Create frustum from screen rectangle
   */
  createSelectionFrustum(start, end, camera) {
    const frustum = new THREE.Frustum();
    
    // Normalize coordinates
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    
    // Create selection box in NDC
    const topLeft = new THREE.Vector3(minX, maxY, -1);
    const topRight = new THREE.Vector3(maxX, maxY, -1);
    const bottomLeft = new THREE.Vector3(minX, minY, -1);
    const bottomRight = new THREE.Vector3(maxX, minY, -1);
    
    // Unproject to world space
    topLeft.unproject(camera);
    topRight.unproject(camera);
    bottomLeft.unproject(camera);
    bottomRight.unproject(camera);
    
    // Create planes (simplified - full implementation would create proper frustum)
    const camPos = camera.position;
    
    frustum.setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse
      )
    );
    
    return frustum;
  }

  /**
   * Get current selection
   */
  getSelection() {
    return Array.from(this.selected);
  }

  /**
   * Check if piece is selected
   */
  isSelected(piece) {
    return this.selected.has(piece);
  }

  /**
   * Get selection count
   */
  getCount() {
    return this.selected.size;
  }

  /**
   * Highlight piece visually
   */
  highlightPiece(piece, highlight) {
    if (!piece.mesh) return;
    
    if (highlight) {
      piece.mesh.userData.originalMaterial = piece.mesh.material;
      
      if (this.selectionOutline) {
        // Add outline effect
        piece.mesh.material = piece.mesh.material.clone();
        piece.mesh.material.emissive = new THREE.Color(this.highlightColor);
        piece.mesh.material.emissiveIntensity = 0.3;
      }
    } else {
      // Restore original material
      if (piece.mesh.userData.originalMaterial) {
        piece.mesh.material = piece.mesh.userData.originalMaterial;
        delete piece.mesh.userData.originalMaterial;
      }
    }
  }

  /**
   * Get selection bounds
   */
  getSelectionBounds() {
    if (this.selected.size === 0) return null;
    
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    
    for (const piece of this.selected) {
      min.x = Math.min(min.x, piece.position.x);
      min.y = Math.min(min.y, piece.position.y);
      min.z = Math.min(min.z, piece.position.z);
      max.x = Math.max(max.x, piece.position.x);
      max.y = Math.max(max.y, piece.position.y);
      max.z = Math.max(max.z, piece.position.z);
    }
    
    return { min, max, center: min.clone().add(max).multiplyScalar(0.5) };
  }
}
```

## Integration Checklist

When implementing builder UX:

- [ ] Implement command pattern for all building operations
- [ ] Create command history with configurable size limit
- [ ] Add undo/redo keyboard shortcuts (Ctrl+Z, Ctrl+Y)
- [ ] Implement ghost preview with validity feedback
- [ ] Add pulse animation for preview visibility
- [ ] Create blueprint save/load system
- [ ] Add blueprint export/import for sharing
- [ ] Implement selection manager with highlighting
- [ ] Add box selection for multi-select
- [ ] Support shift+click additive selection
- [ ] Create batch commands for group operations
- [ ] Test undo/redo with complex operations
- [ ] Network commands for multiplayer sync

## Related References

- `structural-physics` skill - Validate placement in commands
- `multiplayer-building` skill - Serialize commands for network
- `performance-at-scale` skill - Selection queries via spatial index
