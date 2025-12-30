# Shader Templates

Common shader patterns for R3F ShaderMaterial.

## Starter Template

```tsx
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const vertexShader = `
  uniform float uTime;
  
  varying vec2 vUv;
  varying vec3 vPosition;
  varying vec3 vNormal;
  
  void main() {
    vUv = uv;
    vPosition = position;
    vNormal = normalize(normalMatrix * normal);
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform float uTime;
  uniform vec3 uColor;
  
  varying vec2 vUv;
  varying vec3 vPosition;
  varying vec3 vNormal;
  
  void main() {
    vec3 color = uColor;
    gl_FragColor = vec4(color, 1.0);
  }
`;

function ShaderMesh() {
  const materialRef = useRef<THREE.ShaderMaterial>(null!);
  
  useFrame(({ clock }) => {
    materialRef.current.uniforms.uTime.value = clock.elapsedTime;
  });
  
  return (
    <mesh>
      <planeGeometry args={[2, 2, 32, 32]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={{
          uTime: { value: 0 },
          uColor: { value: new THREE.Color('#ff6b6b') }
        }}
      />
    </mesh>
  );
}
```

## Gradient

```glsl
// Fragment shader
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uAngle;

varying vec2 vUv;

void main() {
  // Rotated gradient
  vec2 uv = vUv - 0.5;
  float angle = uAngle;
  uv = vec2(
    uv.x * cos(angle) - uv.y * sin(angle),
    uv.x * sin(angle) + uv.y * cos(angle)
  );
  uv += 0.5;
  
  vec3 color = mix(uColorA, uColorB, uv.y);
  gl_FragColor = vec4(color, 1.0);
}
```

## Fresnel / Rim Light

```glsl
// Fragment shader
uniform vec3 uFresnelColor;
uniform float uFresnelPower;

varying vec3 vNormal;

void main() {
  // View direction (assumes camera at origin in view space)
  vec3 viewDir = normalize(cameraPosition - vPosition);
  
  // Fresnel factor
  float fresnel = pow(1.0 - dot(viewDir, vNormal), uFresnelPower);
  
  vec3 baseColor = vec3(0.1);
  vec3 color = mix(baseColor, uFresnelColor, fresnel);
  
  gl_FragColor = vec4(color, 1.0);
}
```

## Wave Displacement

```glsl
// Vertex shader
uniform float uTime;
uniform float uAmplitude;
uniform float uFrequency;

varying vec2 vUv;

void main() {
  vUv = uv;
  
  vec3 pos = position;
  
  // Wave displacement
  float wave = sin(pos.x * uFrequency + uTime) * 
               cos(pos.y * uFrequency + uTime) * 
               uAmplitude;
  pos.z += wave;
  
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
```

## Noise-Based Distortion

```glsl
// Include noise functions (see noise patterns below)

uniform float uTime;
uniform float uNoiseScale;
uniform float uNoiseStrength;

varying vec2 vUv;

void main() {
  vUv = uv;
  
  vec3 pos = position;
  
  // 3D noise displacement
  float noise = snoise(vec3(pos.xy * uNoiseScale, uTime * 0.5));
  pos.z += noise * uNoiseStrength;
  
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
```

## Dissolve Effect

```glsl
// Fragment shader
uniform float uProgress;  // 0 to 1
uniform float uEdgeWidth;
uniform vec3 uEdgeColor;
uniform sampler2D uNoiseTexture;

varying vec2 vUv;

void main() {
  float noise = texture2D(uNoiseTexture, vUv).r;
  
  // Dissolve threshold
  float threshold = uProgress;
  
  // Discard dissolved pixels
  if (noise < threshold) {
    discard;
  }
  
  // Edge glow
  float edge = smoothstep(threshold, threshold + uEdgeWidth, noise);
  vec3 color = mix(uEdgeColor, vec3(1.0), edge);
  
  gl_FragColor = vec4(color, 1.0);
}
```

## Holographic

```glsl
// Fragment shader
uniform float uTime;
uniform vec3 uColor;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;

void main() {
  // Scanlines
  float scanline = sin(vUv.y * 200.0 + uTime * 10.0) * 0.1 + 0.9;
  
  // Fresnel
  vec3 viewDir = normalize(cameraPosition - vPosition);
  float fresnel = pow(1.0 - abs(dot(viewDir, vNormal)), 2.0);
  
  // Color shift
  vec3 color = uColor;
  color.r += sin(uTime + vUv.y * 10.0) * 0.1;
  color.b += cos(uTime + vUv.y * 10.0) * 0.1;
  
  // Combine
  color *= scanline;
  color += fresnel * 0.5;
  
  // Alpha based on fresnel
  float alpha = 0.5 + fresnel * 0.5;
  
  gl_FragColor = vec4(color, alpha);
}
```

## Glitch

```glsl
// Fragment shader
uniform float uTime;
uniform float uIntensity;
uniform sampler2D uTexture;

varying vec2 vUv;

float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
  vec2 uv = vUv;
  
  // Random horizontal offset
  float glitchTime = floor(uTime * 20.0);
  float glitchRand = random(vec2(glitchTime, 0.0));
  
  if (glitchRand > 0.9) {
    float offset = (random(vec2(uv.y, glitchTime)) - 0.5) * uIntensity;
    uv.x += offset;
  }
  
  // Color channel split
  vec4 color;
  color.r = texture2D(uTexture, uv + vec2(0.01, 0.0) * uIntensity).b;
  color.g = texture2D(uTexture, uv).g;
  color.b = texture2D(uTexture, uv - vec2(0.01, 0.0) * uIntensity).b;
  color.a = 1.0;
  
  gl_FragColor = color;
}
```

## Particle Point Shader

```glsl
// Vertex shader (for Points)
uniform float uTime;
uniform float uSize;

attribute float aScale;
attribute vec3 aRandomness;

varying vec3 vColor;

void main() {
  vec4 modelPosition = modelMatrix * vec4(position, 1.0);
  
  // Add randomness animation
  modelPosition.xyz += aRandomness * sin(uTime + position.x);
  
  vec4 viewPosition = viewMatrix * modelPosition;
  vec4 projectedPosition = projectionMatrix * viewPosition;
  
  gl_Position = projectedPosition;
  
  // Size attenuation
  gl_PointSize = uSize * aScale;
  gl_PointSize *= (1.0 / -viewPosition.z);
  
  // Color based on position
  vColor = vec3(position.x, position.y, 1.0) * 0.5 + 0.5;
}

// Fragment shader
varying vec3 vColor;

void main() {
  // Circular point
  float dist = length(gl_PointCoord - 0.5);
  if (dist > 0.5) discard;
  
  // Soft edge
  float alpha = 1.0 - smoothstep(0.4, 0.5, dist);
  
  gl_FragColor = vec4(vColor, alpha);
}
```

## Common Noise Functions

```glsl
// Simplex 2D noise
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
           -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
    dot(x12.zw,x12.zw)), 0.0);
  m = m*m;
  m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// 3D simplex noise (abbreviated, full version in references)
float snoise(vec3 v) {
  // Implementation...
  return 0.0; // Placeholder
}

// FBM (Fractal Brownian Motion)
float fbm(vec2 st, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  
  for (int i = 0; i < octaves; i++) {
    value += amplitude * snoise(st * frequency);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  
  return value;
}
```

## Utility Functions

```glsl
// Remap value from one range to another
float remap(float value, float inMin, float inMax, float outMin, float outMax) {
  return outMin + (outMax - outMin) * (value - inMin) / (inMax - inMin);
}

// Smooth minimum (blend between shapes)
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Rotation matrix
mat2 rotate2D(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat2(c, -s, s, c);
}

// HSV to RGB
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
```
