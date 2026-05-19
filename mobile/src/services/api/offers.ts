import apiClient from './client';

export interface Offer {
  id: string;
  title: string;
  description?: string;
  discountPercentage: number;
  merchant: string;
  affiliateLink: string;
  imageUrl?: string;
  expiresAt: string;
}

export const offersService = {
  async list(): Promise<{ offers: Offer[] }> {
    const { data } = await apiClient.get<{ offers: Offer[] }>('/offers');
    return data;
  },

  /**
   * Click on an offer. Backend issues a 302 to the affiliate link — we
   * disable axios redirect-following so the response carries the URL we
   * can hand off to the in-app browser.
   */
  async click(offerId: string): Promise<string | null> {
    const response = await apiClient.post(
      `/offers/${offerId}/click`,
      {},
      { maxRedirects: 0, validateStatus: (s) => s === 302 || s === 200 },
    );
    return (response.headers.location as string | undefined) ?? null;
  },
};
