import { useCallback, useMemo } from 'react';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { walletService } from '@services/api/wallet';
import { useMobileWalletStore } from '@store/useMobileWalletStore';
import type { Transaction, TransactionType } from '@/types/transaction';
import logger from '@services/utils/logger';

/**
 * useSalaryFeed — Salary Dashboard async-value composer.
 *
 * Surfaces the AsyncValue tri-state (loading / data / error) for the
 * salary screen by composing two underlying queries:
 *
 *   1. Wallet balance — from the moat-aware mobile-gateway store
 *      (`useMobileWalletStore`). Source of truth for `walletBalance`,
 *      `accruedWages`, `availableLimit`, `cycle`, and any structured
 *      `lastError`. We surface its state straight through to the UI.
 *
 *   2. WPS-relevant transactions — a paginated `walletService.
 *      getTransactions` query, FILTERED to the types that represent a
 *      wage-pay rail movement:
 *         PAYROLL    WPS settlement credit (the salary itself)
 *         REFUND     reversal of a failed wage/bill/transfer
 *         REMITTANCE outbound rail (treasury-relevant for the user)
 *      Card purchases / cashback / referral rewards are intentionally
 *      filtered OUT — those belong on the general wallet screen.
 *
 * Why React Query and not the Zustand store for transactions:
 *   The salary dashboard needs the AsyncValue contract: a single
 *   `status` field flips between idle/loading/error/success, with
 *   `refetch` and `isFetching` separately addressable so the
 *   RefreshControl spinner doesn't replace already-rendered content.
 *   useInfiniteQuery's pagination model maps cleanly onto the
 *   backend's offset/limit pair.
 *
 * Pull-to-refresh: call `refresh()` which invalidates BOTH underlying
 * caches in parallel. The screen renders one consistent snapshot
 * after both resolve.
 */

export const SALARY_FEED_QUERY_KEYS = {
  all: ['salary-feed'] as const,
  transactions: () => [...SALARY_FEED_QUERY_KEYS.all, 'transactions'] as const,
} as const;

const WPS_RELEVANT_TYPES: ReadonlyArray<TransactionType> = [
  'PAYROLL',
  'REFUND',
  'REMITTANCE',
];

const PAGE_SIZE = 20;

// Zod schema for the slice we actually render. Built from the
// generated `Transaction` type so a drift on the API side surfaces
// at runtime parse, not as a silent rendering bug.
const transactionLineSchema = z.object({
  id: z.string(),
  type: z.string(),
  amount: z.number(),
  fee: z.number(),
  totalAmount: z.number(),
  status: z.enum(['PENDING', 'COMPLETED', 'FAILED', 'REVERSED']),
  description: z.string().nullable().optional(),
  merchantName: z.string().nullable().optional(),
  createdAt: z.string(),
});
const transactionPageSchema = z.object({
  transactions: z.array(transactionLineSchema),
  pagination: z.object({
    limit: z.number(),
    offset: z.number(),
    total: z.number().optional(),
  }),
});

export type SalaryFeedStatus = 'idle' | 'loading' | 'error' | 'success';

export interface SalaryFeedView {
  status: SalaryFeedStatus;
  isFirstPaint: boolean;
  isRefreshing: boolean;
  /** Always present once `status === 'success'`. May be partially-resolved otherwise. */
  balance: ReturnType<typeof useMobileWalletStore.getState>['balance'];
  /** Filtered to WPS-relevant types only. */
  transactions: Transaction[];
  /** True if there is at least one more page to fetch via `loadMore()`. */
  hasMore: boolean;
  error: { code: string; message: string } | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  retry: () => void;
}

export function useSalaryFeed(): SalaryFeedView {
  const queryClient = useQueryClient();

  // ── 1. Balance — bound to the store-shaped gateway snapshot ────────
  const balance = useMobileWalletStore((s) => s.balance);
  const balanceLoading = useMobileWalletStore((s) => s.isLoading);
  const balanceError = useMobileWalletStore((s) => s.lastError);
  const fetchBalance = useMobileWalletStore((s) => s.fetchBalance);
  const clearBalanceError = useMobileWalletStore((s) => s.clearError);

  // ── 2. Transactions — paginated WPS-filtered query ─────────────────
  const txQuery = useInfiniteQuery({
    queryKey: SALARY_FEED_QUERY_KEYS.transactions(),
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const raw = await walletService.getTransactions({
        limit: PAGE_SIZE,
        offset: pageParam,
      });
      const parsed = transactionPageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn('useSalaryFeed: transaction page failed schema parse', {
          issues: parsed.error.flatten(),
        });
        throw new Error('TRANSACTION_PAGE_SCHEMA_MISMATCH');
      }
      return parsed.data;
    },
    initialPageParam: 0,
    getNextPageParam: (last, allPages) => {
      // Backend returns `limit` items per page; absence of a full page
      // means we are caught up. Cheaper than asking the backend for a
      // total count.
      if (last.transactions.length < PAGE_SIZE) return undefined;
      return allPages.length * PAGE_SIZE;
    },
    staleTime: 30_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });

  const transactions = useMemo(() => {
    const pages = txQuery.data?.pages ?? [];
    const all = pages.flatMap((p) => p.transactions as unknown as Transaction[]);
    return all.filter((t) => WPS_RELEVANT_TYPES.includes(t.type));
  }, [txQuery.data]);

  // ── 3. Combined status ─────────────────────────────────────────────
  // The screen wants ONE status flag. We collapse:
  //   error if either side has an error (balance-side wins for the
  //     specific code, since that's the structured one)
  //   loading if either side is loading AND we have no data yet
  //   success once both sides have at least one payload
  const error = useMemo<{ code: string; message: string } | null>(() => {
    if (balanceError) {
      return { code: balanceError.code, message: balanceError.message };
    }
    if (txQuery.isError) {
      return { code: 'TRANSACTIONS_UNAVAILABLE', message: 'Could not load recent activity.' };
    }
    return null;
  }, [balanceError, txQuery.isError]);

  const status: SalaryFeedStatus = useMemo(() => {
    if (error) return 'error';
    const hasBalance = balance != null;
    const hasTx = (txQuery.data?.pages.length ?? 0) > 0;
    if (!hasBalance && !hasTx && (balanceLoading || txQuery.isLoading)) return 'loading';
    if (hasBalance && hasTx) return 'success';
    return 'idle';
  }, [error, balance, balanceLoading, txQuery.data?.pages.length, txQuery.isLoading]);

  const refresh = useCallback(async () => {
    clearBalanceError();
    await Promise.all([
      fetchBalance(),
      queryClient.invalidateQueries({ queryKey: SALARY_FEED_QUERY_KEYS.transactions() }),
    ]);
  }, [clearBalanceError, fetchBalance, queryClient]);

  const loadMore = useCallback(async () => {
    if (!txQuery.hasNextPage || txQuery.isFetchingNextPage) return;
    await txQuery.fetchNextPage();
  }, [txQuery]);

  const retry = useCallback(() => {
    clearBalanceError();
    void fetchBalance();
    void txQuery.refetch();
  }, [clearBalanceError, fetchBalance, txQuery]);

  return {
    status,
    isFirstPaint: status === 'loading',
    isRefreshing: txQuery.isRefetching || (balanceLoading && balance != null),
    balance,
    transactions,
    hasMore: txQuery.hasNextPage ?? false,
    error,
    refresh,
    loadMore,
    retry,
  };
}
