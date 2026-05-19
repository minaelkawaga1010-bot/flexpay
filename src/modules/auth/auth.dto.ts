import { z } from 'zod';
import {
  phoneSchema,
  emailSchema,
  passwordSchema,
  amountSchema,
} from '@shared/middleware/validator';

// =====================================================================
// Employee Auth
// =====================================================================

export const requestOtpSchema = z.object({
  phone: phoneSchema,
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  otp: z.string().length(6, 'OTP must be 6 digits').regex(/^\d{6}$/),
  // Required only when the phone has no employee yet — the service layer
  // enforces that distinction so the mobile app can split OTP entry and
  // profile setup into separate screens.
  fullName: z.string().min(2).max(100).optional(),
  salary: amountSchema.optional(),
  companyId: z.string().uuid().optional(),
  // Referrer's referral code is a cuid by default. Allow either format
  // because legacy/manual codes may use the alphanumeric helper format.
  referralCode: z
    .string()
    .min(6)
    .max(40)
    .optional(),
});

// =====================================================================
// Company Auth
// =====================================================================

export const companyRegisterSchema = z.object({
  name: z.string().min(2).max(100),
  tradeLicense: z.string().min(5).max(50),
  adminName: z.string().min(2).max(100),
  adminEmail: emailSchema,
  adminPhone: phoneSchema,
  password: passwordSchema,
});

export const companyLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

// =====================================================================
// Token refresh
// =====================================================================

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

// =====================================================================
// Response shapes
// =====================================================================

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    role: 'employee' | 'company';
    phone?: string;
    email?: string;
    fullName?: string;
    balance?: number;
    companyId?: string | null;
    plan?: string;
    status?: string;
    virtualCardLast4?: string | null;
  };
}
