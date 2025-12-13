# Forms Integration Guide

Complete patterns for wiring form skills together.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      forms-router                           │
│                  (lightweight dispatcher)                   │
└──────┬──────────┬──────────┬──────────┬──────────┬─────────┘
       │          │          │          │          │
       ▼          ▼          ▼          ▼          ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│  form-   │ │  form-   │ │  form-   │ │  form-   │ │  form-   │
│validation│ │access-   │ │  react   │ │ security │ │   ux-    │
│          │ │ibility   │ │          │ │          │ │ patterns │
└──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘
     ▲            ▲            ▲            ▲            ▲
     │            │            │            │            │
     └────────────┴────────────┴────────────┴────────────┘
                    Shared: Zod Schemas
```

## Data Flow

```
User Input
    │
    ▼
┌─────────────────┐
│ Security Layer  │  autocomplete, CSRF token
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Validation      │  Zod schema check
│ (timing logic)  │  Reward early, punish late
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Accessibility   │  ARIA bindings, focus
│ Layer           │  management, announcements
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Framework       │  React/Vue/Vanilla
│ Integration     │  state management
└────────┬────────┘
         │
         ▼
   Form Submission
```

## Complete Integration Examples

### Example 1: Production Login Form (React)

```typescript
// schemas/auth.ts (form-validation)
import { z } from 'zod';

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Please enter your email')
    .email('Please enter a valid email'),
  password: z
    .string()
    .min(1, 'Please enter your password'),
  rememberMe: z.boolean().optional().default(false)
});

export type LoginFormData = z.infer<typeof loginSchema>;
```

```typescript
// config/autocomplete.ts (form-security)
export const AUTOCOMPLETE = {
  email: 'email',
  currentPassword: 'current-password',
  newPassword: 'new-password',
  oneTimeCode: 'one-time-code'
} as const;
```

```tsx
// components/FormField.tsx (form-accessibility)
import { ReactNode } from 'react';

interface FormFieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  touched?: boolean;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}

export function FormField({
  label,
  htmlFor,
  error,
  touched,
  hint,
  required,
  children
}: FormFieldProps) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;
  const showError = touched && !!error;
  const showValid = touched && !error;

  return (
    <div className={`form-field ${showError ? 'has-error' : ''} ${showValid ? 'is-valid' : ''}`}>
      <label htmlFor={htmlFor}>
        {label}
        {required && <span className="required" aria-hidden="true">*</span>}
      </label>
      
      {hint && (
        <span id={hintId} className="hint">{hint}</span>
      )}
      
      <div className="input-wrapper">
        {children}
        {showValid && <CheckIcon className="valid-icon" aria-hidden="true" />}
        {showError && <AlertIcon className="error-icon" aria-hidden="true" />}
      </div>
      
      {showError && (
        <span id={errorId} className="error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
```

```tsx
// components/LoginForm.tsx (form-react + all integrations)
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginFormData } from '../schemas/auth';
import { AUTOCOMPLETE } from '../config/autocomplete';
import { FormField } from './FormField';

interface LoginFormProps {
  onSubmit: (data: LoginFormData) => Promise<void>;
}

export function LoginForm({ onSubmit }: LoginFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, touchedFields, isSubmitting }
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    mode: 'onBlur',           // Punish late
    reValidateMode: 'onChange' // Real-time correction
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <FormField
        label="Email"
        htmlFor="email"
        error={errors.email?.message}
        touched={touchedFields.email}
        required
      >
        <input
          id="email"
          type="email"
          autoComplete={AUTOCOMPLETE.email}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'email-error' : undefined}
          {...register('email')}
        />
      </FormField>

      <FormField
        label="Password"
        htmlFor="password"
        error={errors.password?.message}
        touched={touchedFields.password}
        required
      >
        <input
          id="password"
          type="password"
          autoComplete={AUTOCOMPLETE.currentPassword}
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'password-error' : undefined}
          {...register('password')}
        />
      </FormField>

      <div className="form-field checkbox">
        <label>
          <input type="checkbox" {...register('rememberMe')} />
          Remember me
        </label>
      </div>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  );
}
```

### Example 2: Registration Form with Password Strength

```typescript
// schemas/registration.ts (form-validation)
import { z } from 'zod';

const passwordSchema = z
  .string()
  .min(1, 'Password is required')
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Include at least one uppercase letter')
  .regex(/[a-z]/, 'Include at least one lowercase letter')
  .regex(/[0-9]/, 'Include at least one number');

export const registrationSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Please enter a valid email'),
  password: passwordSchema,
  confirmPassword: z.string().min(1, 'Please confirm your password'),
  acceptTerms: z
    .boolean()
    .refine(val => val === true, 'You must accept the terms')
}).refine(data => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
});

export type RegistrationFormData = z.infer<typeof registrationSchema>;
```

```tsx
// components/PasswordStrength.tsx (form-ux-patterns)
import { useMemo } from 'react';

interface PasswordStrengthProps {
  password: string;
}

export function PasswordStrength({ password }: PasswordStrengthProps) {
  const strength = useMemo(() => {
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    
    if (score <= 2) return { label: 'Weak', color: 'red', width: '33%' };
    if (score <= 4) return { label: 'Medium', color: 'orange', width: '66%' };
    return { label: 'Strong', color: 'green', width: '100%' };
  }, [password]);

  if (!password) return null;

  return (
    <div className="password-strength" aria-live="polite">
      <div className="strength-bar">
        <div 
          className="strength-fill" 
          style={{ width: strength.width, backgroundColor: strength.color }}
        />
      </div>
      <span className="strength-label">{strength.label}</span>
    </div>
  );
}
```

```tsx
// components/RegistrationForm.tsx
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registrationSchema, type RegistrationFormData } from '../schemas/registration';
import { AUTOCOMPLETE } from '../config/autocomplete';
import { FormField } from './FormField';
import { PasswordStrength } from './PasswordStrength';

export function RegistrationForm({ onSubmit }) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, touchedFields, isSubmitting }
  } = useForm<RegistrationFormData>({
    resolver: zodResolver(registrationSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange'
  });

  // Watch password for strength meter (real-time feedback)
  const password = useWatch({ control, name: 'password', defaultValue: '' });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <FormField
        label="Email"
        htmlFor="email"
        error={errors.email?.message}
        touched={touchedFields.email}
        required
      >
        <input
          id="email"
          type="email"
          autoComplete={AUTOCOMPLETE.email}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'email-error' : undefined}
          {...register('email')}
        />
      </FormField>

      <FormField
        label="Password"
        htmlFor="password"
        error={errors.password?.message}
        touched={touchedFields.password}
        required
      >
        <input
          id="password"
          type="password"
          autoComplete={AUTOCOMPLETE.newPassword}  // CRITICAL: new-password
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'password-error' : 'password-strength'}
          {...register('password')}
        />
        <PasswordStrength password={password} />
      </FormField>

      <FormField
        label="Confirm Password"
        htmlFor="confirmPassword"
        error={errors.confirmPassword?.message}
        touched={touchedFields.confirmPassword}
        required
      >
        <input
          id="confirmPassword"
          type="password"
          autoComplete={AUTOCOMPLETE.newPassword}  // Same: new-password
          aria-invalid={!!errors.confirmPassword}
          aria-describedby={errors.confirmPassword ? 'confirmPassword-error' : undefined}
          {...register('confirmPassword')}
        />
      </FormField>

      <div className="form-field checkbox">
        <label>
          <input 
            type="checkbox" 
            {...register('acceptTerms')}
            aria-invalid={!!errors.acceptTerms}
          />
          I accept the <a href="/terms">Terms of Service</a>
        </label>
        {errors.acceptTerms && (
          <span className="error" role="alert">
            {errors.acceptTerms.message}
          </span>
        )}
      </div>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creating account...' : 'Create account'}
      </button>
    </form>
  );
}
```

### Example 3: Multi-Step Checkout (form-ux-patterns)

```typescript
// schemas/checkout.ts (form-validation)
import { z } from 'zod';

export const contactSchema = z.object({
  email: z.string().email('Valid email required'),
  phone: z.string().min(10, 'Valid phone required')
});

export const shippingSchema = z.object({
  fullName: z.string().min(1, 'Name required'),
  street: z.string().min(1, 'Address required'),
  city: z.string().min(1, 'City required'),
  state: z.string().min(1, 'State required'),
  zip: z.string().regex(/^\d{5}(-\d{4})?$/, 'Valid ZIP required'),
  country: z.string().min(1, 'Country required')
});

export const paymentSchema = z.object({
  cardName: z.string().min(1, 'Name on card required'),
  cardNumber: z.string().regex(/^\d{16}$/, 'Valid card number required'),
  expiry: z.string().regex(/^\d{2}\/\d{2}$/, 'MM/YY format required'),
  cvc: z.string().regex(/^\d{3,4}$/, 'Valid CVC required')
});

// Combined for full validation
export const checkoutSchema = z.object({
  contact: contactSchema,
  shipping: shippingSchema,
  payment: paymentSchema
});

export type CheckoutFormData = z.infer<typeof checkoutSchema>;
```

```typescript
// config/checkout-steps.ts (form-ux-patterns)
export interface FormChunk {
  id: string;
  title: string;
  description: string;  // Briefing (separate from fields)
  fields: string[];     // Max 5-7 per chunk
  schema: z.ZodType;
}

export const checkoutSteps: FormChunk[] = [
  {
    id: 'contact',
    title: 'Contact Information',
    description: 'We\'ll use this to send your order confirmation and shipping updates.',
    fields: ['contact.email', 'contact.phone'],
    schema: contactSchema
  },
  {
    id: 'shipping',
    title: 'Shipping Address',
    description: 'Where should we send your order?',
    fields: ['shipping.fullName', 'shipping.street', 'shipping.city', 'shipping.state', 'shipping.zip', 'shipping.country'],
    schema: shippingSchema
  },
  {
    id: 'payment',
    title: 'Payment Method',
    description: 'Your payment information is encrypted and secure.',
    fields: ['payment.cardName', 'payment.cardNumber', 'payment.expiry', 'payment.cvc'],
    schema: paymentSchema
  }
];
```

```tsx
// components/MultiStepCheckout.tsx
import { useState } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { checkoutSchema, type CheckoutFormData } from '../schemas/checkout';
import { checkoutSteps } from '../config/checkout-steps';
import { StepIndicator } from './StepIndicator';
import { ContactStep, ShippingStep, PaymentStep, ReviewStep } from './steps';

const stepComponents = [ContactStep, ShippingStep, PaymentStep, ReviewStep];

export function MultiStepCheckout({ onSubmit }) {
  const [currentStep, setCurrentStep] = useState(0);
  
  const methods = useForm<CheckoutFormData>({
    resolver: zodResolver(checkoutSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      contact: { email: '', phone: '' },
      shipping: { fullName: '', street: '', city: '', state: '', zip: '', country: 'US' },
      payment: { cardName: '', cardNumber: '', expiry: '', cvc: '' }
    }
  });

  const step = checkoutSteps[currentStep];
  const isLastStep = currentStep === checkoutSteps.length;
  const StepComponent = stepComponents[currentStep];

  const handleNext = async () => {
    if (currentStep < checkoutSteps.length) {
      // Validate only current step's fields
      const isValid = await methods.trigger(step.fields as any);
      if (isValid) {
        setCurrentStep(prev => prev + 1);
        // Focus management: move focus to step heading
        document.getElementById('step-heading')?.focus();
      }
    }
  };

  const handleBack = () => {
    setCurrentStep(prev => prev - 1);
    document.getElementById('step-heading')?.focus();
  };

  const handleSubmitForm = methods.handleSubmit(onSubmit);

  return (
    <FormProvider {...methods}>
      <form onSubmit={handleSubmitForm} noValidate>
        <StepIndicator 
          steps={checkoutSteps.map(s => s.title)} 
          currentStep={currentStep} 
        />

        {!isLastStep && (
          <div className="step-header">
            <h2 id="step-heading" tabIndex={-1}>{step.title}</h2>
            <p className="step-description">{step.description}</p>
          </div>
        )}

        <div className="step-content">
          <StepComponent />
        </div>

        <div className="step-navigation">
          {currentStep > 0 && (
            <button type="button" onClick={handleBack}>
              Back
            </button>
          )}
          
          {isLastStep ? (
            <button type="submit" disabled={methods.formState.isSubmitting}>
              {methods.formState.isSubmitting ? 'Processing...' : 'Place Order'}
            </button>
          ) : (
            <button type="button" onClick={handleNext}>
              Continue
            </button>
          )}
        </div>
      </form>
    </FormProvider>
  );
}
```

### Example 4: Vue Form with VeeValidate

```typescript
// schemas/contact.ts (shared with Vue)
import { z } from 'zod';

export const contactSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Valid email required'),
  message: z.string().min(10, 'Message must be at least 10 characters')
});

export type ContactFormData = z.infer<typeof contactSchema>;
```

```vue
<!-- components/ContactForm.vue (form-vue) -->
<script setup lang="ts">
import { useForm, useField } from 'vee-validate';
import { toTypedSchema } from '@vee-validate/zod';
import { contactSchema, type ContactFormData } from '../schemas/contact';
import FormField from './FormField.vue';

const emit = defineEmits<{
  submit: [data: ContactFormData]
}>();

const { handleSubmit, meta } = useForm<ContactFormData>({
  validationSchema: toTypedSchema(contactSchema),
  validateOnMount: false
});

const { value: name, errorMessage: nameError, meta: nameMeta } = useField('name');
const { value: email, errorMessage: emailError, meta: emailMeta } = useField('email');
const { value: message, errorMessage: messageError, meta: messageMeta } = useField('message');

const onSubmit = handleSubmit((values) => {
  emit('submit', values);
});
</script>

<template>
  <form @submit="onSubmit" novalidate>
    <FormField
      label="Name"
      html-for="name"
      :error="nameError"
      :touched="nameMeta.touched"
      required
    >
      <input
        id="name"
        v-model="name"
        type="text"
        autocomplete="name"
        :aria-invalid="!!nameError"
        :aria-describedby="nameError ? 'name-error' : undefined"
      />
    </FormField>

    <FormField
      label="Email"
      html-for="email"
      :error="emailError"
      :touched="emailMeta.touched"
      required
    >
      <input
        id="email"
        v-model="email"
        type="email"
        autocomplete="email"
        :aria-invalid="!!emailError"
        :aria-describedby="emailError ? 'email-error' : undefined"
      />
    </FormField>

    <FormField
      label="Message"
      html-for="message"
      :error="messageError"
      :touched="messageMeta.touched"
      required
    >
      <textarea
        id="message"
        v-model="message"
        rows="5"
        :aria-invalid="!!messageError"
        :aria-describedby="messageError ? 'message-error' : undefined"
      />
    </FormField>

    <button type="submit" :disabled="meta.pending">
      Send Message
    </button>
  </form>
</template>
```

## Skill Cross-References

| When using... | Also reference... |
|---------------|-------------------|
| form-react | form-validation (Zod schemas), form-accessibility (ARIA), form-security (autocomplete) |
| form-vue | form-validation (Zod schemas), form-accessibility (ARIA) |
| form-vanilla | form-validation (Zod runtime), form-accessibility (manual ARIA) |
| form-ux-patterns | form-react or form-vue (form state), form-validation (per-step) |
| form-security | All others (autocomplete is universal) |
| form-accessibility | All others (a11y is universal) |

## Dependency Order

```
1. form-validation      (no dependencies - pure Zod)
2. form-security        (no dependencies - pure config)
3. form-accessibility   (depends on: validation for error states)
4. form-react           (depends on: validation, accessibility, security)
5. form-vue             (depends on: validation, accessibility, security)
6. form-vanilla         (depends on: validation, accessibility, security)
7. form-ux-patterns     (depends on: react/vue, validation)
```

## Testing Integration

```typescript
// Example test setup combining skills
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from './LoginForm';

describe('LoginForm Integration', () => {
  it('validates on blur (punish late)', async () => {
    render(<LoginForm onSubmit={jest.fn()} />);
    const emailInput = screen.getByLabelText(/email/i);
    
    // Type invalid email
    await userEvent.type(emailInput, 'invalid');
    
    // No error yet (reward early doesn't apply - no valid state)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    
    // Blur triggers validation (punish late)
    await userEvent.tab();
    
    // Now error appears
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/valid email/i);
    });
  });

  it('corrects in real-time after first error', async () => {
    render(<LoginForm onSubmit={jest.fn()} />);
    const emailInput = screen.getByLabelText(/email/i);
    
    // Trigger error
    await userEvent.type(emailInput, 'invalid');
    await userEvent.tab();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    
    // Focus back and correct
    await userEvent.click(emailInput);
    await userEvent.clear(emailInput);
    await userEvent.type(emailInput, 'valid@email.com');
    
    // Error clears in real-time (no blur needed)
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('has correct autocomplete attributes', () => {
    render(<LoginForm onSubmit={jest.fn()} />);
    
    expect(screen.getByLabelText(/email/i)).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('autocomplete', 'current-password');
  });

  it('has correct ARIA attributes', async () => {
    render(<LoginForm onSubmit={jest.fn()} />);
    const emailInput = screen.getByLabelText(/email/i);
    
    // Initially valid
    expect(emailInput).toHaveAttribute('aria-invalid', 'false');
    
    // After error
    await userEvent.type(emailInput, 'invalid');
    await userEvent.tab();
    
    await waitFor(() => {
      expect(emailInput).toHaveAttribute('aria-invalid', 'true');
      expect(emailInput).toHaveAttribute('aria-describedby', 'email-error');
    });
  });
});
```
