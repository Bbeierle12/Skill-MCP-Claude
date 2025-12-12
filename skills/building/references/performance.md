# Building Performance

## Draw Call Optimization

### GPU Instancing

```csharp
// Unity - Instance rendering for repeated objects
MaterialPropertyBlock props = new MaterialPropertyBlock();
Graphics.DrawMeshInstanced(mesh, 0, material, matrices, count, props);
```

### Static Batching

Combine static geometry at build time:

```csharp
// Unity
StaticBatchingUtility.Combine(buildingRoot);
```

### Dynamic Batching

For small meshes (<300 verts), ensure:
- Same material
- No scaling differences
- No runtime mesh modifications

## Level of Detail (LOD)

```csharp
// LOD Group setup
LODGroup lodGroup = building.AddComponent<LODGroup>();
LOD[] lods = new LOD[3];

lods[0] = new LOD(0.6f, highDetailRenderers);   // 60%+ screen
lods[1] = new LOD(0.3f, mediumDetailRenderers); // 30-60% screen
lods[2] = new LOD(0.1f, lowDetailRenderers);    // 10-30% screen

lodGroup.SetLODs(lods);
```

## Occlusion Culling

### Frustum Culling
Automatic in most engines - ensure bounds are correct.

### Portal Culling
For indoor environments:

```csharp
// Define rooms and portals
OcclusionPortal portal = doorway.AddComponent<OcclusionPortal>();
portal.open = doorIsOpen;
```

## Chunk-Based Loading

```csharp
public class ChunkManager : MonoBehaviour
{
    const int CHUNK_SIZE = 16;
    const int VIEW_DISTANCE = 4;

    Dictionary<Vector2Int, Chunk> loadedChunks = new();

    void Update()
    {
        Vector2Int playerChunk = WorldToChunk(player.position);

        // Load nearby chunks
        for (int x = -VIEW_DISTANCE; x <= VIEW_DISTANCE; x++)
        {
            for (int z = -VIEW_DISTANCE; z <= VIEW_DISTANCE; z++)
            {
                Vector2Int coord = playerChunk + new Vector2Int(x, z);
                if (!loadedChunks.ContainsKey(coord))
                {
                    LoadChunkAsync(coord);
                }
            }
        }

        // Unload distant chunks
        UnloadDistantChunks(playerChunk, VIEW_DISTANCE + 2);
    }
}
```

## Mesh Merging

Combine multiple building pieces into single meshes:

```csharp
public Mesh CombineMeshes(List<MeshFilter> filters)
{
    CombineInstance[] combine = new CombineInstance[filters.Count];

    for (int i = 0; i < filters.Count; i++)
    {
        combine[i].mesh = filters[i].sharedMesh;
        combine[i].transform = filters[i].transform.localToWorldMatrix;
    }

    Mesh combinedMesh = new Mesh();
    combinedMesh.CombineMeshes(combine, true, true);
    return combinedMesh;
}
```

## Memory Management

- Pool building piece prefabs
- Use shared materials
- Compress textures (BC7/ASTC)
- Stream meshes for large structures
