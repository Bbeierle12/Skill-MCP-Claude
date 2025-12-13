/**
 * Authentication Schemas
 * 
 * Zod schemas for login, registration, password reset, and 2FA flows.
 * All schemas follow the "specific, actionable error messages" principle.
 * 
 * @module schemas/auth
 */

import { z } from 'zod';

// =============================================================================
// PASSWORD VALIDATION
// =============================================================================

/**
 * Password requirements configuration
 * Adjust these based on your security requirements
 */
export const PASSWORD_REQUIREMENTS = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: false
} as const;

/**
 * Base password schema with configurable requirements
 */
export const passwordSchema = z
  .string()
  .min(1, 'Please create a password')
  .min(PASSWORD_REQUIREMENTS.minLength, `Password must be at least ${PASSWORD_REQUIREMENTS.minLength} characters`)
  .max(PASSWORD_REQUIREMENTS.maxLength, `Password must be ${PASSWORD_REQUIREMENTS.maxLength} characters or less`)
  .refine(
    (val) => !PASSWORD_REQUIREMENTS.requireUppercase || /[A-Z]/.test(val),
    'Include at least one uppercase letter'
  )
  .refine(
    (val) => !PASSWORD_REQUIREMENTS.requireLowercase || /[a-z]/.test(val),
    'Include at least one lowercase letter'
  )
  .refine(
    (val) => !PASSWORD_REQUIREMENTS.requireNumber || /[0-9]/.test(val),
    'Include at least one number'
  )
  .refine(
    (val) => !PASSWORD_REQUIREMENTS.requireSpecial || /[!@#$%^&*(),.?":{}|<>]/.test(val),
    'Include at least one special character'
  );

/**
 * Simple password (for login - no strength requirements)
 */
export const simplePasswordSchema = z
  .string()
  .min(1, 'Please enter your password');

// =============================================================================
// LOGIN
// =============================================================================

/**
 * Login form schema
 * 
 * @example
 * ```tsx
 * const { register } = useForm<LoginFormData>({
 *   resolver: zodResolver(loginSchema)
 * });
 * ```
 */
export const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Please enter your email')
    .email('Please enter a valid email address'),
  password: simplePasswordSchema,
  rememberMe: z.boolean().optional().default(false)
});

export type LoginFormData = z.infer<typeof loginSchema>;

// =============================================================================
// REGISTRATION
// =============================================================================

/**
 * Registration form schema with password confirmation
 * 
 * Uses refine for cross-field validation (password match)
 * 
 * @example
 * ```tsx
 * const { register } = useForm<RegistrationFormData>({
 *   resolver: zodResolver(registrationSchema)
 * });
 * ```
 */
export const registrationSchema = z.object({
  email: z
    .string()
    .min(1, 'Please enter your email')
    .email('Please enter a valid email address'),
  password: passwordSchema,
  confirmPassword: z
    .string()
    .min(1, 'Please confirm your password'),
  acceptTerms: z
    .boolean()
    .refine(val => val === true, 'You must accept the terms and conditions')
}).refine(
  (data) => data.password === data.confirmPassword,
  {
    message: 'Passwords do not match',
    path: ['confirmPassword']
  }
);

export type RegistrationFormData = z.infer<typeof registrationSchema>;

/**
 * Username-based registration (for platforms requiring usernames)
 */
export const usernameRegistrationSchema = registrationSchema.extend({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(20, 'Username must be 20 characters or less')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores')
});

export type UsernameRegistrationFormData = z.infer<typeof usernameRegistrationSchema>;

// =============================================================================
// PASSWORD RESET
// =============================================================================

/**
 * Forgot password (request reset)
 */
export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .min(1, 'Please enter your email')
    .email('Please enter a valid email address')
});

export type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

/**
 * Reset password (set new password)
 */
export const resetPasswordSchema = z.object({
  password: passwordSchema,
  confirmPassword: z
    .string()
    .min(1, 'Please confirm your password')
}).refine(
  (data) => data.password === data.confirmPassword,
  {
    message: 'Passwords do not match',
    path: ['confirmPassword']
  }
);

export type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

/**
 * Change password (when already logged in)
 */
export const changePasswordSchema = z.object({
  currentPassword: z
    .string()
    .min(1, 'Please enter your current password'),
  newPassword: passwordSchema,
  confirmNewPassword: z
    .string()
    .min(1, 'Please confirm your new password')
}).refine(
  (data) => data.newPassword === data.confirmNewPassword,
  {
    message: 'New passwords do not match',
    path: ['confirmNewPassword']
  }
).refine(
  (data) => data.currentPassword !== data.newPassword,
  {
    message: 'New password must be different from current password',
    path: ['newPassword']
  }
);

export type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;

// =============================================================================
// TWO-FACTOR AUTHENTICATION
// =============================================================================

/**
 * 2FA verification code
 */
export const twoFactorSchema = z.object({
  code: z
    .string()
    .min(1, 'Please enter the verification code')
    .regex(/^\d{6}$/, 'Code must be 6 digits'),
  rememberDevice: z.boolean().optional().default(false)
});

export type TwoFactorFormData = z.infer<typeof twoFactorSchema>;

/**
 * Backup code (when 2FA device unavailable)
 */
export const backupCodeSchema = z.object({
  code: z
    .string()
    .min(1, 'Please enter a backup code')
    .regex(/^[a-zA-Z0-9]{8,12}$/, 'Invalid backup code format')
});

export type BackupCodeFormData = z.infer<typeof backupCodeSchema>;

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Password strength calculator
 * Returns a score from 0-5 and a label
 */
export function calculatePasswordStrength(password: string): {
  score: number;
  label: 'weak' | 'fair' | 'good' | 'strong' | 'very-strong';
  feedback: string[];
} {
  const feedback: string[] = [];
  let score = 0;

  if (password.length >= 8) score++;
  else feedback.push('Use at least 8 characters');

  if (password.length >= 12) score++;

  if (/[A-Z]/.test(password)) score++;
  else feedback.push('Add uppercase letters');

  if (/[a-z]/.test(password)) score++;
  else feedback.push('Add lowercase letters');

  if (/[0-9]/.test(password)) score++;
  else feedback.push('Add numbers');

  if (/[^A-Za-z0-9]/.test(password)) score++;
  else feedback.push('Add special characters');

  const labels = ['weak', 'weak', 'fair', 'good', 'strong', 'very-strong'] as const;

  return {
    score,
    label: labels[Math.min(score, 5)],
    feedback
  };
}

/**
 * Validate password strength meets minimum requirements
 */
export function meetsPasswordRequirements(password: string): boolean {
  const result = passwordSchema.safeParse(password);
  return result.success;
}
