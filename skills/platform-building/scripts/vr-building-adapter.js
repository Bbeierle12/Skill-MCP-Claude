/**
 * VRBuildingAdapter - VR input handling for building systems
 * 
 * Adapts WebXR controller and hand tracking input for building games.
 * Handles grab-and-place mechanics, laser pointer selection, and
 * provides comfort features like snap rotation and distance clamping.
 * 
 * Usage:
 *   const vr = new VRBuildingAdapter(xrSession, renderer, {
 *     dominantHand: 'right',
 *     comfortMode: true
 *   });
 *   vr.onGrab = (piece) => selection.select(piece);
 *   vr.onPlace = (position, rotation) => buildingSystem.place(position, rotation);
 */

import * as THREE from 'three';

/**
 * Input modes for VR building
 */
export const VRInputMode = {
  CONTROLLER: 'controller',
  HAND_TRACKING: 'handTracking',
  GAZE: 'gaze'
};

/**
 * Snap rotation presets
 */
export const SnapRotation = {
  NONE: 0,
  COARSE: Math.PI / 2,    // 90°
  MEDIUM: Math.PI / 4,    // 45°
  FINE: Math.PI / 6       // 30°
};

/**
 * Haptic feedback patterns
 */
const HapticPatterns = {
  select: { duration: 40, intensity: 0.3 },
  grab: { duration: 50, intensity: 0.4 },
  release: { duration: 30, intensity: 0.2 },
  valid: { duration: 50, intensity: 0.3 },
  invalid: { duration: 30, intensity: 0.5, repeat: 2, gap: 40 },
  confirm: { duration: 100, intensity: 0.6 },
  snap: { duration: 20, intensity: 0.2 }
};

export class VRBuildingAdapter {
  /**
   * Create VR building adapter
   * @param {XRSession} xrSession - WebXR session
   * @param {THREE.WebGLRenderer} renderer - Three.js renderer
   * @param {Object} options - Configuration options
   */
  constructor(xrSession, renderer, options = {}) {
    this.session = xrSession;
    this.renderer = renderer;
    
    // Hand configuration
    this.dominantHand = options.dominantHand ?? 'right';
    this.nonDominantHand = this.dominantHand === 'right' ? 'left' : 'right';
    
    // Input mode
    this.inputMode = options.inputMode ?? VRInputMode.CONTROLLER;
    
    // Comfort settings
    this.comfortMode = options.comfortMode ?? true;
    this.snapRotation = options.snapRotation ?? SnapRotation.MEDIUM;
    this.minBuildDistance = options.minBuildDistance ?? 0.5; // meters
    this.maxBuildDistance = options.maxBuildDistance ?? 10; // meters
    this.teleportWhileBuilding = options.teleportWhileBuilding ?? true;
    
    // Grid snapping
    this.snapToGrid = options.snapToGrid ?? true;
    this.gridSize = options.gridSize ?? 0.5; // meters
    
    // Haptic feedback
    this.hapticsEnabled = options.hapticsEnabled ?? true;
    
    // State
    this.controllers = new Map();
    this.hands = new Map();
    this.activeController = null;
    this.grabbedPiece = null;
    this.grabOffset = new THREE.Vector3();
    this.currentRotation = 0;
    this.isPlacementValid = true;
    
    // Laser pointer
    this.laserEnabled = options.laserEnabled ?? true;
    this.laserLength = options.laserLength ?? 10;
    this.laserLine = null;
    this.laserHitPoint = new THREE.Vector3();
    
    // Reference space
    this.referenceSpace = null;
    
    // Raycaster for selection
    this.raycaster = new THREE.Raycaster();
    this.tempMatrix = new THREE.Matrix4();
    
    // Callbacks (set by user)
    this.onSelect = null;
    this.onGrab = null;
    this.onRelease = null;
    this.onPlace = null;
    this.onRotate = null;
    this.onMove = null;
    this.onValidityChange = null;
    this.onTeleport = null;
    
    // Initialize
    this.initialize();
  }

  /**
   * Initialize VR input handling
   */
  async initialize() {
    // Get reference space
    this.referenceSpace = await this.session.requestReferenceSpace('local-floor');
    
    // Setup controller tracking
    this.session.addEventListener('inputsourceschange', (event) => {
      this.handleInputSourcesChange(event);
    });
    
    // Process existing input sources
    for (const source of this.session.inputSources) {
      this.addInputSource(source);
    }
    
    // Create laser pointer visualization
    if (this.laserEnabled) {
      this.createLaserPointer();
    }
  }

  /**
   * Handle input sources change
   */
  handleInputSourcesChange(event) {
    for (const source of event.added) {
      this.addInputSource(source);
    }
    
    for (const source of event.removed) {
      this.removeInputSource(source);
    }
  }

  /**
   * Add input source
   */
  addInputSource(source) {
    if (source.targetRayMode === 'tracked-pointer') {
      // Controller
      const hand = source.handedness;
      this.controllers.set(hand, {
        source,
        grip: null,
        targetRay: null,
        pressing: {
          trigger: false,
          grip: false,
          thumbstick: false
        }
      });
    } else if (source.hand) {
      // Hand tracking
      this.hands.set(source.handedness, {
        source,
        hand: source.hand,
        pinching: false
      });
      
      if (this.inputMode === VRInputMode.CONTROLLER) {
        this.inputMode = VRInputMode.HAND_TRACKING;
      }
    }
  }

  /**
   * Remove input source
   */
  removeInputSource(source) {
    if (source.targetRayMode === 'tracked-pointer') {
      this.controllers.delete(source.handedness);
    } else if (source.hand) {
      this.hands.delete(source.handedness);
    }
  }

  /**
   * Update - call each frame
   * @param {XRFrame} frame - Current XR frame
   * @param {Array} selectablePieces - Pieces that can be selected
   */
  update(frame, selectablePieces = []) {
    if (!frame) return;

    if (this.inputMode === VRInputMode.HAND_TRACKING) {
      this.updateHandTracking(frame);
    } else {
      this.updateControllers(frame, selectablePieces);
    }
    
    // Update grabbed piece position
    if (this.grabbedPiece) {
      this.updateGrabbedPiece(frame);
    }
  }

  /**
   * Update controller input
   */
  updateControllers(frame, selectablePieces) {
    for (const [hand, controller] of this.controllers) {
      const source = controller.source;
      const gamepad = source.gamepad;
      
      if (!gamepad) continue;
      
      // Get pose
      const targetRayPose = frame.getPose(source.targetRaySpace, this.referenceSpace);
      const gripPose = source.gripSpace ? 
        frame.getPose(source.gripSpace, this.referenceSpace) : null;
      
      if (targetRayPose) {
        controller.targetRay = targetRayPose;
      }
      if (gripPose) {
        controller.grip = gripPose;
      }
      
      // Process buttons
      const trigger = gamepad.buttons[0]; // Select/trigger
      const grip = gamepad.buttons[1];    // Grip/squeeze
      const thumbstick = gamepad.buttons[3]; // Thumbstick press
      const axes = gamepad.axes;
      
      // Trigger for selection/placement
      if (trigger && trigger.pressed && !controller.pressing.trigger) {
        this.handleTriggerDown(hand, controller, selectablePieces);
      } else if (trigger && !trigger.pressed && controller.pressing.trigger) {
        this.handleTriggerUp(hand, controller);
      }
      controller.pressing.trigger = trigger?.pressed ?? false;
      
      // Grip for grabbing
      if (grip && grip.pressed && !controller.pressing.grip) {
        this.handleGripDown(hand, controller, selectablePieces);
      } else if (grip && !grip.pressed && controller.pressing.grip) {
        this.handleGripUp(hand, controller);
      }
      controller.pressing.grip = grip?.pressed ?? false;
      
      // Thumbstick for rotation
      if (axes && axes.length >= 4 && hand === this.dominantHand) {
        this.handleThumbstick(axes[2], axes[3], controller);
      }
      
      // Update laser pointer
      if (this.laserEnabled && hand === this.dominantHand) {
        this.updateLaserPointer(controller, selectablePieces);
      }
    }
  }

  /**
   * Update hand tracking input
   */
  updateHandTracking(frame) {
    for (const [handedness, handData] of this.hands) {
      const hand = handData.hand;
      
      // Get pinch state (index tip to thumb tip distance)
      const indexTip = hand.get('index-finger-tip');
      const thumbTip = hand.get('thumb-tip');
      
      if (!indexTip || !thumbTip) continue;
      
      const indexPose = frame.getJointPose(indexTip, this.referenceSpace);
      const thumbPose = frame.getJointPose(thumbTip, this.referenceSpace);
      
      if (!indexPose || !thumbPose) continue;
      
      // Calculate pinch distance
      const indexPos = indexPose.transform.position;
      const thumbPos = thumbPose.transform.position;
      const distance = Math.sqrt(
        Math.pow(indexPos.x - thumbPos.x, 2) +
        Math.pow(indexPos.y - thumbPos.y, 2) +
        Math.pow(indexPos.z - thumbPos.z, 2)
      );
      
      const isPinching = distance < 0.02; // 2cm threshold
      
      // Handle pinch state changes
      if (isPinching && !handData.pinching) {
        this.handlePinchStart(handedness, indexPose.transform.position);
      } else if (!isPinching && handData.pinching) {
        this.handlePinchEnd(handedness);
      }
      
      handData.pinching = isPinching;
      
      // Update position while pinching
      if (isPinching && this.grabbedPiece) {
        const midpoint = {
          x: (indexPos.x + thumbPos.x) / 2,
          y: (indexPos.y + thumbPos.y) / 2,
          z: (indexPos.z + thumbPos.z) / 2
        };
        this.updateGrabbedPosition(midpoint);
      }
    }
  }

  /**
   * Handle trigger down (selection/placement)
   */
  handleTriggerDown(hand, controller, selectablePieces) {
    if (hand !== this.dominantHand) return;
    
    this.triggerHaptic(controller.source, 'select');
    
    if (this.grabbedPiece) {
      // Place the grabbed piece
      if (this.isPlacementValid && this.onPlace) {
        const position = this.grabbedPiece.position.clone();
        this.onPlace(position, this.currentRotation);
        this.triggerHaptic(controller.source, 'confirm');
      } else {
        this.triggerHaptic(controller.source, 'invalid');
      }
    } else {
      // Select piece at laser pointer
      const hit = this.raycastSelectables(controller, selectablePieces);
      if (hit && this.onSelect) {
        this.onSelect(hit.piece, hit.point);
      }
    }
  }

  /**
   * Handle trigger up
   */
  handleTriggerUp(hand, controller) {
    // Trigger release logic if needed
  }

  /**
   * Handle grip down (grab)
   */
  handleGripDown(hand, controller, selectablePieces) {
    if (hand !== this.dominantHand) return;
    
    const hit = this.raycastSelectables(controller, selectablePieces);
    
    if (hit) {
      this.grabbedPiece = hit.piece;
      
      // Calculate grab offset
      const gripPos = this.getGripPosition(controller);
      if (gripPos) {
        this.grabOffset.subVectors(hit.piece.position, gripPos);
      }
      
      this.triggerHaptic(controller.source, 'grab');
      
      if (this.onGrab) {
        this.onGrab(hit.piece);
      }
    }
  }

  /**
   * Handle grip up (release)
   */
  handleGripUp(hand, controller) {
    if (hand !== this.dominantHand) return;
    
    if (this.grabbedPiece) {
      this.triggerHaptic(controller.source, 'release');
      
      if (this.onRelease) {
        this.onRelease(this.grabbedPiece.position.clone());
      }
      
      this.grabbedPiece = null;
    }
  }

  /**
   * Handle thumbstick input for rotation
   */
  handleThumbstick(x, y, controller) {
    // Only process significant input
    if (Math.abs(x) < 0.5) return;
    
    // Debounce
    if (this.lastThumbstickTime && Date.now() - this.lastThumbstickTime < 200) {
      return;
    }
    
    const direction = x > 0 ? 1 : -1;
    
    if (this.snapRotation > 0) {
      // Snap rotation
      this.currentRotation += direction * this.snapRotation;
      this.triggerHaptic(controller.source, 'snap');
    } else {
      // Smooth rotation
      this.currentRotation += direction * 0.1;
    }
    
    // Normalize rotation
    while (this.currentRotation > Math.PI) this.currentRotation -= 2 * Math.PI;
    while (this.currentRotation < -Math.PI) this.currentRotation += 2 * Math.PI;
    
    if (this.onRotate) {
      this.onRotate(this.currentRotation);
    }
    
    this.lastThumbstickTime = Date.now();
  }

  /**
   * Handle pinch start (hand tracking)
   */
  handlePinchStart(hand, position) {
    // Similar to grip down
    if (hand !== this.dominantHand) return;
    
    // For hand tracking, we'd need to do spatial query at pinch position
    // Simplified: just set position for placement preview
    if (this.onGrab) {
      this.onGrab(null); // Signal grab intent
    }
  }

  /**
   * Handle pinch end (hand tracking)
   */
  handlePinchEnd(hand) {
    if (hand !== this.dominantHand) return;
    
    if (this.onRelease) {
      this.onRelease(this.laserHitPoint.clone());
    }
  }

  /**
   * Update grabbed piece position
   */
  updateGrabbedPiece(frame) {
    const controller = this.controllers.get(this.dominantHand);
    if (!controller) return;
    
    const gripPos = this.getGripPosition(controller);
    if (!gripPos) return;
    
    // Calculate new position with offset
    const newPosition = new THREE.Vector3(
      gripPos.x + this.grabOffset.x,
      gripPos.y + this.grabOffset.y,
      gripPos.z + this.grabOffset.z
    );
    
    // Clamp distance from player
    const cameraPosition = this.renderer.xr.getCamera().position;
    const direction = newPosition.clone().sub(cameraPosition);
    const distance = direction.length();
    
    if (distance < this.minBuildDistance) {
      direction.normalize().multiplyScalar(this.minBuildDistance);
      newPosition.copy(cameraPosition).add(direction);
    } else if (distance > this.maxBuildDistance) {
      direction.normalize().multiplyScalar(this.maxBuildDistance);
      newPosition.copy(cameraPosition).add(direction);
    }
    
    // Snap to grid
    if (this.snapToGrid) {
      newPosition.x = Math.round(newPosition.x / this.gridSize) * this.gridSize;
      newPosition.y = Math.round(newPosition.y / this.gridSize) * this.gridSize;
      newPosition.z = Math.round(newPosition.z / this.gridSize) * this.gridSize;
    }
    
    // Update piece position
    this.grabbedPiece.position.copy(newPosition);
    this.grabbedPiece.rotation.y = this.currentRotation;
    
    if (this.onMove) {
      this.onMove(newPosition, this.currentRotation);
    }
  }

  /**
   * Update position from hand tracking
   */
  updateGrabbedPosition(position) {
    if (!this.grabbedPiece) return;
    
    const newPosition = new THREE.Vector3(position.x, position.y, position.z);
    
    // Snap to grid
    if (this.snapToGrid) {
      newPosition.x = Math.round(newPosition.x / this.gridSize) * this.gridSize;
      newPosition.y = Math.round(newPosition.y / this.gridSize) * this.gridSize;
      newPosition.z = Math.round(newPosition.z / this.gridSize) * this.gridSize;
    }
    
    this.grabbedPiece.position.copy(newPosition);
  }

  /**
   * Raycast against selectable pieces
   */
  raycastSelectables(controller, selectables) {
    if (!controller.targetRay) return null;
    
    const pose = controller.targetRay;
    const position = pose.transform.position;
    const orientation = pose.transform.orientation;
    
    // Set up raycaster
    this.tempMatrix.compose(
      new THREE.Vector3(position.x, position.y, position.z),
      new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w),
      new THREE.Vector3(1, 1, 1)
    );
    
    this.raycaster.ray.origin.setFromMatrixPosition(this.tempMatrix);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix).normalize();
    
    // Get meshes from selectables
    const meshes = selectables
      .filter(p => p.mesh)
      .map(p => p.mesh);
    
    const intersects = this.raycaster.intersectObjects(meshes, true);
    
    if (intersects.length > 0) {
      const hit = intersects[0];
      const piece = selectables.find(p => 
        p.mesh === hit.object || p.mesh.children?.includes(hit.object)
      );
      
      return piece ? { piece, point: hit.point } : null;
    }
    
    return null;
  }

  /**
   * Get grip position from controller
   */
  getGripPosition(controller) {
    if (!controller.grip) return null;
    
    const pos = controller.grip.transform.position;
    return new THREE.Vector3(pos.x, pos.y, pos.z);
  }

  /**
   * Create laser pointer visualization
   */
  createLaserPointer() {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -this.laserLength)
    ]);
    
    const material = new THREE.LineBasicMaterial({
      color: 0x00aaff,
      transparent: true,
      opacity: 0.5
    });
    
    this.laserLine = new THREE.Line(geometry, material);
    this.laserLine.visible = false;
  }

  /**
   * Update laser pointer visualization
   */
  updateLaserPointer(controller, selectables) {
    if (!this.laserLine || !controller.targetRay) return;
    
    const pose = controller.targetRay;
    const position = pose.transform.position;
    const orientation = pose.transform.orientation;
    
    // Update laser position/rotation
    this.laserLine.position.set(position.x, position.y, position.z);
    this.laserLine.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
    this.laserLine.visible = true;
    
    // Raycast to find hit point
    const hit = this.raycastSelectables(controller, selectables);
    
    if (hit) {
      this.laserHitPoint.copy(hit.point);
      
      // Shorten laser to hit point
      const distance = this.laserLine.position.distanceTo(hit.point);
      this.updateLaserLength(distance);
      
      // Change color on hover
      this.laserLine.material.color.setHex(0x00ff00);
    } else {
      this.updateLaserLength(this.laserLength);
      this.laserLine.material.color.setHex(0x00aaff);
    }
  }

  /**
   * Update laser length
   */
  updateLaserLength(length) {
    const positions = this.laserLine.geometry.attributes.position.array;
    positions[5] = -length;
    this.laserLine.geometry.attributes.position.needsUpdate = true;
  }

  /**
   * Trigger haptic feedback
   */
  triggerHaptic(source, patternName) {
    if (!this.hapticsEnabled) return;
    
    const gamepad = source.gamepad;
    if (!gamepad || !gamepad.hapticActuators || gamepad.hapticActuators.length === 0) {
      return;
    }
    
    const actuator = gamepad.hapticActuators[0];
    const pattern = HapticPatterns[patternName] || HapticPatterns.select;
    
    if (pattern.repeat) {
      for (let i = 0; i < pattern.repeat; i++) {
        setTimeout(() => {
          actuator.pulse(pattern.intensity, pattern.duration);
        }, i * (pattern.duration + pattern.gap));
      }
    } else {
      actuator.pulse(pattern.intensity, pattern.duration);
    }
  }

  /**
   * Set placement validity (for haptic feedback)
   */
  setPlacementValid(valid) {
    if (valid !== this.isPlacementValid) {
      this.isPlacementValid = valid;
      
      const controller = this.controllers.get(this.dominantHand);
      if (controller) {
        this.triggerHaptic(controller.source, valid ? 'valid' : 'invalid');
      }
      
      if (this.onValidityChange) {
        this.onValidityChange(valid);
      }
    }
  }

  /**
   * Get laser line for adding to scene
   */
  getLaserLine() {
    return this.laserLine;
  }

  /**
   * Set comfort mode
   */
  setComfortMode(enabled) {
    this.comfortMode = enabled;
    this.snapRotation = enabled ? SnapRotation.MEDIUM : SnapRotation.NONE;
  }

  /**
   * Set snap rotation
   */
  setSnapRotation(snap) {
    this.snapRotation = snap;
  }

  /**
   * Set grid snapping
   */
  setGridSnap(enabled, size = 0.5) {
    this.snapToGrid = enabled;
    this.gridSize = size;
  }

  /**
   * Get current state
   */
  getState() {
    return {
      inputMode: this.inputMode,
      dominantHand: this.dominantHand,
      isGrabbing: this.grabbedPiece !== null,
      currentRotation: this.currentRotation,
      isPlacementValid: this.isPlacementValid,
      comfortMode: this.comfortMode,
      snapRotation: this.snapRotation
    };
  }

  /**
   * Dispose of adapter
   */
  dispose() {
    if (this.laserLine) {
      this.laserLine.geometry.dispose();
      this.laserLine.material.dispose();
    }
    
    this.controllers.clear();
    this.hands.clear();
  }
}

export default VRBuildingAdapter;
