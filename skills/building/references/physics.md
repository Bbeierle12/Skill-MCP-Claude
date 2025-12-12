# Building Physics

## Structural Integrity

### Support Propagation

```csharp
public class StructuralIntegrity : MonoBehaviour
{
    public float maxIntegrity = 100f;
    public float currentIntegrity;
    public bool isFoundation;

    HashSet<StructuralIntegrity> supporters = new();
    HashSet<StructuralIntegrity> supported = new();

    public void RecalculateIntegrity()
    {
        if (isFoundation)
        {
            currentIntegrity = maxIntegrity;
            return;
        }

        float bestSupport = 0f;
        foreach (var supporter in supporters)
        {
            float propagated = supporter.currentIntegrity * GetConnectionStrength(supporter);
            bestSupport = Mathf.Max(bestSupport, propagated);
        }

        currentIntegrity = bestSupport;

        // Collapse if no support
        if (currentIntegrity <= 0)
        {
            Collapse();
        }

        // Propagate to supported pieces
        foreach (var piece in supported)
        {
            piece.RecalculateIntegrity();
        }
    }

    float GetConnectionStrength(StructuralIntegrity supporter)
    {
        // Vertical connections stronger than horizontal
        float verticalBonus = supporter.transform.position.y < transform.position.y ? 0.95f : 0.7f;
        return verticalBonus;
    }
}
```

### Damage Propagation

```csharp
public void TakeDamage(float damage)
{
    currentIntegrity -= damage;

    if (currentIntegrity <= 0)
    {
        Collapse();
    }
    else
    {
        // Recalculate connected pieces
        foreach (var piece in supported)
        {
            piece.RecalculateIntegrity();
        }
    }
}
```

## Collision Detection

### Overlap Testing for Placement

```csharp
public bool CanPlace(Vector3 position, Quaternion rotation, BuildingPiece piece)
{
    Collider[] overlaps = Physics.OverlapBox(
        position + piece.bounds.center,
        piece.bounds.extents,
        rotation,
        buildingLayer
    );

    // Filter out valid snap connections
    foreach (var overlap in overlaps)
    {
        if (!IsValidSnapPoint(overlap, piece))
        {
            return false;
        }
    }

    return true;
}
```

### Snap Point System

```csharp
public class SnapPoint : MonoBehaviour
{
    public SnapType type; // Floor, Wall, Ceiling, Foundation
    public bool isOccupied;
    public SnapPoint connectedTo;

    public bool CanSnapTo(SnapPoint other)
    {
        if (isOccupied || other.isOccupied) return false;

        // Check compatible types
        return AreTypesCompatible(type, other.type);
    }

    public void SnapTo(SnapPoint other)
    {
        isOccupied = true;
        other.isOccupied = true;
        connectedTo = other;
        other.connectedTo = this;

        // Update structural connections
        GetComponent<StructuralIntegrity>().AddSupporter(
            other.GetComponent<StructuralIntegrity>()
        );
    }
}
```

## Destruction Physics

### Ragdoll on Collapse

```csharp
public void Collapse()
{
    // Convert to physics object
    Rigidbody rb = gameObject.AddComponent<Rigidbody>();
    rb.mass = CalculateMass();
    rb.AddExplosionForce(500f, transform.position + Random.insideUnitSphere, 5f);

    // Disconnect from structure
    foreach (var supporter in supporters)
    {
        supporter.supported.Remove(this);
    }
    foreach (var piece in supported)
    {
        piece.supporters.Remove(this);
        piece.RecalculateIntegrity();
    }

    // Destroy after falling
    Destroy(gameObject, 5f);
}
```

## Performance Tips

- Use compound colliders, not mesh colliders
- Batch physics queries
- Use layers to filter collision checks
- Sleep rigidbodies when stable
