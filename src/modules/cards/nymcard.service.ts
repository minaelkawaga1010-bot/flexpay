import { randomUUID } from 'crypto';
import crypto from 'crypto';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { env } from '@config/env';
import logger from '@shared/utils/logger';
import {
  NymCardAddress,
  NymCardCard,
  NymCardCustomer,
  WalletType,
} from '@shared/types/nymcard';

interface NymCardVirtualCard extends NymCardCard {
  status: 'ACTIVE' | 'INACTIVE';
}

interface PhysicalCardOrder {
  orderId: string;
  status: 'PENDING' | 'PROCESSING' | 'SHIPPED';
  trackingNumber?: string;
  card: NymCardCard;
}

const RETRYABLE_STATUS_FLOOR = 500;

export class NymCardService {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: env.NYMCARD_API_BASE,
      timeout: 15_000,
      headers: env.NYMCARD_API_KEY
        ? {
            Authorization: `Bearer ${env.NYMCARD_API_KEY}`,
            'Content-Type': 'application/json',
          }
        : { 'Content-Type': 'application/json' },
    });

    this.client.interceptors.response.use(
      (res) => res,
      (error: AxiosError) => {
        logger.error('NymCard API error', {
          status: error.response?.status,
          data: error.response?.data,
          url: error.config?.url,
        });
        return Promise.reject(error);
      },
    );
  }

  private get isConfigured(): boolean {
    return Boolean(env.NYMCARD_API_KEY);
  }

  // -------------------------------------------------------------- Customers

  async createCustomer(input: { name: string; email: string; phone: string }): Promise<NymCardCustomer> {
    if (!this.isConfigured) {
      logger.info('[nymcard:stub] createCustomer', input);
      return { id: `cust_${randomUUID()}`, ...input };
    }
    return this.withRetry(async () => {
      const { data } = await this.client.post('/customers', {
        name: input.name,
        email: input.email,
        phone: input.phone,
        meta: { source: 'flexpay' },
      });
      return data;
    });
  }

  // ---------------------------------------------------------- Virtual cards

  async issueVirtualCard(customerId: string): Promise<NymCardVirtualCard> {
    if (!this.isConfigured) {
      logger.info('[nymcard:stub] issueVirtualCard', { customerId });
      return { ...this.fakeCard(customerId, 'VIRTUAL'), status: 'ACTIVE' };
    }
    return this.withRetry(async () => {
      const { data } = await this.client.post(`/customers/${customerId}/cards`, {
        type: 'VIRTUAL',
        currency: 'AED',
        limits: { daily: 5000, monthly: 50000 },
      });
      return {
        cardId: data.id,
        customerId,
        last4: data.last4,
        brand: data.brand ?? 'VISA',
        expiryMonth: data.expiryMonth,
        expiryYear: data.expiryYear,
        type: 'VIRTUAL',
        status: data.status ?? 'ACTIVE',
      };
    });
  }

  // --------------------------------------------------------- Physical cards

  async issuePhysicalCard(customerId: string, address: NymCardAddress): Promise<PhysicalCardOrder> {
    if (!this.isConfigured) {
      logger.info('[nymcard:stub] issuePhysicalCard', { customerId, address });
      return {
        orderId: `ord_${randomUUID()}`,
        status: 'PENDING',
        card: this.fakeCard(customerId, 'PHYSICAL'),
      };
    }
    return this.withRetry(async () => {
      const { data } = await this.client.post(`/customers/${customerId}/cards/physical`, {
        shippingAddress: {
          line1: address.street,
          city: address.city,
          postalCode: address.postalCode,
          country: address.country,
          state: address.emirate,
        },
        currency: 'AED',
      });
      return {
        orderId: data.orderId,
        status: data.status,
        trackingNumber: data.trackingNumber,
        card: {
          cardId: data.card.id,
          customerId,
          last4: data.card.last4,
          brand: data.card.brand ?? 'VISA',
          expiryMonth: data.card.expiryMonth,
          expiryYear: data.card.expiryYear,
          type: 'PHYSICAL',
        },
      };
    });
  }

  // ---------------------------------------------------------- Tokenization

  async tokenizeCard(cardId: string, walletType: WalletType): Promise<{ token: string }> {
    if (!this.isConfigured) {
      logger.info('[nymcard:stub] tokenizeCard', { cardId, walletType });
      return { token: `${walletType.toLowerCase()}_${randomUUID()}` };
    }
    return this.withRetry(async () => {
      const { data } = await this.client.post(`/cards/${cardId}/tokenize`, { walletType });
      return { token: data.paymentToken };
    });
  }

  async blockCard(cardId: string): Promise<void> {
    if (!this.isConfigured) {
      logger.info('[nymcard:stub] blockCard', { cardId });
      return;
    }
    await this.withRetry(() => this.client.post(`/cards/${cardId}/block`));
  }

  // ----------------------------------------------------- Webhook signature

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!env.NYMCARD_WEBHOOK_SECRET) return true;
    if (!signatureHeader) return false;
    const [scheme, sig] = signatureHeader.split('=');
    if (scheme !== 'sha256' || !sig) return false;
    const expected = crypto
      .createHmac('sha256', env.NYMCARD_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------- Helpers

  /**
   * Retry a NymCard call on 5xx / network errors, with capped exponential
   * backoff. 4xx errors are surfaced immediately — they're caller bugs.
   */
  private async withRetry<T>(operation: () => Promise<T>, maxAttempts = 3, baseDelayMs = 1000): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        if (axios.isAxiosError(error) && error.response?.status && error.response.status < RETRYABLE_STATUS_FLOOR) {
          throw error;
        }
        if (attempt < maxAttempts) {
          const delay = baseDelayMs * 2 ** (attempt - 1);
          logger.warn('NymCard operation failed, retrying', {
            attempt,
            maxAttempts,
            delay,
            error: (error as Error).message,
          });
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastError ?? new Error('NymCard operation failed');
  }

  private fakeCard(customerId: string, type: 'VIRTUAL' | 'PHYSICAL'): NymCardCard {
    const last4 = Math.floor(1000 + Math.random() * 9000).toString();
    const now = new Date();
    return {
      cardId: `card_${randomUUID()}`,
      customerId,
      last4,
      brand: 'VISA',
      expiryMonth: now.getMonth() + 1,
      expiryYear: now.getFullYear() + 4,
      type,
    };
  }
}

export const nymcardService = new NymCardService();
