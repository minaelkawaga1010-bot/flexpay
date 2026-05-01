import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { logger } from '../config/logger';

export interface NymCardCustomer {
  id: string;
}

export interface NymCardCard {
  cardId: string;
  last4: string;
  expiry: string; // ISO date
}

export interface Address {
  street: string;
  city: string;
  country: string;
  postalCode: string;
}

export type WalletType = 'APPLE_PAY' | 'GOOGLE_PAY';

/**
 * Thin client around NymCard's REST API.
 *
 * Real network calls are gated on `NYMCARD_API_KEY`. When unset (dev/test),
 * the service generates deterministic-shaped fake responses so the rest of
 * the pipeline can run end-to-end without a sandbox account.
 */
class NymCardService {
  private get isConfigured(): boolean {
    return Boolean(env.nymcard.apiKey);
  }

  async createCustomer(name: string, email: string, phone: string): Promise<NymCardCustomer> {
    if (!this.isConfigured) {
      logger.info({ name, email, phone }, '[nymcard:stub] createCustomer');
      return { id: `cust_${randomUUID()}` };
    }
    const res = await this.request('POST', '/customers', { name, email, phone });
    return { id: res.id };
  }

  async issueVirtualCard(customerId: string): Promise<NymCardCard> {
    if (!this.isConfigured) {
      logger.info({ customerId }, '[nymcard:stub] issueVirtualCard');
      return this.fakeCard();
    }
    const res = await this.request('POST', `/customers/${customerId}/cards`, { type: 'VIRTUAL' });
    return { cardId: res.id, last4: res.last4, expiry: res.expiry };
  }

  async issuePhysicalCard(customerId: string, address: Address): Promise<{ orderId: string }> {
    if (!this.isConfigured) {
      logger.info({ customerId, address }, '[nymcard:stub] issuePhysicalCard');
      return { orderId: `ord_${randomUUID()}` };
    }
    const res = await this.request('POST', `/customers/${customerId}/cards`, {
      type: 'PHYSICAL',
      shippingAddress: address,
    });
    return { orderId: res.orderId };
  }

  async tokenizeCard(cardId: string, walletType: WalletType): Promise<{ token: string }> {
    if (!this.isConfigured) {
      logger.info({ cardId, walletType }, '[nymcard:stub] tokenizeCard');
      return { token: `${walletType.toLowerCase()}_${randomUUID()}` };
    }
    const res = await this.request('POST', `/cards/${cardId}/tokenize`, { walletType });
    return { token: res.token };
  }

  private fakeCard(): NymCardCard {
    const last4 = Math.floor(1000 + Math.random() * 9000).toString();
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 4);
    return { cardId: `card_${randomUUID()}`, last4, expiry: expiry.toISOString() };
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${env.nymcard.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.nymcard.apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`NymCard ${method} ${path} failed: ${res.status} ${text}`);
    }
    return res.json();
  }
}

export const nymcardService = new NymCardService();
