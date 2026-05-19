import { create } from "zustand";

interface User {
  fullName: string;
  phone: string;
  role: string;
  kycLevel: number;
}

interface AppState {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  user: User | null;
  setUser: (user: User | null) => void;
  isMobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
}

const defaultUser: User = {
  fullName: "Rajesh Kumar",
  phone: "+971501234567",
  role: "EMPLOYEE",
  kycLevel: 2,
};

export const useAppStore = create<AppState>((set) => ({
  activeTab: "backend-engineering",
  setActiveTab: (tab) => set({ activeTab: tab }),
  user: defaultUser,
  setUser: (user) => set({ user }),
  isMobileSidebarOpen: false,
  setMobileSidebarOpen: (open) => set({ isMobileSidebarOpen: open }),
}));
