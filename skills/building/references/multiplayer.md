# Multiplayer Building

## Server Authority

All building operations should be server-authoritative:

```csharp
// Client requests build
[Command]
void CmdRequestBuild(int pieceId, Vector3 position, Quaternion rotation)
{
    // Server validates
    if (!CanPlace(position, rotation, pieceId))
    {
        TargetBuildFailed(connectionToClient, "Invalid placement");
        return;
    }

    if (!HasResources(connectionToClient.identity, pieceId))
    {
        TargetBuildFailed(connectionToClient, "Insufficient resources");
        return;
    }

    // Server spawns and syncs to all clients
    GameObject piece = Instantiate(piecePrefabs[pieceId], position, rotation);
    NetworkServer.Spawn(piece);

    // Deduct resources
    DeductResources(connectionToClient.identity, pieceId);
}
```

## State Synchronization

### Delta Compression

```csharp
public class BuildingState : NetworkBehaviour
{
    SyncList<BuildingPieceData> pieces = new SyncList<BuildingPieceData>();

    public struct BuildingPieceData
    {
        public uint id;
        public ushort prefabIndex;
        public Vector3 position;
        public Quaternion rotation;
        public float integrity;
    }

    void OnPiecesChanged(SyncList<BuildingPieceData>.Operation op, int index, BuildingPieceData oldItem, BuildingPieceData newItem)
    {
        switch (op)
        {
            case SyncList<BuildingPieceData>.Operation.OP_ADD:
                SpawnPieceLocally(newItem);
                break;
            case SyncList<BuildingPieceData>.Operation.OP_REMOVEAT:
                DestroyPieceLocally(oldItem.id);
                break;
            case SyncList<BuildingPieceData>.Operation.OP_SET:
                UpdatePieceLocally(newItem);
                break;
        }
    }
}
```

### Interest Management

Only sync buildings in player's area:

```csharp
public class BuildingInterestManagement : InterestManagement
{
    public float visibilityRange = 100f;

    public override bool OnCheckObserver(NetworkIdentity identity, NetworkConnectionToClient conn)
    {
        Vector3 playerPos = conn.identity.transform.position;
        Vector3 buildingPos = identity.transform.position;

        return Vector3.Distance(playerPos, buildingPos) <= visibilityRange;
    }
}
```

## Prediction & Rollback

### Client-Side Prediction

```csharp
[Client]
void TryBuild(int pieceId, Vector3 position, Quaternion rotation)
{
    // Predict locally
    GameObject preview = Instantiate(ghostPrefabs[pieceId], position, rotation);
    preview.GetComponent<GhostPiece>().SetPending();

    pendingBuilds.Add(new PendingBuild {
        localId = nextLocalId++,
        preview = preview,
        pieceId = pieceId,
        position = position,
        rotation = rotation,
        timestamp = Time.time
    });

    // Send to server
    CmdRequestBuild(pieceId, position, rotation, pendingBuilds.Count - 1);
}

[TargetRpc]
void TargetBuildConfirmed(NetworkConnection conn, int localId, uint serverId)
{
    var pending = pendingBuilds.Find(p => p.localId == localId);
    if (pending != null)
    {
        pending.preview.GetComponent<GhostPiece>().Confirm();
        pendingBuilds.Remove(pending);
    }
}

[TargetRpc]
void TargetBuildFailed(NetworkConnection conn, int localId, string reason)
{
    var pending = pendingBuilds.Find(p => p.localId == localId);
    if (pending != null)
    {
        Destroy(pending.preview);
        pendingBuilds.Remove(pending);
        ShowError(reason);
    }
}
```

## Bandwidth Optimization

- Quantize positions (use shorts instead of floats)
- Batch multiple operations per frame
- Use bit flags for piece properties
- Compress rotation to smallest-three format
