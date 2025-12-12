# Form Security

## CSRF Protection

### Token-Based Protection

```html
<form method="POST" action="/submit">
  <input type="hidden" name="_csrf" value="{{ csrfToken }}" />
  <!-- form fields -->
</form>
```

```javascript
// Server-side validation
app.post('/submit', (req, res) => {
  if (req.body._csrf !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  // Process form
});
```

### SameSite Cookies

```javascript
// Set cookies with SameSite attribute
res.cookie('session', sessionId, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict'
});
```

## XSS Prevention

### Input Sanitization

```typescript
import DOMPurify from 'dompurify';

const sanitizeInput = (input: string): string => {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [], // Strip all HTML
    ALLOWED_ATTR: []
  });
};
```

### Output Encoding

```typescript
const encodeHTML = (str: string): string => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};
```

## Secure Password Handling

### Autocomplete Attributes

```html
<!-- Current password (login) -->
<input type="password" autocomplete="current-password" />

<!-- New password (registration/change) -->
<input type="password" autocomplete="new-password" />

<!-- Confirm password -->
<input type="password" autocomplete="new-password" />
```

### Password Visibility Toggle

```html
<div class="password-field">
  <input type="password" id="password" />
  <button type="button" aria-label="Show password" onclick="togglePassword()">
    <span aria-hidden="true">Show</span>
  </button>
</div>
```

### Client-Side Hashing (Optional Extra Layer)

```typescript
// Note: Server should still hash - this is defense in depth
const hashPassword = async (password: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};
```

## Rate Limiting

```typescript
const rateLimiter = new Map<string, number[]>();

const checkRateLimit = (ip: string, limit = 5, window = 60000): boolean => {
  const now = Date.now();
  const attempts = rateLimiter.get(ip) || [];
  const recentAttempts = attempts.filter(t => now - t < window);

  if (recentAttempts.length >= limit) {
    return false;
  }

  rateLimiter.set(ip, [...recentAttempts, now]);
  return true;
};
```

## Security Checklist

- [ ] CSRF tokens on all state-changing forms
- [ ] Input validation on both client and server
- [ ] Output encoding for user-generated content
- [ ] Secure autocomplete attributes
- [ ] Rate limiting on sensitive endpoints
- [ ] HTTPS only for form submissions
- [ ] HttpOnly and Secure cookie flags
