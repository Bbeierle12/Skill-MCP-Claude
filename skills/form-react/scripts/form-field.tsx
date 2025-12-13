/**
 * React Form Field Component
 * 
 * Reusable form field with automatic ARIA bindings,
 * validation state display, and React Hook Form integration.
 * 
 * @module form-field
 */

import React, {
  forwardRef,
  useId,
  ReactNode,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  SelectHTMLAttributes
} from 'react';
import { useFormContext, RegisterOptions, FieldError } from 'react-hook-form';

// =============================================================================
// TYPES
// =============================================================================

export interface FormFieldProps {
  /** Field name (must match schema) */
  name: string;
  
  /** Field label */
  label: string;
  
  /** Input type */
  type?: 'text' | 'email' | 'password' | 'tel' | 'url' | 'number' | 'date' | 'time' | 'datetime-local';
  
  /** Autocomplete value */
  autoComplete?: string;
  
  /** Hint text (separate from label) */
  hint?: string;
  
  /** Placeholder text */
  placeholder?: string;
  
  /** Required field */
  required?: boolean;
  
  /** Disabled field */
  disabled?: boolean;
  
  /** Read-only field */
  readOnly?: boolean;
  
  /** Additional validation options */
  validation?: RegisterOptions;
  
  /** Custom error message override */
  errorMessage?: string;
  
  /** Additional class names */
  className?: string;
  
  /** Hide label visually (still accessible) */
  hideLabel?: boolean;
  
  /** Render custom input */
  children?: ReactNode;
  
  /** Input props to pass through */
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
}

export interface TextareaFieldProps extends Omit<FormFieldProps, 'type' | 'inputProps'> {
  /** Number of visible rows */
  rows?: number;
  
  /** Maximum character count */
  maxLength?: number;
  
  /** Show character count */
  showCount?: boolean;
  
  /** Textarea props */
  textareaProps?: TextareaHTMLAttributes<HTMLTextAreaElement>;
}

export interface SelectFieldProps extends Omit<FormFieldProps, 'type' | 'inputProps'> {
  /** Select options */
  options: Array<{
    value: string;
    label: string;
    disabled?: boolean;
  }>;
  
  /** Placeholder option text */
  placeholderOption?: string;
  
  /** Select props */
  selectProps?: SelectHTMLAttributes<HTMLSelectElement>;
}

export interface CheckboxFieldProps {
  /** Field name */
  name: string;
  
  /** Checkbox label */
  label: ReactNode;
  
  /** Required field */
  required?: boolean;
  
  /** Disabled field */
  disabled?: boolean;
  
  /** Additional validation */
  validation?: RegisterOptions;
  
  /** Custom error message */
  errorMessage?: string;
  
  /** Additional class names */
  className?: string;
}

// =============================================================================
// FORM FIELD
// =============================================================================

/**
 * Standard form field with label, input, and error display
 * 
 * @example
 * ```tsx
 * <FormField
 *   name="email"
 *   label="Email"
 *   type="email"
 *   autoComplete="email"
 *   required
 *   hint="We'll never share your email"
 * />
 * ```
 */
export function FormField({
  name,
  label,
  type = 'text',
  autoComplete,
  hint,
  placeholder,
  required,
  disabled,
  readOnly,
  validation,
  errorMessage,
  className = '',
  hideLabel = false,
  children,
  inputProps
}: FormFieldProps) {
  const id = useId();
  const fieldId = `field-${name}-${id}`;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  
  const {
    register,
    formState: { errors, touchedFields }
  } = useFormContext();
  
  const error = errors[name] as FieldError | undefined;
  const touched = touchedFields[name];
  const showError = touched && !!error;
  const showValid = touched && !error;
  
  // Build aria-describedby
  const describedBy = [
    hint && hintId,
    showError && errorId
  ].filter(Boolean).join(' ') || undefined;
  
  // Field classes
  const fieldClasses = [
    'form-field',
    showError && 'form-field--error',
    showValid && 'form-field--valid',
    disabled && 'form-field--disabled',
    className
  ].filter(Boolean).join(' ');
  
  return (
    <div className={fieldClasses}>
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
      
      {hint && (
        <span id={hintId} className="form-field__hint">
          {hint}
        </span>
      )}
      
      <div className="form-field__input-wrapper">
        {children || (
          <input
            id={fieldId}
            type={type}
            autoComplete={autoComplete}
            placeholder={placeholder}
            disabled={disabled}
            readOnly={readOnly}
            aria-invalid={showError}
            aria-describedby={describedBy}
            aria-required={required}
            {...inputProps}
            {...register(name, {
              required: required && 'This field is required',
              ...validation
            })}
          />
        )}
        
        {showValid && (
          <span className="form-field__icon form-field__icon--valid" aria-hidden="true">
            ✓
          </span>
        )}
        
        {showError && (
          <span className="form-field__icon form-field__icon--error" aria-hidden="true">
            !
          </span>
        )}
      </div>
      
      {showError && (
        <span id={errorId} className="form-field__error" role="alert">
          {errorMessage || error?.message || 'Invalid value'}
        </span>
      )}
    </div>
  );
}

// =============================================================================
// TEXTAREA FIELD
// =============================================================================

/**
 * Textarea form field with optional character count
 * 
 * @example
 * ```tsx
 * <TextareaField
 *   name="bio"
 *   label="Bio"
 *   rows={4}
 *   maxLength={500}
 *   showCount
 *   hint="Tell us about yourself"
 * />
 * ```
 */
export function TextareaField({
  name,
  label,
  hint,
  placeholder,
  required,
  disabled,
  readOnly,
  validation,
  errorMessage,
  className = '',
  hideLabel = false,
  rows = 4,
  maxLength,
  showCount = false,
  textareaProps
}: TextareaFieldProps) {
  const id = useId();
  const fieldId = `field-${name}-${id}`;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  
  const {
    register,
    watch,
    formState: { errors, touchedFields }
  } = useFormContext();
  
  const value = watch(name) || '';
  const error = errors[name] as FieldError | undefined;
  const touched = touchedFields[name];
  const showError = touched && !!error;
  
  const describedBy = [
    hint && hintId,
    showError && errorId
  ].filter(Boolean).join(' ') || undefined;
  
  const fieldClasses = [
    'form-field',
    'form-field--textarea',
    showError && 'form-field--error',
    disabled && 'form-field--disabled',
    className
  ].filter(Boolean).join(' ');
  
  return (
    <div className={fieldClasses}>
      <label
        htmlFor={fieldId}
        className={hideLabel ? 'sr-only' : 'form-field__label'}
      >
        {label}
        {required && (
          <span className="form-field__required" aria-hidden="true">*</span>
        )}
      </label>
      
      {hint && (
        <span id={hintId} className="form-field__hint">
          {hint}
        </span>
      )}
      
      <textarea
        id={fieldId}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={showError}
        aria-describedby={describedBy}
        aria-required={required}
        {...textareaProps}
        {...register(name, {
          required: required && 'This field is required',
          maxLength: maxLength && {
            value: maxLength,
            message: `Maximum ${maxLength} characters`
          },
          ...validation
        })}
      />
      
      {showCount && maxLength && (
        <span className="form-field__count" aria-live="polite">
          {value.length}/{maxLength}
        </span>
      )}
      
      {showError && (
        <span id={errorId} className="form-field__error" role="alert">
          {errorMessage || error?.message}
        </span>
      )}
    </div>
  );
}

// =============================================================================
// SELECT FIELD
// =============================================================================

/**
 * Select dropdown form field
 * 
 * @example
 * ```tsx
 * <SelectField
 *   name="country"
 *   label="Country"
 *   autoComplete="country"
 *   options={[
 *     { value: 'US', label: 'United States' },
 *     { value: 'CA', label: 'Canada' }
 *   ]}
 *   placeholderOption="Select a country"
 * />
 * ```
 */
export function SelectField({
  name,
  label,
  autoComplete,
  hint,
  required,
  disabled,
  validation,
  errorMessage,
  className = '',
  hideLabel = false,
  options,
  placeholderOption,
  selectProps
}: SelectFieldProps) {
  const id = useId();
  const fieldId = `field-${name}-${id}`;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  
  const {
    register,
    formState: { errors, touchedFields }
  } = useFormContext();
  
  const error = errors[name] as FieldError | undefined;
  const touched = touchedFields[name];
  const showError = touched && !!error;
  
  const describedBy = [
    hint && hintId,
    showError && errorId
  ].filter(Boolean).join(' ') || undefined;
  
  const fieldClasses = [
    'form-field',
    'form-field--select',
    showError && 'form-field--error',
    disabled && 'form-field--disabled',
    className
  ].filter(Boolean).join(' ');
  
  return (
    <div className={fieldClasses}>
      <label
        htmlFor={fieldId}
        className={hideLabel ? 'sr-only' : 'form-field__label'}
      >
        {label}
        {required && (
          <span className="form-field__required" aria-hidden="true">*</span>
        )}
      </label>
      
      {hint && (
        <span id={hintId} className="form-field__hint">
          {hint}
        </span>
      )}
      
      <div className="form-field__input-wrapper">
        <select
          id={fieldId}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={showError}
          aria-describedby={describedBy}
          aria-required={required}
          {...selectProps}
          {...register(name, {
            required: required && 'Please select an option',
            ...validation
          })}
        >
          {placeholderOption && (
            <option value="" disabled>
              {placeholderOption}
            </option>
          )}
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
      </div>
      
      {showError && (
        <span id={errorId} className="form-field__error" role="alert">
          {errorMessage || error?.message}
        </span>
      )}
    </div>
  );
}

// =============================================================================
// CHECKBOX FIELD
// =============================================================================

/**
 * Checkbox form field
 * 
 * @example
 * ```tsx
 * <CheckboxField
 *   name="acceptTerms"
 *   label={<>I accept the <a href="/terms">Terms</a></>}
 *   required
 * />
 * ```
 */
export function CheckboxField({
  name,
  label,
  required,
  disabled,
  validation,
  errorMessage,
  className = ''
}: CheckboxFieldProps) {
  const id = useId();
  const fieldId = `field-${name}-${id}`;
  const errorId = `${fieldId}-error`;
  
  const {
    register,
    formState: { errors, touchedFields }
  } = useFormContext();
  
  const error = errors[name] as FieldError | undefined;
  const touched = touchedFields[name];
  const showError = touched && !!error;
  
  const fieldClasses = [
    'form-field',
    'form-field--checkbox',
    showError && 'form-field--error',
    disabled && 'form-field--disabled',
    className
  ].filter(Boolean).join(' ');
  
  return (
    <div className={fieldClasses}>
      <label htmlFor={fieldId} className="form-field__checkbox-label">
        <input
          id={fieldId}
          type="checkbox"
          disabled={disabled}
          aria-invalid={showError}
          aria-describedby={showError ? errorId : undefined}
          {...register(name, {
            required: required && 'This field is required',
            ...validation
          })}
        />
        <span className="form-field__checkbox-text">{label}</span>
      </label>
      
      {showError && (
        <span id={errorId} className="form-field__error" role="alert">
          {errorMessage || error?.message}
        </span>
      )}
    </div>
  );
}

// =============================================================================
// PASSWORD FIELD
// =============================================================================

/**
 * Password field with visibility toggle
 */
export const PasswordField = forwardRef<HTMLInputElement, FormFieldProps>(
  function PasswordField(props, ref) {
    const [visible, setVisible] = React.useState(false);
    
    return (
      <FormField
        {...props}
        type={visible ? 'text' : 'password'}
      >
        <div className="password-field__wrapper">
          <input
            ref={ref}
            type={visible ? 'text' : 'password'}
            className="password-field__input"
          />
          <button
            type="button"
            className="password-field__toggle"
            onClick={() => setVisible(!visible)}
            aria-label={visible ? 'Hide password' : 'Show password'}
          >
            {visible ? '👁️' : '👁️‍🗨️'}
          </button>
        </div>
      </FormField>
    );
  }
);

// =============================================================================
// CSS
// =============================================================================

export const formFieldCSS = `
/* Form Field */
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
}

.form-field input,
.form-field select,
.form-field textarea {
  width: 100%;
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

.form-field--error input,
.form-field--error select,
.form-field--error textarea {
  border-color: #dc2626;
}

.form-field--valid input,
.form-field--valid select,
.form-field--valid textarea {
  border-color: #059669;
}

.form-field__icon {
  position: absolute;
  right: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
}

.form-field__icon--valid { color: #059669; }
.form-field__icon--error { color: #dc2626; }

.form-field__error {
  font-size: 0.75rem;
  color: #dc2626;
}

.form-field__count {
  font-size: 0.75rem;
  color: #6b7280;
  text-align: right;
}

/* Checkbox */
.form-field--checkbox {
  flex-direction: row;
  align-items: flex-start;
}

.form-field__checkbox-label {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  cursor: pointer;
}

.form-field__checkbox-label input {
  width: auto;
  margin-top: 0.125rem;
}

/* Screen reader only */
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
`;
