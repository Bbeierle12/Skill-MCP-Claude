# Form Accessibility

## Core Principles

### 1. Labels and Instructions

Every form field must have an associated label:

```html
<!-- Explicit association -->
<label for="email">Email Address</label>
<input type="email" id="email" name="email" />

<!-- Implicit association -->
<label>
  Email Address
  <input type="email" name="email" />
</label>
```

### 2. ARIA Attributes

```html
<input
  type="email"
  id="email"
  aria-describedby="email-hint email-error"
  aria-invalid="true"
  aria-required="true"
/>
<span id="email-hint">We'll never share your email</span>
<span id="email-error" role="alert">Please enter a valid email</span>
```

### 3. Error Handling

- Use `role="alert"` for dynamic error messages
- Connect errors to fields with `aria-describedby`
- Set `aria-invalid="true"` on invalid fields
- Announce errors to screen readers immediately

```javascript
// Announce error to screen readers
const announceError = (message) => {
  const liveRegion = document.getElementById('live-region');
  liveRegion.textContent = message;
};
```

### 4. Focus Management

```javascript
// Focus first error on submit
const focusFirstError = (form) => {
  const firstError = form.querySelector('[aria-invalid="true"]');
  if (firstError) {
    firstError.focus();
  }
};
```

### 5. Keyboard Navigation

- All interactive elements must be keyboard accessible
- Tab order should follow visual order
- Custom components need proper `tabindex` and key handlers

## WCAG 2.1 Checklist

- [ ] 1.3.1: Labels programmatically associated
- [ ] 1.3.5: Autocomplete attributes for user data
- [ ] 2.1.1: All functionality keyboard accessible
- [ ] 2.4.6: Descriptive labels and instructions
- [ ] 3.3.1: Error identification
- [ ] 3.3.2: Labels or instructions provided
- [ ] 3.3.3: Error suggestions provided
- [ ] 4.1.2: Name, role, value for custom components
