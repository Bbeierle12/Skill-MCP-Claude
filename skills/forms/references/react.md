# React Forms

## React Hook Form + Zod

The recommended stack for React forms:

```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

type FormData = z.infer<typeof schema>;

function LoginForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    await submitToAPI(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('email')} type="email" />
      {errors.email && <span>{errors.email.message}</span>}

      <input {...register('password')} type="password" />
      {errors.password && <span>{errors.password.message}</span>}

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Loading...' : 'Submit'}
      </button>
    </form>
  );
}
```

## TanStack Form

For more complex forms with fine-grained control:

```typescript
import { useForm } from '@tanstack/react-form';
import { zodValidator } from '@tanstack/zod-form-adapter';

function ComplexForm() {
  const form = useForm({
    defaultValues: {
      email: '',
      password: '',
    },
    onSubmit: async ({ value }) => {
      await submitToAPI(value);
    },
    validatorAdapter: zodValidator(),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <form.Field
        name="email"
        validators={{
          onChange: z.string().email(),
        }}
      >
        {(field) => (
          <>
            <input
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
            />
            {field.state.meta.errors && (
              <span>{field.state.meta.errors.join(', ')}</span>
            )}
          </>
        )}
      </form.Field>
    </form>
  );
}
```

## Controlled vs Uncontrolled

### Uncontrolled (React Hook Form default)
```typescript
// Better performance - DOM manages state
<input {...register('name')} />
```

### Controlled (When needed)
```typescript
// Use when you need to transform or react to values
const { control } = useForm();

<Controller
  name="price"
  control={control}
  render={({ field }) => (
    <CurrencyInput
      value={field.value}
      onChange={(v) => field.onChange(parseFloat(v))}
    />
  )}
/>
```

## Form Arrays

```typescript
import { useFieldArray } from 'react-hook-form';

function DynamicForm() {
  const { control, register } = useForm({
    defaultValues: {
      items: [{ name: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'items',
  });

  return (
    <>
      {fields.map((field, index) => (
        <div key={field.id}>
          <input {...register(`items.${index}.name`)} />
          <button type="button" onClick={() => remove(index)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={() => append({ name: '' })}>
        Add Item
      </button>
    </>
  );
}
```

## Server Actions (React 19+)

```typescript
'use server';

import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
});

export async function submitForm(formData: FormData) {
  const data = Object.fromEntries(formData);
  const result = schema.safeParse(data);

  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  // Process valid data
  return { success: true };
}
```

```typescript
'use client';

import { useActionState } from 'react';
import { submitForm } from './actions';

function Form() {
  const [state, action, pending] = useActionState(submitForm, null);

  return (
    <form action={action}>
      <input name="email" type="email" />
      {state?.errors?.email && <span>{state.errors.email}</span>}
      <button disabled={pending}>Submit</button>
    </form>
  );
}
```
