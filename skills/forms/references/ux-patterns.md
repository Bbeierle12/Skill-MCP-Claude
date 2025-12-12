# Form UX Patterns

## Multi-Step Wizard

### State Management

```typescript
interface WizardState {
  currentStep: number;
  totalSteps: number;
  data: Record<string, unknown>;
  completedSteps: Set<number>;
}

function createWizard(totalSteps: number) {
  const state: WizardState = {
    currentStep: 0,
    totalSteps,
    data: {},
    completedSteps: new Set(),
  };

  return {
    next: () => {
      if (state.currentStep < totalSteps - 1) {
        state.completedSteps.add(state.currentStep);
        state.currentStep++;
      }
    },
    prev: () => {
      if (state.currentStep > 0) {
        state.currentStep--;
      }
    },
    goTo: (step: number) => {
      if (step <= Math.max(...state.completedSteps) + 1) {
        state.currentStep = step;
      }
    },
    updateData: (data: Record<string, unknown>) => {
      state.data = { ...state.data, ...data };
    },
    getState: () => ({ ...state }),
  };
}
```

### Progress Indicator

```html
<nav aria-label="Progress">
  <ol class="wizard-steps">
    <li class="step completed" aria-current="false">
      <span class="step-number">1</span>
      <span class="step-label">Account</span>
    </li>
    <li class="step current" aria-current="step">
      <span class="step-number">2</span>
      <span class="step-label">Profile</span>
    </li>
    <li class="step" aria-current="false">
      <span class="step-number">3</span>
      <span class="step-label">Review</span>
    </li>
  </ol>
</nav>
```

## Conditional Fields

### Show/Hide Pattern

```typescript
const schema = z.discriminatedUnion('contactMethod', [
  z.object({
    contactMethod: z.literal('email'),
    email: z.string().email(),
  }),
  z.object({
    contactMethod: z.literal('phone'),
    phone: z.string().regex(/^\d{10}$/),
  }),
]);

// React example
function ContactForm() {
  const { watch, register } = useForm();
  const contactMethod = watch('contactMethod');

  return (
    <>
      <select {...register('contactMethod')}>
        <option value="email">Email</option>
        <option value="phone">Phone</option>
      </select>

      {contactMethod === 'email' && (
        <input {...register('email')} type="email" />
      )}

      {contactMethod === 'phone' && (
        <input {...register('phone')} type="tel" />
      )}
    </>
  );
}
```

## Progressive Disclosure

### Accordion Sections

```html
<form>
  <fieldset>
    <legend>
      <button type="button" aria-expanded="true" aria-controls="basic-info">
        Basic Information
      </button>
    </legend>
    <div id="basic-info">
      <!-- Basic fields -->
    </div>
  </fieldset>

  <fieldset>
    <legend>
      <button type="button" aria-expanded="false" aria-controls="advanced">
        Advanced Options (Optional)
      </button>
    </legend>
    <div id="advanced" hidden>
      <!-- Advanced fields -->
    </div>
  </fieldset>
</form>
```

## Inline Validation Timing

### Best Practices

1. **Validate on blur** for fields user has interacted with
2. **Validate on submit** for untouched fields
3. **Clear errors on valid input** immediately
4. **Debounce real-time validation** (300ms)

```typescript
const validationTiming = {
  // Validate after user leaves field
  onBlur: true,

  // Only validate dirty fields on change
  onChange: (isDirty: boolean) => isDirty,

  // Always validate on submit
  onSubmit: true,

  // Real-time for critical fields (debounced)
  realTime: ['username', 'email'], // async availability checks
};
```

## Error Recovery

### Inline Error Messages

```html
<div class="field">
  <label for="email">Email</label>
  <input
    type="email"
    id="email"
    aria-describedby="email-error"
    aria-invalid="true"
  />
  <p id="email-error" class="error" role="alert">
    Please enter a valid email address (e.g., name@example.com)
  </p>
</div>
```

### Error Summary

```html
<div role="alert" aria-labelledby="error-summary-title">
  <h2 id="error-summary-title">There are 2 problems with your submission</h2>
  <ul>
    <li><a href="#email">Email - Enter a valid email address</a></li>
    <li><a href="#password">Password - Must be at least 8 characters</a></li>
  </ul>
</div>
```

## Auto-Save

```typescript
function useAutoSave(form, saveInterval = 30000) {
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      const data = form.getValues();
      await saveDraft(data);
      setLastSaved(new Date());
    }, saveInterval);

    return () => clearInterval(interval);
  }, []);

  // Also save on blur
  useEffect(() => {
    const handleBlur = async () => {
      const data = form.getValues();
      await saveDraft(data);
      setLastSaved(new Date());
    };

    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, []);

  return lastSaved;
}
```

## Loading States

```typescript
function SubmitButton({ isSubmitting }: { isSubmitting: boolean }) {
  return (
    <button type="submit" disabled={isSubmitting}>
      {isSubmitting ? (
        <>
          <Spinner aria-hidden="true" />
          <span>Submitting...</span>
          <span className="sr-only">Please wait</span>
        </>
      ) : (
        'Submit'
      )}
    </button>
  );
}
```
