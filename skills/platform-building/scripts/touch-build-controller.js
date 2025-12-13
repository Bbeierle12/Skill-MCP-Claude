/**
 * TouchBuildController - Mobile gesture handling for building systems
 * 
 * Handles touch input for building games on mobile devices. Supports
 * tap-to-place, drag-to-move, pinch-to-zoom, and two-finger rotation.
 * Designed around patterns from Fortnite Mobile and Minecraft PE.
 * 
 * Usage:
 *   const touch = new TouchBuildController(canvas, {
 *     doubleTapToPlace: true,
 *     pinchToRotate: true
 *   });
 *   touch.onPlace = (position, rotation) => buildingSystem.place(position, rotation);
 *   touch.onRotate = (angle) => ghost.rotate(angle);
 */

/**
 * Gesture types recognized by the controller
 */
export const GestureType = {
  TAP: 'tap',
  DOUBLE_TAP: 'doubleTap',
  LONG_PRESS: 'longPress',
  DRAG: 'drag',
  PINCH: 'pinch',
  ROTATE: 'rotate',
  SWIPE: 'swipe'
};

/**
 * Swipe directions
 */
export const SwipeDirection = {
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right'
};

export class TouchBuildController {
  /**
   * Create touch build controller
   * @param {HTMLElement} element - Element to attach listeners to
   * @param {Object} options - Configuration options
   */
  constructor(element, options = {}) {
    this.element = element;
    
    // Gesture configuration
    this.tapThreshold = options.tapThreshold ?? 10; // pixels
    this.longPressTime = options.longPressTime ?? 400; // ms
    this.doubleTapTime = options.doubleTapTime ?? 300; // ms
    this.swipeThreshold = options.swipeThreshold ?? 50; // pixels
    this.swipeVelocity = options.swipeVelocity ?? 0.5; // pixels/ms
    
    // Feature toggles
    this.doubleTapToPlace = options.doubleTapToPlace ?? true;
    this.longPressForOptions = options.longPressForOptions ?? true;
    this.pinchToZoom = options.pinchToZoom ?? true;
    this.pinchToRotate = options.pinchToRotate ?? false;
    this.twoFingerRotate = options.twoFingerRotate ?? true;
    this.swipeToChangePiece = options.swipeToChangePiece ?? true;
    this.edgeSwipeEnabled = options.edgeSwipeEnabled ?? true;
    this.edgeSize = options.edgeSize ?? 50; // pixels from edge
    
    // State tracking
    this.activeTouches = new Map();
    this.gestureState = {
      type: null,
      startTime: 0,
      startPosition: null,
      lastPosition: null,
      initialDistance: 0,
      initialAngle: 0
    };
    
    // Timing state
    this.lastTapTime = 0;
    this.lastTapPosition = null;
    this.longPressTimer = null;
    
    // Build mode state
    this.buildModeActive = options.buildModeActive ?? false;
    this.selectedPieceType = null;
    this.currentRotation = 0;
    
    // Sensitivity settings
    this.dragSensitivity = options.dragSensitivity ?? 1.0;
    this.rotateSensitivity = options.rotateSensitivity ?? 1.0;
    this.zoomSensitivity = options.zoomSensitivity ?? 1.0;
    
    // Callbacks (set by user)
    this.onTap = null;
    this.onDoubleTap = null;
    this.onLongPress = null;
    this.onDragStart = null;
    this.onDrag = null;
    this.onDragEnd = null;
    this.onPinch = null;
    this.onRotate = null;
    this.onSwipe = null;
    this.onPlace = null;
    this.onCancel = null;
    this.onCyclePiece = null;
    this.onToggleBuildMode = null;
    
    // Bind event handlers
    this.handleTouchStart = this.handleTouchStart.bind(this);
    this.handleTouchMove = this.handleTouchMove.bind(this);
    this.handleTouchEnd = this.handleTouchEnd.bind(this);
    this.handleTouchCancel = this.handleTouchCancel.bind(this);
    
    // Attach listeners
    this.attach();
  }

  /**
   * Attach touch event listeners
   */
  attach() {
    this.element.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    this.element.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    this.element.addEventListener('touchend', this.handleTouchEnd, { passive: false });
    this.element.addEventListener('touchcancel', this.handleTouchCancel, { passive: false });
  }

  /**
   * Detach touch event listeners
   */
  detach() {
    this.element.removeEventListener('touchstart', this.handleTouchStart);
    this.element.removeEventListener('touchmove', this.handleTouchMove);
    this.element.removeEventListener('touchend', this.handleTouchEnd);
    this.element.removeEventListener('touchcancel', this.handleTouchCancel);
  }

  /**
   * Handle touch start
   */
  handleTouchStart(event) {
    event.preventDefault();
    
    // Track all touches
    for (const touch of event.changedTouches) {
      this.activeTouches.set(touch.identifier, {
        id: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        currentX: touch.clientX,
        currentY: touch.clientY,
        startTime: Date.now()
      });
    }

    const touchCount = this.activeTouches.size;

    if (touchCount === 1) {
      this.handleSingleTouchStart(event.changedTouches[0]);
    } else if (touchCount === 2) {
      this.handleTwoTouchStart();
    } else if (touchCount === 3) {
      this.handleThreeTouchStart();
    }
  }

  /**
   * Handle single touch start
   */
  handleSingleTouchStart(touch) {
    const position = { x: touch.clientX, y: touch.clientY };
    
    this.gestureState = {
      type: 'pending',
      startTime: Date.now(),
      startPosition: position,
      lastPosition: position
    };

    // Start long press timer
    if (this.longPressForOptions) {
      this.longPressTimer = setTimeout(() => {
        if (this.gestureState.type === 'pending') {
          this.gestureState.type = GestureType.LONG_PRESS;
          
          if (this.onLongPress) {
            this.onLongPress(this.gestureState.startPosition);
          }
        }
      }, this.longPressTime);
    }
  }

  /**
   * Handle two touch start (pinch/rotate)
   */
  handleTwoTouchStart() {
    this.clearLongPressTimer();
    
    const touches = Array.from(this.activeTouches.values());
    const t1 = touches[0];
    const t2 = touches[1];
    
    // Calculate initial distance and angle
    const dx = t2.currentX - t1.currentX;
    const dy = t2.currentY - t1.currentY;
    
    this.gestureState.initialDistance = Math.hypot(dx, dy);
    this.gestureState.initialAngle = Math.atan2(dy, dx);
    this.gestureState.type = 'twoFinger';
  }

  /**
   * Handle three touch start (build mode toggle)
   */
  handleThreeTouchStart() {
    this.clearLongPressTimer();
    
    // Three finger tap toggles build mode
    if (this.onToggleBuildMode) {
      this.buildModeActive = !this.buildModeActive;
      this.onToggleBuildMode(this.buildModeActive);
    }
  }

  /**
   * Handle touch move
   */
  handleTouchMove(event) {
    event.preventDefault();
    
    // Update touch positions
    for (const touch of event.changedTouches) {
      const tracked = this.activeTouches.get(touch.identifier);
      if (tracked) {
        tracked.currentX = touch.clientX;
        tracked.currentY = touch.clientY;
      }
    }

    const touchCount = this.activeTouches.size;

    if (touchCount === 1) {
      this.handleSingleTouchMove();
    } else if (touchCount === 2) {
      this.handleTwoTouchMove();
    }
  }

  /**
   * Handle single touch move
   */
  handleSingleTouchMove() {
    const touch = Array.from(this.activeTouches.values())[0];
    const position = { x: touch.currentX, y: touch.currentY };
    
    // Calculate movement
    const dx = position.x - this.gestureState.startPosition.x;
    const dy = position.y - this.gestureState.startPosition.y;
    const distance = Math.hypot(dx, dy);
    
    // Check if exceeded tap threshold
    if (distance > this.tapThreshold && this.gestureState.type === 'pending') {
      this.clearLongPressTimer();
      this.gestureState.type = GestureType.DRAG;
      
      if (this.onDragStart) {
        this.onDragStart(this.gestureState.startPosition);
      }
    }

    // Handle ongoing drag
    if (this.gestureState.type === GestureType.DRAG) {
      const delta = {
        x: (position.x - this.gestureState.lastPosition.x) * this.dragSensitivity,
        y: (position.y - this.gestureState.lastPosition.y) * this.dragSensitivity
      };
      
      if (this.onDrag) {
        this.onDrag(position, delta);
      }
      
      this.gestureState.lastPosition = position;
    }
  }

  /**
   * Handle two touch move (pinch/rotate)
   */
  handleTwoTouchMove() {
    const touches = Array.from(this.activeTouches.values());
    const t1 = touches[0];
    const t2 = touches[1];
    
    const dx = t2.currentX - t1.currentX;
    const dy = t2.currentY - t1.currentY;
    
    const currentDistance = Math.hypot(dx, dy);
    const currentAngle = Math.atan2(dy, dx);
    
    // Calculate pinch scale
    const scale = currentDistance / this.gestureState.initialDistance;
    
    // Calculate rotation delta
    let angleDelta = currentAngle - this.gestureState.initialAngle;
    
    // Normalize angle to -PI to PI
    while (angleDelta > Math.PI) angleDelta -= 2 * Math.PI;
    while (angleDelta < -Math.PI) angleDelta += 2 * Math.PI;

    // Determine if primarily pinching or rotating
    const scaleChange = Math.abs(scale - 1);
    const angleChange = Math.abs(angleDelta);
    
    if (scaleChange > 0.1 && this.pinchToZoom) {
      // Pinch gesture (zoom)
      if (this.onPinch) {
        this.onPinch(scale, this.getCenterPoint(t1, t2));
      }
    }
    
    if (angleChange > 0.1 && this.twoFingerRotate) {
      // Rotation gesture
      const rotationAmount = angleDelta * this.rotateSensitivity;
      this.currentRotation += rotationAmount;
      
      if (this.onRotate) {
        this.onRotate(rotationAmount, this.currentRotation);
      }
      
      // Update initial angle for next frame
      this.gestureState.initialAngle = currentAngle;
    }
  }

  /**
   * Handle touch end
   */
  handleTouchEnd(event) {
    event.preventDefault();
    
    for (const touch of event.changedTouches) {
      const tracked = this.activeTouches.get(touch.identifier);
      
      if (tracked && this.activeTouches.size === 1) {
        this.handleSingleTouchEnd(tracked);
      }
      
      this.activeTouches.delete(touch.identifier);
    }
    
    if (this.activeTouches.size === 0) {
      this.resetGestureState();
    }
  }

  /**
   * Handle single touch end
   */
  handleSingleTouchEnd(touch) {
    this.clearLongPressTimer();
    
    const position = { x: touch.currentX, y: touch.currentY };
    const elapsed = Date.now() - touch.startTime;
    
    // Calculate movement
    const dx = position.x - touch.startX;
    const dy = position.y - touch.startY;
    const distance = Math.hypot(dx, dy);
    const velocity = distance / elapsed;

    // Check for swipe
    if (distance > this.swipeThreshold && velocity > this.swipeVelocity) {
      this.handleSwipe(dx, dy, position);
      return;
    }

    // Check for tap (minimal movement, short duration)
    if (distance <= this.tapThreshold && this.gestureState.type !== GestureType.LONG_PRESS) {
      this.handleTap(position);
      return;
    }

    // End drag
    if (this.gestureState.type === GestureType.DRAG && this.onDragEnd) {
      this.onDragEnd(position);
    }
  }

  /**
   * Handle tap gesture
   */
  handleTap(position) {
    const now = Date.now();
    
    // Check for double tap
    if (this.doubleTapToPlace && 
        this.lastTapTime && 
        now - this.lastTapTime < this.doubleTapTime &&
        this.isNearPosition(position, this.lastTapPosition)) {
      
      // Double tap - place piece
      if (this.buildModeActive && this.onPlace) {
        this.onPlace(position, this.currentRotation);
      } else if (this.onDoubleTap) {
        this.onDoubleTap(position);
      }
      
      this.lastTapTime = 0;
      this.lastTapPosition = null;
      
    } else {
      // Single tap
      if (this.onTap) {
        this.onTap(position);
      }
      
      this.lastTapTime = now;
      this.lastTapPosition = position;
    }
  }

  /**
   * Handle swipe gesture
   */
  handleSwipe(dx, dy, position) {
    const direction = this.getSwipeDirection(dx, dy);
    
    // Check for edge swipe
    if (this.edgeSwipeEnabled) {
      const isEdge = this.isEdgePosition(this.gestureState.startPosition);
      if (isEdge) {
        this.handleEdgeSwipe(isEdge, direction);
        return;
      }
    }

    // Normal swipe
    if (this.swipeToChangePiece && this.buildModeActive) {
      if (direction === SwipeDirection.LEFT || direction === SwipeDirection.RIGHT) {
        const delta = direction === SwipeDirection.RIGHT ? 1 : -1;
        if (this.onCyclePiece) {
          this.onCyclePiece(delta);
        }
      }
    }

    if (this.onSwipe) {
      this.onSwipe(direction, position);
    }
  }

  /**
   * Handle edge swipe (for menus, etc.)
   */
  handleEdgeSwipe(edge, direction) {
    // Left edge swipe right = open build menu
    // Right edge swipe left = open inventory
    // Bottom edge swipe up = quick actions
    
    if (edge === 'left' && direction === SwipeDirection.RIGHT) {
      if (this.onToggleBuildMode) {
        this.buildModeActive = true;
        this.onToggleBuildMode(true);
      }
    } else if (edge === 'right' && direction === SwipeDirection.LEFT) {
      // Could trigger inventory or cancel
      if (this.onCancel) {
        this.onCancel();
      }
    }
  }

  /**
   * Handle touch cancel
   */
  handleTouchCancel(event) {
    for (const touch of event.changedTouches) {
      this.activeTouches.delete(touch.identifier);
    }
    
    this.clearLongPressTimer();
    this.resetGestureState();
    
    if (this.onCancel) {
      this.onCancel();
    }
  }

  /**
   * Get swipe direction from delta
   */
  getSwipeDirection(dx, dy) {
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? SwipeDirection.RIGHT : SwipeDirection.LEFT;
    } else {
      return dy > 0 ? SwipeDirection.DOWN : SwipeDirection.UP;
    }
  }

  /**
   * Check if position is near screen edge
   */
  isEdgePosition(position) {
    const rect = this.element.getBoundingClientRect();
    
    if (position.x < rect.left + this.edgeSize) return 'left';
    if (position.x > rect.right - this.edgeSize) return 'right';
    if (position.y < rect.top + this.edgeSize) return 'top';
    if (position.y > rect.bottom - this.edgeSize) return 'bottom';
    
    return null;
  }

  /**
   * Check if two positions are near each other
   */
  isNearPosition(pos1, pos2) {
    if (!pos1 || !pos2) return false;
    
    const dx = pos1.x - pos2.x;
    const dy = pos1.y - pos2.y;
    return Math.hypot(dx, dy) < this.tapThreshold * 2;
  }

  /**
   * Get center point between two touches
   */
  getCenterPoint(t1, t2) {
    return {
      x: (t1.currentX + t2.currentX) / 2,
      y: (t1.currentY + t2.currentY) / 2
    };
  }

  /**
   * Clear long press timer
   */
  clearLongPressTimer() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  /**
   * Reset gesture state
   */
  resetGestureState() {
    this.gestureState = {
      type: null,
      startTime: 0,
      startPosition: null,
      lastPosition: null,
      initialDistance: 0,
      initialAngle: 0
    };
  }

  /**
   * Set build mode active state
   */
  setBuildMode(active) {
    this.buildModeActive = active;
    
    if (this.onToggleBuildMode) {
      this.onToggleBuildMode(active);
    }
  }

  /**
   * Set selected piece type
   */
  setSelectedPiece(type) {
    this.selectedPieceType = type;
  }

  /**
   * Set current rotation
   */
  setRotation(rotation) {
    this.currentRotation = rotation;
  }

  /**
   * Update sensitivity settings
   */
  setSensitivity(type, value) {
    switch (type) {
      case 'drag':
        this.dragSensitivity = value;
        break;
      case 'rotate':
        this.rotateSensitivity = value;
        break;
      case 'zoom':
        this.zoomSensitivity = value;
        break;
    }
  }

  /**
   * Update timing settings (for accessibility)
   */
  setTimings(options) {
    if (options.longPress !== undefined) {
      this.longPressTime = options.longPress;
    }
    if (options.doubleTap !== undefined) {
      this.doubleTapTime = options.doubleTap;
    }
  }

  /**
   * Get current state for debugging/UI
   */
  getState() {
    return {
      buildModeActive: this.buildModeActive,
      selectedPieceType: this.selectedPieceType,
      currentRotation: this.currentRotation,
      activeTouchCount: this.activeTouches.size,
      currentGesture: this.gestureState.type
    };
  }

  /**
   * Dispose of controller
   */
  dispose() {
    this.detach();
    this.clearLongPressTimer();
    this.activeTouches.clear();
  }
}

export default TouchBuildController;
