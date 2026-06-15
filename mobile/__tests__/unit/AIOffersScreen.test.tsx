/**
 * AIOffersScreen — Phase 2 Feature #4 integration tests.
 *
 * Covers:
 *   • Success: feed paints with personalised cards + Tool 11 badge.
 *   • Empty state: localised copy renders.
 *   • Firewall 451 (prompt injection): distinct surface, no retry.
 *   • Firewall 403 (plumbing): distinct surface, retry CTA.
 *   • Network error: error card with retry.
 *   • CTA lock: claiming an offer disables ALL CTAs in flight.
 *   • Pagination: loadMore appends the next page.
 *   • Refresh: triggers refetch.
 *
 * useAIOffers is mocked at the module boundary (lazy-binding pattern
 * — see VirtualCardView.test.tsx for the rationale).
 */

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

const mockFeed = {
  status: 'success' as 'idle' | 'loading' | 'success' | 'error' | 'firewall_blocked',
  offers: [] as any[],
  hasMore: false,
  isRefreshing: false,
  claimingOfferId: null as string | null,
  lastClaimLink: null as string | null,
  error: null as { code: string; message: string; status: number } | null,
  loadMore: jest.fn().mockResolvedValue(undefined),
  refresh: jest.fn().mockResolvedValue(undefined),
  claim: jest.fn().mockResolvedValue('https://example.test'),
  retry: jest.fn(),
};

jest.mock('@hooks/useAIOffers', () => ({
  useAIOffers: () => mockFeed,
  AI_OFFERS_QUERY_KEYS: { all: ['ai-offers'], feed: () => ['ai-offers', 'feed'] },
}));

// Stub Linking so the claim CTA doesn't try to open URLs in jest.
jest.mock('react-native/Libraries/Linking/Linking', () => ({
  openURL: jest.fn().mockResolvedValue(undefined),
  canOpenURL: jest.fn().mockResolvedValue(true),
}));

import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AIOffersScreen } from '@screens/offers/AIOffersScreen';

const offerOf = (id: string, over: Record<string, unknown> = {}) => ({
  offerId: id,
  category: 'telecom',
  score: 75,
  reason: 'Matches your recent telecom spend.',
  title: `Offer ${id}`,
  merchant: 'e&',
  discountPercentage: 15,
  imageUrl: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockFeed, {
    status: 'success',
    offers: [],
    hasMore: false,
    isRefreshing: false,
    claimingOfferId: null,
    lastClaimLink: null,
    error: null,
  });
});

// ───────────────────────────────────────────────────────────────────
// Tool 11 badge — always visible inside the layout perimeter
// ───────────────────────────────────────────────────────────────────

describe('AIOffersScreen — Tool 11 badge', () => {
  it('renders the firewall badge in the header (success state)', () => {
    const { getByTestId } = render(<AIOffersScreen />);
    expect(getByTestId('ai-offers-firewall-badge')).toBeTruthy();
  });

  it('keeps the firewall badge visible even on firewall_blocked state', () => {
    Object.assign(mockFeed, {
      status: 'firewall_blocked',
      error: { code: 'AI_OFFERS_INJECTION_BLOCKED', message: 'refused', status: 451 },
    });
    const { getByTestId } = render(<AIOffersScreen />);
    expect(getByTestId('ai-offers-firewall-badge')).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────
// Success feed
// ───────────────────────────────────────────────────────────────────

describe('AIOffersScreen — success state', () => {
  it('renders one card per personalised offer', () => {
    mockFeed.offers = [offerOf('o1'), offerOf('o2', { score: 92 })];
    const { getByTestId } = render(<AIOffersScreen />);
    expect(getByTestId('ai-offer-card-o1')).toBeTruthy();
    expect(getByTestId('ai-offer-card-o2')).toBeTruthy();
  });

  it('badges high-score offers as TOP MATCH', () => {
    mockFeed.offers = [offerOf('o1', { score: 92 })];
    const { getByText } = render(<AIOffersScreen />);
    // The score-tier label is a literal string the screen owns — no
    // i18n indirection — so a direct text query is enough.
    expect(getByText('TOP MATCH')).toBeTruthy();
  });

  it('renders the localised category chip per card', () => {
    mockFeed.offers = [offerOf('o1', { category: 'remittance' })];
    const { getByTestId } = render(<AIOffersScreen />);
    expect(getByTestId('ai-offer-category-o1')).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────
// Empty state
// ───────────────────────────────────────────────────────────────────

describe('AIOffersScreen — empty state', () => {
  it('renders the empty surface when status=success AND no offers', () => {
    mockFeed.offers = [];
    const { getByTestId } = render(<AIOffersScreen />);
    expect(getByTestId('ai-offers-empty')).toBeTruthy();
  });

  it('renders the localised empty title + subtitle', () => {
    mockFeed.offers = [];
    const { getByText } = render(<AIOffersScreen />);
    expect(getByText('ai_offers.empty_title')).toBeTruthy();
    expect(getByText('ai_offers.empty_subtitle')).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────
// Loading state
// ───────────────────────────────────────────────────────────────────

describe('AIOffersScreen — loading state', () => {
  it('renders skeleton cards on first paint', () => {
    Object.assign(mockFeed, { status: 'loading', offers: [] });
    const { getByTestId } = render(<AIOffersScreen />);
    expect(getByTestId('ai-offers-skeletons')).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────
// Firewall blocked — 451 (injection) and 403 (plumbing)
// ───────────────────────────────────────────────────────────────────

describe('AIOffersScreen — firewall blocked', () => {
  it('renders the injection-blocked surface on 451 + AI_OFFERS_INJECTION_BLOCKED', () => {
    Object.assign(mockFeed, {
      status: 'firewall_blocked',
      offers: [],
      error: { code: 'AI_OFFERS_INJECTION_BLOCKED', message: 'refused on policy', status: 451 },
    });
    const { getByTestId, queryByTestId } = render(<AIOffersScreen />);
    expect(getByTestId('ai-offers-firewall-blocked')).toBeTruthy();
    expect(getByTestId('ai-offers-firewall-code').props.children).toBe('AI_OFFERS_INJECTION_BLOCKED');
    // No retry on injection — would just re-trigger the same verdict.
    expect(queryByTestId('ai-offers-firewall-retry')).toBeNull();
  });

  it('renders the plumbing-failure surface on 403 + AI_OFFERS_FIREWALL_UNAVAILABLE WITH retry', () => {
    Object.assign(mockFeed, {
      status: 'firewall_blocked',
      offers: [],
      error: { code: 'AI_OFFERS_FIREWALL_UNAVAILABLE', message: 'safety service paused', status: 403 },
    });
    const { getByTestId } = render(<AIOffersScreen />);
    expect(getByTestId('ai-offers-firewall-blocked')).toBeTruthy();
    fireEvent.press(getByTestId('ai-offers-firewall-retry'));
    expect(mockFeed.retry).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────────────────────────────────────────────────
// Network error
// ───────────────────────────────────────────────────────────────────

describe('AIOffersScreen — network error', () => {
  it('renders the error surface + retry on plain error status', () => {
    Object.assign(mockFeed, {
      status: 'error',
      offers: [],
      error: { code: 'AI_OFFERS_NETWORK', message: 'no connection', status: 0 },
    });
    const { getByTestId } = render(<AIOffersScreen />);
    expect(getByTestId('ai-offers-error')).toBeTruthy();
    fireEvent.press(getByTestId('ai-offers-retry'));
    expect(mockFeed.retry).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────────────────────────────────────────────────
// CTA lock — claim
// ───────────────────────────────────────────────────────────────────

describe('AIOffersScreen — CTA lock', () => {
  it('calls feed.claim() on CTA press', async () => {
    mockFeed.offers = [offerOf('o1')];
    const { getByTestId } = render(<AIOffersScreen />);
    fireEvent.press(getByTestId('ai-offer-claim-o1'));
    await waitFor(() => expect(mockFeed.claim).toHaveBeenCalledWith('o1'));
  });

  it('opens the affiliate URL via Linking after a successful claim', async () => {
    mockFeed.offers = [offerOf('o1')];
    mockFeed.claim.mockResolvedValue('https://aff.example/test');
    const { getByTestId } = render(<AIOffersScreen />);
    fireEvent.press(getByTestId('ai-offer-claim-o1'));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith('https://aff.example/test'));
  });

  it('disables EVERY card CTA while any claim is in flight', () => {
    mockFeed.offers = [offerOf('o1'), offerOf('o2'), offerOf('o3')];
    mockFeed.claimingOfferId = 'o1';
    const { getByTestId } = render(<AIOffersScreen />);
    for (const id of ['o1', 'o2', 'o3']) {
      expect(getByTestId(`ai-offer-claim-${id}`).props.accessibilityState?.disabled).toBe(true);
    }
  });

  it('rapid five-tap on the same CTA still results in exactly one claim() invocation when the lock fires', async () => {
    mockFeed.offers = [offerOf('o1')];
    // Hold the resolve so the lock is observably engaged.
    let resolveClaim: ((value: string) => void) | null = null;
    mockFeed.claim.mockImplementation(() => {
      mockFeed.claimingOfferId = 'o1';
      return new Promise((r) => { resolveClaim = r; });
    });
    const { getByTestId, rerender } = render(<AIOffersScreen />);
    const cta = getByTestId('ai-offer-claim-o1');
    fireEvent.press(cta);
    // Re-render so the screen reads the updated claimingOfferId from
    // the hook mock — `anyClaimInFlight` then short-circuits the
    // subsequent presses.
    rerender(<AIOffersScreen />);
    fireEvent.press(cta);
    fireEvent.press(cta);
    fireEvent.press(cta);
    fireEvent.press(cta);

    expect(mockFeed.claim).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveClaim?.('https://aff.example/done');
    });
  });
});

// ───────────────────────────────────────────────────────────────────
// Pagination + refresh
// ───────────────────────────────────────────────────────────────────

describe('AIOffersScreen — pagination + refresh', () => {
  it('invokes feed.refresh() when the RefreshControl fires', () => {
    const { getByTestId } = render(<AIOffersScreen />);
    const list = getByTestId('ai-offers-flatlist');
    list.props.refreshControl.props.onRefresh();
    expect(mockFeed.refresh).toHaveBeenCalledTimes(1);
  });

  it('invokes feed.loadMore() when onEndReached fires', () => {
    mockFeed.offers = [offerOf('o1')];
    mockFeed.hasMore = true;
    const { getByTestId } = render(<AIOffersScreen />);
    const list = getByTestId('ai-offers-flatlist');
    list.props.onEndReached();
    expect(mockFeed.loadMore).toHaveBeenCalledTimes(1);
  });
});
