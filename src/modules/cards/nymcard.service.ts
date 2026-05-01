import { randomUUID } from 'crypto';
import axios, { AxiosInstance } from 'axios';
import { env } from '@config/env';
import logger from '@shared/utils/logger';
import {
  NymCardAddress,
  NymCardCard,
  NymCardCustomer,
  WalletType,
} from '@shared/types/nymcard';

class NymCardService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: env.NYMCARD_API_BASE,
      timeout: 10_000,
      headers: env.NYMCARD_API_KEY
        ? { Authorization: `Bearer ${env.NYMCARD_API_KEY}` }
        : {},
    });
  }

  private get isConfigured(): boolean {
    return Boolean(env.NYMCARD_API_KEY);
  }

  async createCustomer(name: string, email: string, phone: string): Promise<NymCardCustomer> {
    if (!this.isConfigured) {
      logger.info('[nymcard:stub] createCustomer', { name, email, phone });
      return { id: `cust_${randomUUID()}`, name, email, phone };
    }
    const { data } = await this.client.post('/customers', { name, email, phone });
    return data;
  }

  async issueVirtualCard(customerId: string): Promise<NymCardCard> {
    if (!this.isConfigured) {
      logger.info('[nymcard:stub] issueVirtualCard', { customerId });
      return this.fakeCard(customerId, 'VIRTUAL');
    }
    const { data } = await this.client.post(`/customers/${customerId}/cards`, { type: 'VIRTUAL' });
    return data;
  }

  async issuePhysicalCard(
    customerId: string,
    address: NymCardAddress,
  ): Promise<{ orderId: string; card: NymCardCard }> {
    if (!this.isConfigured) {
      logger.info('[nymcard:stub] issuePhysicalCard', { customerId, address });
      return { orderId: `ord_${randomUUID()}`, card: this.fakeCard(customerId, 'PHYSICAL') };
    }
    const { data } = await this.client.post(`/customers/${customerId}/cards`, {
      type: 'PHYSICAL',
      shippingAddress: address,
    });
    return data;
  }

  async tokenizeCard(cardId: string, walletType: WalletType): Promise<{ token: string }> {
    if (!this.isConfigured) {
      logger.info('[nymcard:stub] tokenizeCard', { cardId, walletType });
      return { token: `${walletType.toLowerCase()}_${randomUUID()}` };
    }
    const { data } = await this.client.post(`/cards/${cardId}/tokenize`, { walletType });
    return data;
  }

  async blockCard(cardId: string): Promise<void> {
    if (!this.isConfigured) {
      logger.info('[nymcard:stub] blockCard', { cardId });
      return;
    }
    await this.client.post(`/cards/${cardId}/block`);
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
