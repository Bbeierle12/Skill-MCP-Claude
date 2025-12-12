# Form Validation

## Schema-First with Zod

Define your validation schema first, derive types from it:

```typescript
import { z } from 'zod';

const userSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase letter')
    .regex(/[0-9]/, 'Must contain number'),
  confirmPassword: z.string(),
  age: z.coerce.number().min(18, 'Must be 18 or older'),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

type UserForm = z.infer<typeof userSchema>;
```

## Validation Strategies

### 1. On Submit (Default)
```typescript
const onSubmit = (data: unknown) => {
  const result = schema.safeParse(data);
  if (!result.success) {
    return result.error.flatten();
  }
  // Process valid data
};
```

### 2. On Blur (Field-level)
```typescript
const validateField = (name: string, value: unknown) => {
  const fieldSchema = schema.shape[name];
  return fieldSchema.safeParse(value);
};
```

### 3. On Change (Real-time)
```typescript
// Debounce for performance
const debouncedValidate = debounce((value) => {
  schema.safeParse(value);
}, 300);
```

## Async Validation

```typescript
const emailSchema = z.string().email().refine(
  async (email) => {
    const exists = await checkEmailExists(email);
    return !exists;
  },
  { message: 'Email already registered' }
);

// Use parseAsync for schemas with async refinements
const result = await emailSchema.parseAsync(email);
```

## Error Formatting

```typescript
const formatErrors = (error: z.ZodError) => {
  return error.issues.reduce((acc, issue) => {
    const path = issue.path.join('.');
    acc[path] = issue.message;
    return acc;
  }, {} as Record<string, string>);
};
```

## Common Patterns

### Optional with Default
```typescript
z.string().optional().default('')
```

### Conditional Validation
```typescript
z.discriminatedUnion('type', [
  z.object({ type: z.literal('email'), email: z.string().email() }),
  z.object({ type: z.literal('phone'), phone: z.string().regex(/^\d{10}$/) }),
])
```

### Transform and Validate
```typescript
z.string()
  .transform((val) => val.trim().toLowerCase())
  .pipe(z.string().email())
```
