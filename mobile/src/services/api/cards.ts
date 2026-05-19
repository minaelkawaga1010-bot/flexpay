import apiClient from './client';
import { Card } from '@/types/card';

export interface OrderPhysicalResponse {
  message: string;
  cardId: string;
  trackingNumber: string | null;
}

export interface TokenizeRequest {
  walletType: 'APPLE_PAY' | 'GOOGLE_PAY';
}

export const cardsService = {
  async getCards(): Promise<{ cards: Card[] }> {
    const { data } = await apiClient.get<{ cards: Card[] }>('/cards');
    return data;
  },

  async orderPhysicalCard(address: {
    street: string;
    city: string;
    postalCode: string;
    country: string;
    emirate?: string;
  }): Promise<OrderPhysicalResponse> {
    const { data } = await apiClient.post<OrderPhysicalResponse>('/cards/physical', { address });
    return data;
  },

  async tokenize(request: TokenizeRequest): Promise<{ token: string }> {
    const { data } = await apiClient.post<{ token: string }>('/cards/tokenize', request);
    return data;
  },
};
