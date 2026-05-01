import { Router } from 'express';
import { authRateLimiter, otpRateLimiter } from '@shared/middleware/rate-limit';
import { validate } from '@shared/middleware/validator';
import { asyncHandler } from '@shared/utils/asyncHandler';
import {
  requestOtpSchema,
  verifyOtpSchema,
  registerCompanySchema,
  loginCompanySchema,
} from './auth.dto';
import { authController } from './auth.controller';

const router = Router();

router.post(
  '/employee/request-otp',
  authRateLimiter,
  otpRateLimiter,
  validate(requestOtpSchema),
  asyncHandler(authController.requestOtp),
);

router.post(
  '/employee/verify-otp',
  authRateLimiter,
  validate(verifyOtpSchema),
  asyncHandler(authController.verifyOtp),
);

router.post(
  '/company/register',
  authRateLimiter,
  validate(registerCompanySchema),
  asyncHandler(authController.registerCompany),
);

router.post(
  '/company/login',
  authRateLimiter,
  validate(loginCompanySchema),
  asyncHandler(authController.loginCompany),
);

export default router;
