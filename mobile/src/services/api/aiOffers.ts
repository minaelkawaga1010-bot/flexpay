import apiClient from './client';

/**
 * Mirrors the backend `PersonalisedOffer` shape from
 * src/modules/offers/offers.types.ts. The categories union is kept
 * in lock-step with the server enum — extending here without
 * extending the server (or vice versa) is a contract drift.
 */
export type OfferCategory = 'telecom' | 'remittance' | 'groceries';

export interface PersonalisedOffer {
  offerId: string;
  category: OfferCategory;
  /** 0–100. Higher = better match for the worker signal vector. */
  score: number;
  reason: string;
  /** Editorial fields the server joins onto the personalised shape. */
  title?: string;
  merchant?: string;
  discountPercentage?: number;
  imageUrl?: string | null;
}

export interface AiOffersPage {
  offers: PersonalisedOffer[];
  pagination: { limit: number; offset: number; total: number; hasMore: boolean };
  firewall: { status: 'OK' };
}

/** Server-mapped Tool 11 outcomes. The mobile client routes 403/451
 *  to a distinct UI rather than the generic error surface. */
export type AiOffersFirewallCode =
  | 'AI_OFFERS_INJECTION_BLOCKED'   // 451
  | 'AI_OFFERS_FIREWALL_UNAVAILABLE' // 403
  | 'AI_OFFERS_OUTPUT_SCHEMA';      // 403

export const aiOffersService = {
  async list(params: { limit?: number; offset?: number } = {}): Promise<AiOffersPage> {
    const { data } = await apiClient.get<AiOffersPage>('/ai/offers', { params });
    return data;
  },

  async click(offerId: string): Promise<{ affiliateLink: string }> {
    const { data } = await apiClient.post<{ affiliateLink: string }>(
      `/ai/offers/${offerId}/click`,
    );
    return data;
  },
};
