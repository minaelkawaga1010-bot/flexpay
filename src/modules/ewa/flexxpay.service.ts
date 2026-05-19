import { randomUUID } from 'crypto';
import axios, { AxiosInstance } from 'axios';
import { env } from '@config/env';
import logger from '@shared/utils/logger';

export interface AdvanceRequest {
  employeeName: string;
  employeePhone: string;
  amount: number;
  employerId: string | null;
  returnUrl: string;
}

class FlexxPayService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: env.FLEXXPAY_API_BASE,
      timeout: 10_000,
      headers: env.FLEXXPAY_API_KEY
        ? { Authorization: `Bearer ${env.FLEXXPAY_API_KEY}` }
        : {},
    });
  }

  async createAdvanceRequest(req: AdvanceRequest): Promise<string> {
    if (!env.FLEXXPAY_API_KEY) {
      const id = `fxp_${randomUUID()}`;
      logger.info('[flexxpay:stub] createAdvanceRequest', { req, id });
      return `${env.FLEXXPAY_API_BASE}/redirect/${id}?return=${encodeURIComponent(req.returnUrl)}`;
    }
    const { data } = await this.client.post('/advances', req);
    return data.redirectUrl;
  }
}

export const flexxPayService = new FlexxPayService();
