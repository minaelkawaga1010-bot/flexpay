import { useCallback, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { cardsService } from '@services/api/cards';
import { useCardsStore } from '@store/useCardsStore';
import type { Card, CardStatus } from '@/types/card';
import logger from '@services/utils/logger';

/**
 * useCardFreeze — optimistic freeze / unfreeze toggle.
 *
 * Flips the local `useCardsStore` row IMMEDIATELY for instant UI
 * feedback, then issues the corresponding /freeze or /unfreeze call.
 * On rail failure we roll back the local row and surface a typed
 * error. The hook is a thin coordinator — the source of truth is the
 * post-call response from the backend, which gets merged in last.
 *
 * Idempotency: a fresh UUIDv4 per attempt. Re-clicks during the
 * pending phase are guarded against by the `isToggling` flag.
 */

interface UseCardFreezeView {
  isToggling: boolean;
  error: { code: string; message: string } | null;
  toggle: (card: Card) => Promise<void>;
}

export function useCardFreeze(): UseCardFreezeView {
  const [isToggling, setIsToggling] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const toggle = useCallback(async (card: Card) => {
    if (isToggling) return;
    setError(null);

    const wasActive = card.status === 'ACTIVE';
    const optimisticStatus: CardStatus = wasActive ? 'BLOCKED' : 'ACTIVE';

    setIsToggling(true);
    // Optimistic — flip the store row so the UI animates immediately.
    applyStatus(card.id, optimisticStatus);

    try {
      const { card: updated } = wasActive
        ? await cardsService.freezeCard(card.id, uuid())
        : await cardsService.unfreezeCard(card.id, uuid());
      // Merge the authoritative server-side row over the optimistic one.
      applyStatus(updated.id, updated.status);
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'FREEZE_TOGGLE_FAILED';
      const message = (err as Error).message ?? 'Could not update the card. Please try again.';
      logger.warn('card-freeze: toggle failed — rolling back', { cardId: card.id, code });
      // Rollback the optimistic update.
      applyStatus(card.id, card.status);
      setError({ code, message });
    } finally {
      setIsToggling(false);
    }
  }, [isToggling]);

  return { isToggling, error, toggle };
}

function applyStatus(cardId: string, status: CardStatus): void {
  useCardsStore.setState((s) => {
    s.cards = s.cards.map((c) => (c.id === cardId ? { ...c, status } : c));
  });
}
