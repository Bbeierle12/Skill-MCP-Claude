/**
 * ARIA Form Wrapper
 * 
 * React components that automatically handle ARIA bindings for form fields.
 * Implements WCAG 2.2 AA compliance patterns.
 * 
 * @module aria-form-wrapper
 */

import React, {
  createContext,
  useContext,
  useId,
  useMemo,
  ReactNode,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  SelectHTMLAttributes,
  forwardRef
} from 'react';

// =============================================================================
// TYPES
// =============================================================================

export interface FormFieldContextValue {
  /** Unique field ID */
  fieldId: string;
  
  /** ID for error message element */
  errorId: string;
  
  /** ID for hint/description element */
  hintId: string;
  
  /** Current error message (if any) */
  error?: string;
  
  /** Hint text (if any) */
  hint?: string;
  
  /** Whether field is required */
  required?: boolean;
  
  /** Whether field has been touched */
  touched?: boolean;
  
  /** Field label text */
  label: string;
}

export interface FormFieldProps {
  /** Field label (required for accessibility) */
  label: string;
  
  /** Unique name for the field */
  name: string;
  
  /** Error message to display */
  error?: string;
  
  /** Hint text to display below label */
  hint?: string;
  
  /** Whether field is required */
  required?: boolean;
  
  /** Whether field has been touched (for showing errors) */
  touched?: boolean;
  
  /** Child input element(s) */
  children: ReactNode;
  
  /** Additional class name */
  className?: string;
  
  /** Hide the label visually (still accessible to screen readers) */
  hideLabel?: boolean;
}

export interface AccessibleInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** Override auto-generated ID */
  id?: string;
}

export interface AccessibleTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  /** Override auto-generated ID */
  id?: string;
}

export interface AccessibleSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  /** Override auto-generated ID */
  id?: string;
  children: ReactNode;
}

// =============================================================================
// CONTEXT
// =============================================================================

const FormFieldContext = createContext<FormFieldContextValue | null>(null);

/**
 * Hook to access form field context
 * Must be used within a FormField component
 */
export function useFormFieldContext(): FormFieldContextValue {
  const context = useContext(FormFieldContext);
  if (!context) {
    throw new Error('useFormFieldContext must be used within a FormField');
  }
  return context;
}

// =============================================================================
// FORM FIELD WRAPPER
// =============================================================================

/**
 * Accessible form field wrapper
 * 
 * Provides automatic ARIA bindings for child inputs.
 * 
 * @example
 * ```tsx
 * <FormField
 *   label="Email"
 *   name="email"
 *   error={errors.email}
 *   hint="We'll never share your email"
 *   required
 * >
 *   <AccessibleInput type="email" autoComplete="email" />
 * </FormField>
 * ```
 */
export function FormField({
  label,
  name,
  error,
  hint,
  required,
  touched,
  children,
  className = '',
  hideLabel = false
}: FormFieldProps) {
  // Generate unique IDs
  const uniqueId = useId();
  const fieldId = `field-${name}-${uniqueId}`;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  
  // Determine visual state
  const showError = touched && !!error;
  const showValid = touched && !error;
  
  // Build class names
  const fieldClasses = [
    'form-field',
    showError && 'form-field--error',
    showValid && 'form-field--valid',
    required && 'form-field--required',
    className
  ].filter(Boolean).join(' ');
  
  // Context value for child inputs
  const contextValue = useMemo<FormFieldContextValue>(() => ({
    fieldId,
    errorId,
    hintId,
    error,
    hint,
    required,
    touched,
    label
  }), [fieldId, errorId, hintId, error, hint, required, touched, label]);
  
  return (
    <FormFieldContext.Provider value={contextValue}>
      <div className={fieldClasses}>
        {/* Label */}
        <label 
          htmlFor={fieldId}
          className={hideLabel ? 'sr-only' : 'form-field__label'}
        >
          {label}
          {required && (
            <>
              <span className="form-field__required" aria-hidden="true">*</span>
              <span className="sr-only">(required)</span>
            </>
          )}
        </label>
        
        {/* Hint (before input for screen reader flow) */}
        {hint && (
          <span id={hintId} className="form-field__hint">
            {hint}
          </span>
        )}
        
        {/* Input wrapper (for icons, addons) */}
        <div className="form-field__input-wrapper">
          {children}
          
          {/* Visual state indicators */}
          {showValid && (
            <span className="form-field__icon form-field__icon--valid" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </span>
          )}
          {showError && (
            <span className="form-field__icon form-field__icon--error" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </span>
          )}
        </div>
        
        {/* Error message (announced by screen readers) */}
        {showError && (
          <span id={errorId} className="form-field__error" role="alert">
            {error}
          </span>
        )}
      </div>
    </FormFieldContext.Provider>
  );
}

// =============================================================================
// ACCESSIBLE INPUT
// =============================================================================

/**
 * Accessible input that automatically binds ARIA attributes from FormField context
 * 
 * @example
 * ```tsx
 * <FormField label="Email" name="email" error={error}>
 *   <AccessibleInput type="email" autoComplete="email" />
 * </FormField>
 * ```
 */
export const AccessibleInput = forwardRef<HTMLInputElement, AccessibleInputProps>(
  function AccessibleInput(props, ref) {
    const context = useFormFieldContext();
    
    // Build aria-describedby
    const describedBy = [
      context.hint && context.hintId,
      context.error && context.touched && context.errorId
    ].filter(Boolean).join(' ') || undefined;
    
    return (
      <input
        ref={ref}
        id={props.id || context.fieldId}
        aria-invalid={context.touched && !!context.error}
        aria-describedby={describedBy}
        aria-required={context.required}
        {...props}
      />
    );
  }
);

// =============================================================================
// ACCESSIBLE TEXTAREA
// =============================================================================

/**
 * Accessible textarea that automatically binds ARIA attributes from FormField context
 */
export const AccessibleTextarea = forwardRef<HTMLTextAreaElement, AccessibleTextareaProps>(
  function AccessibleTextarea(props, ref) {
    const context = useFormFieldContext();
    
    const describedBy = [
      context.hint && context.hintId,
      context.error && context.touched && context.errorId
    ].filter(Boolean).join(' ') || undefined;
    
    return (
      <textarea
        ref={ref}
        id={props.id || context.fieldId}
        aria-invalid={context.touched && !!context.error}
        aria-describedby={describedBy}
        aria-required={context.required}
        {...props}
      />
    );
  }
);

// =============================================================================
// ACCESSIBLE SELECT
// =============================================================================

/**
 * Accessible select that automatically binds ARIA attributes from FormField context
 */
export const AccessibleSelect = forwardRef<HTMLSelectElement, AccessibleSelectProps>(
  function AccessibleSelect({ children, ...props }, ref) {
    const context = useFormFieldContext();
    
    const describedBy = [
      context.hint && context.hintId,
      context.error && context.touched && context.errorId
    ].filter(Boolean).join(' ') || undefined;
    
    return (
      <select
        ref={ref}
        id={props.id || context.fieldId}
        aria-invalid={context.touched && !!context.error}
        aria-describedby={describedBy}
        aria-required={context.required}
        {...props}
      >
        {children}
      </select>
    );
  }
);

// =============================================================================
// CHECKBOX FIELD
// =============================================================================

export interface CheckboxFieldProps {
  /** Checkbox label */
  label: ReactNode;
  
  /** Field name */
  name: string;
  
  /** Error message */
  error?: string;
  
  /** Whether touched */
  touched?: boolean;
  
  /** Whether required */
  required?: boolean;
  
  /** Checkbox props */
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;
  
  /** Additional class name */
  className?: string;
}

/**
 * Accessible checkbox field
 * 
 * @example
 * ```tsx
 * <CheckboxField
 *   label="I accept the terms"
 *   name="acceptTerms"
 *   error={errors.acceptTerms}
 *   inputProps={register('acceptTerms')}
 * />
 * ```
 */
export function CheckboxField({
  label,
  name,
  error,
  touched,
  required,
  inputProps,
  className = ''
}: CheckboxFieldProps) {
  const uniqueId = useId();
  const fieldId = `checkbox-${name}-${uniqueId}`;
  const errorId = `${fieldId}-error`;
  
  const showError = touched && !!error;
  
  return (
    <div className={`form-field form-field--checkbox ${showError ? 'form-field--error' : ''} ${className}`}>
      <label className="form-field__checkbox-label">
        <input
          type="checkbox"
          id={fieldId}
          aria-invalid={showError}
          aria-describedby={showError ? errorId : undefined}
          aria-required={required}
          {...inputProps}
        />
        <span className="form-field__checkbox-text">
          {label}
          {required && <span className="sr-only">(required)</span>}
        </span>
      </label>
      
      {showError && (
        <span id={errorId} className="form-field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

// =============================================================================
// RADIO GROUP
// =============================================================================

export interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  /** Group legend (required for accessibility) */
  legend: string;
  
  /** Field name */
  name: string;
  
  /** Radio options */
  options: RadioOption[];
  
  /** Error message */
  error?: string;
  
  /** Whether touched */
  touched?: boolean;
  
  /** Whether required */
  required?: boolean;
  
  /** Currently selected value */
  value?: string;
  
  /** Change handler */
  onChange?: (value: string) => void;
  
  /** Additional props for radio inputs */
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'name' | 'value'>;
  
  /** Additional class name */
  className?: string;
  
  /** Layout direction */
  direction?: 'horizontal' | 'vertical';
}

/**
 * Accessible radio button group with fieldset/legend
 * 
 * @example
 * ```tsx
 * <RadioGroup
 *   legend="Preferred contact method"
 *   name="contactMethod"
 *   options={[
 *     { value: 'email', label: 'Email' },
 *     { value: 'phone', label: 'Phone' }
 *   ]}
 *   error={errors.contactMethod}
 *   touched={touched.contactMethod}
 * />
 * ```
 */
export function RadioGroup({
  legend,
  name,
  options,
  error,
  touched,
  required,
  value,
  onChange,
  inputProps,
  className = '',
  direction = 'vertical'
}: RadioGroupProps) {
  const uniqueId = useId();
  const errorId = `radio-${name}-${uniqueId}-error`;
  
  const showError = touched && !!error;
  
  return (
    <fieldset 
      className={`form-field form-field--radio-group form-field--${direction} ${showError ? 'form-field--error' : ''} ${className}`}
      aria-invalid={showError}
      aria-describedby={showError ? errorId : undefined}
    >
      <legend className="form-field__legend">
        {legend}
        {required && (
          <>
            <span className="form-field__required" aria-hidden="true">*</span>
            <span className="sr-only">(required)</span>
          </>
        )}
      </legend>
      
      <div className="form-field__radio-options">
        {options.map((option) => (
          <label key={option.value} className="form-field__radio-label">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={(e) => onChange?.(e.target.value)}
              disabled={option.disabled}
              aria-required={required}
              {...inputProps}
            />
            <span className="form-field__radio-text">{option.label}</span>
          </label>
        ))}
      </div>
      
      {showError && (
        <span id={errorId} className="form-field__error" role="alert">
          {error}
        </span>
      )}
    </fieldset>
  );
}

// =============================================================================
// CSS (Include in your stylesheet)
// =============================================================================

export const formFieldCSS = `
/* Form Field Base */
.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 1rem;
}

.form-field__label {
  font-weight: 500;
  font-size: 0.875rem;
  color: #374151;
}

.form-field__required {
  color: #dc2626;
  margin-left: 0.25rem;
}

.form-field__hint {
  font-size: 0.75rem;
  color: #6b7280;
}

.form-field__input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.form-field__input-wrapper input,
.form-field__input-wrapper textarea,
.form-field__input-wrapper select {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  font-size: 1rem;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.form-field__input-wrapper input:focus,
.form-field__input-wrapper textarea:focus,
.form-field__input-wrapper select:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

/* Error State */
.form-field--error .form-field__input-wrapper input,
.form-field--error .form-field__input-wrapper textarea,
.form-field--error .form-field__input-wrapper select {
  border-color: #dc2626;
  padding-right: 2.5rem;
}

.form-field--error .form-field__input-wrapper input:focus,
.form-field--error .form-field__input-wrapper textarea:focus,
.form-field--error .form-field__input-wrapper select:focus {
  border-color: #dc2626;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.1);
}

.form-field__error {
  font-size: 0.75rem;
  color: #dc2626;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.form-field__error::before {
  content: "⚠";
}

/* Valid State */
.form-field--valid .form-field__input-wrapper input,
.form-field--valid .form-field__input-wrapper textarea,
.form-field--valid .form-field__input-wrapper select {
  border-color: #059669;
  padding-right: 2.5rem;
}

/* Icons */
.form-field__icon {
  position: absolute;
  right: 0.75rem;
  pointer-events: none;
}

.form-field__icon--valid {
  color: #059669;
}

.form-field__icon--error {
  color: #dc2626;
}

/* Screen Reader Only */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Checkbox */
.form-field--checkbox {
  flex-direction: row;
  align-items: flex-start;
  gap: 0.5rem;
}

.form-field__checkbox-label {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  cursor: pointer;
}

.form-field__checkbox-label input {
  width: 1rem;
  height: 1rem;
  margin-top: 0.125rem;
}

/* Radio Group */
.form-field--radio-group {
  border: none;
  padding: 0;
  margin: 0 0 1rem 0;
}

.form-field__legend {
  font-weight: 500;
  font-size: 0.875rem;
  color: #374151;
  margin-bottom: 0.5rem;
}

.form-field__radio-options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-field--horizontal .form-field__radio-options {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 1rem;
}

.form-field__radio-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.form-field__radio-label input {
  width: 1rem;
  height: 1rem;
}

/* Target Size (WCAG 2.5.8) */
.form-field input[type="checkbox"],
.form-field input[type="radio"] {
  min-width: 24px;
  min-height: 24px;
}
`;
