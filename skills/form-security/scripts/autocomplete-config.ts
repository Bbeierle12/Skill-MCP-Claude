/**
 * Autocomplete Configuration
 * 
 * Complete autocomplete attribute values for password manager compatibility.
 * Based on WHATWG HTML Standard: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill
 * 
 * @module autocomplete-config
 */

// =============================================================================
// AUTOCOMPLETE VALUES
// =============================================================================

/**
 * Complete autocomplete attribute values
 * 
 * @example
 * ```tsx
 * import { AUTOCOMPLETE } from './autocomplete-config';
 * 
 * <input type="email" autoComplete={AUTOCOMPLETE.email} />
 * <input type="password" autoComplete={AUTOCOMPLETE.currentPassword} />
 * ```
 */
export const AUTOCOMPLETE = {
  // =========================================================================
  // IDENTITY
  // =========================================================================
  
  /** Full name */
  name: 'name',
  
  /** Title/prefix (Mr., Mrs., Dr.) */
  honorificPrefix: 'honorific-prefix',
  
  /** First name */
  givenName: 'given-name',
  
  /** Middle name */
  additionalName: 'additional-name',
  
  /** Last name */
  familyName: 'family-name',
  
  /** Suffix (Jr., III) */
  honorificSuffix: 'honorific-suffix',
  
  /** Nickname */
  nickname: 'nickname',

  // =========================================================================
  // AUTHENTICATION (CRITICAL FOR PASSWORD MANAGERS)
  // =========================================================================
  
  /** Email address */
  email: 'email',
  
  /** Username */
  username: 'username',
  
  /**
   * Current/existing password - USE FOR LOGIN FORMS
   * Password managers will offer to fill existing credentials
   */
  currentPassword: 'current-password',
  
  /**
   * New password - USE FOR REGISTRATION AND PASSWORD RESET
   * Password managers will offer to generate a new password
   */
  newPassword: 'new-password',
  
  /**
   * One-time code - USE FOR 2FA/OTP FIELDS
   * Password managers and SMS autofill will recognize this
   */
  oneTimeCode: 'one-time-code',

  // =========================================================================
  // CONTACT - PHONE
  // =========================================================================
  
  /** Full phone number */
  tel: 'tel',
  
  /** Country code (e.g., +1) */
  telCountryCode: 'tel-country-code',
  
  /** National number (without country code) */
  telNational: 'tel-national',
  
  /** Area code */
  telAreaCode: 'tel-area-code',
  
  /** Local number */
  telLocal: 'tel-local',
  
  /** Extension */
  telExtension: 'tel-extension',

  // =========================================================================
  // ADDRESS
  // =========================================================================
  
  /** Full street address (may be multiline) */
  streetAddress: 'street-address',
  
  /** Street address line 1 */
  addressLine1: 'address-line1',
  
  /** Street address line 2 (Apt, Suite, etc.) */
  addressLine2: 'address-line2',
  
  /** Street address line 3 */
  addressLine3: 'address-line3',
  
  /** State, Province, Region */
  addressLevel1: 'address-level1',
  
  /** City */
  addressLevel2: 'address-level2',
  
  /** District */
  addressLevel3: 'address-level3',
  
  /** Neighborhood */
  addressLevel4: 'address-level4',
  
  /** ZIP/Postal code */
  postalCode: 'postal-code',
  
  /** Country code (ISO 3166-1 alpha-2) */
  country: 'country',
  
  /** Country name */
  countryName: 'country-name',

  // =========================================================================
  // PAYMENT (CRITICAL FOR CHECKOUT FORMS)
  // =========================================================================
  
  /** Full name on card */
  ccName: 'cc-name',
  
  /** First name on card */
  ccGivenName: 'cc-given-name',
  
  /** Last name on card */
  ccFamilyName: 'cc-family-name',
  
  /** Card number */
  ccNumber: 'cc-number',
  
  /** Expiry date (MM/YY or MM/YYYY) */
  ccExp: 'cc-exp',
  
  /** Expiry month */
  ccExpMonth: 'cc-exp-month',
  
  /** Expiry year */
  ccExpYear: 'cc-exp-year',
  
  /** Security code (CVV/CVC) */
  ccCsc: 'cc-csc',
  
  /** Card type (Visa, Mastercard, etc.) */
  ccType: 'cc-type',

  // =========================================================================
  // ORGANIZATION
  // =========================================================================
  
  /** Company/Organization name */
  organization: 'organization',
  
  /** Job title */
  organizationTitle: 'organization-title',

  // =========================================================================
  // DATES
  // =========================================================================
  
  /** Full birthday */
  bday: 'bday',
  
  /** Birthday day */
  bdayDay: 'bday-day',
  
  /** Birthday month */
  bdayMonth: 'bday-month',
  
  /** Birthday year */
  bdayYear: 'bday-year',

  // =========================================================================
  // OTHER
  // =========================================================================
  
  /** Gender */
  sex: 'sex',
  
  /** Website URL */
  url: 'url',
  
  /** Photo URL */
  photo: 'photo',
  
  /** Preferred language */
  language: 'language',
  
  /** Instant messaging handle */
  impp: 'impp',

  // =========================================================================
  // SPECIAL VALUES
  // =========================================================================
  
  /**
   * Disable autofill - USE SPARINGLY
   * Only for fields where autofill would be actively harmful
   * (e.g., CAPTCHA, security questions)
   */
  off: 'off',
  
  /** Enable autofill (default browser behavior) */
  on: 'on'
} as const;

export type AutocompleteValue = typeof AUTOCOMPLETE[keyof typeof AUTOCOMPLETE];

// =============================================================================
// AUTOCOMPLETE PRESETS
// =============================================================================

/**
 * Pre-configured autocomplete sets for common form types
 */
export const AUTOCOMPLETE_PRESETS = {
  /**
   * Login form fields
   */
  login: {
    email: AUTOCOMPLETE.email,
    username: AUTOCOMPLETE.username,
    password: AUTOCOMPLETE.currentPassword
  },
  
  /**
   * Registration form fields
   */
  registration: {
    email: AUTOCOMPLETE.email,
    username: AUTOCOMPLETE.username,
    password: AUTOCOMPLETE.newPassword,
    confirmPassword: AUTOCOMPLETE.newPassword
  },
  
  /**
   * Password reset fields
   */
  passwordReset: {
    password: AUTOCOMPLETE.newPassword,
    confirmPassword: AUTOCOMPLETE.newPassword
  },
  
  /**
   * Change password fields
   */
  changePassword: {
    currentPassword: AUTOCOMPLETE.currentPassword,
    newPassword: AUTOCOMPLETE.newPassword,
    confirmPassword: AUTOCOMPLETE.newPassword
  },
  
  /**
   * 2FA/OTP fields
   */
  twoFactor: {
    code: AUTOCOMPLETE.oneTimeCode
  },
  
  /**
   * Credit card fields
   */
  creditCard: {
    name: AUTOCOMPLETE.ccName,
    number: AUTOCOMPLETE.ccNumber,
    expiry: AUTOCOMPLETE.ccExp,
    expiryMonth: AUTOCOMPLETE.ccExpMonth,
    expiryYear: AUTOCOMPLETE.ccExpYear,
    cvc: AUTOCOMPLETE.ccCsc
  },
  
  /**
   * Shipping address fields
   */
  shippingAddress: {
    name: AUTOCOMPLETE.name,
    street: AUTOCOMPLETE.addressLine1,
    street2: AUTOCOMPLETE.addressLine2,
    city: AUTOCOMPLETE.addressLevel2,
    state: AUTOCOMPLETE.addressLevel1,
    zip: AUTOCOMPLETE.postalCode,
    country: AUTOCOMPLETE.country
  },
  
  /**
   * Billing address fields
   */
  billingAddress: {
    name: AUTOCOMPLETE.name,
    street: AUTOCOMPLETE.addressLine1,
    street2: AUTOCOMPLETE.addressLine2,
    city: AUTOCOMPLETE.addressLevel2,
    state: AUTOCOMPLETE.addressLevel1,
    zip: AUTOCOMPLETE.postalCode,
    country: AUTOCOMPLETE.country
  },
  
  /**
   * Contact form fields
   */
  contact: {
    name: AUTOCOMPLETE.name,
    email: AUTOCOMPLETE.email,
    phone: AUTOCOMPLETE.tel,
    company: AUTOCOMPLETE.organization
  },
  
  /**
   * Profile form fields
   */
  profile: {
    firstName: AUTOCOMPLETE.givenName,
    lastName: AUTOCOMPLETE.familyName,
    email: AUTOCOMPLETE.email,
    phone: AUTOCOMPLETE.tel,
    company: AUTOCOMPLETE.organization,
    jobTitle: AUTOCOMPLETE.organizationTitle,
    website: AUTOCOMPLETE.url
  }
} as const;

// =============================================================================
// DEPRECATED/AVOID VALUES
// =============================================================================

/**
 * Values to avoid or that have limited support
 */
export const DEPRECATED_AUTOCOMPLETE = {
  /** Use 'name' instead */
  fullName: 'full-name',
  
  /** Use addressLine1 + addressLine2 instead */
  streetAddress: 'street-address',
  
  /** Inconsistent browser support */
  transactionCurrency: 'transaction-currency',
  transactionAmount: 'transaction-amount'
} as const;

// =============================================================================
// SECTION MODIFIERS
// =============================================================================

/**
 * Section modifiers for forms with multiple address sets
 * 
 * @example
 * ```tsx
 * // Shipping address
 * <input autoComplete="shipping address-line1" />
 * 
 * // Billing address
 * <input autoComplete="billing address-line1" />
 * ```
 */
export const AUTOCOMPLETE_SECTIONS = {
  shipping: 'shipping',
  billing: 'billing'
} as const;

/**
 * Create a sectioned autocomplete value
 * 
 * @example
 * ```tsx
 * const shippingStreet = withSection('shipping', AUTOCOMPLETE.addressLine1);
 * // Returns: "shipping address-line1"
 * ```
 */
export function withSection(
  section: keyof typeof AUTOCOMPLETE_SECTIONS,
  value: AutocompleteValue
): string {
  return `${section} ${value}`;
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Check if a value is a valid autocomplete attribute
 */
export function isValidAutocomplete(value: string): boolean {
  const allValues = Object.values(AUTOCOMPLETE);
  
  // Check direct match
  if (allValues.includes(value as AutocompleteValue)) {
    return true;
  }
  
  // Check sectioned value (e.g., "shipping address-line1")
  const parts = value.split(' ');
  if (parts.length === 2) {
    const [section, base] = parts;
    if (
      Object.values(AUTOCOMPLETE_SECTIONS).includes(section as any) &&
      allValues.includes(base as AutocompleteValue)
    ) {
      return true;
    }
  }
  
  return false;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the appropriate autocomplete value for a password field
 * based on the form context
 */
export function getPasswordAutocomplete(
  context: 'login' | 'registration' | 'reset' | 'change-current' | 'change-new'
): AutocompleteValue {
  switch (context) {
    case 'login':
    case 'change-current':
      return AUTOCOMPLETE.currentPassword;
    case 'registration':
    case 'reset':
    case 'change-new':
      return AUTOCOMPLETE.newPassword;
    default:
      return AUTOCOMPLETE.currentPassword;
  }
}

/**
 * Get autocomplete attribute with section prefix
 * for forms with multiple addresses
 */
export function getAddressAutocomplete(
  field: keyof typeof AUTOCOMPLETE_PRESETS.shippingAddress,
  section?: 'shipping' | 'billing'
): string {
  const baseValue = AUTOCOMPLETE_PRESETS.shippingAddress[field];
  return section ? `${section} ${baseValue}` : baseValue;
}
