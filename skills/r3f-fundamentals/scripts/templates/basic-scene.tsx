// Basic R3F Scene Template
// Copy and customize for new projects

import { useRef, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// =============================================================================
// SCENE COMPONENTS
// =============================================================================

function RotatingBox() {
  const meshRef = useRef<THREE.Mesh>(null!);
  
  useFrame((state, delta) => {
    meshRef.current.rotation.x += delta * 0.5;
    meshRef.current.rotation.y += delta * 0.3;
  });
  
  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#ff6b6b" />
    </mesh>
  );
}

function Floor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]} receiveShadow>
      <planeGeometry args={[10, 10]} />
      <meshStandardMaterial color="#333" />
    </mesh>
  );
}

function Lights() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[5, 10, 5]}
        intensity={1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={50}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />
    </>
  );
}

function Scene() {
  return (
    <>
      <Lights />
      <RotatingBox />
      <Floor />
    </>
  );
}

// =============================================================================
// LOADING FALLBACK
// =============================================================================

function Loader() {
  const meshRef = useRef<THREE.Mesh>(null!);
  
  useFrame((_, delta) => {
    meshRef.current.rotation.z += delta * 2;
  });
  
  return (
    <mesh ref={meshRef}>
      <torusGeometry args={[0.5, 0.1, 16, 32]} />
      <meshBasicMaterial color="white" wireframe />
    </mesh>
  );
}

// =============================================================================
// MAIN APP
// =============================================================================

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Canvas
        shadows
        camera={{ position: [3, 3, 3], fov: 75 }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance'
        }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#1a1a2e']} />
        
        <Suspense fallback={<Loader />}>
          <Scene />
        </Suspense>
      </Canvas>
    </div>
  );
}

// =============================================================================
// CANVAS PRESETS (uncomment to use)
// =============================================================================

/*
// Performance-focused (mobile)
<Canvas
  dpr={1}
  gl={{ antialias: false, powerPreference: 'low-power' }}
  frameloop="demand"
/>

// Quality-focused (desktop)
<Canvas
  shadows="soft"
  dpr={[1, 2]}
  gl={{ antialias: true }}
  camera={{ fov: 45 }}
/>

// Orthographic
<Canvas
  orthographic
  camera={{ zoom: 50, position: [0, 0, 100] }}
/>
*/
