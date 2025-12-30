# R3F Hooks API Reference

Complete reference for React Three Fiber hooks.

## useThree

Access R3F state from any component inside Canvas:

```tsx
import { useThree } from '@react-three/fiber';

function Component() {
  const state = useThree();
  // or destructure specific values
  const { camera, gl, scene } = useThree();
}
```

### State Properties

| Property | Type | Description |
|----------|------|-------------|
| `gl` | `WebGLRenderer` | The WebGL renderer |
| `scene` | `Scene` | The scene object |
| `camera` | `Camera` | Current active camera |
| `raycaster` | `Raycaster` | For pointer events |
| `pointer` | `Vector2` | Normalized pointer position |
| `mouse` | `Vector2` | Alias for pointer |
| `clock` | `Clock` | Three.js clock |
| `size` | `{ width, height, top, left }` | Canvas size in pixels |
| `viewport` | `{ width, height, factor, distance, aspect }` | Viewport in Three.js units |
| `aspect` | `number` | Canvas aspect ratio |
| `set` | `function` | Update state |
| `get` | `function` | Get current state |
| `invalidate` | `function` | Request re-render (demand mode) |
| `advance` | `function` | Advance one frame (never mode) |
| `setSize` | `function` | Resize canvas |
| `setDpr` | `function` | Change device pixel ratio |
| `setFrameloop` | `function` | Change frameloop mode |
| `setEvents` | `function` | Update event settings |
| `onPointerMissed` | `function` | Global pointer miss handler |
| `events` | `object` | Event handlers state |
| `xr` | `object` | WebXR state |
| `performance` | `object` | Adaptive performance state |

### Selector Pattern (Performance)

Only subscribe to specific state slices:

```tsx
// Re-renders only when camera changes
const camera = useThree((state) => state.camera);

// Re-renders only when size changes
const { width, height } = useThree((state) => state.size);

// Multiple values with shallow compare
const [camera, gl] = useThree((state) => [state.camera, state.gl]);
```

### Viewport Calculations

```tsx
const { viewport, camera } = useThree();

// Convert screen pixels to Three.js units
const unitsPerPixel = viewport.factor;

// Viewport dimensions at specific Z distance
const atZ = (z: number) => {
  const distance = camera.position.z - z;
  const fov = (camera.fov * Math.PI) / 180;
  const height = 2 * Math.tan(fov / 2) * distance;
  const width = height * viewport.aspect;
  return { width, height };
};
```

## useFrame

Run code on every frame (render loop):

```tsx
import { useFrame } from '@react-three/fiber';

useFrame((state, delta, frame) => {
  // state: Same as useThree
  // delta: Time since last frame (seconds)
  // frame: XRFrame for WebXR
});
```

### Animation Patterns

```tsx
// Rotate mesh
const meshRef = useRef<THREE.Mesh>(null!);
useFrame((_, delta) => {
  meshRef.current.rotation.y += delta;
});

// Smooth follow
useFrame((state) => {
  meshRef.current.position.lerp(targetPosition, 0.1);
});

// Oscillation
useFrame(({ clock }) => {
  meshRef.current.position.y = Math.sin(clock.elapsedTime) * 2;
});

// Camera tracking
useFrame(({ camera }) => {
  camera.lookAt(targetRef.current.position);
});
```

### Render Priority

Control execution order with priority argument:

```tsx
// Physics update (runs first)
useFrame(() => {
  updatePhysics();
}, -1);

// Visual updates (default priority)
useFrame(() => {
  updateMeshes();
}, 0);

// Camera/post-processing (runs last)
useFrame(() => {
  updateCamera();
}, 1);
```

### Conditional Rendering

```tsx
// Skip frame logic when not needed
const [active, setActive] = useState(true);

useFrame(() => {
  if (!active) return;
  // ... animation logic
});
```

## useLoader

Load assets with Suspense integration:

```tsx
import { useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { TextureLoader } from 'three';

// Single asset
const gltf = useLoader(GLTFLoader, '/model.glb');
const texture = useLoader(TextureLoader, '/texture.jpg');

// Multiple assets
const [model1, model2] = useLoader(GLTFLoader, ['/a.glb', '/b.glb']);

// With extensions (e.g., Draco)
const gltf = useLoader(
  GLTFLoader,
  '/model.glb',
  (loader) => {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/draco/');
    loader.setDRACOLoader(dracoLoader);
  }
);
```

### Preloading

```tsx
// Preload outside component
useLoader.preload(GLTFLoader, '/model.glb');

// Or use drei's Preload component
import { Preload } from '@react-three/drei';
<Canvas>
  <Suspense fallback={null}>
    <Scene />
    <Preload all />
  </Suspense>
</Canvas>
```

## useGraph

Traverse and extract objects from loaded scenes:

```tsx
import { useGraph } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';

function Model() {
  const { scene } = useGLTF('/model.glb');
  const { nodes, materials } = useGraph(scene);
  
  // Access specific meshes by name
  return (
    <>
      <mesh geometry={nodes.Body.geometry} material={materials.Metal} />
      <mesh geometry={nodes.Wheel.geometry} material={materials.Rubber} />
    </>
  );
}
```

## Custom Hooks Patterns

### useAnimatedValue

```tsx
function useAnimatedValue(target: number, speed = 0.1) {
  const valueRef = useRef(target);
  
  useFrame(() => {
    valueRef.current += (target - valueRef.current) * speed;
  });
  
  return valueRef;
}
```

### useMousePosition3D

```tsx
function useMousePosition3D(z = 0) {
  const position = useRef(new THREE.Vector3());
  const { camera, viewport } = useThree();
  
  useFrame(({ pointer }) => {
    position.current.set(
      (pointer.x * viewport.width) / 2,
      (pointer.y * viewport.height) / 2,
      z
    );
  });
  
  return position;
}
```

### useBoundingBox

```tsx
function useBoundingBox(ref: RefObject<THREE.Object3D>) {
  const [box, setBox] = useState<THREE.Box3 | null>(null);
  
  useEffect(() => {
    if (ref.current) {
      const bbox = new THREE.Box3().setFromObject(ref.current);
      setBox(bbox);
    }
  }, [ref]);
  
  return box;
}
```
