# Vue Forms

## VeeValidate + Zod

The recommended stack for Vue forms:

```vue
<script setup lang="ts">
import { useForm } from 'vee-validate';
import { toTypedSchema } from '@vee-validate/zod';
import { z } from 'zod';

const schema = toTypedSchema(
  z.object({
    email: z.string().email('Invalid email'),
    password: z.string().min(8, 'Min 8 characters'),
  })
);

const { handleSubmit, errors, defineField, isSubmitting } = useForm({
  validationSchema: schema,
});

const [email, emailAttrs] = defineField('email');
const [password, passwordAttrs] = defineField('password');

const onSubmit = handleSubmit(async (values) => {
  await submitToAPI(values);
});
</script>

<template>
  <form @submit="onSubmit">
    <input v-model="email" v-bind="emailAttrs" type="email" />
    <span v-if="errors.email">{{ errors.email }}</span>

    <input v-model="password" v-bind="passwordAttrs" type="password" />
    <span v-if="errors.password">{{ errors.password }}</span>

    <button type="submit" :disabled="isSubmitting">
      {{ isSubmitting ? 'Loading...' : 'Submit' }}
    </button>
  </form>
</template>
```

## Composition API Pattern

```vue
<script setup lang="ts">
import { useField, useForm } from 'vee-validate';

const { handleSubmit, resetForm } = useForm();

const { value: email, errorMessage: emailError } = useField('email',
  (value) => {
    if (!value) return 'Email is required';
    if (!/\S+@\S+\.\S+/.test(value)) return 'Invalid email';
    return true;
  }
);

const { value: password, errorMessage: passwordError } = useField('password',
  (value) => {
    if (!value) return 'Password is required';
    if (value.length < 8) return 'Min 8 characters';
    return true;
  }
);

const onSubmit = handleSubmit((values) => {
  console.log(values);
});
</script>
```

## FormKit (Alternative)

```vue
<script setup>
import { FormKit } from '@formkit/vue';

const submit = async (data) => {
  await saveToAPI(data);
};
</script>

<template>
  <FormKit type="form" @submit="submit">
    <FormKit
      type="email"
      name="email"
      label="Email"
      validation="required|email"
    />
    <FormKit
      type="password"
      name="password"
      label="Password"
      validation="required|length:8"
    />
  </FormKit>
</template>
```

## Dynamic Forms

```vue
<script setup lang="ts">
import { useFieldArray, useForm } from 'vee-validate';

const { handleSubmit } = useForm({
  initialValues: {
    items: [{ name: '' }],
  },
});

const { fields, push, remove } = useFieldArray('items');
</script>

<template>
  <form @submit="handleSubmit">
    <div v-for="(field, idx) in fields" :key="field.key">
      <input v-model="field.value.name" />
      <button type="button" @click="remove(idx)">Remove</button>
    </div>
    <button type="button" @click="push({ name: '' })">Add</button>
  </form>
</template>
```

## Async Validation

```typescript
import { useField } from 'vee-validate';

const { value: username, errorMessage } = useField('username', async (value) => {
  if (!value) return 'Required';

  // Debounce built-in
  const exists = await checkUsername(value);
  if (exists) return 'Username taken';

  return true;
}, {
  validateOnValueUpdate: true,
});
```

## Form-Level Validation

```typescript
const { handleSubmit, setErrors } = useForm();

const onSubmit = handleSubmit(async (values) => {
  try {
    await submitToAPI(values);
  } catch (error) {
    // Set server-side errors
    setErrors({
      email: 'Email already registered',
    });
  }
});
```
