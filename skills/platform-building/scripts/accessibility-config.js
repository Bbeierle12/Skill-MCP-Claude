/**
 * AccessibilityConfig - Accessibility settings for building systems
 * 
 * Manages colorblind-friendly palettes, high contrast modes, reduced
 * motion preferences, and screen reader integration. Based on WCAG 2.1
 * guidelines and patterns from accessible games like Valheim.
 * 
 * Usage:
 *   const a11y = new AccessibilityConfig({
 *     colorblindMode: 'deuteranopia',
 *     highContrast: true
 *   });
 *   ghost.setColors(a11y.getValidityColors());
 *   a11y.announce('Placed wall at grid 5, 3');
 */

/**
 * Colorblind modes supported
 */
export const ColorblindMode = {
  NONE: 'none',
  PROTANOPIA: 'protanopia',     // Red-blind (~1% males)
  DEUTERANOPIA: 'deuteranopia', // Green-blind (~6% males)
  TRITANOPIA: 'tritanopia',     // Blue-blind (rare)
  ACHROMATOPSIA: 'achromatopsia' // Full color blindness (very rare)
};

/**
 * Default color palettes for different modes
 */
const ColorPalettes = {
  [ColorblindMode.NONE]: {
    valid: 0x00ff00,       // Green
    invalid: 0xff0000,     // Red
    warning: 0xffaa00,     // Orange
    blocked: 0xff6600,     // Dark orange
    neutral: 0x888888,     // Gray
    highlight: 0x00aaff,   // Blue
    stabilityHigh: 0x00ff00,
    stabilityMedium: 0xffff00,
    stabilityLow: 0xff6600,
    stabilityCritical: 0xff0000
  },
  [ColorblindMode.PROTANOPIA]: {
    valid: 0x0066ff,       // Blue (instead of green)
    invalid: 0xffcc00,     // Yellow (instead of red)
    warning: 0xff9900,     // Orange
    blocked: 0xffffff,     // White
    neutral: 0x888888,
    highlight: 0x00ccff,
    stabilityHigh: 0x0066ff,
    stabilityMedium: 0x00ccff,
    stabilityLow: 0xffcc00,
    stabilityCritical: 0xffffff
  },
  [ColorblindMode.DEUTERANOPIA]: {
    valid: 0x0066ff,       // Blue (Valheim pattern)
    invalid: 0xffcc00,     // Yellow/Gold
    warning: 0xff9900,
    blocked: 0xffffff,
    neutral: 0x888888,
    highlight: 0x00ccff,
    stabilityHigh: 0x0066ff,
    stabilityMedium: 0x00ccff,
    stabilityLow: 0xffcc00,
    stabilityCritical: 0xffffff
  },
  [ColorblindMode.TRITANOPIA]: {
    valid: 0x00ff00,       // Green (preserved)
    invalid: 0xff0066,     // Magenta (instead of red)
    warning: 0xff6699,
    blocked: 0xffffff,
    neutral: 0x888888,
    highlight: 0x00ff99,
    stabilityHigh: 0x00ff00,
    stabilityMedium: 0x99ff00,
    stabilityLow: 0xff6699,
    stabilityCritical: 0xff0066
  },
  [ColorblindMode.ACHROMATOPSIA]: {
    valid: 0xffffff,       // White
    invalid: 0x333333,     // Dark gray
    warning: 0xaaaaaa,     // Medium gray
    blocked: 0x666666,
    neutral: 0x888888,
    highlight: 0xffffff,
    stabilityHigh: 0xffffff,
    stabilityMedium: 0xcccccc,
    stabilityLow: 0x666666,
    stabilityCritical: 0x333333
  }
};

/**
 * High contrast palette modifications
 */
const HighContrastModifiers = {
  background: 0x000000,
  foreground: 0xffffff,
  borderWidth: 2,
  outlineEnabled: true,
  patternOverlay: true
};

/**
 * Timing presets for motor accessibility
 */
export const TimingPresets = {
  default: {
    longPress: 400,
    doubleTap: 300,
    holdToConfirm: 500,
    animationDuration: 200
  },
  relaxed: {
    longPress: 800,
    doubleTap: 500,
    holdToConfirm: 1000,
    animationDuration: 400
  },
  extended: {
    longPress: 1500,
    doubleTap: 800,
    holdToConfirm: 2000,
    animationDuration: 600
  }
};

export class AccessibilityConfig {
  /**
   * Create accessibility configuration
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    // Colorblind settings
    this.colorblindMode = options.colorblindMode ?? ColorblindMode.NONE;
    this.customPalette = options.customPalette ?? null;
    
    // Contrast settings
    this.highContrast = options.highContrast ?? false;
    this.contrastRatio = options.contrastRatio ?? 4.5; // WCAG AA
    
    // Motion settings
    this.reducedMotion = options.reducedMotion ?? this.detectReducedMotion();
    this.disableParallax = options.disableParallax ?? this.reducedMotion;
    this.disablePulse = options.disablePulse ?? this.reducedMotion;
    
    // Timing settings
    this.timingPreset = options.timingPreset ?? 'default';
    this.customTimings = options.customTimings ?? null;
    
    // Audio settings
    this.screenReaderEnabled = options.screenReaderEnabled ?? false;
    this.audioFeedback = options.audioFeedback ?? true;
    this.hapticFeedback = options.hapticFeedback ?? true;
    
    // Visual aids
    this.showPatterns = options.showPatterns ?? false; // Pattern overlays on colors
    this.showIcons = options.showIcons ?? true;        // Icons alongside colors
    this.largeText = options.largeText ?? false;
    this.textScale = options.textScale ?? 1.0;
    
    // Screen reader announcer element
    this.announcer = null;
    this.announcerPolite = null;
    
    // Initialize
    this.initialize();
  }

  /**
   * Initialize accessibility features
   */
  initialize() {
    // Detect system preferences
    this.detectSystemPreferences();
    
    // Create screen reader announcer
    this.createAnnouncer();
  }

  /**
   * Detect system accessibility preferences
   */
  detectSystemPreferences() {
    if (typeof window === 'undefined') return;
    
    // Reduced motion
    if (window.matchMedia) {
      const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (motionQuery.matches) {
        this.reducedMotion = true;
        this.disableParallax = true;
        this.disablePulse = true;
      }
      
      // High contrast
      const contrastQuery = window.matchMedia('(prefers-contrast: more)');
      if (contrastQuery.matches) {
        this.highContrast = true;
      }
      
      // Color scheme (for potential dark mode adjustments)
      const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.prefersDark = darkQuery.matches;
    }
  }

  /**
   * Detect if user prefers reduced motion
   */
  detectReducedMotion() {
    if (typeof window === 'undefined') return false;
    
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  /**
   * Create screen reader announcer elements
   */
  createAnnouncer() {
    if (typeof document === 'undefined') return;
    
    // Assertive announcer (interrupts)
    this.announcer = document.createElement('div');
    this.announcer.setAttribute('role', 'alert');
    this.announcer.setAttribute('aria-live', 'assertive');
    this.announcer.setAttribute('aria-atomic', 'true');
    this.announcer.className = 'sr-only';
    this.applyScreenReaderOnlyStyles(this.announcer);
    
    // Polite announcer (waits)
    this.announcerPolite = document.createElement('div');
    this.announcerPolite.setAttribute('role', 'status');
    this.announcerPolite.setAttribute('aria-live', 'polite');
    this.announcerPolite.setAttribute('aria-atomic', 'true');
    this.announcerPolite.className = 'sr-only';
    this.applyScreenReaderOnlyStyles(this.announcerPolite);
    
    document.body.appendChild(this.announcer);
    document.body.appendChild(this.announcerPolite);
  }

  /**
   * Apply screen-reader-only styles
   */
  applyScreenReaderOnlyStyles(element) {
    element.style.cssText = `
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    `;
  }

  /**
   * Announce message to screen readers
   * @param {string} message - Message to announce
   * @param {string} priority - 'polite' or 'assertive'
   */
  announce(message, priority = 'polite') {
    const announcer = priority === 'assertive' ? this.announcer : this.announcerPolite;
    
    if (!announcer) return;
    
    // Clear and set new message (triggers announcement)
    announcer.textContent = '';
    
    // Small delay to ensure screen readers pick up the change
    requestAnimationFrame(() => {
      announcer.textContent = message;
    });
  }

  /**
   * Announce placement result
   */
  announcePlacement(result) {
    if (result.success) {
      const position = this.formatPosition(result.position);
      this.announce(`Placed ${result.pieceType} at ${position}`, 'polite');
    } else {
      this.announce(`Cannot place: ${result.reason}`, 'assertive');
    }
  }

  /**
   * Announce selection change
   */
  announceSelection(piece) {
    if (piece) {
      const position = this.formatPosition(piece.position);
      this.announce(`Selected ${piece.type} at ${position}`, 'polite');
    } else {
      this.announce('Selection cleared', 'polite');
    }
  }

  /**
   * Format position for announcement
   */
  formatPosition(position) {
    if (!position) return 'unknown location';
    
    const x = Math.round(position.x);
    const y = Math.round(position.y);
    const z = Math.round(position.z);
    
    return `grid ${x}, ${y}, ${z}`;
  }

  /**
   * Get current color palette
   * @returns {Object} Color palette
   */
  getPalette() {
    if (this.customPalette) {
      return { ...ColorPalettes[ColorblindMode.NONE], ...this.customPalette };
    }
    
    return ColorPalettes[this.colorblindMode] ?? ColorPalettes[ColorblindMode.NONE];
  }

  /**
   * Get validity colors (for ghost preview)
   * @returns {Object} Valid/invalid colors
   */
  getValidityColors() {
    const palette = this.getPalette();
    
    return {
      valid: palette.valid,
      invalid: palette.invalid,
      warning: palette.warning,
      blocked: palette.blocked
    };
  }

  /**
   * Get stability colors (for piece stability display)
   * @returns {Object} Stability gradient colors
   */
  getStabilityColors() {
    const palette = this.getPalette();
    
    return {
      high: palette.stabilityHigh,
      medium: palette.stabilityMedium,
      low: palette.stabilityLow,
      critical: palette.stabilityCritical
    };
  }

  /**
   * Get color for stability value
   * @param {number} stability - 0-1 stability value
   * @returns {number} Color hex value
   */
  getStabilityColor(stability) {
    const colors = this.getStabilityColors();
    
    if (stability >= 0.75) return colors.high;
    if (stability >= 0.5) return colors.medium;
    if (stability >= 0.25) return colors.low;
    return colors.critical;
  }

  /**
   * Get timing settings
   * @returns {Object} Timing values
   */
  getTimings() {
    if (this.customTimings) {
      return { ...TimingPresets.default, ...this.customTimings };
    }
    
    return TimingPresets[this.timingPreset] ?? TimingPresets.default;
  }

  /**
   * Get animation settings
   * @returns {Object} Animation configuration
   */
  getAnimationSettings() {
    const timings = this.getTimings();
    
    return {
      enabled: !this.reducedMotion,
      duration: this.reducedMotion ? 0 : timings.animationDuration,
      pulseEnabled: !this.disablePulse,
      parallaxEnabled: !this.disableParallax,
      useSnapTransitions: this.reducedMotion
    };
  }

  /**
   * Get visual indicator settings
   * @returns {Object} Indicator configuration
   */
  getIndicatorSettings() {
    return {
      showPatterns: this.showPatterns || this.colorblindMode !== ColorblindMode.NONE,
      showIcons: this.showIcons,
      useHighContrast: this.highContrast,
      borderWidth: this.highContrast ? HighContrastModifiers.borderWidth : 1,
      outlineEnabled: this.highContrast
    };
  }

  /**
   * Get text settings
   * @returns {Object} Text configuration
   */
  getTextSettings() {
    return {
      scale: this.textScale * (this.largeText ? 1.25 : 1.0),
      minSize: this.largeText ? 16 : 12,
      highContrast: this.highContrast
    };
  }

  /**
   * Set colorblind mode
   */
  setColorblindMode(mode) {
    if (!Object.values(ColorblindMode).includes(mode)) {
      console.warn(`Unknown colorblind mode: ${mode}`);
      return;
    }
    
    this.colorblindMode = mode;
  }

  /**
   * Set high contrast mode
   */
  setHighContrast(enabled) {
    this.highContrast = enabled;
  }

  /**
   * Set reduced motion
   */
  setReducedMotion(enabled) {
    this.reducedMotion = enabled;
    this.disableParallax = enabled;
    this.disablePulse = enabled;
  }

  /**
   * Set timing preset
   */
  setTimingPreset(preset) {
    if (!TimingPresets[preset]) {
      console.warn(`Unknown timing preset: ${preset}`);
      return;
    }
    
    this.timingPreset = preset;
  }

  /**
   * Set custom timing value
   */
  setCustomTiming(key, value) {
    if (!this.customTimings) {
      this.customTimings = {};
    }
    
    this.customTimings[key] = value;
  }

  /**
   * Set text scale
   */
  setTextScale(scale) {
    this.textScale = Math.max(0.5, Math.min(2.0, scale));
  }

  /**
   * Simulate colorblind view of a color
   * @param {number} color - Original color
   * @param {string} mode - Colorblind mode to simulate
   * @returns {number} Simulated color
   */
  simulateColorblind(color, mode = this.colorblindMode) {
    if (mode === ColorblindMode.NONE) return color;
    
    // Extract RGB
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    
    // Transformation matrices (simplified)
    const matrices = {
      [ColorblindMode.PROTANOPIA]: [
        [0.567, 0.433, 0.000],
        [0.558, 0.442, 0.000],
        [0.000, 0.242, 0.758]
      ],
      [ColorblindMode.DEUTERANOPIA]: [
        [0.625, 0.375, 0.000],
        [0.700, 0.300, 0.000],
        [0.000, 0.300, 0.700]
      ],
      [ColorblindMode.TRITANOPIA]: [
        [0.950, 0.050, 0.000],
        [0.000, 0.433, 0.567],
        [0.000, 0.475, 0.525]
      ]
    };
    
    const matrix = matrices[mode];
    if (!matrix) return color;
    
    const newR = Math.round(r * matrix[0][0] + g * matrix[0][1] + b * matrix[0][2]);
    const newG = Math.round(r * matrix[1][0] + g * matrix[1][1] + b * matrix[1][2]);
    const newB = Math.round(r * matrix[2][0] + g * matrix[2][1] + b * matrix[2][2]);
    
    return (newR << 16) | (newG << 8) | newB;
  }

  /**
   * Calculate contrast ratio between two colors
   * @param {number} color1 - First color
   * @param {number} color2 - Second color
   * @returns {number} Contrast ratio (1-21)
   */
  calculateContrastRatio(color1, color2) {
    const lum1 = this.getRelativeLuminance(color1);
    const lum2 = this.getRelativeLuminance(color2);
    
    const lighter = Math.max(lum1, lum2);
    const darker = Math.min(lum1, lum2);
    
    return (lighter + 0.05) / (darker + 0.05);
  }

  /**
   * Get relative luminance of a color
   */
  getRelativeLuminance(color) {
    const r = ((color >> 16) & 0xff) / 255;
    const g = ((color >> 8) & 0xff) / 255;
    const b = (color & 0xff) / 255;
    
    const toLinear = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  }

  /**
   * Check if color combination meets WCAG contrast requirements
   */
  meetsContrastRequirement(foreground, background, level = 'AA') {
    const ratio = this.calculateContrastRatio(foreground, background);
    
    // AA: 4.5:1 for normal text, 3:1 for large text/UI
    // AAA: 7:1 for normal text, 4.5:1 for large text
    const requirements = {
      'AA': 4.5,
      'AA-large': 3,
      'AAA': 7,
      'AAA-large': 4.5
    };
    
    return ratio >= (requirements[level] ?? 4.5);
  }

  /**
   * Serialize configuration for storage
   */
  serialize() {
    return {
      colorblindMode: this.colorblindMode,
      highContrast: this.highContrast,
      reducedMotion: this.reducedMotion,
      timingPreset: this.timingPreset,
      customTimings: this.customTimings,
      showPatterns: this.showPatterns,
      showIcons: this.showIcons,
      largeText: this.largeText,
      textScale: this.textScale,
      screenReaderEnabled: this.screenReaderEnabled,
      audioFeedback: this.audioFeedback,
      hapticFeedback: this.hapticFeedback
    };
  }

  /**
   * Load configuration from storage
   */
  load(data) {
    if (data.colorblindMode) this.colorblindMode = data.colorblindMode;
    if (data.highContrast !== undefined) this.highContrast = data.highContrast;
    if (data.reducedMotion !== undefined) this.reducedMotion = data.reducedMotion;
    if (data.timingPreset) this.timingPreset = data.timingPreset;
    if (data.customTimings) this.customTimings = data.customTimings;
    if (data.showPatterns !== undefined) this.showPatterns = data.showPatterns;
    if (data.showIcons !== undefined) this.showIcons = data.showIcons;
    if (data.largeText !== undefined) this.largeText = data.largeText;
    if (data.textScale !== undefined) this.textScale = data.textScale;
    if (data.screenReaderEnabled !== undefined) this.screenReaderEnabled = data.screenReaderEnabled;
    if (data.audioFeedback !== undefined) this.audioFeedback = data.audioFeedback;
    if (data.hapticFeedback !== undefined) this.hapticFeedback = data.hapticFeedback;
  }

  /**
   * Get summary of current settings for display
   */
  getSummary() {
    const settings = [];
    
    if (this.colorblindMode !== ColorblindMode.NONE) {
      settings.push(`Colorblind mode: ${this.colorblindMode}`);
    }
    if (this.highContrast) settings.push('High contrast');
    if (this.reducedMotion) settings.push('Reduced motion');
    if (this.timingPreset !== 'default') settings.push(`Timing: ${this.timingPreset}`);
    if (this.largeText) settings.push('Large text');
    if (this.screenReaderEnabled) settings.push('Screen reader');
    
    return settings.length > 0 ? settings : ['Default settings'];
  }

  /**
   * Dispose of resources
   */
  dispose() {
    if (this.announcer?.parentNode) {
      this.announcer.parentNode.removeChild(this.announcer);
    }
    if (this.announcerPolite?.parentNode) {
      this.announcerPolite.parentNode.removeChild(this.announcerPolite);
    }
  }
}

export default AccessibilityConfig;
