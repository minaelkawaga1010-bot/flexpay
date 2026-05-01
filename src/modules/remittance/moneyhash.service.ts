import { randomUUID } from 'crypto';
import axios, { AxiosInstance } from 'axios';
import { env } from '@config/env';
import logger from '@shared/utils/logger';

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
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: env.MONEYHASH_API_BASE,
      timeout: 10_000,
      headers: env.MONEYHASH_API_KEY
        ? { Authorization: `Bearer ${env.MONEYHASH_API_KEY}` }
        : {},
    });
  }

  async getExchangeRate(from: string, to: string): Promise<number> {
    if (!env.MONEYHASH_API_KEY) {
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
    const { data } = await this.client.get(`/fx/rate?from=${from}&to=${to}`);
    return data.rate;
  }

  async createTransfer(req: RemittanceRequest): Promise<string> {
    if (!env.MONEYHASH_API_KEY) {
      const id = `mh_${randomUUID()}`;
      logger.info('[moneyhash:stub] createTransfer', { req, id });
      return id;
    }
    const { data } = await this.client.post('/transfers', req);
    return data.id;
  }
}

export const moneyHashService = new MoneyHashService();
