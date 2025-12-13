# Integration Guide

Detailed patterns for combining the 3 building mechanics skills.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Building System                          │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Performance │  │  Structural │  │    Multiplayer      │  │
│  │  at Scale   │◄─┤   Physics   │◄─┤     Building        │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│        │                │                    │              │
│   Spatial Index    Validation +         Network +          │
│   + Streaming      Damage              Prediction          │
└─────────────────────────────────────────────────────────────┘
```

Data flows right-to-left: Network events trigger physics, physics uses spatial queries.

## Full Integration Example

### Setup

```javascript
import * as THREE from 'three';

// Performance
import { SpatialHashGrid } from 'performance-at-scale/scripts/spatial-hash-grid.js';
import { Octree } from 'performance-at-scale/scripts/octree.js';
import { ChunkManager } from 'performance-at-scale/scripts/chunk-manager.js';

// Physics
import { HeuristicValidator } from 'structural-physics/scripts/heuristic-validator.js';
import { StabilityOptimizer } from 'structural-physics/scripts/stability-optimizer.js';
import { DamageSystem } from 'structural-physics/scripts/damage-propagation.js';

// Networking
import { BuildingNetworkServer, BuildingNetworkClient } from 'multiplayer-building/scripts/building-network-manager.js';
import { ClientPrediction } from 'multiplayer-building/scripts/client-prediction.js';
```

### Initialization Order

Order matters. Initialize bottom-up (dependencies first):

```javascript
class IntegratedBuildingSystem {
  constructor(options = {}) {
    // 1. Spatial indexing (no dependencies)
    this.spatial = new SpatialHashGrid(options.cellSize ?? 10);
    
    // 2. Validator (uses spatial for neighbor queries)
    this.validator = new HeuristicValidator({
      mode: options.physicsMode ?? 'heuristic',
      findNeighbors: (pos, radius) => this.spatial.queryRadius(pos, radius)
    });
    
    // 3. Optimizer (wraps validator)
    this.optimizer = new StabilityOptimizer(this.validator, {
      maxCacheSize: 10000,
      updateBudgetMs: 2
    });
    
    // 4. Damage system (uses validator + spatial)
    this.damage = new DamageSystem(this.validator, {
      findNeighbors: (pos, radius) => this.spatial.queryRadius(pos, radius)
    });
    
    // 5. Network (uses everything above)
    if (options.multiplayer) {
      this.initNetworking(options);
    }
    
    // Wire events
    this.wireEvents();
  }
  
  initNetworking(options) {
    if (options.isServer) {
      this.network = new BuildingNetworkServer(this, {
        tickRate: options.tickRate ?? 20
      });
    } else {
      this.network = new BuildingNetworkClient(this);
      this.prediction = new ClientPrediction(this);
    }
  }
  
  wireEvents() {
    // Damage triggers network broadcast
    this.damage.onPieceDestroyed = (piece, cascade) => {
      if (this.network?.broadcastPieceDestroyed) {
        this.network.broadcastPieceDestroyed(piece.id, cascade);
      }
    };
    
    // Stability changes trigger optimizer
    this.validator.onStabilityChanged = (piece, stability) => {
      this.optimizer.queueUpdate(piece.id, 'high');
    };
  }
}
```

### Piece Lifecycle

```javascript
// PLACEMENT
placePiece(type, position, rotation) {
  // 1. Create piece
  const piece = this.createPiece(type, position, rotation);
  
  // 2. Add to spatial index
  this.spatial.insert(piece, position);
  
  // 3. Register with validator
  this.validator.addPiece(piece);
  
  // 4. Queue stability calculation
  this.optimizer.onPiecePlaced(piece);
  
  // 5. Network sync (if multiplayer)
  if (this.network) {
    this.network.broadcastPiecePlaced(piece);
  }
  
  return piece;
}

// DESTRUCTION
destroyPiece(piece) {
  // 1. Apply destruction through damage system (handles cascade)
  const destroyed = this.damage.destroyPiece(piece);
  
  // 2. Remove each from spatial index
  for (const p of destroyed) {
    this.spatial.remove(p);
  }
  
  // 3. Validator removal handled by damage system
  
  // 4. Network broadcast handled by wired event
  
  return destroyed;
}

// DAMAGE
applyDamage(piece, amount, type = 'physical') {
  // Damage system handles everything
  this.damage.applyDamage(piece, amount, type);
}
```

## Common Patterns

### Pattern: Spatial Query for Physics

Physics often needs "nearby pieces" for support detection or cascade damage.

```javascript
// BAD: Physics recalculates neighbors every time
validator.findSupports = (piece) => {
  return allPieces.filter(p => p.position.distanceTo(piece.position) < 5);
}; // O(n) every query

// GOOD: Physics uses spatial index
validator.findSupports = (piece) => {
  return spatial.queryRadius(piece.position, 5);
}; // O(1) average
```

### Pattern: Network Uses Validation

Server validates placement before accepting.

```javascript
// Server-side
handlePlaceRequest(clientId, request) {
  const position = request.position;
  
  // 1. Check spatial collision
  const collisions = this.spatial.queryRadius(position, 0.5);
  if (collisions.length > 0) {
    return reject('Position occupied');
  }
  
  // 2. Check structural validity
  const validation = this.validator.validatePlacement({
    type: request.pieceType,
    position
  });
  if (!validation.valid) {
    return reject(validation.reason);
  }
  
  // 3. Actually place
  const piece = this.placePiece(request.pieceType, position, request.rotation);
  return confirm(piece.id);
}
```

### Pattern: Client Prediction with Local Validation

Client predicts using local copies of spatial + validator.

```javascript
// Client-side
predictPlace(type, position, rotation) {
  // 1. Local collision check
  const collisions = this.spatial.queryRadius(position, 0.5);
  if (collisions.length > 0) {
    showError('Position occupied');
    return null;
  }
  
  // 2. Local stability check
  const validation = this.validator.validatePlacement({ type, position });
  if (!validation.valid) {
    showError(validation.reason);
    return null;
  }
  
  // 3. Create predicted piece
  const predicted = this.prediction.predictPlace(type, position, rotation);
  
  // 4. Add to local spatial (for subsequent predictions)
  this.spatial.insert(predicted, position);
  
  return predicted;
}

// On server rejection
onPredictionRejected(tempId, reason) {
  const piece = this.prediction.getPredicted(tempId);
  if (piece) {
    this.spatial.remove(piece); // Rollback spatial
  }
}
```

### Pattern: Chunked World with Per-Chunk Systems

For very large worlds, each chunk has its own spatial index.

```javascript
class ChunkedBuildingSystem {
  constructor() {
    this.chunkManager = new ChunkManager({
      chunkSize: 256,
      loadRadius: 2,
      onChunkLoad: (chunk) => this.initChunkSystems(chunk),
      onChunkUnload: (chunk) => this.cleanupChunkSystems(chunk)
    });
    
    this.chunkSpatials = new Map();
    this.chunkValidators = new Map();
  }
  
  initChunkSystems(chunk) {
    const spatial = new SpatialHashGrid(10);
    const validator = new HeuristicValidator({
      findNeighbors: (pos, r) => spatial.queryRadius(pos, r)
    });
    
    // Load existing pieces
    for (const piece of chunk.pieces) {
      spatial.insert(piece, piece.position);
      validator.addPiece(piece);
    }
    
    this.chunkSpatials.set(chunk.id, spatial);
    this.chunkValidators.set(chunk.id, validator);
  }
  
  getSystemsForPosition(position) {
    const chunkId = this.chunkManager.getChunkId(position);
    return {
      spatial: this.chunkSpatials.get(chunkId),
      validator: this.chunkValidators.get(chunkId)
    };
  }
}
```

## Performance Budgets

Recommended per-frame budgets for 60fps (16.6ms total):

| System | Budget | Notes |
|--------|--------|-------|
| Spatial queries | 1ms | Usually instant |
| Stability updates | 2ms | Batched by optimizer |
| Damage processing | 1ms | Spread cascades over frames |
| Network send | 1ms | Batched deltas |
| Network receive | 2ms | Apply deltas |
| **Total building** | **7ms** | Leaves 9ms for rendering/other |

## Troubleshooting

### Pieces falling through supports
- Check validator mode matches game style
- Verify findNeighbors returns correct pieces
- Check support detection tolerance

### Network desync
- Ensure server is authoritative
- Check delta acknowledgment flow
- Verify prediction rollback works

### Performance drops with many pieces
- Profile with performance-profiler.js
- Check spatial cell size matches piece density
- Enable stability optimizer caching

### Cascade damage too slow
- Spread destructions over frames (damage system does this)
- Reduce cascade radius
- Use spatial query for neighbors, not full scan
