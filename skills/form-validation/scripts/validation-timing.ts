/**
 * Validation Timing Utilities
 * 
 * Implements the "Reward Early, Punish Late" pattern backed by UX research.
 * 
 * Research basis:
 * - Luke Wroblewski's inline validation study (2009)
 * - Jessica Enders' "Designing UX: Forms" findings
 * - Industry A/B testing results
 * 
 * @module validation-timing
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * When validation should trigger
 */
export type ValidationTrigger = 
  | 'onChange'    // Every keystroke
  | 'onBlur'      // When field loses focus
  | 'onSubmit'    // Only on form submission
  | 'all';        // All events

/**
 * Validation timing configuration
 */
export interface ValidationTimingConfig {
  /** When to first show errors (punish late = onBlur) */
  showErrorsOn: ValidationTrigger;
  
  /** When to re-validate after first error (real-time correction = onChange) */
  revalidateOn: ValidationTrigger;
  
  /** When to show valid state (reward early = onChange) */
  showValidOn: ValidationTrigger;
  
  /** Debounce delay for onChange validation (ms) */
  debounceMs?: number;
  
  /** Whether to validate on mount */
  validateOnMount?: boolean;
}

/**
 * Field validation state
 */
export interface FieldValidationState {
  /** Field has been touched (focused and blurred) */
  touched: boolean;
  
  /** Field value has changed from initial */
  dirty: boolean;
  
  /** Field has shown an error at least once */
  hasShownError: boolean;
  
  /** Current error message (if any) */
  error: string | undefined;
  
  /** Field is currently valid */
  isValid: boolean;
}

// =============================================================================
// TIMING PRESETS
// =============================================================================

/**
 * Pre-configured timing presets for common use cases
 */
export const TIMING_PRESETS = {
  /**
   * Standard: Reward Early, Punish Late (RECOMMENDED)
   * 
   * - Shows green checkmark immediately when valid
   * - Delays red error until user leaves field
   * - Real-time updates during error correction
   * 
   * Best for: Most forms
   */
  standard: {
    showErrorsOn: 'onBlur',
    revalidateOn: 'onChange',
    showValidOn: 'onChange',
    validateOnMount: false
  } as ValidationTimingConfig,

  /**
   * Real-time: Immediate feedback on everything
   * 
   * - Shows both valid and invalid immediately
   * - Good for password strength, character counts
   * 
   * Best for: Password fields, search, live counters
   * Avoid for: Email, phone, complex fields
   */
  realtime: {
    showErrorsOn: 'onChange',
    revalidateOn: 'onChange',
    showValidOn: 'onChange',
    validateOnMount: false
  } as ValidationTimingConfig,

  /**
   * Submit Only: No inline validation
   * 
   * - All validation happens on submit
   * - Simplest user experience
   * 
   * Best for: Very short forms (1-2 fields), login
   */
  submitOnly: {
    showErrorsOn: 'onSubmit',
    revalidateOn: 'onSubmit',
    showValidOn: 'onSubmit',
    validateOnMount: false
  } as ValidationTimingConfig,

  /**
   * Debounced: Delayed validation for expensive checks
   * 
   * - Waits for user to stop typing
   * - Good for async validation (username check)
   * 
   * Best for: Server-side validation, search-as-you-type
   */
  debounced: {
    showErrorsOn: 'onBlur',
    revalidateOn: 'onChange',
    showValidOn: 'onChange',
    debounceMs: 500,
    validateOnMount: false
  } as ValidationTimingConfig,

  /**
   * Aggressive: Validate early and often
   * 
   * - Shows errors on change, but only after touched
   * - Good for forms where mistakes are costly
   * 
   * Best for: Financial forms, legal forms
   */
  aggressive: {
    showErrorsOn: 'onChange',
    revalidateOn: 'onChange',
    showValidOn: 'onChange',
    validateOnMount: false
  } as ValidationTimingConfig
} as const;

// =============================================================================
// REACT HOOK FORM INTEGRATION
// =============================================================================

/**
 * Convert timing config to React Hook Form options
 * 
 * @example
 * ```tsx
 * const { register } = useForm({
 *   ...toRHFOptions(TIMING_PRESETS.standard),
 *   resolver: zodResolver(schema)
 * });
 * ```
 */
export function toRHFOptions(timing: ValidationTimingConfig) {
  return {
    mode: timing.showErrorsOn === 'all' ? 'all' as const : timing.showErrorsOn as 'onChange' | 'onBlur' | 'onSubmit',
    reValidateMode: timing.revalidateOn === 'all' ? 'onChange' as const : timing.revalidateOn as 'onChange' | 'onBlur' | 'onSubmit',
    shouldFocusError: true,
    criteriaMode: 'firstError' as const
  };
}

// =============================================================================
// TANSTACK FORM INTEGRATION
// =============================================================================

/**
 * Convert timing config to TanStack Form options
 * 
 * @example
 * ```tsx
 * const form = useForm({
 *   ...toTanStackOptions(TIMING_PRESETS.standard),
 *   validatorAdapter: zodValidator()
 * });
 * ```
 */
export function toTanStackOptions(timing: ValidationTimingConfig) {
  const options: Record<string, unknown> = {};
  
  // Map triggers to TanStack validators
  if (timing.showErrorsOn === 'onBlur' || timing.showErrorsOn === 'all') {
    options.onBlur = true;
  }
  if (timing.revalidateOn === 'onChange' || timing.revalidateOn === 'all') {
    options.onChange = true;
  }
  if (timing.debounceMs) {
    options.onChangeAsyncDebounceMs = timing.debounceMs;
  }

  return options;
}

// =============================================================================
// VALIDATION STATE MACHINE
// =============================================================================

/**
 * Determines whether to show error based on timing config and field state
 * 
 * This implements the "Reward Early, Punish Late" logic:
 * - Valid state shows immediately (reward early)
 * - Error shows only after blur (punish late)
 * - Once error shown, updates in real-time (correction mode)
 */
export function shouldShowError(
  state: FieldValidationState,
  timing: ValidationTimingConfig = TIMING_PRESETS.standard
): boolean {
  // No error to show
  if (!state.error) {
    return false;
  }

  // Once an error has been shown, always show it (correction mode)
  if (state.hasShownError) {
    return true;
  }

  // Check timing config
  switch (timing.showErrorsOn) {
    case 'onChange':
      return state.dirty;
    case 'onBlur':
      return state.touched;
    case 'onSubmit':
      return false; // Handled by form submit
    case 'all':
      return state.touched || state.dirty;
    default:
      return state.touched;
  }
}

/**
 * Determines whether to show valid state based on timing config
 */
export function shouldShowValid(
  state: FieldValidationState,
  timing: ValidationTimingConfig = TIMING_PRESETS.standard
): boolean {
  // Not valid
  if (!state.isValid) {
    return false;
  }

  // Check timing config
  switch (timing.showValidOn) {
    case 'onChange':
      return state.dirty;
    case 'onBlur':
      return state.touched;
    case 'onSubmit':
      return false;
    case 'all':
      return state.touched || state.dirty;
    default:
      return state.dirty;
  }
}

/**
 * Get visual state for field based on validation state and timing
 */
export function getFieldVisualState(
  state: FieldValidationState,
  timing: ValidationTimingConfig = TIMING_PRESETS.standard
): 'idle' | 'valid' | 'invalid' {
  if (shouldShowError(state, timing)) {
    return 'invalid';
  }
  if (shouldShowValid(state, timing)) {
    return 'valid';
  }
  return 'idle';
}

// =============================================================================
// DEBOUNCE UTILITY
// =============================================================================

/**
 * Creates a debounced validator function
 * 
 * @example
 * ```tsx
 * const checkUsername = createDebouncedValidator(
 *   async (value) => {
 *     const response = await fetch(`/api/check-username?u=${value}`);
 *     const { available } = await response.json();
 *     return available ? undefined : 'Username is taken';
 *   },
 *   500
 * );
 * ```
 */
export function createDebouncedValidator<T>(
  validator: (value: T) => Promise<string | undefined>,
  delay: number = 500
): (value: T) => Promise<string | undefined> {
  let timeoutId: ReturnType<typeof setTimeout>;
  let latestValue: T;
  let latestResolve: ((error: string | undefined) => void) | null = null;

  return (value: T): Promise<string | undefined> => {
    latestValue = value;

    // Clear any pending validation
    clearTimeout(timeoutId);

    return new Promise((resolve) => {
      // Store the resolve function
      latestResolve = resolve;

      timeoutId = setTimeout(async () => {
        // Only validate if this is still the latest value
        if (value === latestValue && latestResolve === resolve) {
          try {
            const error = await validator(value);
            resolve(error);
          } catch (e) {
            resolve('Validation failed');
          }
        } else {
          // Value changed, resolve with no error (will be re-validated)
          resolve(undefined);
        }
      }, delay);
    });
  };
}

// =============================================================================
// FIELD TIMING HOOK (React)
// =============================================================================

/**
 * React hook for managing field validation timing
 * 
 * @example
 * ```tsx
 * function EmailField() {
 *   const { fieldState, handlers } = useFieldTiming('email', {
 *     validate: (value) => validateEmail(value),
 *     timing: TIMING_PRESETS.standard
 *   });
 * 
 *   return (
 *     <input
 *       {...handlers}
 *       className={fieldState.visualState}
 *     />
 *   );
 * }
 * ```
 */
export interface UseFieldTimingOptions<T> {
  /** Validation function */
  validate: (value: T) => string | undefined | Promise<string | undefined>;
  
  /** Timing preset or custom config */
  timing?: ValidationTimingConfig;
  
  /** Initial value */
  initialValue?: T;
}

export interface UseFieldTimingResult<T> {
  /** Current field value */
  value: T;
  
  /** Field validation state */
  fieldState: FieldValidationState & { visualState: 'idle' | 'valid' | 'invalid' };
  
  /** Event handlers to spread on input */
  handlers: {
    onChange: (e: { target: { value: T } }) => void;
    onBlur: () => void;
    onFocus: () => void;
  };
  
  /** Manually trigger validation */
  validate: () => Promise<void>;
  
  /** Reset field state */
  reset: () => void;
}

// Note: Actual React implementation would go here
// This is the interface/types for documentation
