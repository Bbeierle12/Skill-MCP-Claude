# Instancing Patterns

Advanced patterns for rendering thousands of objects efficiently with InstancedMesh.

## Core Concept

InstancedMesh renders N copies of the same geometry+material in a single draw call. Each instance can have unique:
- Position, rotation, scale (via matrix)
- Color (via instanceColor)
- Custom attributes (via InstancedBufferAttribute)

## Basic Setup

```tsx
import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface ParticlesProps {
  count: number;
}

function Particles({ count }: ParticlesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  
  // Initialize positions
  useEffect(() => {
    for (let i = 0; i < count; i++) {
      dummy.position.set(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10
      );
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [count, dummy]);
  
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <boxGeometry args={[0.1, 0.1, 0.1]} />
      <meshStandardMaterial />
    </instancedMesh>
  );
}
```

## Per-Instance Colors

```tsx
function ColoredInstances({ count }: { count: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  
  useEffect(() => {
    const color = new THREE.Color();
    
    for (let i = 0; i < count; i++) {
      // Rainbow colors
      color.setHSL(i / count, 1, 0.5);
      meshRef.current.setColorAt(i, color);
    }
    
    // Critical: mark colors for upload
    meshRef.current.instanceColor!.needsUpdate = true;
  }, [count]);
  
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[0.1, 16, 16]} />
      <meshStandardMaterial />
    </instancedMesh>
  );
}
```

## Animated Instances

```tsx
function AnimatedInstances({ count }: { count: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  
  // Store per-instance data
  const particles = useMemo(() => {
    return Array.from({ length: count }, () => ({
      position: new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10
      ),
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.02,
        (Math.random() - 0.5) * 0.02,
        (Math.random() - 0.5) * 0.02
      ),
      scale: 0.05 + Math.random() * 0.1
    }));
  }, [count]);
  
  useFrame(() => {
    particles.forEach((particle, i) => {
      // Update position
      particle.position.add(particle.velocity);
      
      // Wrap around bounds
      if (Math.abs(particle.position.x) > 5) particle.velocity.x *= -1;
      if (Math.abs(particle.position.y) > 5) particle.velocity.y *= -1;
      if (Math.abs(particle.position.z) > 5) particle.velocity.z *= -1;
      
      // Apply to instance
      dummy.position.copy(particle.position);
      dummy.scale.setScalar(particle.scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    });
    
    meshRef.current.instanceMatrix.needsUpdate = true;
  });
  
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshStandardMaterial />
    </instancedMesh>
  );
}
```

## Custom Instance Attributes

Pass arbitrary per-instance data to shaders:

```tsx
function CustomAttributeInstances({ count }: { count: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  
  // Custom per-instance data
  const speeds = useMemo(() => {
    const arr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      arr[i] = 0.5 + Math.random() * 2;
    }
    return arr;
  }, [count]);
  
  const phases = useMemo(() => {
    const arr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      arr[i] = Math.random() * Math.PI * 2;
    }
    return arr;
  }, [count]);
  
  useEffect(() => {
    const geometry = meshRef.current.geometry;
    
    geometry.setAttribute(
      'aSpeed',
      new THREE.InstancedBufferAttribute(speeds, 1)
    );
    geometry.setAttribute(
      'aPhase',
      new THREE.InstancedBufferAttribute(phases, 1)
    );
  }, [speeds, phases]);
  
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <boxGeometry args={[0.1, 0.1, 0.1]} />
      <shaderMaterial
        uniforms={{ uTime: { value: 0 } }}
        vertexShader={`
          attribute float aSpeed;
          attribute float aPhase;
          uniform float uTime;
          
          void main() {
            vec3 pos = position;
            
            // Oscillate based on speed and phase
            float offset = sin(uTime * aSpeed + aPhase) * 0.5;
            
            vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
            mvPosition.y += offset;
            
            gl_Position = projectionMatrix * mvPosition;
          }
        `}
        fragmentShader={`
          void main() {
            gl_FragColor = vec4(1.0, 0.5, 0.2, 1.0);
          }
        `}
      />
    </instancedMesh>
  );
}
```

## Drei Instances Helper

Simpler API for common cases:

```tsx
import { Instances, Instance } from '@react-three/drei';

function DreiInstances() {
  const positions = useMemo(() => 
    Array.from({ length: 100 }, () => [
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10
    ] as [number, number, number])
  , []);
  
  return (
    <Instances limit={100}>
      <boxGeometry args={[0.2, 0.2, 0.2]} />
      <meshStandardMaterial />
      
      {positions.map((pos, i) => (
        <Instance 
          key={i} 
          position={pos}
          rotation={[Math.random(), Math.random(), 0]}
          color={`hsl(${i * 3.6}, 100%, 50%)`}
        />
      ))}
    </Instances>
  );
}
```

## Performance Tips

### Pre-allocate Objects

```tsx
// Bad: Creates new objects every frame
useFrame(() => {
  const pos = new THREE.Vector3();  // Garbage!
  const quat = new THREE.Quaternion();  // Garbage!
});

// Good: Reuse objects
const pos = useMemo(() => new THREE.Vector3(), []);
const quat = useMemo(() => new THREE.Quaternion(), []);
useFrame(() => {
  pos.set(1, 2, 3);
  quat.setFromEuler(/* ... */);
});
```

### Batch Updates

```tsx
// Update all instances, then mark once
useFrame(() => {
  for (let i = 0; i < count; i++) {
    // ... update matrices
    meshRef.current.setMatrixAt(i, dummy.matrix);
  }
  // Single GPU upload
  meshRef.current.instanceMatrix.needsUpdate = true;
});
```

### Frustum Culling

For large instance counts, consider manual culling:

```tsx
function CulledInstances({ count }: { count: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  
  useFrame(({ camera }) => {
    const frustum = new THREE.Frustum();
    const matrix = new THREE.Matrix4();
    
    matrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    frustum.setFromProjectionMatrix(matrix);
    
    // Only update visible instances
    let visibleCount = 0;
    particles.forEach((p, i) => {
      if (frustum.containsPoint(p.position)) {
        // Update this instance
        visibleCount++;
      }
    });
  });
}
```

## Instance Limits

| Instance Count | Performance | Notes |
|----------------|-------------|-------|
| < 1,000 | Excellent | No optimization needed |
| 1,000 - 10,000 | Good | Use instancing |
| 10,000 - 100,000 | Fair | Consider GPU particles |
| > 100,000 | Variable | Need custom shaders, compute |
