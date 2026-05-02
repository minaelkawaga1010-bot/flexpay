import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { walletService } from '@services/api/wallet';
import { Transaction } from '@types/transaction';
import logger from '@services/utils/logger';

const PAGE_SIZE = 20;
const BASIC_FEE = 2;

interface WalletState {
  balance: number;
  transactions: Transaction[];
  isLoading: boolean;
  hasMore: boolean;
  lastFetchAt: number | null;

  fetchBalance: () => Promise<void>;
  fetchTransactions: (page?: number) => Promise<void>;
  addTransaction: (tx: Transaction) => void;
  optimisticTransfer: (amount: number, recipientPhone: string) => string;
  rollbackOptimistic: (tempId: string) => void;
  reset: () => void;
}

export const useWalletStore = create<WalletState>()(
  immer((set) => ({
    balance: 0,
    transactions: [],
    isLoading: false,
    hasMore: true,
    lastFetchAt: null,

    fetchBalance: async () => {
      try {
        set((s) => {
          s.isLoading = true;
        });
        const { balance } = await walletService.getBalance();
        set((s) => {
          s.balance = balance;
        });
      } catch (err) {
        logger.error('wallet: fetchBalance failed', { error: (err as Error).message });
      } finally {
        set((s) => {
          s.isLoading = false;
        });
      }
    },

    fetchTransactions: async (page = 1) => {
      try {
        if (page === 1) {
          set((s) => {
            s.isLoading = true;
          });
        }
        const result = await walletService.getTransactions({
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        });
        set((s) => {
          if (page === 1) s.transactions = result.transactions;
          else s.transactions.push(...result.transactions);
          s.hasMore = result.pagination.hasMore;
          s.lastFetchAt = Date.now();
        });
      } catch (err) {
        logger.error('wallet: fetchTransactions failed', { error: (err as Error).message });
      } finally {
        if (page === 1) {
          set((s) => {
            s.isLoading = false;
          });
        }
      }
    },

    addTransaction: (tx) =>
      set((s) => {
        s.transactions.unshift(tx);
        if (tx.type === 'DEPOSIT' || tx.type === 'RECEIVE' || tx.type === 'CASHBACK') {
          s.balance += tx.amount;
        } else if (tx.type === 'TRANSFER' || tx.type === 'WITHDRAWAL' || tx.type === 'REMITTANCE') {
          s.balance += tx.totalAmount; // already negative
        }
      }),

    optimisticTransfer: (amount, recipientPhone) => {
      const tempId = `temp-${Date.now()}`;
      const tempTx: Transaction = {
        id: tempId,
        type: 'TRANSFER',
        amount: -amount,
        fee: BASIC_FEE,
        totalAmount: -(amount + BASIC_FEE),
        status: 'PENDING',
        description: `Transfer to ${recipientPhone}`,
        counterpartyPhone: recipientPhone,
        createdAt: new Date().toISOString(),
      };
      set((s) => {
        s.transactions.unshift(tempTx);
        s.balance -= amount + BASIC_FEE;
      });
      return tempId;
    },

    rollbackOptimistic: (tempId) =>
      set((s) => {
        const tx = s.transactions.find((t) => t.id === tempId);
        if (tx) {
          // Restore balance — totalAmount on the temp row is negative.
          s.balance -= tx.totalAmount;
        }
        s.transactions = s.transactions.filter((t) => t.id !== tempId);
      }),

    reset: () =>
      set((s) => {
        s.balance = 0;
        s.transactions = [];
        s.hasMore = true;
        s.lastFetchAt = null;
      }),
  })),
);
