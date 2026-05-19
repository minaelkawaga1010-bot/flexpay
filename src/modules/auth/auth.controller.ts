import { Request, Response, Router, CookieOptions } from 'express';
import { env, isProd } from '@config/env';
import { validate } from '@shared/middleware/validator';
import { authRateLimiter, otpRateLimiter } from '@shared/middleware/rate-limit';
import { asyncHandler } from '@shared/utils/asyncHandler';
import logger from '@shared/utils/logger';
import { authService } from './auth.service';
import {
  requestOtpSchema,
  verifyOtpSchema,
  companyRegisterSchema,
  companyLoginSchema,
  refreshTokenSchema,
} from './auth.dto';

const REFRESH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

export class AuthController {
  public readonly router = Router();

  constructor() {
    this.initialiseRoutes();
  }

  private initialiseRoutes() {
    // Employee
    this.router.post(
      '/employee/request-otp',
      otpRateLimiter,
      validate(requestOtpSchema),
      asyncHandler(this.requestOTP),
    );

    this.router.post(
      '/employee/verify-otp',
      authRateLimiter,
      validate(verifyOtpSchema),
      asyncHandler(this.verifyOTP),
    );

    // Company
    this.router.post(
      '/company/register',
      authRateLimiter,
      validate(companyRegisterSchema),
      asyncHandler(this.registerCompany),
    );

    this.router.post(
      '/company/login',
      authRateLimiter,
      validate(companyLoginSchema),
      asyncHandler(this.loginCompany),
    );

    // Token lifecycle
    this.router.post(
      '/refresh',
      validate(refreshTokenSchema),
      asyncHandler(this.refresh),
    );
    this.router.post('/logout', asyncHandler(this.logout));
  }

  // -------------------------------------------------------------- Handlers

  private requestOTP = async (req: Request, res: Response): Promise<void> => {
    const result = await authService.requestEmployeeOTP(req.body.phone);
    res.status(200).json(result);
  };

  // Web clients consume `refreshToken` from the HttpOnly cookie. Mobile/CLI
  // clients can't read cookies, so we also include it in the JSON body —
  // they never persist it back to the wire as a cookie themselves.
  private verifyOTP = async (req: Request, res: Response): Promise<void> => {
    const result = await authService.verifyEmployeeOTP(req.body);
    res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS);
    res.status(200).json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
    });
  };

  private registerCompany = async (req: Request, res: Response): Promise<void> => {
    const result = await authService.registerCompany(req.body, req.ip);
    res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS);
    res.status(201).json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      company: result.company,
    });
  };

  private loginCompany = async (req: Request, res: Response): Promise<void> => {
    const result = await authService.loginCompany(req.body.email, req.body.password, req.ip);
    res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS);
    res.status(200).json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      company: result.company,
    });
  };

  private refresh = async (req: Request, res: Response): Promise<void> => {
    const token =
      (req.body as { refreshToken?: string }).refreshToken ??
      (req.cookies as { refreshToken?: string } | undefined)?.refreshToken;
    if (!token) {
      res.status(400).json({ error: 'MISSING_REFRESH_TOKEN' });
      return;
    }
    const tokens = await authService.refreshTokens(token);
    res.cookie('refreshToken', tokens.refreshToken, REFRESH_COOKIE_OPTIONS);
    res.status(200).json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  };

  private logout = async (req: Request, res: Response): Promise<void> => {
    res.clearCookie('refreshToken', { ...REFRESH_COOKIE_OPTIONS, maxAge: undefined });
    logger.info('User logged out', { ip: req.ip });
    void env;
    res.status(200).json({ message: 'Logged out successfully' });
  };
}

export const authController = new AuthController();
