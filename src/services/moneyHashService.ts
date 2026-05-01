import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { logger } from '../config/logger';

export interface Beneficiary {
  name: string;
  bankAccount: string;
  swiftCode: string;
}

export interface RemittanceRequest {
  amount: number;
  currency: string;
  beneficiary: Beneficiary;
  reference?: string;
}

class MoneyHashService {
  private get isConfigured(): boolean {
    return Boolean(env.moneyhash.apiKey);
  }

  /** Indicative AED -> target rate. Stub returns a fixed table. */
  async getExchangeRate(from: string, to: string): Promise<number> {
    if (!this.isConfigured) {
      const table: Record<string, number> = {
        'AED-EGP': 13.5,
        'AED-INR': 22.7,
        'AED-PKR': 76.0,
        'AED-BDT': 30.0,
        'AED-PHP': 15.4,
        'AED-USD': 0.272,
      };
      return table[`${from}-${to}`] ?? 1;
    }
    const res = await this.request('GET', `/fx/rate?from=${from}&to=${to}`);
    return res.rate;
  }

  async createTransfer(req: RemittanceRequest): Promise<string> {
    if (!this.isConfigured) {
      const id = `mh_${randomUUID()}`;
      logger.info({ req, id }, '[moneyhash:stub] createTransfer');
      return id;
    }
    const res = await this.request('POST', '/transfers', req);
    return res.id;
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${env.moneyhash.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.moneyhash.apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`MoneyHash ${method} ${path} failed: ${res.status} ${text}`);
    }
    return res.json();
  }
}

export const moneyHashService = new MoneyHashService();
