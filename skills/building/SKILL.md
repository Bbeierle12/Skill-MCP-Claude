# Building Systems Router

Routes to specialized sub-skills for 3D building game mechanics.

## Sub-Skills

| Sub-Skill | Use When |
|-----------|----------|
| **performance** | LOD, culling, instancing, draw call optimization |
| **physics** | Collision detection, structural integrity, gravity systems |
| **multiplayer** | State sync, netcode, server-authoritative building |
| **terrain** | Voxel systems, procedural terrain, chunk management |

## Quick Decision Tree

1. **Performance issues?** → Load `performance`
2. **Structures collapsing/physics?** → Load `physics`
3. **Syncing builds across players?** → Load `multiplayer`
4. **Terrain modification?** → Load `terrain`

## Architecture Overview

```
BuildingSystem
├── GridManager (snap points, placement validation)
├── StructureManager (integrity, connections)
├── RenderManager (LOD, batching, culling)
├── PhysicsManager (collision, destruction)
└── NetworkManager (sync, authority)
```

## Common Combinations

- **Single-player builder**: `performance` + `physics`
- **Online survival**: `multiplayer` + `physics` + `terrain`
- **Creative mode**: `performance` + `terrain`
