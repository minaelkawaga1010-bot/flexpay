import apiClient from './client';

export interface RemittanceQuote {
  rate: number;
  fee: number;
  recipientAmount: number;
  totalDebit: number;
  disclaimer: string;
}

export interface RemittanceSendResult {
  transferId: string;
  estimatedDelivery: string;
  recipientAmount: number;
  fee: number;
}

export const remittanceService = {
  async quote(amount: number, currency: string): Promise<RemittanceQuote> {
    const { data } = await apiClient.get<RemittanceQuote>('/remittance/quote', {
      params: { amount, currency },
    });
    return data;
  },

  async send(payload: {
    amount: number;
    currency: string;
    beneficiary: { name: string; bankAccount: string; swiftCode: string };
  }): Promise<RemittanceSendResult> {
    const { data } = await apiClient.post<RemittanceSendResult>('/remittance/send', payload);
    return data;
  },
};
