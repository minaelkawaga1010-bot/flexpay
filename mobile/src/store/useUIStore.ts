import { create } from 'zustand';

interface Toast {
  id: string;
  message: string;
  variant: 'info' | 'success' | 'error';
}

interface UIState {
  toasts: Toast[];
  globalLoading: boolean;
  showToast: (message: string, variant?: Toast['variant']) => void;
  hideToast: (id: string) => void;
  setGlobalLoading: (v: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  toasts: [],
  globalLoading: false,
  showToast: (message, variant = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3000);
  },
  hideToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setGlobalLoading: (v) => set({ globalLoading: v }),
}));
