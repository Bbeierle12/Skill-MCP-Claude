/**
 * CommandHistory - Undo/redo system using command pattern
 * 
 * Every building action becomes a command object with execute() and undo()
 * methods. This enables undo/redo, networked replication (serialize commands
 * and send to server), and macro recording (save command sequences).
 * 
 * Usage:
 *   const history = new CommandHistory({ maxSize: 50 });
 *   history.execute(new PlaceCommand(piece, position, buildingSystem));
 *   history.undo();
 *   history.redo();
 */

import * as THREE from 'three';

/**
 * Base command class - extend this for specific operations
 */
export class BuildCommand {
  constructor() {
    this.id = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    this.timestamp = Date.now();
    this.executed = false;
  }

  /**
   * Execute the command
   * @returns {Object} Execution result { success: boolean, ... }
   */
  execute() {
    throw new Error('execute() must be implemented by subclass');
  }

  /**
   * Undo the command (reverse execute)
   * @returns {Object} Undo result { success: boolean, ... }
   */
  undo() {
    throw new Error('undo() must be implemented by subclass');
  }

  /**
   * Check if command can be executed in current state
   * @returns {boolean} Whether command is valid
   */
  canExecute() {
    return true;
  }

  /**
   * Get command type name
   * @returns {string} Command type
   */
  getType() {
    return this.constructor.name;
  }

  /**
   * Get human-readable description
   * @returns {string} Description
   */
  getDescription() {
    return this.getType();
  }

  /**
   * Serialize command for networking/saving
   * @returns {Object} Serialized data
   */
  serialize() {
    return {
      type: this.getType(),
      id: this.id,
      timestamp: this.timestamp,
      data: this.getData()
    };
  }

  /**
   * Get command-specific data for serialization
   * Override in subclasses
   * @returns {Object} Command data
   */
  getData() {
    return {};
  }
}

/**
 * Place a building piece
 */
export class PlaceCommand extends BuildCommand {
  constructor(pieceData, position, rotation, buildingSystem) {
    super();
    this.pieceData = pieceData;
    this.position = position.clone();
    this.rotation = rotation?.clone() ?? new THREE.Euler();
    this.buildingSystem = buildingSystem;
    this.placedPiece = null;
  }

  execute() {
    if (!this.canExecute()) {
      return { success: false, reason: 'Cannot place here' };
    }

    this.placedPiece = this.buildingSystem.placePiece(
      this.pieceData,
      this.position,
      this.rotation
    );
    
    this.executed = true;
    
    return { 
      success: true, 
      piece: this.placedPiece,
      pieceId: this.placedPiece?.id
    };
  }

  undo() {
    if (!this.placedPiece) {
      return { success: false, reason: 'No piece to remove' };
    }

    this.buildingSystem.removePiece(this.placedPiece.id);
    this.executed = false;
    
    return { success: true, removedId: this.placedPiece.id };
  }

  canExecute() {
    return this.buildingSystem.canPlace?.(this.pieceData, this.position) ?? true;
  }

  getDescription() {
    return `Place ${this.pieceData.type}`;
  }

  getData() {
    return {
      pieceType: this.pieceData.type,
      material: this.pieceData.material?.name,
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      rotation: { x: this.rotation.x, y: this.rotation.y, z: this.rotation.z },
      placedPieceId: this.placedPiece?.id
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
    this.savedState = null;
  }

  execute() {
    // Save full state for undo
    this.savedState = {
      id: this.piece.id,
      type: this.piece.type,
      position: this.piece.position.clone(),
      rotation: this.piece.rotation?.clone() ?? new THREE.Euler(),
      material: this.piece.material,
      health: this.piece.health,
      variant: this.piece.variant,
      customData: this.piece.customData
    };

    this.buildingSystem.removePiece(this.piece.id);
    this.executed = true;
    
    return { success: true, removedId: this.piece.id };
  }

  undo() {
    if (!this.savedState) {
      return { success: false, reason: 'No saved state' };
    }

    // Restore piece
    const restored = this.buildingSystem.placePiece(
      { 
        type: this.savedState.type, 
        material: this.savedState.material,
        variant: this.savedState.variant
      },
      this.savedState.position,
      this.savedState.rotation
    );

    // Restore additional properties
    if (restored) {
      restored.health = this.savedState.health;
      restored.customData = this.savedState.customData;
    }

    this.piece = restored;
    this.executed = false;
    
    return { success: true, piece: restored };
  }

  getDescription() {
    return `Remove ${this.piece.type}`;
  }

  getData() {
    return {
      pieceId: this.piece.id,
      pieceType: this.piece.type,
      savedState: this.savedState
    };
  }
}

/**
 * Upgrade a piece's material
 */
export class UpgradeCommand extends BuildCommand {
  constructor(piece, newMaterial, buildingSystem) {
    super();
    this.piece = piece;
    this.newMaterial = newMaterial;
    this.oldMaterial = null;
    this.buildingSystem = buildingSystem;
  }

  execute() {
    this.oldMaterial = this.piece.material;
    this.buildingSystem.upgradePiece(this.piece.id, this.newMaterial);
    this.executed = true;
    
    return { 
      success: true, 
      pieceId: this.piece.id,
      oldMaterial: this.oldMaterial?.name,
      newMaterial: this.newMaterial?.name
    };
  }

  undo() {
    if (!this.oldMaterial) {
      return { success: false, reason: 'No previous material' };
    }

    this.buildingSystem.upgradePiece(this.piece.id, this.oldMaterial);
    this.executed = false;
    
    return { success: true, pieceId: this.piece.id };
  }

  getDescription() {
    return `Upgrade to ${this.newMaterial?.name ?? 'unknown'}`;
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
 * Rotate a piece
 */
export class RotateCommand extends BuildCommand {
  constructor(piece, newRotation, buildingSystem) {
    super();
    this.piece = piece;
    this.newRotation = newRotation.clone();
    this.oldRotation = null;
    this.buildingSystem = buildingSystem;
  }

  execute() {
    this.oldRotation = this.piece.rotation.clone();
    this.piece.rotation.copy(this.newRotation);
    
    if (this.buildingSystem.onPieceModified) {
      this.buildingSystem.onPieceModified(this.piece);
    }
    
    this.executed = true;
    return { success: true, pieceId: this.piece.id };
  }

  undo() {
    if (!this.oldRotation) {
      return { success: false, reason: 'No previous rotation' };
    }

    this.piece.rotation.copy(this.oldRotation);
    
    if (this.buildingSystem.onPieceModified) {
      this.buildingSystem.onPieceModified(this.piece);
    }
    
    this.executed = false;
    return { success: true, pieceId: this.piece.id };
  }

  getDescription() {
    return `Rotate ${this.piece.type}`;
  }
}

/**
 * Batch command - execute multiple commands as one undo unit
 */
export class BatchCommand extends BuildCommand {
  constructor(commands, description = null) {
    super();
    this.commands = commands;
    this.customDescription = description;
    this.executedCommands = [];
  }

  execute() {
    this.executedCommands = [];

    for (const command of this.commands) {
      if (command.canExecute()) {
        const result = command.execute();
        if (result.success) {
          this.executedCommands.push(command);
        }
      }
    }

    this.executed = true;
    
    return {
      success: this.executedCommands.length > 0,
      executed: this.executedCommands.length,
      total: this.commands.length,
      failed: this.commands.length - this.executedCommands.length
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

  getDescription() {
    return this.customDescription ?? `Batch (${this.commands.length} operations)`;
  }

  getData() {
    return {
      commands: this.commands.map(c => c.serialize()),
      executedCount: this.executedCommands.length
    };
  }
}

/**
 * CommandHistory - Manages the undo/redo stack
 */
export class CommandHistory {
  constructor(options = {}) {
    this.maxSize = options.maxSize ?? 100;
    this.undoStack = [];
    this.redoStack = [];
    
    // Grouping support (for compound operations)
    this.isGrouping = false;
    this.groupCommands = [];
    this.groupDescription = null;
    
    // Event callbacks
    this.onExecute = options.onExecute ?? null;
    this.onUndo = options.onUndo ?? null;
    this.onRedo = options.onRedo ?? null;
    this.onChange = options.onChange ?? null;
  }

  /**
   * Execute a command and add to history
   * @param {BuildCommand} command - Command to execute
   * @returns {Object} Execution result
   */
  execute(command) {
    if (!command.canExecute()) {
      return { success: false, reason: 'Command cannot be executed' };
    }

    const result = command.execute();

    if (result.success) {
      if (this.isGrouping) {
        // Add to current group
        this.groupCommands.push(command);
      } else {
        // Add to undo stack
        this.undoStack.push(command);
        
        // Clear redo stack (new action invalidates redo)
        this.redoStack = [];
        
        // Enforce max size
        this.enforceMaxSize();
      }

      if (this.onExecute) this.onExecute(command, result);
      if (this.onChange) this.onChange(this.getStatus());
    }

    return result;
  }

  /**
   * Undo the last command
   * @returns {Object} Undo result
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
      if (this.onChange) this.onChange(this.getStatus());
    } else {
      // Restore to stack if undo failed
      this.undoStack.push(command);
    }

    return result;
  }

  /**
   * Redo the last undone command
   * @returns {Object} Redo result
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
      if (this.onChange) this.onChange(this.getStatus());
    } else {
      // Restore to stack if redo failed
      this.redoStack.push(command);
    }

    return result;
  }

  /**
   * Begin a command group (multiple commands as one undo unit)
   * @param {string} description - Group description
   */
  beginGroup(description = null) {
    if (this.isGrouping) {
      console.warn('Already in a command group');
      return;
    }
    
    this.isGrouping = true;
    this.groupCommands = [];
    this.groupDescription = description;
  }

  /**
   * End the current command group
   * @returns {Object} Result with grouped command
   */
  endGroup() {
    if (!this.isGrouping) {
      return { success: false, reason: 'Not in a command group' };
    }

    this.isGrouping = false;

    if (this.groupCommands.length === 0) {
      return { success: true, commands: 0 };
    }

    // Create batch command from group
    const batch = new BatchCommand(this.groupCommands, this.groupDescription);
    batch.executedCommands = [...this.groupCommands]; // Already executed
    batch.executed = true;

    // Add batch to undo stack
    this.undoStack.push(batch);
    this.redoStack = [];
    this.enforceMaxSize();

    const count = this.groupCommands.length;
    this.groupCommands = [];
    this.groupDescription = null;

    if (this.onChange) this.onChange(this.getStatus());

    return { success: true, commands: count };
  }

  /**
   * Cancel current command group (undo all grouped commands)
   */
  cancelGroup() {
    if (!this.isGrouping) return;

    // Undo all grouped commands in reverse order
    for (let i = this.groupCommands.length - 1; i >= 0; i--) {
      this.groupCommands[i].undo();
    }

    this.isGrouping = false;
    this.groupCommands = [];
    this.groupDescription = null;
  }

  /**
   * Check if undo is available
   */
  canUndo() {
    return this.undoStack.length > 0 && !this.isGrouping;
  }

  /**
   * Check if redo is available
   */
  canRedo() {
    return this.redoStack.length > 0 && !this.isGrouping;
  }

  /**
   * Clear all history
   */
  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.isGrouping = false;
    this.groupCommands = [];
    
    if (this.onChange) this.onChange(this.getStatus());
  }

  /**
   * Get current history status (for UI)
   */
  getStatus() {
    return {
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      isGrouping: this.isGrouping,
      groupSize: this.groupCommands.length,
      lastUndo: this.undoStack.length > 0 
        ? this.undoStack[this.undoStack.length - 1].getDescription() 
        : null,
      lastRedo: this.redoStack.length > 0
        ? this.redoStack[this.redoStack.length - 1].getDescription()
        : null
    };
  }

  /**
   * Get undo history descriptions (for UI menu)
   */
  getUndoHistory(limit = 10) {
    return this.undoStack
      .slice(-limit)
      .reverse()
      .map(cmd => ({
        id: cmd.id,
        type: cmd.getType(),
        description: cmd.getDescription(),
        timestamp: cmd.timestamp
      }));
  }

  /**
   * Get redo history descriptions
   */
  getRedoHistory(limit = 10) {
    return this.redoStack
      .slice(-limit)
      .reverse()
      .map(cmd => ({
        id: cmd.id,
        type: cmd.getType(),
        description: cmd.getDescription(),
        timestamp: cmd.timestamp
      }));
  }

  /**
   * Enforce maximum history size
   */
  enforceMaxSize() {
    while (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
  }

  /**
   * Serialize full history for saving
   */
  serialize() {
    return {
      version: 1,
      undoStack: this.undoStack.map(cmd => cmd.serialize()),
      redoStack: this.redoStack.map(cmd => cmd.serialize())
    };
  }
}

export default CommandHistory;
