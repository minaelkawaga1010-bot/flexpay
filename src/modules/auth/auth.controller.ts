import { Request, Response } from 'express';
import { authService } from './auth.service';

export const authController = {
  async requestOtp(req: Request, res: Response): Promise<void> {
    await authService.requestEmployeeOtp(req.body.phone);
    res.json({ message: 'OTP sent' });
  },

  async verifyOtp(req: Request, res: Response): Promise<void> {
    const result = await authService.verifyEmployeeOtp(req.body);
    res.json(result);
  },

  async registerCompany(req: Request, res: Response): Promise<void> {
    const result = await authService.registerCompany(req.body);
    res.status(201).json(result);
  },

  async loginCompany(req: Request, res: Response): Promise<void> {
    const result = await authService.loginCompany(req.body.email, req.body.password);
    res.json(result);
  },
};
