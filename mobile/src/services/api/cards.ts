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

/**
 * Sensitive card details — the un-masked PAN + CVV returned by the
 * reveal endpoint. The mobile client holds this in COMPONENT-LOCAL
 * state only — never in Zustand, Keychain, or any cross-screen
 * cache. The hook layer enforces a short auto-clear timeout.
 */
export interface SensitiveCardDetails {
  pan: string;
  cvv: string;
  expiryMonth: number;
  expiryYear: number;
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

  /**
   * Flip the card to BLOCKED. Idempotency-Key required so a retry
   * after a network failure does not double-toggle. The backend
   * tolerates already-BLOCKED rows as a no-op.
   */
  async freezeCard(cardId: string, idempotencyKey: string): Promise<{ card: Card }> {
    const { data } = await apiClient.post<{ card: Card }>(
      `/cards/${cardId}/freeze`,
      {},
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
    return data;
  },

  /**
   * Flip the card back to ACTIVE. Same idempotency semantics. The
   * backend refuses EXPIRED / REPLACED rows (terminal states).
   */
  async unfreezeCard(cardId: string, idempotencyKey: string): Promise<{ card: Card }> {
    const { data } = await apiClient.post<{ card: Card }>(
      `/cards/${cardId}/unfreeze`,
      {},
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
    return data;
  },

  /**
   * Pull the sensitive PAN + CVV from the backend. The backend
   * requires step-up auth (handled by the gateway interceptor when
   * the server signals STEP_UP_OTP_REQUIRED). The caller is
   * responsible for the biometric / Keychain pre-gate BEFORE this
   * call is made.
   */
  async revealCard(cardId: string): Promise<SensitiveCardDetails> {
    const { data } = await apiClient.post<SensitiveCardDetails>(`/cards/${cardId}/reveal`);
    return data;
  },
};
