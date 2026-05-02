import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { AuthUser } from '@types/user';

interface UserState {
  user: AuthUser | null;
  setUser: (user: AuthUser) => void;
  updateBalance: (balance: number) => void;
  patchUser: (patch: Partial<AuthUser>) => void;
  clearUser: () => void;
}

export const useUserStore = create<UserState>()(
  immer((set) => ({
    user: null,
    setUser: (user) =>
      set((state) => {
        state.user = user;
      }),
    updateBalance: (balance) =>
      set((state) => {
        if (state.user) state.user.balance = balance;
      }),
    patchUser: (patch) =>
      set((state) => {
        if (state.user) Object.assign(state.user, patch);
      }),
    clearUser: () =>
      set((state) => {
        state.user = null;
      }),
  })),
);
