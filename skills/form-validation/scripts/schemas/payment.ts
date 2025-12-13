/**
 * Payment Schemas
 * 
 * Zod schemas for credit cards, billing addresses, and payment flows.
 * Includes Luhn algorithm validation for card numbers.
 * 
 * @module schemas/payment
 */

import { z } from 'zod';
import { usAddressSchema } from './profile';

// =============================================================================
// CARD VALIDATION UTILITIES
// =============================================================================

/**
 * Luhn algorithm for credit card validation
 * @param cardNumber - Card number (digits only)
 * @returns true if valid
 */
export function luhnCheck(cardNumber: string): boolean {
  // Remove any non-digits
  const digits = cardNumber.replace(/\D/g, '');
  
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  let sum = 0;
  let isEven = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i], 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

/**
 * Detect card type from number
 */
export function detectCardType(cardNumber: string): CardType | null {
  const digits = cardNumber.replace(/\D/g, '');
  
  if (/^4/.test(digits)) return 'visa';
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return 'mastercard';
  if (/^3[47]/.test(digits)) return 'amex';
  if (/^6(?:011|5)/.test(digits)) return 'discover';
  if (/^3(?:0[0-5]|[68])/.test(digits)) return 'diners';
  if (/^35/.test(digits)) return 'jcb';
  
  return null;
}

export type CardType = 'visa' | 'mastercard' | 'amex' | 'discover' | 'diners' | 'jcb';

/**
 * Card type display info
 */
export const CARD_INFO: Record<CardType, { name: string; cvvLength: number; numberLength: number[] }> = {
  visa: { name: 'Visa', cvvLength: 3, numberLength: [13, 16, 19] },
  mastercard: { name: 'Mastercard', cvvLength: 3, numberLength: [16] },
  amex: { name: 'American Express', cvvLength: 4, numberLength: [15] },
  discover: { name: 'Discover', cvvLength: 3, numberLength: [16, 19] },
  diners: { name: 'Diners Club', cvvLength: 3, numberLength: [14, 16, 19] },
  jcb: { name: 'JCB', cvvLength: 3, numberLength: [16, 19] }
};

/**
 * Check if expiry date is valid (not expired)
 */
export function isExpiryValid(month: number, year: number): boolean {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear() % 100; // 2-digit year
  
  if (year < currentYear) return false;
  if (year === currentYear && month < currentMonth) return false;
  
  return true;
}

/**
 * Parse expiry string (MM/YY) to month and year
 */
export function parseExpiry(expiry: string): { month: number; year: number } | null {
  const match = expiry.match(/^(\d{2})\/(\d{2})$/);
  if (!match) return null;
  
  const month = parseInt(match[1], 10);
  const year = parseInt(match[2], 10);
  
  if (month < 1 || month > 12) return null;
  
  return { month, year };
}

// =============================================================================
// CREDIT CARD SCHEMAS
// =============================================================================

/**
 * Card number schema with Luhn validation
 */
export const cardNumberSchema = z
  .string()
  .min(1, 'Card number is required')
  .transform(val => val.replace(/\s/g, '')) // Remove spaces
  .refine(val => /^\d{13,19}$/.test(val), 'Please enter a valid card number')
  .refine(luhnCheck, 'Please enter a valid card number');

/**
 * Expiry date schema (MM/YY format)
 */
export const expirySchema = z
  .string()
  .min(1, 'Expiry date is required')
  .regex(/^\d{2}\/\d{2}$/, 'Please enter expiry as MM/YY')
  .refine(val => {
    const parsed = parseExpiry(val);
    return parsed !== null;
  }, 'Invalid expiry date')
  .refine(val => {
    const parsed = parseExpiry(val);
    if (!parsed) return false;
    return isExpiryValid(parsed.month, parsed.year);
  }, 'Card has expired');

/**
 * CVV/CVC schema
 */
export const cvvSchema = z
  .string()
  .min(1, 'Security code is required')
  .regex(/^\d{3,4}$/, 'Please enter a valid security code');

/**
 * Name on card schema
 */
export const cardNameSchema = z
  .string()
  .min(1, 'Name on card is required')
  .max(50, 'Name must be 50 characters or less')
  .regex(/^[a-zA-Z\s'-]+$/, 'Please enter the name as it appears on the card');

/**
 * Complete credit card schema
 */
export const creditCardSchema = z.object({
  cardNumber: cardNumberSchema,
  cardName: cardNameSchema,
  expiry: expirySchema,
  cvv: cvvSchema
});

export type CreditCardFormData = z.infer<typeof creditCardSchema>;

/**
 * Credit card with split expiry fields
 */
export const creditCardSplitExpirySchema = z.object({
  cardNumber: cardNumberSchema,
  cardName: cardNameSchema,
  expMonth: z
    .string()
    .regex(/^(0[1-9]|1[0-2])$/, 'Invalid month'),
  expYear: z
    .string()
    .regex(/^\d{2}$/, 'Invalid year'),
  cvv: cvvSchema
}).refine(
  (data) => {
    const month = parseInt(data.expMonth, 10);
    const year = parseInt(data.expYear, 10);
    return isExpiryValid(month, year);
  },
  {
    message: 'Card has expired',
    path: ['expYear']
  }
);

export type CreditCardSplitExpiryFormData = z.infer<typeof creditCardSplitExpirySchema>;

// =============================================================================
// BILLING SCHEMAS
// =============================================================================

/**
 * Billing address (extends US address)
 */
export const billingAddressSchema = usAddressSchema;

export type BillingAddressFormData = z.infer<typeof billingAddressSchema>;

/**
 * Complete payment form (card + billing)
 */
export const paymentFormSchema = z.object({
  card: creditCardSchema,
  billingAddress: billingAddressSchema,
  sameAsShipping: z.boolean().default(false)
});

export type PaymentFormData = z.infer<typeof paymentFormSchema>;

/**
 * Payment form with conditional billing address
 */
export const paymentWithOptionalBillingSchema = z.object({
  card: creditCardSchema,
  sameAsShipping: z.boolean(),
  billingAddress: billingAddressSchema.optional()
}).refine(
  (data) => {
    if (!data.sameAsShipping && !data.billingAddress) {
      return false;
    }
    return true;
  },
  {
    message: 'Billing address is required',
    path: ['billingAddress']
  }
);

export type PaymentWithOptionalBillingFormData = z.infer<typeof paymentWithOptionalBillingSchema>;

// =============================================================================
// PAYMENT METHOD SELECTION
// =============================================================================

/**
 * Payment method types
 */
export const paymentMethodSchema = z.enum([
  'credit_card',
  'debit_card',
  'paypal',
  'apple_pay',
  'google_pay',
  'bank_transfer'
], {
  errorMap: () => ({ message: 'Please select a payment method' })
});

export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/**
 * Payment method selection form
 */
export const paymentMethodSelectionSchema = z.object({
  method: paymentMethodSchema,
  savePaymentMethod: z.boolean().default(false)
});

export type PaymentMethodSelectionFormData = z.infer<typeof paymentMethodSelectionSchema>;

// =============================================================================
// BANK ACCOUNT (ACH)
// =============================================================================

/**
 * Bank account types
 */
export const bankAccountTypeSchema = z.enum(['checking', 'savings'], {
  errorMap: () => ({ message: 'Please select an account type' })
});

/**
 * US Bank account (ACH)
 */
export const bankAccountSchema = z.object({
  accountHolderName: z
    .string()
    .min(1, 'Account holder name is required'),
  accountType: bankAccountTypeSchema,
  routingNumber: z
    .string()
    .regex(/^\d{9}$/, 'Routing number must be 9 digits'),
  accountNumber: z
    .string()
    .min(4, 'Account number is required')
    .max(17, 'Account number is too long')
    .regex(/^\d+$/, 'Account number must contain only digits'),
  confirmAccountNumber: z
    .string()
    .min(1, 'Please confirm account number')
}).refine(
  (data) => data.accountNumber === data.confirmAccountNumber,
  {
    message: 'Account numbers do not match',
    path: ['confirmAccountNumber']
  }
);

export type BankAccountFormData = z.infer<typeof bankAccountSchema>;

// =============================================================================
// CHECKOUT SCHEMAS
// =============================================================================

/**
 * Promo/coupon code
 */
export const promoCodeSchema = z.object({
  code: z
    .string()
    .min(1, 'Please enter a promo code')
    .max(20, 'Promo code is too long')
    .regex(/^[A-Z0-9]+$/, 'Promo code can only contain letters and numbers')
    .transform(val => val.toUpperCase())
});

export type PromoCodeFormData = z.infer<typeof promoCodeSchema>;

/**
 * Gift card
 */
export const giftCardSchema = z.object({
  cardNumber: z
    .string()
    .min(1, 'Gift card number is required')
    .regex(/^\d{16,19}$/, 'Please enter a valid gift card number'),
  pin: z
    .string()
    .regex(/^\d{4,8}$/, 'Please enter a valid PIN')
    .optional()
});

export type GiftCardFormData = z.infer<typeof giftCardSchema>;

// =============================================================================
// AMOUNT VALIDATION
// =============================================================================

/**
 * Currency amount schema
 */
export const amountSchema = z
  .number()
  .positive('Amount must be greater than 0')
  .multipleOf(0.01, 'Amount cannot have more than 2 decimal places');

/**
 * Donation amount form
 */
export const donationSchema = z.object({
  amount: z.union([
    z.literal(10),
    z.literal(25),
    z.literal(50),
    z.literal(100),
    amountSchema
  ]),
  isRecurring: z.boolean().default(false),
  frequency: z.enum(['monthly', 'quarterly', 'yearly']).optional()
}).refine(
  (data) => !data.isRecurring || data.frequency,
  {
    message: 'Please select a donation frequency',
    path: ['frequency']
  }
);

export type DonationFormData = z.infer<typeof donationSchema>;
