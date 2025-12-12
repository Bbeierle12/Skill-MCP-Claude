# Terrain Systems

## Voxel Architecture

### Chunk Structure

```csharp
public class VoxelChunk
{
    public const int SIZE = 16;

    // Flat array for cache efficiency
    byte[] voxels = new byte[SIZE * SIZE * SIZE];

    public byte GetVoxel(int x, int y, int z)
    {
        return voxels[x + y * SIZE + z * SIZE * SIZE];
    }

    public void SetVoxel(int x, int y, int z, byte type)
    {
        voxels[x + y * SIZE + z * SIZE * SIZE] = type;
        isDirty = true;
    }
}
```

### Chunk Management

```csharp
public class ChunkManager
{
    Dictionary<Vector3Int, VoxelChunk> chunks = new();
    Queue<Vector3Int> meshQueue = new();

    public void ModifyTerrain(Vector3 worldPos, byte voxelType)
    {
        Vector3Int chunkCoord = WorldToChunk(worldPos);
        Vector3Int localPos = WorldToLocal(worldPos);

        if (!chunks.TryGetValue(chunkCoord, out var chunk))
        {
            chunk = LoadOrGenerateChunk(chunkCoord);
        }

        chunk.SetVoxel(localPos.x, localPos.y, localPos.z, voxelType);

        // Queue mesh rebuild
        if (!meshQueue.Contains(chunkCoord))
        {
            meshQueue.Enqueue(chunkCoord);
        }

        // Also update adjacent chunks if on boundary
        UpdateAdjacentChunks(chunkCoord, localPos);
    }
}
```

## Mesh Generation

### Greedy Meshing

```csharp
public Mesh GenerateGreedyMesh(VoxelChunk chunk)
{
    List<Vector3> vertices = new();
    List<int> triangles = new();
    List<Vector2> uvs = new();

    // Process each axis
    for (int axis = 0; axis < 3; axis++)
    {
        int u = (axis + 1) % 3;
        int v = (axis + 2) % 3;

        int[] x = new int[3];
        int[] q = new int[3];
        q[axis] = 1;

        // Sweep through the volume
        for (x[axis] = -1; x[axis] < VoxelChunk.SIZE;)
        {
            // Compute mask
            bool[,] mask = ComputeMask(chunk, axis, x, u, v);

            x[axis]++;

            // Generate quads from mask using greedy algorithm
            GenerateQuadsFromMask(mask, axis, x, u, v, vertices, triangles, uvs);
        }
    }

    Mesh mesh = new Mesh();
    mesh.vertices = vertices.ToArray();
    mesh.triangles = triangles.ToArray();
    mesh.uv = uvs.ToArray();
    mesh.RecalculateNormals();
    return mesh;
}
```

## Procedural Generation

### Noise-Based Terrain

```csharp
public byte GenerateVoxel(Vector3 worldPos)
{
    float height = GetTerrainHeight(worldPos.x, worldPos.z);

    if (worldPos.y > height)
    {
        return AIR;
    }
    else if (worldPos.y > height - 1)
    {
        return GRASS;
    }
    else if (worldPos.y > height - 4)
    {
        return DIRT;
    }
    else
    {
        return STONE;
    }
}

float GetTerrainHeight(float x, float z)
{
    float scale = 0.01f;

    // Layer multiple octaves
    float height = 0;
    height += Mathf.PerlinNoise(x * scale, z * scale) * 32;
    height += Mathf.PerlinNoise(x * scale * 2, z * scale * 2) * 16;
    height += Mathf.PerlinNoise(x * scale * 4, z * scale * 4) * 8;

    return height + 64; // Base height
}
```

### Cave Generation

```csharp
bool IsCave(Vector3 pos)
{
    float scale = 0.05f;
    float threshold = 0.6f;

    // 3D noise for caves
    float noise = Perlin3D(pos.x * scale, pos.y * scale, pos.z * scale);

    return noise > threshold;
}
```

## Serialization

### Chunk Save/Load

```csharp
public byte[] SerializeChunk(VoxelChunk chunk)
{
    using var ms = new MemoryStream();
    using var writer = new BinaryWriter(ms);

    // Run-length encoding
    byte currentType = chunk.voxels[0];
    int count = 1;

    for (int i = 1; i < chunk.voxels.Length; i++)
    {
        if (chunk.voxels[i] == currentType && count < 255)
        {
            count++;
        }
        else
        {
            writer.Write(currentType);
            writer.Write((byte)count);
            currentType = chunk.voxels[i];
            count = 1;
        }
    }

    writer.Write(currentType);
    writer.Write((byte)count);

    return ms.ToArray();
}
```

## Performance Tips

- Generate meshes on background threads
- Use object pooling for chunk GameObjects
- Implement chunk LOD for distant terrain
- Cache neighbor chunk references
