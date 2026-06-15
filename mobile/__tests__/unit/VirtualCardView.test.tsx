/**
 * VirtualCardView — integration tests.
 *
 * Coverage:
 *   • Masked → Unmasked transition via the reveal hook (biometric
 *     success → API call → render).
 *   • Biometric cancel short-circuits BEFORE any network call.
 *   • Auto-clear timer re-masks the PAN without user action.
 *   • Freeze toggle calls the freeze endpoint with an idempotency
 *     key, flips the local store optimistically, and rolls back on
 *     rail failure.
 *   • Compliance badge is mounted on the surface regardless of state.
 *   • Status tag mirrors the card status (ACTIVE / BLOCKED / EXPIRED).
 */

jest.mock('react-native-linear-gradient', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

const mockBiometrics = {
  available: true,
  type: 'TouchID' as const,
  authenticate: jest.fn().mockResolvedValue(true),
  enableBiometrics: jest.fn(),
};
jest.mock('@hooks/useBiometrics', () => ({
  useBiometrics: () => mockBiometrics,
}));

const mockApi = {
  freezeCard: jest.fn(),
  unfreezeCard: jest.fn(),
  revealCard: jest.fn(),
};
// IMPORTANT: jest.mock factory is hoisted ABOVE the `const mockApi` line.
// The factory must NOT touch mockApi at evaluation time — only at CALL time.
// We pass through method-by-method so the mockApi reference is dereferenced
// when the production code actually invokes the method, by which point
// mockApi is fully initialised.
jest.mock('@services/api/cards', () => ({
  cardsService: {
    revealCard: (...args: unknown[]) => (mockApi.revealCard as any)(...args),
    freezeCard: (...args: unknown[]) => (mockApi.freezeCard as any)(...args),
    unfreezeCard: (...args: unknown[]) => (mockApi.unfreezeCard as any)(...args),
  },
}));

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { VirtualCardView } from '@components/cards/VirtualCardView';
import { useCardsStore } from '@store/useCardsStore';
import type { Card } from '@/types/card';

const makeCard = (over: Partial<Card> = {}): Card => ({
  id: 'card-1',
  type: 'VIRTUAL',
  status: 'ACTIVE',
  last4: '4321',
  brand: 'MASTERCARD',
  expiryMonth: 12,
  expiryYear: 2030,
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  mockBiometrics.authenticate.mockResolvedValue(true);
  mockBiometrics.available = true;
  useCardsStore.setState({ cards: [makeCard()], isLoading: false });
});

// ───────────────────────────────────────────────────────────────────
// Default (masked) render
// ───────────────────────────────────────────────────────────────────

describe('VirtualCardView — masked default', () => {
  it('renders the masked PAN (•••• •••• •••• 4321)', () => {
    const { getByTestId, queryByTestId } = render(<VirtualCardView card={makeCard()} />);
    expect(getByTestId('virtual-card-pan-masked').props.children).toContain('4321');
    expect(queryByTestId('virtual-card-pan-revealed')).toBeNull();
    expect(queryByTestId('virtual-card-cvv')).toBeNull();
  });

  it('renders the holder name uppercased + masked expiry', () => {
    const { getByTestId } = render(
      <VirtualCardView card={makeCard()} cardholderName="Mina Kawaga" />,
    );
    expect(getByTestId('virtual-card-holder').props.children).toBe('MINA KAWAGA');
    expect(getByTestId('virtual-card-expiry').props.children).toBe('12/30');
  });

  it('mounts the CBUAE compliance badge', () => {
    const { getByTestId } = render(<VirtualCardView card={makeCard()} />);
    expect(getByTestId('virtual-card-compliance-badge')).toBeTruthy();
  });

  it('mirrors card.status in the status tag', () => {
    const { getByTestId, rerender } = render(<VirtualCardView card={makeCard({ status: 'ACTIVE' })} />);
    expect(getByTestId('virtual-card-status-ACTIVE')).toBeTruthy();
    rerender(<VirtualCardView card={makeCard({ status: 'BLOCKED' })} />);
    expect(getByTestId('virtual-card-status-BLOCKED')).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────
// Reveal — biometric gate + API
// ───────────────────────────────────────────────────────────────────

describe('VirtualCardView — reveal interaction', () => {
  it('unmasks the PAN + CVV after successful biometric + API', async () => {
    mockApi.revealCard.mockResolvedValue({
      pan: '5555555555554321',
      cvv: '321',
      expiryMonth: 12,
      expiryYear: 2030,
    });

    const { getByTestId, queryByTestId } = render(<VirtualCardView card={makeCard()} />);

    fireEvent.press(getByTestId('virtual-card-reveal-button'));

    await waitFor(() => expect(mockBiometrics.authenticate).toHaveBeenCalled());
    await waitFor(() => expect(mockApi.revealCard).toHaveBeenCalledWith('card-1'));
    await waitFor(() => expect(queryByTestId('virtual-card-pan-revealed')).toBeTruthy());

    expect(getByTestId('virtual-card-pan-revealed').props.children).toBe(
      '5555 5555 5555 4321',
    );
    expect(getByTestId('virtual-card-cvv').props.children).toBe('321');
  });

  it('cancelled biometrics short-circuits BEFORE the API call', async () => {
    mockBiometrics.authenticate.mockResolvedValue(false);
    const { getByTestId, queryByTestId } = render(<VirtualCardView card={makeCard()} />);

    fireEvent.press(getByTestId('virtual-card-reveal-button'));
    await waitFor(() => expect(mockBiometrics.authenticate).toHaveBeenCalled());

    expect(mockApi.revealCard).not.toHaveBeenCalled();
    expect(queryByTestId('virtual-card-pan-revealed')).toBeNull();
  });

  it('surfaces a BIOMETRICS_UNAVAILABLE error and refuses to fetch when sensor is absent', async () => {
    mockBiometrics.available = false;
    const { getByTestId, queryByTestId } = render(<VirtualCardView card={makeCard()} />);

    fireEvent.press(getByTestId('virtual-card-reveal-button'));
    await waitFor(() => expect(queryByTestId('virtual-card-reveal-error')).toBeTruthy());
    expect(mockApi.revealCard).not.toHaveBeenCalled();
  });

  it('Hide button re-masks the PAN', async () => {
    mockApi.revealCard.mockResolvedValue({
      pan: '5555555555554321',
      cvv: '321',
      expiryMonth: 12,
      expiryYear: 2030,
    });
    const { getByTestId, queryByTestId } = render(<VirtualCardView card={makeCard()} />);
    fireEvent.press(getByTestId('virtual-card-reveal-button'));
    await waitFor(() => expect(queryByTestId('virtual-card-pan-revealed')).toBeTruthy());

    // Press again — toggles hide.
    fireEvent.press(getByTestId('virtual-card-reveal-button'));
    await waitFor(() => expect(queryByTestId('virtual-card-pan-revealed')).toBeNull());
    expect(queryByTestId('virtual-card-pan-masked')).toBeTruthy();
  });

  it('auto-clears the PAN after the timeout fires', async () => {
    jest.useFakeTimers();
    mockApi.revealCard.mockResolvedValue({
      pan: '5555555555554321',
      cvv: '321',
      expiryMonth: 12,
      expiryYear: 2030,
    });
    const { getByTestId, queryByTestId } = render(<VirtualCardView card={makeCard()} />);

    fireEvent.press(getByTestId('virtual-card-reveal-button'));
    // Flush the pending promises (biometric prompt + API) so the hook
    // transitions into 'revealed' and starts the timer.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(queryByTestId('virtual-card-pan-revealed')).toBeTruthy();

    // Default auto-clear is 30s.
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(queryByTestId('virtual-card-pan-revealed')).toBeNull();
    expect(queryByTestId('virtual-card-pan-masked')).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────
// Freeze toggle
// ───────────────────────────────────────────────────────────────────

describe('VirtualCardView — freeze toggle', () => {
  it('calls /cards/:id/freeze on first toggle and updates the local store', async () => {
    mockApi.freezeCard.mockResolvedValue({
      card: makeCard({ status: 'BLOCKED' }),
    });
    const { getByTestId } = render(<VirtualCardView card={makeCard()} />);

    fireEvent(getByTestId('virtual-card-freeze-toggle'), 'valueChange', true);

    await waitFor(() => expect(mockApi.freezeCard).toHaveBeenCalledTimes(1));
    expect(mockApi.freezeCard).toHaveBeenCalledWith(
      'card-1',
      expect.any(String),
    );
    // The store row has been flipped to BLOCKED.
    expect(useCardsStore.getState().cards[0].status).toBe('BLOCKED');
  });

  it('calls /cards/:id/unfreeze when the card is already frozen', async () => {
    const frozen = makeCard({ status: 'BLOCKED' });
    useCardsStore.setState({ cards: [frozen], isLoading: false });
    mockApi.unfreezeCard.mockResolvedValue({
      card: makeCard({ status: 'ACTIVE' }),
    });

    const { getByTestId } = render(<VirtualCardView card={frozen} />);
    fireEvent(getByTestId('virtual-card-freeze-toggle'), 'valueChange', false);

    await waitFor(() => expect(mockApi.unfreezeCard).toHaveBeenCalledTimes(1));
    expect(useCardsStore.getState().cards[0].status).toBe('ACTIVE');
  });

  it('rolls back the optimistic update if the rail call fails', async () => {
    mockApi.freezeCard.mockRejectedValue(new Error('rail down'));
    const { getByTestId } = render(<VirtualCardView card={makeCard()} />);

    fireEvent(getByTestId('virtual-card-freeze-toggle'), 'valueChange', true);

    await waitFor(() => expect(getByTestId('virtual-card-freeze-error')).toBeTruthy());
    // Rollback to ACTIVE.
    expect(useCardsStore.getState().cards[0].status).toBe('ACTIVE');
  });

  it('hides revealed PAN automatically when the card is frozen', async () => {
    mockApi.revealCard.mockResolvedValue({
      pan: '5555555555554321',
      cvv: '321',
      expiryMonth: 12,
      expiryYear: 2030,
    });
    mockApi.freezeCard.mockResolvedValue({
      card: makeCard({ status: 'BLOCKED' }),
    });
    const { getByTestId, queryByTestId } = render(<VirtualCardView card={makeCard()} />);

    fireEvent.press(getByTestId('virtual-card-reveal-button'));
    await waitFor(() => expect(queryByTestId('virtual-card-pan-revealed')).toBeTruthy());

    fireEvent(getByTestId('virtual-card-freeze-toggle'), 'valueChange', true);

    await waitFor(() => expect(queryByTestId('virtual-card-pan-revealed')).toBeNull());
  });

  it('disables the toggle on EXPIRED cards (terminal state)', () => {
    const { getByTestId } = render(<VirtualCardView card={makeCard({ status: 'EXPIRED' })} />);
    const sw = getByTestId('virtual-card-freeze-toggle');
    expect(sw.props.disabled).toBe(true);
  });
});
