import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { cardsService } from '@services/api/cards';
import { Card } from '@/types/card';
import logger from '@services/utils/logger';

interface CardsState {
  cards: Card[];
  isLoading: boolean;
  fetchCards: () => Promise<void>;
  reset: () => void;
}

export const useCardsStore = create<CardsState>()(
  immer((set) => ({
    cards: [],
    isLoading: false,

    fetchCards: async () => {
      try {
        set((s) => {
          s.isLoading = true;
        });
        const { cards } = await cardsService.getCards();
        set((s) => {
          s.cards = cards;
        });
      } catch (err) {
        logger.error('cards: fetch failed', { error: (err as Error).message });
      } finally {
        set((s) => {
          s.isLoading = false;
        });
      }
    },

    reset: () =>
      set((s) => {
        s.cards = [];
      }),
  })),
);
