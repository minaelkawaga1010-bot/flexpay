import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler';
import { ipAuthRateLimiter, otpRateLimiter } from '../../middleware/rateLimit';
import { validateBody } from '../../utils/validation';
import { assertPasswordPolicy, authService } from './authService';

const router = Router();

const phoneSchema = z.string().regex(/^\+\d{8,15}$/, 'phone must be E.164 format e.g. +971501234567');

const requestOtpSchema = z.object({ phone: phoneSchema });

const verifyOtpSchema = z.object({
  phone: phoneSchema,
  otp: z.string().regex(/^\d{6}$/),
  fullName: z.string().min(2),
  salary: z.number().nonnegative().optional(),
  companyId: z.string().uuid().optional(),
  referralCode: z.string().optional(),
});

router.post(
  '/employee/request-otp',
  ipAuthRateLimiter,
  validateBody(requestOtpSchema),
  otpRateLimiter,
  asyncHandler(async (req, res) => {
    await authService.requestEmployeeOtp(req.body.phone);
    res.json({ message: 'OTP sent' });
  }),
);

router.post(
  '/employee/verify-otp',
  ipAuthRateLimiter,
  validateBody(verifyOtpSchema),
  asyncHandler(async (req, res) => {
    const result = await authService.verifyEmployeeOtp(req.body);
    res.json(result);
  }),
);

const registerCompanySchema = z.object({
  name: z.string().min(2),
  tradeLicense: z.string().min(3),
  adminName: z.string().min(2),
  adminEmail: z.string().email(),
  adminPhone: phoneSchema,
  password: z.string().min(8),
});

router.post(
  '/company/register',
  validateBody(registerCompanySchema),
  asyncHandler(async (req, res) => {
    assertPasswordPolicy(req.body.password);
    const result = await authService.registerCompany(req.body);
    res.status(201).json(result);
  }),
);

const loginCompanySchema = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post(
  '/company/login',
  ipAuthRateLimiter,
  validateBody(loginCompanySchema),
  asyncHandler(async (req, res) => {
    const result = await authService.loginCompany(req.body.email, req.body.password);
    res.json(result);
  }),
);

export default router;
