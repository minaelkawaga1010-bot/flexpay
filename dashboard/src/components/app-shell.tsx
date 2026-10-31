"use client";

import { useEffect } from "react";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarTrigger,
  SidebarRail,
} from "@/components/ui/sidebar";
import { SidebarNav } from "@/components/sidebar-nav";
import { useAppStore } from "@/store/app-store";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { activeTab } = useAppStore();

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="border-0">
        <SidebarContent className="p-0">
          <SidebarNav />
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md sm:px-6">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground/90">
              {formatTabLabel(activeTab)}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div
              className="flex items-center gap-1.5"
              role="status"
              aria-live="polite"
              aria-label="Connection status: connected"
            >
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-xs text-muted-foreground">AED</span>
            </div>
            <Separator orientation="vertical" className="h-4" />
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function formatTabLabel(tab: string): string {
  const labels: Record<string, string> = {
    dashboard: "Dashboard",
    wallet: "Wallet",
    transactions: "Transactions",
    send: "Send & Remit",
    cards: "Cards",
    hafiza: "Hafiza Savings",
    "credit-score": "Credit Score",
    loyalty: "Loyalty",
    savings: "Savings Goals",
    loans: "Loans & EWA",
    referrals: "Referrals",
    notifications: "Notifications",
    offers: "Offers & Cashback",
    compliance: "Compliance",
    architecture: "Backend Architecture",
    "sre-observability": "SRE & Observability",
    "cicd-pipeline": "CI/CD Pipeline",
    infrastructure: "Infrastructure",
    "board-deck": "Board Report",
    "system-architecture": "System Architecture",
  };
  return labels[tab] ?? "Dashboard";
}
