import { useCallback, useMemo, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import {
  aiOffersService,
  type AiOffersFirewallCode,
  type PersonalisedOffer,
} from '@services/api/aiOffers';
import logger from '@services/utils/logger';

/**
 * useAIOffers — React Query infinite-pagination hook for the
 * Tool 11-firewalled personalised feed.
 *
 * Surfaces an AsyncValue-shaped view to the screen:
 *
 *   status         idle | loading | success | error | firewall_blocked
 *   offers         flattened personalised offer list
 *   hasMore        true while another page is fetchable
 *   loadMore       async — fetch the next page (cap at 50 per page)
 *   refresh        async — invalidate and refetch from page 0
 *   error          structured: { code, message, status }
 *
 * The 403 / 451 firewall outcomes route through a dedicated
 * `firewall_blocked` status so the screen renders a distinct surface
 * (not a generic error). Tool 11 codes preserved verbatim in
 * `error.code` so the screen can pick the right copy.
 *
 * CTA-click coordination:
 *   The hook also owns the `claimingOfferId` lock so a rapid tap on
 *   the CTA does not double-fire the click endpoint and double-
 *   attribute the affiliate event.
 */

export const AI_OFFERS_QUERY_KEYS = {
  all: ['ai-offers'] as const,
  feed: () => [...AI_OFFERS_QUERY_KEYS.all, 'feed'] as const,
} as const;

const PAGE_SIZE = 20;

export type AiOffersStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'error'
  | 'firewall_blocked';

export interface AiOffersError {
  code: string;
  message: string;
  status: number;
}

export interface AiOffersView {
  status: AiOffersStatus;
  offers: PersonalisedOffer[];
  hasMore: boolean;
  isRefreshing: boolean;
  /** Currently in-flight claim (CTA click), if any. */
  claimingOfferId: string | null;
  /** Most-recent successful claim affiliate link, if any. */
  lastClaimLink: string | null;
  error: AiOffersError | null;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  claim: (offerId: string) => Promise<string | null>;
  retry: () => void;
}

export function useAIOffers(): AiOffersView {
  const queryClient = useQueryClient();
  const [claimingOfferId, setClaimingOfferId] = useState<string | null>(null);
  const [lastClaimLink, setLastClaimLink] = useState<string | null>(null);

  const query = useInfiniteQuery({
    queryKey: AI_OFFERS_QUERY_KEYS.feed(),
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      return aiOffersService.list({ limit: PAGE_SIZE, offset: pageParam });
    },
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.pagination.hasMore ? last.pagination.offset + last.pagination.limit : undefined,
    staleTime: 60_000,
    // Firewall outcomes are non-retryable — retrying a flagged input
    // will produce the same verdict and spam the safety service.
    retry: (failureCount, err) => {
      if (axios.isAxiosError(err) && (err.response?.status === 403 || err.response?.status === 451)) {
        return false;
      }
      return failureCount < 2;
    },
  });

  const offers = useMemo<PersonalisedOffer[]>(() => {
    return (query.data?.pages ?? []).flatMap((p) => p.offers);
  }, [query.data]);

  // ── Error mapping ─────────────────────────────────────────────────
  const error = useMemo<AiOffersError | null>(() => {
    if (!query.isError) return null;
    const err = query.error;
    if (axios.isAxiosError(err) && err.response) {
      const data = (err.response.data ?? {}) as { error?: string; message?: string };
      return {
        code: data.error ?? 'AI_OFFERS_UNKNOWN',
        message: data.message ?? 'Could not load offers.',
        status: err.response.status,
      };
    }
    return {
      code: 'AI_OFFERS_NETWORK',
      message: 'Please check your internet connection.',
      status: 0,
    };
  }, [query.isError, query.error]);

  const status: AiOffersStatus = useMemo(() => {
    if (error) {
      if (error.status === 403 || error.status === 451) return 'firewall_blocked';
      return 'error';
    }
    const hasData = (query.data?.pages.length ?? 0) > 0;
    if (!hasData && query.isLoading) return 'loading';
    if (hasData) return 'success';
    return 'idle';
  }, [error, query.data?.pages.length, query.isLoading]);

  // ── Actions ──────────────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (!query.hasNextPage || query.isFetchingNextPage) return;
    await query.fetchNextPage();
  }, [query]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: AI_OFFERS_QUERY_KEYS.feed() });
  }, [queryClient]);

  const retry = useCallback(() => {
    void query.refetch();
  }, [query]);

  /**
   * Claim an offer (CTA click).
   *
   * Lock semantics:
   *   • A claim in flight short-circuits subsequent claim calls for
   *     ANY offerId. The CTA buttons read `claimingOfferId !== null`
   *     to render their spinner; the hook reads its own ref to
   *     prevent double-fires.
   */
  const claim = useCallback(async (offerId: string): Promise<string | null> => {
    if (claimingOfferId) return null;
    setClaimingOfferId(offerId);
    try {
      const { affiliateLink } = await aiOffersService.click(offerId);
      setLastClaimLink(affiliateLink);
      return affiliateLink;
    } catch (err) {
      logger.warn('useAIOffers: claim failed', { offerId, error: (err as Error).message });
      return null;
    } finally {
      setClaimingOfferId(null);
    }
  }, [claimingOfferId]);

  return {
    status,
    offers,
    hasMore: query.hasNextPage ?? false,
    isRefreshing: query.isRefetching,
    claimingOfferId,
    lastClaimLink,
    error,
    loadMore,
    refresh,
    claim,
    retry,
  };
}

export type { AiOffersFirewallCode };
