"use client";

import { AppShell } from "@/components/app-shell";
import { useAppStore } from "@/store/app-store";
import { DashboardPage } from "@/components/pages/dashboard-page";
import { WalletPage } from "@/components/pages/wallet-page";
import { TransactionsPage } from "@/components/pages/transactions-page";
import { RemittancePage } from "@/components/pages/remittance-page";
import { CardsPage } from "@/components/pages/cards-page";
import { HafizaPage } from "@/components/pages/hafiza-page";
import { CreditScorePage } from "@/components/pages/credit-score-page";
import { LoyaltyPage } from "@/components/pages/loyalty-page";
import { AMLPage } from "@/components/pages/aml-page";
import { SavingsPage } from "@/components/pages/savings-page";
import { LoansPage } from "@/components/pages/loans-page";
import { VoiceAIPage } from "@/components/pages/voice-ai-page";
import { ArchitecturePage } from "@/components/pages/architecture-page";
import { SREObservabilityPage } from "@/components/pages/sre-observability-page";
import { CICDPipelinePage } from "@/components/pages/cicd-pipeline-page";
import { InfrastructurePage } from "@/components/pages/infrastructure-page";
import { ReferralsPage } from "@/components/pages/referrals-page";
import { NotificationsPage } from "@/components/pages/notifications-page";
import { OffersPage } from "@/components/pages/offers-page";
import { BoardDeckPage } from "@/components/pages/board-deck-page";
import { OpsIntelPage } from "@/components/pages/ops-intel-page";
import { SystemArchitecturePage } from "@/components/pages/system-architecture-page";
import { BackendOverviewPage } from "@/components/pages/backend-overview-page";
import { motion } from "framer-motion";
import { Send, CreditCard, TrendingUp, Shield } from "lucide-react";

const pageMap: Record<string, React.ComponentType> = {
  dashboard: DashboardPage,
  wallet: WalletPage,
  transactions: TransactionsPage,
  send: RemittancePage,
  cards: CardsPage,
  hafiza: HafizaPage,
  "credit-score": CreditScorePage,
  loyalty: LoyaltyPage,
  savings: SavingsPage,
  loans: LoansPage,
  referrals: ReferralsPage,
  notifications: NotificationsPage,
  offers: OffersPage,
  compliance: AMLPage,
  "voice-ai": VoiceAIPage,
  architecture: ArchitecturePage,
  "sre-observability": SREObservabilityPage,
  "cicd-pipeline": CICDPipelinePage,
  infrastructure: InfrastructurePage,
  "board-deck": BoardDeckPage,
  "ops-intel": OpsIntelPage,
  "system-architecture": SystemArchitecturePage,
  "backend-engineering": BackendOverviewPage,
};

export default function Home() {
  const { activeTab } = useAppStore();

  const PageComponent = pageMap[activeTab];

  if (PageComponent) {
    return (
      <AppShell>
        <PageComponent />
      </AppShell>
    );
  }

  // Default placeholder for tabs without dedicated pages
  return (
    <AppShell>
      <div className="flex flex-col items-center justify-center gap-6 py-20">
        <div className="brand-gradient flex size-16 items-center justify-center rounded-2xl shadow-lg">
          <svg
            className="size-8 text-white"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
            <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
            <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
          </svg>
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Welcome to Flex<span className="text-emerald-600">Pay</span>
          </h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground sm:text-base">
            Your AI-powered digital wallet platform for the UAE.
            Navigate using the sidebar to explore all features.
          </p>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InfoCard
            title="Send & Remit"
            description="Send money home instantly"
            accent
            icon={<Send className="size-5 text-emerald-600" />}
          />
          <InfoCard
            title="Smart Savings"
            description="Automated Hafiza goals"
            icon={<TrendingUp className="size-5 text-emerald-600" />}
          />
          <InfoCard
            title="My Cards"
            description="Virtual & physical cards"
            icon={<CreditCard className="size-5 text-emerald-600" />}
          />
          <InfoCard
            title="Compliance"
            description="KYC & AML status"
            icon={<Shield className="size-5 text-emerald-600" />}
          />
        </div>
      </div>
    </AppShell>
  );
}

function InfoCard({
  title,
  description,
  accent = false,
  icon,
}: {
  title: string;
  description: string;
  accent?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className={`rounded-xl border p-4 transition-shadow hover:shadow-md ${
        accent
          ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800/50 dark:bg-emerald-950/20"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </motion.div>
  );
}
