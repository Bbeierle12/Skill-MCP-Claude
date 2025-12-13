/**
 * VeeValidate Form Composables
 * 
 * Reusable Vue 3 composables for form validation with VeeValidate + Zod.
 * 
 * @module veevalidate-composables
 */

import { computed, ref, Ref } from 'vue';
import { useForm, useField, useFieldArray } from 'vee-validate';
import { toTypedSchema } from '@vee-validate/zod';
import { z, ZodType } from 'zod';

// =============================================================================
// TYPES
// =============================================================================

export interface UseZodFormOptions<T extends z.ZodType> {
  /** Zod schema for validation */
  schema: T;
  
  /** Initial form values */
  initialValues?: Partial<z.infer<T>>;
  
  /** Validate on mount */
  validateOnMount?: boolean;
  
  /** Keep values on unmount */
  keepValuesOnUnmount?: boolean;
}

export interface FieldConfig {
  /** Field name */
  name: string;
  
  /** Initial value */
  initialValue?: unknown;
  
  /** Validate on model update */
  validateOnModelUpdate?: boolean;
  
  /** Validate on blur */
  validateOnBlur?: boolean;
}

// =============================================================================
// USE ZOD FORM
// =============================================================================

/**
 * Composable for VeeValidate form with Zod schema
 * 
 * @example
 * ```vue
 * <script setup>
 * import { useZodForm } from './veevalidate-composables';
 * import { loginSchema } from './schemas';
 * 
 * const {
 *   handleSubmit,
 *   errors,
 *   isSubmitting,
 *   defineField
 * } = useZodForm({
 *   schema: loginSchema,
 *   initialValues: { email: '', password: '' }
 * });
 * 
 * const [email, emailAttrs] = defineField('email');
 * const [password, passwordAttrs] = defineField('password');
 * 
 * const onSubmit = handleSubmit((values) => {
 *   console.log(values);
 * });
 * </script>
 * ```
 */
export function useZodForm<T extends z.ZodType>(options: UseZodFormOptions<T>) {
  const { schema, initialValues, validateOnMount = false, keepValuesOnUnmount = false } = options;
  
  type FormValues = z.infer<T>;
  
  const form = useForm<FormValues>({
    validationSchema: toTypedSchema(schema),
    initialValues: initialValues as FormValues,
    validateOnMount,
    keepValuesOnUnmount
  });
  
  return {
    ...form,
    
    /**
     * Define a field with v-model binding
     */
    defineField: form.defineField,
    
    /**
     * Check if form has any errors
     */
    hasErrors: computed(() => Object.keys(form.errors.value).length > 0),
    
    /**
     * Get error message for a field
     */
    getError: (fieldName: keyof FormValues) => form.errors.value[fieldName as string],
    
    /**
     * Check if a specific field is valid
     */
    isFieldValid: (fieldName: keyof FormValues) => !form.errors.value[fieldName as string],
    
    /**
     * Reset form to initial values
     */
    resetToInitial: () => form.resetForm({ values: initialValues as FormValues })
  };
}

// =============================================================================
// USE FORM FIELD
// =============================================================================

/**
 * Composable for a single form field with validation timing
 * 
 * @example
 * ```vue
 * <script setup>
 * const { value, error, attrs, isTouched, isValid } = useFormField({
 *   name: 'email',
 *   validateOnBlur: true
 * });
 * </script>
 * 
 * <template>
 *   <input v-model="value" v-bind="attrs" :class="{ error: isTouched && error }" />
 *   <span v-if="isTouched && error">{{ error }}</span>
 * </template>
 * ```
 */
export function useFormField(config: FieldConfig) {
  const {
    name,
    initialValue,
    validateOnModelUpdate = true,
    validateOnBlur = true
  } = config;
  
  const field = useField(name, undefined, {
    initialValue,
    validateOnValueUpdate: validateOnModelUpdate
  });
  
  // Track touched state
  const isTouched = ref(false);
  
  const handleBlur = () => {
    isTouched.value = true;
    if (validateOnBlur) {
      field.validate();
    }
  };
  
  return {
    /** Field value (v-model) */
    value: field.value,
    
    /** Error message */
    error: field.errorMessage,
    
    /** Meta information */
    meta: field.meta,
    
    /** Whether field has been touched */
    isTouched,
    
    /** Whether field is valid */
    isValid: computed(() => !field.errorMessage.value),
    
    /** Whether to show error (touched + has error) */
    showError: computed(() => isTouched.value && !!field.errorMessage.value),
    
    /** Whether to show valid state (touched + valid) */
    showValid: computed(() => isTouched.value && !field.errorMessage.value && field.meta.dirty),
    
    /** Attributes to bind to input */
    attrs: {
      name,
      onBlur: handleBlur,
      'aria-invalid': field.errorMessage.value ? 'true' : 'false'
    },
    
    /** Manually trigger validation */
    validate: field.validate,
    
    /** Reset field */
    reset: field.resetField
  };
}

// =============================================================================
// USE VALIDATION TIMING
// =============================================================================

/**
 * Composable for "Reward Early, Punish Late" validation timing
 * 
 * @example
 * ```vue
 * <script setup>
 * const { showError, showValid, visualState, handlers } = useValidationTiming(field);
 * </script>
 * 
 * <template>
 *   <input v-bind="handlers" :class="visualState" />
 *   <span v-if="showError">{{ field.errorMessage }}</span>
 * </template>
 * ```
 */
export function useValidationTiming(field: ReturnType<typeof useField>) {
  const touched = ref(false);
  const hasShownError = ref(false);
  
  const handleBlur = () => {
    touched.value = true;
    field.validate();
  };
  
  const handleInput = () => {
    // Only revalidate if error has been shown (correction mode)
    if (hasShownError.value) {
      field.validate();
    }
  };
  
  // Track when error is first shown
  const showError = computed(() => {
    const shouldShow = touched.value && !!field.errorMessage.value;
    if (shouldShow) {
      hasShownError.value = true;
    }
    return shouldShow;
  });
  
  const showValid = computed(() => {
    return field.meta.dirty && !field.errorMessage.value;
  });
  
  const visualState = computed(() => {
    if (showError.value) return 'invalid';
    if (showValid.value) return 'valid';
    return 'idle';
  });
  
  return {
    showError,
    showValid,
    visualState,
    touched,
    handlers: {
      onBlur: handleBlur,
      onInput: handleInput
    }
  };
}

// =============================================================================
// USE ASYNC VALIDATION
// =============================================================================

/**
 * Composable for async validation with debouncing
 * 
 * @example
 * ```vue
 * <script setup>
 * const { validate, isValidating, error } = useAsyncValidation({
 *   validator: async (value) => {
 *     const { available } = await checkUsername(value);
 *     return available ? null : 'Username taken';
 *   },
 *   debounceMs: 500
 * });
 * </script>
 * ```
 */
export interface UseAsyncValidationOptions<T> {
  /** Async validator function */
  validator: (value: T) => Promise<string | null>;
  
  /** Debounce delay in ms */
  debounceMs?: number;
  
  /** Minimum length before validating */
  minLength?: number;
}

export function useAsyncValidation<T>(options: UseAsyncValidationOptions<T>) {
  const { validator, debounceMs = 500, minLength = 0 } = options;
  
  const isValidating = ref(false);
  const error = ref<string | null>(null);
  let timeoutId: ReturnType<typeof setTimeout>;
  
  const validate = async (value: T): Promise<string | null> => {
    clearTimeout(timeoutId);
    
    // Skip if too short
    if (typeof value === 'string' && value.length < minLength) {
      error.value = null;
      return null;
    }
    
    return new Promise((resolve) => {
      timeoutId = setTimeout(async () => {
        isValidating.value = true;
        try {
          const result = await validator(value);
          error.value = result;
          resolve(result);
        } catch (e) {
          error.value = 'Validation failed';
          resolve('Validation failed');
        } finally {
          isValidating.value = false;
        }
      }, debounceMs);
    });
  };
  
  return {
    validate,
    isValidating,
    error
  };
}

// =============================================================================
// USE FIELD ARRAY
// =============================================================================

/**
 * Composable for dynamic array fields
 * 
 * @example
 * ```vue
 * <script setup>
 * const { fields, push, remove, move } = useFieldArrayHelper('members');
 * </script>
 * 
 * <template>
 *   <div v-for="(field, idx) in fields" :key="field.key">
 *     <input v-model="field.value.name" />
 *     <button @click="remove(idx)">Remove</button>
 *   </div>
 *   <button @click="push({ name: '' })">Add Member</button>
 * </template>
 * ```
 */
export function useFieldArrayHelper<T = unknown>(name: string) {
  const { fields, push, remove, move, insert, update, replace } = useFieldArray<T>(name);
  
  return {
    fields,
    push,
    remove,
    move,
    insert,
    update,
    replace,
    
    /** Remove all items */
    clear: () => {
      while (fields.value.length > 0) {
        remove(0);
      }
    },
    
    /** Move item up */
    moveUp: (index: number) => {
      if (index > 0) {
        move(index, index - 1);
      }
    },
    
    /** Move item down */
    moveDown: (index: number) => {
      if (index < fields.value.length - 1) {
        move(index, index + 1);
      }
    }
  };
}

// =============================================================================
// USE FORM SUBMIT
// =============================================================================

/**
 * Composable for form submission with loading and error states
 * 
 * @example
 * ```vue
 * <script setup>
 * const { submit, isSubmitting, submitError, clearError } = useFormSubmit(
 *   handleSubmit,
 *   async (values) => {
 *     await api.createUser(values);
 *   }
 * );
 * </script>
 * 
 * <template>
 *   <form @submit="submit">
 *     <div v-if="submitError" class="error">{{ submitError }}</div>
 *     <button :disabled="isSubmitting">
 *       {{ isSubmitting ? 'Submitting...' : 'Submit' }}
 *     </button>
 *   </form>
 * </template>
 * ```
 */
export function useFormSubmit<T>(
  handleSubmit: (cb: (values: T) => void) => (e?: Event) => Promise<void>,
  onSubmit: (values: T) => Promise<void>
) {
  const isSubmitting = ref(false);
  const submitError = ref<string | null>(null);
  
  const submit = handleSubmit(async (values) => {
    isSubmitting.value = true;
    submitError.value = null;
    
    try {
      await onSubmit(values);
    } catch (e: any) {
      submitError.value = e.message || 'Submission failed';
    } finally {
      isSubmitting.value = false;
    }
  });
  
  return {
    submit,
    isSubmitting,
    submitError,
    clearError: () => { submitError.value = null; }
  };
}
