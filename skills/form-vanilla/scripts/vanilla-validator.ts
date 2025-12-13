/**
 * Vanilla Form Validator
 * 
 * Framework-free form validation using HTML5 Constraint Validation API
 * enhanced with Zod for complex validation rules.
 * 
 * @module vanilla-validator
 */

import { z, ZodType, ZodError } from 'zod';

// =============================================================================
// TYPES
// =============================================================================

export interface FormValidatorOptions {
  /** Validate on blur (default: true) */
  validateOnBlur?: boolean;
  
  /** Validate on input after first error (default: true) */
  validateOnInput?: boolean;
  
  /** Custom error messages */
  messages?: Record<string, string>;
  
  /** Custom error display function */
  displayError?: (field: HTMLElement, message: string) => void;
  
  /** Custom error clear function */
  clearError?: (field: HTMLElement) => void;
  
  /** Focus first error on submit */
  focusFirstError?: boolean;
}

export interface ValidationResult<T = unknown> {
  /** Whether validation passed */
  valid: boolean;
  
  /** Validated and typed data (if valid) */
  data?: T;
  
  /** Errors by field name */
  errors: Record<string, string>;
  
  /** First error message */
  firstError?: string;
}

export interface FormValidator<T = unknown> {
  /** Validate entire form */
  validate: () => Promise<ValidationResult<T>>;
  
  /** Validate single field */
  validateField: (name: string) => Promise<string | undefined>;
  
  /** Get form data as object */
  getData: () => Record<string, unknown>;
  
  /** Reset form and clear errors */
  reset: () => void;
  
  /** Destroy validator (remove listeners) */
  destroy: () => void;
}

// =============================================================================
// DEFAULT ERROR MESSAGES
// =============================================================================

const DEFAULT_MESSAGES: Record<string, string> = {
  valueMissing: 'This field is required',
  typeMismatch: 'Please enter a valid value',
  patternMismatch: 'Please match the requested format',
  tooShort: 'Please enter at least {minLength} characters',
  tooLong: 'Please enter no more than {maxLength} characters',
  rangeUnderflow: 'Value must be at least {min}',
  rangeOverflow: 'Value must be at most {max}',
  stepMismatch: 'Please enter a valid value',
  badInput: 'Please enter a valid value',
  customError: 'Please enter a valid value'
};

// =============================================================================
// CREATE FORM VALIDATOR
// =============================================================================

/**
 * Create a form validator with Zod schema
 * 
 * @example
 * ```js
 * import { createFormValidator } from './vanilla-validator.js';
 * import { z } from 'zod';
 * 
 * const schema = z.object({
 *   email: z.string().email('Invalid email'),
 *   password: z.string().min(8, 'Min 8 characters')
 * });
 * 
 * const form = document.getElementById('my-form');
 * const validator = createFormValidator(form, schema);
 * 
 * form.addEventListener('submit', async (e) => {
 *   e.preventDefault();
 *   const result = await validator.validate();
 *   if (result.valid) {
 *     // Submit result.data
 *   }
 * });
 * ```
 */
export function createFormValidator<T extends ZodType>(
  form: HTMLFormElement,
  schema: T,
  options: FormValidatorOptions = {}
): FormValidator<z.infer<T>> {
  const {
    validateOnBlur = true,
    validateOnInput = true,
    messages = {},
    displayError = defaultDisplayError,
    clearError = defaultClearError,
    focusFirstError = true
  } = options;
  
  type FormData = z.infer<T>;
  
  // Track which fields have shown errors
  const errorShown = new Set<string>();
  
  // Event handlers (stored for cleanup)
  const handlers = new Map<Element, { blur: () => void; input: () => void }>();
  
  // ==========================================================================
  // HELPERS
  // ==========================================================================
  
  function getFormData(): Record<string, unknown> {
    const formData = new FormData(form);
    const data: Record<string, unknown> = {};
    
    for (const [key, value] of formData.entries()) {
      // Handle multiple values (checkboxes, multi-select)
      if (data[key]) {
        if (Array.isArray(data[key])) {
          (data[key] as unknown[]).push(value);
        } else {
          data[key] = [data[key], value];
        }
      } else {
        data[key] = value;
      }
    }
    
    // Handle unchecked checkboxes
    form.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      const input = checkbox as HTMLInputElement;
      if (!(input.name in data)) {
        data[input.name] = false;
      } else if (data[input.name] === 'on') {
        data[input.name] = true;
      }
    });
    
    return data;
  }
  
  function getConstraintMessage(input: HTMLInputElement): string {
    const validity = input.validity;
    const allMessages = { ...DEFAULT_MESSAGES, ...messages };
    
    for (const [key, message] of Object.entries(allMessages)) {
      if (validity[key as keyof ValidityState]) {
        return message
          .replace('{minLength}', input.minLength.toString())
          .replace('{maxLength}', input.maxLength.toString())
          .replace('{min}', input.min)
          .replace('{max}', input.max);
      }
    }
    
    return input.validationMessage || 'Invalid value';
  }
  
  function getField(name: string): HTMLElement | null {
    return form.querySelector(`[name="${name}"]`);
  }
  
  function getFieldWrapper(field: HTMLElement): HTMLElement {
    return field.closest('.form-field') || field.parentElement || field;
  }
  
  // ==========================================================================
  // ERROR DISPLAY
  // ==========================================================================
  
  function defaultDisplayError(field: HTMLElement, message: string): void {
    const wrapper = getFieldWrapper(field);
    wrapper.classList.add('form-field--error');
    wrapper.classList.remove('form-field--valid');
    
    // Set aria-invalid
    field.setAttribute('aria-invalid', 'true');
    
    // Find or create error element
    let errorEl = wrapper.querySelector('.error, .form-field__error') as HTMLElement;
    if (!errorEl) {
      errorEl = document.createElement('span');
      errorEl.className = 'error';
      errorEl.setAttribute('role', 'alert');
      wrapper.appendChild(errorEl);
    }
    
    // Link error to input
    const errorId = `${field.id || field.getAttribute('name')}-error`;
    errorEl.id = errorId;
    field.setAttribute('aria-describedby', errorId);
    
    errorEl.textContent = message;
  }
  
  function defaultClearError(field: HTMLElement): void {
    const wrapper = getFieldWrapper(field);
    wrapper.classList.remove('form-field--error');
    
    field.setAttribute('aria-invalid', 'false');
    
    const errorEl = wrapper.querySelector('.error, .form-field__error');
    if (errorEl) {
      errorEl.textContent = '';
    }
  }
  
  function showValidState(field: HTMLElement): void {
    const wrapper = getFieldWrapper(field);
    wrapper.classList.add('form-field--valid');
  }
  
  // ==========================================================================
  // VALIDATION
  // ==========================================================================
  
  async function validateField(name: string): Promise<string | undefined> {
    const field = getField(name);
    if (!field) return undefined;
    
    const input = field as HTMLInputElement;
    
    // Check HTML5 constraint validation first
    if (!input.validity.valid) {
      const message = getConstraintMessage(input);
      displayError(field, message);
      errorShown.add(name);
      return message;
    }
    
    // Then check Zod schema
    const data = getFormData();
    const result = await schema.safeParseAsync(data);
    
    if (!result.success) {
      const fieldError = result.error.errors.find(e => e.path[0] === name);
      if (fieldError) {
        displayError(field, fieldError.message);
        errorShown.add(name);
        return fieldError.message;
      }
    }
    
    // Valid
    clearError(field);
    showValidState(field);
    return undefined;
  }
  
  async function validate(): Promise<ValidationResult<FormData>> {
    const data = getFormData();
    const errors: Record<string, string> = {};
    
    // Check HTML5 constraints first
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach((el) => {
      const input = el as HTMLInputElement;
      if (!input.validity.valid && input.name) {
        errors[input.name] = getConstraintMessage(input);
      }
    });
    
    // Then check Zod schema
    const result = await schema.safeParseAsync(data);
    
    if (!result.success) {
      result.error.errors.forEach((err) => {
        const fieldName = err.path[0] as string;
        if (!errors[fieldName]) {
          errors[fieldName] = err.message;
        }
      });
    }
    
    // Display errors
    for (const [name, message] of Object.entries(errors)) {
      const field = getField(name);
      if (field) {
        displayError(field, message);
        errorShown.add(name);
      }
    }
    
    // Clear valid fields
    inputs.forEach((el) => {
      const input = el as HTMLInputElement;
      if (input.name && !errors[input.name]) {
        clearError(input);
        showValidState(input);
      }
    });
    
    // Focus first error
    if (focusFirstError && Object.keys(errors).length > 0) {
      const firstErrorField = getField(Object.keys(errors)[0]);
      firstErrorField?.focus();
    }
    
    const valid = Object.keys(errors).length === 0;
    
    return {
      valid,
      data: valid ? (result as { success: true; data: FormData }).data : undefined,
      errors,
      firstError: Object.values(errors)[0]
    };
  }
  
  // ==========================================================================
  // EVENT LISTENERS
  // ==========================================================================
  
  function setupListeners(): void {
    const inputs = form.querySelectorAll('input, select, textarea');
    
    inputs.forEach((el) => {
      const input = el as HTMLInputElement;
      const name = input.name;
      
      const blurHandler = () => {
        if (validateOnBlur) {
          validateField(name);
        }
      };
      
      const inputHandler = () => {
        // Only validate on input if error has been shown (correction mode)
        if (validateOnInput && errorShown.has(name)) {
          validateField(name);
        }
      };
      
      input.addEventListener('blur', blurHandler);
      input.addEventListener('input', inputHandler);
      
      handlers.set(input, { blur: blurHandler, input: inputHandler });
    });
  }
  
  function removeListeners(): void {
    handlers.forEach((handler, el) => {
      el.removeEventListener('blur', handler.blur);
      el.removeEventListener('input', handler.input);
    });
    handlers.clear();
  }
  
  // ==========================================================================
  // INITIALIZE
  // ==========================================================================
  
  setupListeners();
  
  // ==========================================================================
  // PUBLIC API
  // ==========================================================================
  
  return {
    validate,
    validateField,
    getData: getFormData,
    
    reset() {
      form.reset();
      errorShown.clear();
      
      const inputs = form.querySelectorAll('input, select, textarea');
      inputs.forEach((el) => {
        clearError(el as HTMLElement);
        const wrapper = getFieldWrapper(el as HTMLElement);
        wrapper.classList.remove('form-field--valid');
      });
    },
    
    destroy() {
      removeListeners();
      errorShown.clear();
    }
  };
}

// =============================================================================
// NATIVE VALIDATION ENHANCER
// =============================================================================

/**
 * Enhance native HTML5 validation with custom error display
 * 
 * Use when you don't need Zod but want better error UX.
 * 
 * @example
 * ```js
 * const form = document.getElementById('my-form');
 * enhanceNativeValidation(form);
 * ```
 */
export function enhanceNativeValidation(
  form: HTMLFormElement,
  options: Omit<FormValidatorOptions, 'validateOnInput'> = {}
): { destroy: () => void } {
  const {
    validateOnBlur = true,
    messages = {},
    displayError = defaultDisplayError,
    clearError = defaultClearError,
    focusFirstError = true
  } = options;
  
  const errorShown = new Set<string>();
  const handlers = new Map<Element, () => void>();
  
  function getConstraintMessage(input: HTMLInputElement): string {
    const validity = input.validity;
    const allMessages = { ...DEFAULT_MESSAGES, ...messages };
    
    for (const [key, message] of Object.entries(allMessages)) {
      if (validity[key as keyof ValidityState]) {
        return message
          .replace('{minLength}', input.minLength.toString())
          .replace('{maxLength}', input.maxLength.toString())
          .replace('{min}', input.min)
          .replace('{max}', input.max);
      }
    }
    
    return input.validationMessage || 'Invalid value';
  }
  
  function validateInput(input: HTMLInputElement): void {
    if (!input.validity.valid) {
      const message = getConstraintMessage(input);
      displayError(input, message);
      errorShown.add(input.name);
    } else {
      clearError(input);
      errorShown.delete(input.name);
    }
  }
  
  // Set up blur handlers
  const inputs = form.querySelectorAll('input, select, textarea');
  inputs.forEach((el) => {
    const input = el as HTMLInputElement;
    
    const handler = () => {
      if (validateOnBlur) {
        validateInput(input);
      }
    };
    
    input.addEventListener('blur', handler);
    input.addEventListener('input', () => {
      if (errorShown.has(input.name)) {
        validateInput(input);
      }
    });
    
    handlers.set(input, handler);
  });
  
  // Handle form submit
  const submitHandler = (e: Event) => {
    let firstError: HTMLElement | null = null;
    
    inputs.forEach((el) => {
      const input = el as HTMLInputElement;
      if (!input.validity.valid) {
        const message = getConstraintMessage(input);
        displayError(input, message);
        errorShown.add(input.name);
        
        if (!firstError) {
          firstError = input;
        }
      }
    });
    
    if (firstError && focusFirstError) {
      e.preventDefault();
      firstError.focus();
    }
  };
  
  form.addEventListener('submit', submitHandler);
  
  return {
    destroy() {
      handlers.forEach((handler, el) => {
        el.removeEventListener('blur', handler);
      });
      form.removeEventListener('submit', submitHandler);
    }
  };
}

// =============================================================================
// CSS
// =============================================================================

export const vanillaFormCSS = `
/* Form Field */
.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 1rem;
}

.form-field label {
  font-weight: 500;
  font-size: 0.875rem;
}

.form-field input,
.form-field select,
.form-field textarea {
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  font-size: 1rem;
}

.form-field input:focus,
.form-field select:focus,
.form-field textarea:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

/* Error State */
.form-field--error input,
.form-field--error select,
.form-field--error textarea {
  border-color: #dc2626;
}

.form-field--error input:focus,
.form-field--error select:focus,
.form-field--error textarea:focus {
  border-color: #dc2626;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.1);
}

.form-field .error {
  font-size: 0.75rem;
  color: #dc2626;
  min-height: 1rem;
}

/* Valid State */
.form-field--valid input,
.form-field--valid select,
.form-field--valid textarea {
  border-color: #059669;
}
`;
