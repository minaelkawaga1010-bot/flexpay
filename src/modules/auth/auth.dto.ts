import { z } from 'zod';
import { phoneSchema, emailSchema, passwordSchema } from '@shared/middleware/validator';

export const requestOtpSchema = z.object({
  phone: phoneSchema,
});
export type RequestOtpDto = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  otp: z.string().regex(/^\d{6}$/),
  fullName: z.string().min(2),
  salary: z.number().nonnegative().optional(),
  companyId: z.string().uuid().optional(),
  referralCode: z.string().optional(),
});
export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>;

export const registerCompanySchema = z.object({
  name: z.string().min(2),
  tradeLicense: z.string().min(3),
  adminName: z.string().min(2),
  adminEmail: emailSchema,
  adminPhone: phoneSchema,
  password: passwordSchema,
});
export type RegisterCompanyDto = z.infer<typeof registerCompanySchema>;

export const loginCompanySchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});
export type LoginCompanyDto = z.infer<typeof loginCompanySchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(10),
});
