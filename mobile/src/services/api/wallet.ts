import apiClient from './client';
import { Transaction, TransactionType } from '@types/transaction';
import { Pagination } from '@types/api';

export interface TransferResult {
  success: boolean;
  transactionId: string;
  balance: number;
  fee: number;
  replay?: boolean;
}

export interface TransactionsList {
  transactions: Transaction[];
  pagination: Pagination;
}

export const walletService = {
  async getBalance(): Promise<{ balance: number }> {
    const { data } = await apiClient.get<{ balance: number }>('/wallet/balance');
    return data;
  },

  async getTransactions(params: {
    limit?: number;
    offset?: number;
    type?: TransactionType;
    startDate?: string;
    endDate?: string;
  } = {}): Promise<TransactionsList> {
    const { data } = await apiClient.get<TransactionsList>('/wallet/transactions', { params });
    return data;
  },

  async transfer(payload: {
    recipientPhone: string;
    amount: number;
  }): Promise<TransferResult> {
    const { data } = await apiClient.post<TransferResult>('/wallet/transfer', payload);
    return data;
  },
};
