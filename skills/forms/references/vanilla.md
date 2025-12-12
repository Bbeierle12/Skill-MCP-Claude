# Vanilla JavaScript Forms

## Basic Form Handling

```javascript
const form = document.getElementById('myForm');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(form);
  const data = Object.fromEntries(formData);

  // Validate
  const errors = validateForm(data);
  if (Object.keys(errors).length > 0) {
    displayErrors(errors);
    return;
  }

  // Submit
  await submitForm(data);
});
```

## Validation with Zod

```javascript
import { z } from 'zod';

const schema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Min 8 characters'),
});

function validateForm(data) {
  const result = schema.safeParse(data);

  if (result.success) {
    return {};
  }

  return result.error.flatten().fieldErrors;
}
```

## Constraint Validation API

```javascript
const form = document.getElementById('myForm');
const emailInput = document.getElementById('email');

// Custom validation
emailInput.addEventListener('input', () => {
  if (emailInput.validity.typeMismatch) {
    emailInput.setCustomValidity('Please enter a valid email');
  } else {
    emailInput.setCustomValidity('');
  }
});

// Check validity
form.addEventListener('submit', (e) => {
  if (!form.checkValidity()) {
    e.preventDefault();
    form.reportValidity();
  }
});
```

## Error Display

```javascript
function displayErrors(errors) {
  // Clear previous errors
  document.querySelectorAll('.error').forEach(el => {
    el.textContent = '';
    el.previousElementSibling?.removeAttribute('aria-invalid');
  });

  // Display new errors
  for (const [field, messages] of Object.entries(errors)) {
    const input = document.querySelector(`[name="${field}"]`);
    const errorEl = document.querySelector(`#${field}-error`);

    if (input && errorEl) {
      input.setAttribute('aria-invalid', 'true');
      errorEl.textContent = messages[0];
    }
  }

  // Focus first error
  const firstError = document.querySelector('[aria-invalid="true"]');
  firstError?.focus();
}
```

## Real-Time Validation

```javascript
function setupRealTimeValidation(form, schema) {
  const fields = form.querySelectorAll('input, select, textarea');

  fields.forEach(field => {
    field.addEventListener('blur', () => {
      validateField(field, schema);
    });

    // Debounced validation on input
    let timeout;
    field.addEventListener('input', () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => validateField(field, schema), 300);
    });
  });
}

function validateField(field, schema) {
  const fieldSchema = schema.shape[field.name];
  if (!fieldSchema) return;

  const result = fieldSchema.safeParse(field.value);
  const errorEl = document.querySelector(`#${field.name}-error`);

  if (result.success) {
    field.removeAttribute('aria-invalid');
    if (errorEl) errorEl.textContent = '';
  } else {
    field.setAttribute('aria-invalid', 'true');
    if (errorEl) errorEl.textContent = result.error.issues[0].message;
  }
}
```

## Form Serialization

```javascript
// Get all form data as object
function serializeForm(form) {
  const formData = new FormData(form);
  const data = {};

  for (const [key, value] of formData.entries()) {
    // Handle multiple values (checkboxes, multi-select)
    if (data[key]) {
      if (Array.isArray(data[key])) {
        data[key].push(value);
      } else {
        data[key] = [data[key], value];
      }
    } else {
      data[key] = value;
    }
  }

  return data;
}

// Populate form from object
function populateForm(form, data) {
  for (const [key, value] of Object.entries(data)) {
    const input = form.querySelector(`[name="${key}"]`);
    if (!input) continue;

    if (input.type === 'checkbox') {
      input.checked = Boolean(value);
    } else if (input.type === 'radio') {
      form.querySelector(`[name="${key}"][value="${value}"]`).checked = true;
    } else {
      input.value = value;
    }
  }
}
```

## Async Submission

```javascript
async function submitForm(form, url) {
  const submitBtn = form.querySelector('[type="submit"]');
  const originalText = submitBtn.textContent;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serializeForm(form)),
    });

    if (!response.ok) {
      const errorData = await response.json();
      displayErrors(errorData.errors);
      return { success: false };
    }

    return { success: true, data: await response.json() };
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}
```
