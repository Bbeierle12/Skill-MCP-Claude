# Platform Considerations for Building Systems

Building mechanics require adaptation across platforms. Mobile touch lacks hover states and precision, VR adds spatial depth but introduces comfort concerns, and accessibility requirements affect visual feedback systems. This reference covers patterns from successful games and research-backed guidelines.

## Mobile Touch Patterns

### Gesture Vocabulary

Touch building uses a limited gesture set to avoid conflicts and ensure discoverability. Fortnite Mobile's approach demonstrates the minimal effective set.

**Core Gestures:**
- Single tap: Select piece type / Confirm placement
- Tap and hold: Enter placement mode / Show options menu
- Drag: Move piece position / Pan camera
- Pinch: Zoom camera / Scale piece (if supported)
- Two-finger rotate: Rotate piece around Y axis
- Swipe (edge): Cycle piece types / Switch materials

**Conflict Resolution:**

Distinguishing tap from drag requires a distance threshold (typically 10-15px) and time threshold (150-200ms). If the touch moves beyond the distance threshold before the time threshold, it's a drag. If time expires without movement, it's a tap-hold.

```javascript
const DRAG_THRESHOLD = 12; // pixels
const HOLD_THRESHOLD = 180; // milliseconds

function classifyGesture(touchStart, touchCurrent, elapsed) {
  const distance = Math.hypot(
    touchCurrent.x - touchStart.x,
    touchCurrent.y - touchStart.y
  );
  
  if (distance > DRAG_THRESHOLD) return 'drag';
  if (elapsed > HOLD_THRESHOLD) return 'hold';
  return 'pending';
}
```

### Touch Target Sizes

Apple Human Interface Guidelines specify 44x44pt minimum touch targets. For building games where precision matters, slightly larger targets (48-56pt) reduce errors. Fortnite Mobile uses 52pt for build piece buttons.

**Recommended Sizes:**
- Primary actions (place, delete): 52-56pt
- Secondary actions (rotate, upgrade): 44-48pt
- Navigation (camera controls): Full edge zones (64pt strips)

### Build Mode Patterns

**Fortnite Mobile Approach:**

Fortnite uses a dedicated build mode toggle. When active, the screen layout changes to show piece selection prominently, and tap behavior shifts from combat to building. This modal approach prevents accidental placement during movement.

**Minecraft Pocket Edition Approach:**

Minecraft PE uses contextual building. Tap on existing blocks places adjacent blocks, tap and hold destroys. No explicit mode toggle, but requires existing geometry as reference. Better for exploration games, worse for rapid construction.

**Recommended Hybrid:**

For survival builders, combine approaches. Default to contextual mode for simple placements, with a build mode toggle for complex construction. The toggle can be a floating action button or a gesture (three-finger tap).

### Performance Budgets

Mobile GPUs are constrained. Building games must balance piece complexity against device capability.

**Device Tiers:**

| Tier | Example Devices | Max Pieces | Triangle Budget |
|------|-----------------|------------|-----------------|
| Low | iPhone 8, older Android | 500 | 50k |
| Medium | iPhone 11, mid Android | 2,000 | 200k |
| High | iPhone 14+, flagship Android | 5,000 | 500k |

**Adaptive Quality:**

Implement LOD based on device tier and current frame time.

```javascript
function getQualityLevel(avgFrameTime, deviceTier) {
  if (avgFrameTime > 33) return 'low'; // Below 30fps
  if (avgFrameTime > 20) return 'medium'; // Below 50fps
  return deviceTier === 'high' ? 'high' : 'medium';
}
```

### Auto-Material Selection

Mobile benefits from reducing decision points. Auto-material selection chooses the highest available material the player can afford, reducing taps.

```javascript
function autoSelectMaterial(pieceType, inventory) {
  const materials = ['armored', 'metal', 'stone', 'wood', 'twig'];
  
  for (const material of materials) {
    const cost = getCost(pieceType, material);
    if (hasResources(inventory, cost)) {
      return material;
    }
  }
  
  return null; // Can't afford any material
}
```

## VR Building Patterns

### Input Modalities

VR supports multiple input types with different characteristics.

**Controller-Based:**

Dominant in current VR. Trigger for select/place, grip for grab, thumbstick for rotation. Laser pointer for distant selection (beyond arm's reach).

**Hand Tracking:**

Emerging with Quest hand tracking. Pinch gesture for select, palm-down release for place, rotation by physically rotating hand. More intuitive but less precise.

**Gaze-Based:**

Fallback for seated VR or accessibility. Head direction selects, button confirms. Slower but works for everyone.

### Comfort Guidelines

VR building introduces unique comfort concerns. Motion sickness affects 40-70% of users depending on experience design.

**Snap Rotation:**

Instead of smooth rotation, use snap increments (typically 30°, 45°, or 90°). Eliminates vection (visual motion without physical motion), the primary cause of VR sickness.

```javascript
const SNAP_ANGLES = {
  coarse: Math.PI / 2,  // 90°
  medium: Math.PI / 4,  // 45°
  fine: Math.PI / 6     // 30°
};

function snapRotation(current, direction, granularity = 'medium') {
  const snap = SNAP_ANGLES[granularity];
  return current + (direction * snap);
}
```

**Building Distance:**

Pieces placed too close cause eye strain (vergence-accommodation conflict). Minimum comfortable distance is 0.5m, optimal is 1-2m.

```javascript
const MIN_BUILD_DISTANCE = 0.5; // meters
const MAX_BUILD_DISTANCE = 10; // meters
const OPTIMAL_DISTANCE = 1.5;

function clampBuildDistance(distance) {
  return Math.max(MIN_BUILD_DISTANCE, Math.min(MAX_BUILD_DISTANCE, distance));
}
```

**Arm Fatigue (Gorilla Arm):**

Extended arm positions cause fatigue within 1-2 minutes. Building UI should be positioned at hip/waist level when not in active use. Consider "build from palm" where pieces spawn from the open hand rather than requiring reach.

**Teleportation Building:**

For large structures, allow teleportation while in build mode. Smooth locomotion during building increases sickness. Implement "build station" concept where player teleports to scaffolding positions.

### VR-Specific Feedback

**Haptics:**

Controller vibration communicates placement validity. Short pulse for valid, double pulse for invalid, long pulse for confirm.

```javascript
const HAPTIC_PATTERNS = {
  valid: { duration: 50, intensity: 0.3 },
  invalid: { duration: 30, intensity: 0.5, repeat: 2, gap: 50 },
  confirm: { duration: 100, intensity: 0.6 },
  grab: { duration: 40, intensity: 0.4 }
};

function triggerHaptic(controller, pattern) {
  const p = HAPTIC_PATTERNS[pattern];
  if (p.repeat) {
    for (let i = 0; i < p.repeat; i++) {
      setTimeout(() => {
        controller.gamepad.hapticActuators[0]?.pulse(p.intensity, p.duration);
      }, i * (p.duration + p.gap));
    }
  } else {
    controller.gamepad.hapticActuators[0]?.pulse(p.intensity, p.duration);
  }
}
```

**Spatial Audio:**

Sound position reinforces placement location. Place confirmation sound at piece position, not at player ears. Use 3D audio spatialization.

**Visual Guides:**

Grid overlays help placement in VR where depth perception can be uncertain. Show floor grid, wall alignment guides, and snap indicators.

## Accessibility Patterns

### Color Vision Deficiency

8% of males and 0.5% of females have some form of color vision deficiency. Red-green deficiency (deuteranopia/protanopia) is most common.

**Problematic Patterns:**

Traditional validity feedback (green = valid, red = invalid) fails for red-green colorblind users. These colors appear as similar shades of brown/olive.

**Accessible Alternatives:**

| Feedback Type | Traditional | Accessible Alternative |
|---------------|-------------|------------------------|
| Valid placement | Green (#00FF00) | Blue (#0066FF) |
| Invalid placement | Red (#FF0000) | Orange/Yellow (#FF9900) |
| Stability high | Green | Blue (#3366FF) |
| Stability low | Red | Yellow (#FFCC00) |
| Stability critical | Dark red | White with pattern |

Valheim uses this blue/yellow pattern and it works well.

**Additional Cues:**

Color should never be the only indicator. Combine with shape, animation, or pattern.

```javascript
const VALIDITY_INDICATORS = {
  valid: {
    color: 0x0066ff,
    pattern: 'solid',
    animation: 'none',
    icon: 'checkmark'
  },
  invalid: {
    color: 0xff9900,
    pattern: 'striped',
    animation: 'pulse',
    icon: 'x'
  },
  blocked: {
    color: 0xffcc00,
    pattern: 'dashed',
    animation: 'shake',
    icon: 'lock'
  }
};
```

### Colorblind Simulation

Test designs by simulating color vision deficiency.

```javascript
// Approximate color transforms for colorblind simulation
const COLORBLIND_MATRICES = {
  protanopia: [
    0.567, 0.433, 0.000,
    0.558, 0.442, 0.000,
    0.000, 0.242, 0.758
  ],
  deuteranopia: [
    0.625, 0.375, 0.000,
    0.700, 0.300, 0.000,
    0.000, 0.300, 0.700
  ],
  tritanopia: [
    0.950, 0.050, 0.000,
    0.000, 0.433, 0.567,
    0.000, 0.475, 0.525
  ]
};

function simulateColorblind(color, type) {
  const matrix = COLORBLIND_MATRICES[type];
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  
  return {
    r: r * matrix[0] + g * matrix[1] + b * matrix[2],
    g: r * matrix[3] + g * matrix[4] + b * matrix[5],
    b: r * matrix[6] + g * matrix[7] + b * matrix[8]
  };
}
```

### High Contrast Mode

Some users need increased contrast. Detect system preference and provide manual toggle.

```javascript
// Detect system preference
const prefersHighContrast = window.matchMedia('(prefers-contrast: more)').matches;

// High contrast palette
const CONTRAST_PALETTES = {
  normal: {
    background: 0x1a1a1a,
    foreground: 0xffffff,
    accent: 0x0088ff,
    error: 0xff4444,
    gridLines: 0x333333
  },
  highContrast: {
    background: 0x000000,
    foreground: 0xffffff,
    accent: 0x00ffff,
    error: 0xffff00,
    gridLines: 0xffffff
  }
};
```

WCAG 2.1 requires 4.5:1 contrast ratio for normal text, 3:1 for large text, and 3:1 for UI components. For building feedback, aim for 7:1 on critical indicators.

### Screen Reader Integration

Building games are inherently visual, but screen reader support helps blind/low-vision users and benefits everyone with audio feedback.

**ARIA Live Regions:**

Announce placement results without requiring focus change.

```javascript
// Create announcement region
const announcer = document.createElement('div');
announcer.setAttribute('aria-live', 'polite');
announcer.setAttribute('aria-atomic', 'true');
announcer.className = 'sr-only'; // Visually hidden
document.body.appendChild(announcer);

function announce(message, priority = 'polite') {
  announcer.setAttribute('aria-live', priority);
  announcer.textContent = message;
}

// Usage
function onPlacement(result) {
  if (result.success) {
    announce(`Placed ${result.pieceType} at grid position ${result.gridX}, ${result.gridZ}`);
  } else {
    announce(`Cannot place: ${result.reason}`, 'assertive');
  }
}
```

**Spatial Descriptions:**

Describe piece positions in meaningful terms.

```javascript
function describePosition(position, referencePoint) {
  const dx = position.x - referencePoint.x;
  const dz = position.z - referencePoint.z;
  
  const distance = Math.sqrt(dx * dx + dz * dz);
  const direction = getCardinalDirection(dx, dz);
  
  return `${Math.round(distance)} meters ${direction}`;
}

function getCardinalDirection(dx, dz) {
  const angle = Math.atan2(dz, dx) * (180 / Math.PI);
  
  if (angle > -22.5 && angle <= 22.5) return 'east';
  if (angle > 22.5 && angle <= 67.5) return 'southeast';
  if (angle > 67.5 && angle <= 112.5) return 'south';
  // ... etc
}
```

### Reduced Motion

Some users experience motion sickness or discomfort from animations. Respect system preference.

```javascript
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const ANIMATION_SETTINGS = {
  normal: {
    ghostPulse: true,
    placementBounce: true,
    cameraSmoothing: 0.1,
    rotationAnimated: true
  },
  reduced: {
    ghostPulse: false,
    placementBounce: false,
    cameraSmoothing: 0, // Instant
    rotationAnimated: false // Snap instead
  }
};
```

### Motor Accessibility

Not all users have fine motor control. Provide alternatives to precise gestures.

**Timing Adjustments:**

Allow configuration of timing thresholds for tap-hold, double-tap, etc.

```javascript
const TIMING_PRESETS = {
  default: { holdTime: 180, doubleTapWindow: 300 },
  relaxed: { holdTime: 400, doubleTapWindow: 500 },
  extended: { holdTime: 800, doubleTapWindow: 1000 }
};
```

**Alternative Input:**

Support keyboard/switch control for all functions.

```javascript
const KEYBOARD_BINDINGS = {
  'ArrowUp': 'movePieceForward',
  'ArrowDown': 'movePieceBack',
  'ArrowLeft': 'movePieceLeft',
  'ArrowRight': 'movePieceRight',
  'PageUp': 'movePieceUp',
  'PageDown': 'movePieceDown',
  'q': 'rotateCCW',
  'e': 'rotateCW',
  'Enter': 'confirmPlacement',
  'Escape': 'cancelPlacement',
  'Tab': 'nextPieceType',
  'Shift+Tab': 'prevPieceType'
};
```

## Cross-Platform Abstraction

### Input Abstraction Layer

Unify input handling across platforms behind a common interface.

```javascript
class BuildInputManager {
  constructor() {
    this.handlers = new Map();
    this.activeController = null;
  }
  
  // Register platform-specific controllers
  registerController(platform, controller) {
    this.handlers.set(platform, controller);
  }
  
  // Detect and activate appropriate controller
  activate() {
    if (navigator.xr) {
      this.activeController = this.handlers.get('vr');
    } else if ('ontouchstart' in window) {
      this.activeController = this.handlers.get('touch');
    } else {
      this.activeController = this.handlers.get('desktop');
    }
    
    this.activeController?.activate();
  }
  
  // Unified event interface
  on(event, callback) {
    // Events: 'select', 'place', 'cancel', 'rotate', 'move', 'cycleType'
    this.activeController?.on(event, callback);
  }
}
```

### Consistent Feedback

Ensure feedback works across all platforms.

```javascript
class FeedbackManager {
  constructor(options = {}) {
    this.visualEnabled = options.visual ?? true;
    this.audioEnabled = options.audio ?? true;
    this.hapticEnabled = options.haptic ?? true;
  }
  
  feedback(type, data) {
    if (this.visualEnabled) this.visualFeedback(type, data);
    if (this.audioEnabled) this.audioFeedback(type, data);
    if (this.hapticEnabled) this.hapticFeedback(type, data);
  }
  
  visualFeedback(type, data) {
    // Color flash, animation, etc.
  }
  
  audioFeedback(type, data) {
    // Sound effect
  }
  
  hapticFeedback(type, data) {
    // Vibration (mobile) or controller rumble (VR/gamepad)
    if ('vibrate' in navigator) {
      navigator.vibrate(type === 'error' ? [50, 50, 50] : [30]);
    }
  }
}
```

## Testing Checklist

### Mobile Testing
- [ ] All gestures work with single hand
- [ ] Touch targets meet minimum size (44pt)
- [ ] Works in both portrait and landscape
- [ ] Performance acceptable on low-tier devices
- [ ] Works with screen magnification enabled

### VR Testing
- [ ] No discomfort after 15 minutes of building
- [ ] Works with both hands as dominant
- [ ] Snap rotation feels comfortable
- [ ] Haptic feedback distinguishable
- [ ] Works seated and standing

### Accessibility Testing
- [ ] Tested with colorblind simulation
- [ ] All functions keyboard accessible
- [ ] Screen reader announces all actions
- [ ] Reduced motion preference respected
- [ ] High contrast mode readable
- [ ] Timing adjustable for motor accessibility
