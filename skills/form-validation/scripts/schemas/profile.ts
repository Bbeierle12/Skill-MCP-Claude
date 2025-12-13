/**
 * Profile & Address Schemas
 * 
 * Zod schemas for user profiles, addresses, and contact information.
 * 
 * @module schemas/profile
 */

import { z } from 'zod';

// =============================================================================
// PHONE VALIDATION
// =============================================================================

/**
 * Phone number patterns by region
 */
export const PHONE_PATTERNS = {
  US: /^(\+1)?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/,
  INTL: /^\+?[\d\s.-]{10,20}$/,
  SIMPLE: /^[\d\s.-]+$/
} as const;

/**
 * Flexible phone schema (US format preferred)
 */
export const phoneSchema = z
  .string()
  .regex(PHONE_PATTERNS.US, 'Please enter a valid phone number (e.g., 555-123-4567)')
  .or(z.literal(''))
  .optional();

/**
 * International phone schema
 */
export const intlPhoneSchema = z
  .string()
  .regex(PHONE_PATTERNS.INTL, 'Please enter a valid phone number with country code')
  .optional();

// =============================================================================
// NAME SCHEMAS
// =============================================================================

/**
 * Name field schema
 */
const nameFieldSchema = z
  .string()
  .min(1, 'This field is required')
  .max(50, 'Name must be 50 characters or less')
  .regex(/^[a-zA-Z\s'-]+$/, 'Name can only contain letters, spaces, hyphens, and apostrophes');

/**
 * Full name as single field
 */
export const fullNameSchema = z.object({
  name: z
    .string()
    .min(1, 'Please enter your name')
    .max(100, 'Name must be 100 characters or less')
});

export type FullNameFormData = z.infer<typeof fullNameSchema>;

/**
 * Split first/last name
 */
export const splitNameSchema = z.object({
  firstName: nameFieldSchema.describe('First name'),
  lastName: nameFieldSchema.describe('Last name'),
  middleName: z
    .string()
    .max(50, 'Middle name must be 50 characters or less')
    .optional()
});

export type SplitNameFormData = z.infer<typeof splitNameSchema>;

// =============================================================================
// ADDRESS SCHEMAS
// =============================================================================

/**
 * US ZIP code patterns
 */
export const ZIP_PATTERNS = {
  US_5: /^\d{5}$/,
  US_9: /^\d{5}-\d{4}$/,
  US_ANY: /^\d{5}(-\d{4})?$/,
  CA: /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/,
  UK: /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/
} as const;

/**
 * US States for select dropdowns
 */
export const US_STATES = [
  { value: 'AL', label: 'Alabama' },
  { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' },
  { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' },
  { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' },
  { value: 'DE', label: 'Delaware' },
  { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' },
  { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' },
  { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' },
  { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' },
  { value: 'DC', label: 'District of Columbia' }
] as const;

const stateValues = US_STATES.map(s => s.value) as [string, ...string[]];

/**
 * US Address schema
 */
export const usAddressSchema = z.object({
  street: z
    .string()
    .min(1, 'Street address is required')
    .max(100, 'Street address must be 100 characters or less'),
  street2: z
    .string()
    .max(100, 'Apt/Suite must be 100 characters or less')
    .optional(),
  city: z
    .string()
    .min(1, 'City is required')
    .max(50, 'City must be 50 characters or less'),
  state: z
    .enum(stateValues, { errorMap: () => ({ message: 'Please select a state' }) }),
  zip: z
    .string()
    .regex(ZIP_PATTERNS.US_ANY, 'Please enter a valid ZIP code (e.g., 12345 or 12345-6789)'),
  country: z.literal('US').default('US')
});

export type USAddressFormData = z.infer<typeof usAddressSchema>;

/**
 * International address schema
 */
export const intlAddressSchema = z.object({
  street: z
    .string()
    .min(1, 'Street address is required'),
  street2: z.string().optional(),
  city: z
    .string()
    .min(1, 'City is required'),
  region: z
    .string()
    .min(1, 'State/Province/Region is required'),
  postalCode: z
    .string()
    .min(1, 'Postal code is required'),
  country: z
    .string()
    .min(1, 'Country is required')
    .length(2, 'Please use 2-letter country code (e.g., US, GB, CA)')
});

export type IntlAddressFormData = z.infer<typeof intlAddressSchema>;

// =============================================================================
// PROFILE SCHEMAS
// =============================================================================

/**
 * Basic profile schema
 */
export const basicProfileSchema = z.object({
  firstName: nameFieldSchema,
  lastName: nameFieldSchema,
  email: z
    .string()
    .email('Please enter a valid email address'),
  phone: phoneSchema
});

export type BasicProfileFormData = z.infer<typeof basicProfileSchema>;

/**
 * Extended profile with bio and website
 */
export const extendedProfileSchema = basicProfileSchema.extend({
  bio: z
    .string()
    .max(500, 'Bio must be 500 characters or less')
    .optional(),
  website: z
    .string()
    .url('Please enter a valid URL (e.g., https://example.com)')
    .or(z.literal(''))
    .optional(),
  company: z
    .string()
    .max(100, 'Company name must be 100 characters or less')
    .optional(),
  jobTitle: z
    .string()
    .max(100, 'Job title must be 100 characters or less')
    .optional()
});

export type ExtendedProfileFormData = z.infer<typeof extendedProfileSchema>;

/**
 * Full profile with address
 */
export const fullProfileSchema = extendedProfileSchema.extend({
  address: usAddressSchema.optional()
});

export type FullProfileFormData = z.infer<typeof fullProfileSchema>;

// =============================================================================
// CONTACT FORM
// =============================================================================

/**
 * Contact form schema
 */
export const contactFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Please enter your name'),
  email: z
    .string()
    .min(1, 'Please enter your email')
    .email('Please enter a valid email address'),
  phone: phoneSchema,
  subject: z
    .string()
    .min(1, 'Please select a subject')
    .optional(),
  message: z
    .string()
    .min(10, 'Message must be at least 10 characters')
    .max(2000, 'Message must be 2000 characters or less')
});

export type ContactFormData = z.infer<typeof contactFormSchema>;

// =============================================================================
// PREFERENCES
// =============================================================================

/**
 * Notification preferences
 */
export const notificationPreferencesSchema = z.object({
  emailNotifications: z.boolean().default(true),
  smsNotifications: z.boolean().default(false),
  pushNotifications: z.boolean().default(true),
  marketingEmails: z.boolean().default(false),
  weeklyDigest: z.boolean().default(true)
});

export type NotificationPreferencesFormData = z.infer<typeof notificationPreferencesSchema>;

/**
 * Privacy settings
 */
export const privacySettingsSchema = z.object({
  profileVisibility: z.enum(['public', 'private', 'contacts'], {
    errorMap: () => ({ message: 'Please select a visibility option' })
  }),
  showEmail: z.boolean().default(false),
  showPhone: z.boolean().default(false),
  allowSearchEngines: z.boolean().default(false)
});

export type PrivacySettingsFormData = z.infer<typeof privacySettingsSchema>;
