import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { logger } from '../config/logger';

export interface AdvanceRequest {
  employeeName: string;
  employeePhone: string;
  amount: number;
  employerId: string | null;
  returnUrl: string;
}

class FlexxPayService {
  private get isConfigured(): boolean {
    return Boolean(env.flexxpay.apiKey);
  }

  async createAdvanceRequest(req: AdvanceRequest): Promise<string> {
    if (!this.isConfigured) {
      const id = `fxp_${randomUUID()}`;
      logger.info({ req, id }, '[flexxpay:stub] createAdvanceRequest');
      return `${env.flexxpay.baseUrl}/redirect/${id}?return=${encodeURIComponent(req.returnUrl)}`;
    }
    const res = await fetch(`${env.flexxpay.baseUrl}/advances`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.flexxpay.apiKey}`,
      },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`FlexxPay request failed: ${res.status}`);
    const data = await res.json();
    return data.redirectUrl;
  }
}

export const flexxPayService = new FlexxPayService();
