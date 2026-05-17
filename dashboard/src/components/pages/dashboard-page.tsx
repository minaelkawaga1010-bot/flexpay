"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownLeft,
  Send,
  Plus,
  Clock,
  CreditCard,
  Receipt,
  Globe,
  QrCode,
  ArrowRight,
  DollarSign,
  RefreshCw,
  AlertCircle,
  Building2,
  Plane,
  UserCheck,
  Landmark,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// ── Animation Variants ──────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.07, duration: 0.45, ease: "easeOut" as const },
  }),
};

const stagger = {
  visible: { transition: { staggerChildren: 0.07 } },
};

// ── Types ───────────────────────────────────────────────────────
interface DashboardTransaction {
  id: string;
  userId: string;
  type: string;
  status: string;
  amount: number;
  currency: string;
  fee: number;
  description: string;
  reference: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface MonthlyVolumeItem {
  month: string;
  volume: number;
  count: number;
}

interface QuickStats {
  totalSentThisMonth: number;
  totalReceivedThisMonth: number;
  beneficiaryCount: number;
  pendingTransfers: number;
}

interface DashboardData {
  user: {
    id: string;
    fullName: string;
    phone: string;
    email: string;
    role: string;
    kycLevel: number;
    avatarUrl: string | null;
  };
  wallet: {
    id: string;
    isActive: boolean;
    balances: Array<{
      id: string;
      walletId: string;
      currency: string;
      amount: number;
      updatedAt: string;
    }>;
  };
  totalBalanceAED: number;
  recentTransactions: DashboardTransaction[];
  quickStats: QuickStats;
  monthlyVolume: MonthlyVolumeItem[];
}

// ── Fallback Mock Data ──────────────────────────────────────────
const fallbackData: DashboardData = {
  user: {
    id: "fallback",
    fullName: "Rajesh Kumar",
    phone: "+971501234567",
    email: "rajesh@example.com",
    role: "EMPLOYEE",
    kycLevel: 2,
    avatarUrl: null,
  },
  wallet: {
    id: "fallback-wallet",
    isActive: true,
    balances: [
      { id: "fb1", walletId: "fallback-wallet", currency: "AED", amount: 12500, updatedAt: new Date().toISOString() },
    ],
  },
  totalBalanceAED: 12500,
  recentTransactions: [
    { id: "fb-tx1", userId: "fallback", type: "SALARY_CREDIT", status: "COMPLETED", amount: 8500, currency: "AED", fee: 0, description: "Salary - Al Futtaim Group", reference: "SAL-001", metadata: null, createdAt: "2025-01-15T09:00:00Z", updatedAt: "2025-01-15T09:00:00Z" },
    { id: "fb-tx2", userId: "fallback", type: "REMITTANCE", status: "COMPLETED", amount: 2400, currency: "AED", fee: 18, description: "Remittance to India", reference: "REM-001", metadata: null, createdAt: "2025-01-14T14:30:00Z", updatedAt: "2025-01-14T14:30:00Z" },
    { id: "fb-tx3", userId: "fallback", type: "SPEND", status: "COMPLETED", amount: 485, currency: "AED", fee: 0, description: "DEWA Electricity Bill", reference: "PAY-001", metadata: null, createdAt: "2025-01-14T10:00:00Z", updatedAt: "2025-01-14T10:00:00Z" },
    { id: "fb-tx4", userId: "fallback", type: "P2P_RECEIVE", status: "PENDING", amount: 1500, currency: "AED", fee: 0, description: "Transfer from Amit S.", reference: "P2P-001", metadata: null, createdAt: "2025-01-13T16:00:00Z", updatedAt: "2025-01-13T16:00:00Z" },
    { id: "fb-tx5", userId: "fallback", type: "SPEND", status: "COMPLETED", amount: 320, currency: "AED", fee: 0, description: "Carrefour Supermarket", reference: "PAY-002", metadata: null, createdAt: "2025-01-13T12:00:00Z", updatedAt: "2025-01-13T12:00:00Z" },
    { id: "fb-tx6", userId: "fallback", type: "SPEND", status: "COMPLETED", amount: 100, currency: "AED", fee: 0, description: "Etisalat Mobile Recharge", reference: "PAY-003", metadata: null, createdAt: "2025-01-12T09:00:00Z", updatedAt: "2025-01-12T09:00:00Z" },
    { id: "fb-tx7", userId: "fallback", type: "SALARY_CREDIT", status: "PENDING", amount: 2200, currency: "AED", fee: 0, description: "Freelance Payment", reference: "SAL-002", metadata: null, createdAt: "2025-01-12T08:00:00Z", updatedAt: "2025-01-12T08:00:00Z" },
    { id: "fb-tx8", userId: "fallback", type: "P2P_SEND", status: "COMPLETED", amount: 3500, currency: "AED", fee: 5, description: "Rent Payment - Tenant", reference: "P2P-002", metadata: null, createdAt: "2025-01-11T11:00:00Z", updatedAt: "2025-01-11T11:00:00Z" },
  ],
  quickStats: {
    totalSentThisMonth: 3200,
    totalReceivedThisMonth: 8500,
    beneficiaryCount: 3,
    pendingTransfers: 2,
  },
  monthlyVolume: [
    { month: "Aug", volume: 3200, count: 8 },
    { month: "Sep", volume: 5100, count: 12 },
    { month: "Oct", volume: 4700, count: 10 },
    { month: "Nov", volume: 6300, count: 15 },
    { month: "Dec", volume: 8900, count: 20 },
    { month: "Jan", volume: 7500, count: 18 },
  ],
};

// ── Transaction Type Config ─────────────────────────────────────
const TX_TYPE_CONFIG: Record<
  string,
  {
    label: string;
    badgeClass: string;
    iconBg: string;
    iconColor: string;
    isCredit: boolean;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  SALARY_CREDIT: {
    label: "Salary",
    badgeClass: "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400 border-0",
    iconBg: "bg-green-50 dark:bg-green-950/40",
    iconColor: "text-green-600 dark:text-green-400",
    isCredit: true,
    Icon: Building2,
  },
  SPEND: {
    label: "Spent",
    badgeClass: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-0",
    iconBg: "bg-red-50 dark:bg-red-950/40",
    iconColor: "text-red-600 dark:text-red-400",
    isCredit: false,
    Icon: ArrowUpRight,
  },
  TOP_UP: {
    label: "Top Up",
    badgeClass: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-0",
    iconBg: "bg-emerald-50 dark:bg-emerald-950/40",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    isCredit: true,
    Icon: Plus,
  },
  REMITTANCE: {
    label: "Remittance",
    badgeClass: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-0",
    iconBg: "bg-amber-50 dark:bg-amber-950/40",
    iconColor: "text-amber-600 dark:text-amber-400",
    isCredit: false,
    Icon: Plane,
  },
  P2P_SEND: {
    label: "Sent",
    badgeClass: "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400 border-0",
    iconBg: "bg-orange-50 dark:bg-orange-950/40",
    iconColor: "text-orange-600 dark:text-orange-400",
    isCredit: false,
    Icon: Send,
  },
  P2P_RECEIVE: {
    label: "Received",
    badgeClass: "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400 border-0",
    iconBg: "bg-teal-50 dark:bg-teal-950/40",
    iconColor: "text-teal-600 dark:text-teal-400",
    isCredit: true,
    Icon: UserCheck,
  },
  WITHDRAW: {
    label: "Withdraw",
    badgeClass: "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400 border-0",
    iconBg: "bg-purple-50 dark:bg-purple-950/40",
    iconColor: "text-purple-600 dark:text-purple-400",
    isCredit: false,
    Icon: Landmark,
  },
};

function getTxConfig(type: string) {
  return (
    TX_TYPE_CONFIG[type] ?? TX_TYPE_CONFIG.SPEND
  );
}

// ── Helpers ──────────────────────────────────────────────────────
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-AE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function getTodayFormatted(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ── Type Badge ──────────────────────────────────────────────────
function TypeBadge({ type }: { type: string }) {
  const config = getTxConfig(type);
  return (
    <Badge className={`text-[11px] font-medium ${config.badgeClass}`}>
      {config.label}
    </Badge>
  );
}

// ── Status Badge ────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const statusMap: Record<string, { label: string; className: string }> = {
    COMPLETED: {
      label: "Completed",
      className:
        "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-0",
    },
    PENDING: {
      label: "Pending",
      className:
        "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-0",
    },
    FAILED: {
      label: "Failed",
      className:
        "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-0",
    },
  };
  const c = statusMap[status] ?? statusMap.PENDING;
  return (
    <Badge className={`text-[11px] font-medium ${c.className}`}>{c.label}</Badge>
  );
}

// ── Custom Tooltip ──────────────────────────────────────────────
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="text-sm font-semibold" style={{ color: p.color }}>
          {p.name}: AED {p.value.toLocaleString()}
        </p>
      ))}
    </div>
  );
}

// ── Transaction Row (shared between desktop & mobile) ───────────
function TransactionIcon({ type }: { type: string }) {
  const config = getTxConfig(type);
  const { Icon } = config;
  return (
    <div className={`flex size-9 items-center justify-center rounded-lg ${config.iconBg}`}>
      <Icon className={`size-4 ${config.iconColor}`} />
    </div>
  );
}

// ── Loading Skeleton ────────────────────────────────────────────
function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {/* Welcome Banner Skeleton */}
      <Skeleton className="h-[120px] w-full rounded-2xl" />

      {/* Balance Cards Skeleton */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-[120px] rounded-xl" />
        <Skeleton className="h-[120px] rounded-xl" />
        <Skeleton className="h-[120px] rounded-xl" />
        <Skeleton className="h-[120px] rounded-xl" />
      </div>

      {/* Chart + Quick Actions Skeleton */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-[360px] rounded-xl lg:col-span-2" />
        <Skeleton className="h-[360px] rounded-xl" />
      </div>

      {/* Transactions Skeleton */}
      <div className="rounded-xl border border-border p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between border-b py-3 last:border-0">
            <div className="flex items-center gap-3">
              <Skeleton className="size-9 rounded-lg" />
              <Skeleton className="h-4 w-48" />
            </div>
            <div className="flex items-center gap-6">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Error State ─────────────────────────────────────────────────
function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {/* Banner area placeholder */}
      <div className="h-[120px]" />

      <Card className="border-red-200 dark:border-red-900/50">
        <CardContent className="flex flex-col items-center justify-center gap-4 py-12">
          <div className="flex size-14 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/40">
            <AlertCircle className="size-7 text-red-500" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold text-foreground">
              Unable to load dashboard
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          </div>
          <Button
            onClick={onRetry}
            variant="outline"
            className="gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
          >
            <RefreshCw className="size-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────
export function DashboardPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard");
      if (!res.ok) {
        throw new Error(`Server responded with ${res.status}`);
      }
      const json = await res.json();
      if (!json || json.error) {
        throw new Error(json.error || "Invalid response from server");
      }
      setDashboardData(json);
    } catch (err) {
      console.error("Dashboard fetch error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      );
      // Graceful degradation: use fallback data
      setDashboardData(fallbackData);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Loading state
  if (isLoading) {
    return <DashboardSkeleton />;
  }

  // Error state (only if we also failed to set fallback data)
  if (error && !dashboardData) {
    return <ErrorState message={error} onRetry={fetchDashboard} />;
  }

  // Derive data from API with fallback
  const data = dashboardData ?? fallbackData;
  const userName = data.user?.fullName?.split(" ")[0] ?? "User";
  const totalBalance = data.totalBalanceAED ?? 0;
  const monthlyIncome = data.quickStats?.totalReceivedThisMonth ?? 0;
  const monthlySpent = data.quickStats?.totalSentThisMonth ?? 0;
  const pendingCount = data.quickStats?.pendingTransfers ?? 0;
  const transactions = data.recentTransactions ?? [];
  const chartData = data.monthlyVolume ?? [];

  return (
    <motion.div
      className="flex flex-col gap-6"
      initial="hidden"
      animate="visible"
      variants={stagger}
    >
      {/* ── 1. Welcome Banner ──────────────────────────────────── */}
      <motion.div variants={fadeUp} custom={0}>
        <Card className="overflow-hidden border-0 bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 py-0 shadow-lg dark:from-emerald-800 dark:via-emerald-900 dark:to-teal-950">
          <CardContent className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <h1 className="text-xl font-bold text-white sm:text-2xl">
                {getGreeting()}, {userName}{" "}
                <span className="inline-block animate-[wave_1.5s_ease-in-out_infinite]">
                  👋
                </span>
              </h1>
              <p className="text-sm text-emerald-100/80">{getTodayFormatted()}</p>
              <p className="mt-1 text-sm text-emerald-200/70">
                Here&apos;s what&apos;s happening with your wallet today.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <QuickActionButton
                icon={Send}
                label="Send Money"
                className="bg-white/15 text-white hover:bg-white/25 backdrop-blur-sm"
              />
              <QuickActionButton
                icon={Receipt}
                label="Pay Bills"
                className="bg-white/15 text-white hover:bg-white/25 backdrop-blur-sm"
              />
              <QuickActionButton
                icon={Plus}
                label="Top Up"
                className="bg-white/15 text-white hover:bg-white/25 backdrop-blur-sm"
              />
              <QuickActionButton
                icon={Globe}
                label="Remit"
                className="bg-white/15 text-white hover:bg-white/25 backdrop-blur-sm"
              />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── 2. Balance Overview Cards ──────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Total Balance */}
        <motion.div variants={fadeUp} custom={1}>
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-emerald-500 to-teal-600 py-0 shadow-md dark:from-emerald-700 dark:to-teal-800">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
                  <Wallet className="size-5 text-white" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-emerald-100/80">
                    Total Balance
                  </span>
                  <span className="text-2xl font-bold text-white">
                    AED {formatCurrency(totalBalance)}
                  </span>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-1 text-xs text-emerald-100/70">
                <DollarSign className="size-3" />
                <span>Across all accounts</span>
              </div>
            </CardContent>
            {/* Decorative circle */}
            <div className="absolute -right-4 -top-4 size-24 rounded-full bg-white/5" />
            <div className="absolute -bottom-6 -right-6 size-32 rounded-full bg-white/5" />
          </Card>
        </motion.div>

        {/* Monthly Income */}
        <motion.div variants={fadeUp} custom={2}>
          <Card className="border-emerald-100 py-0 transition-shadow hover:shadow-md dark:border-emerald-900/50">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/50">
                    <TrendingUp className="size-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-muted-foreground">
                      Monthly Income
                    </span>
                    <span className="text-xl font-bold text-foreground">
                      AED {formatCurrency(monthlyIncome)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <Badge className="bg-emerald-50 text-emerald-700 border-0 text-[11px] font-medium dark:bg-emerald-950/40 dark:text-emerald-400">
                    <TrendingUp className="size-3" />
                    {monthlyIncome > 0 ? "+" : ""}
                    {monthlyIncome > 0 ? "12.5%" : "0%"}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">this month</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Monthly Spent */}
        <motion.div variants={fadeUp} custom={3}>
          <Card className="border-emerald-100 py-0 transition-shadow hover:shadow-md dark:border-emerald-900/50">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-xl bg-orange-50 dark:bg-orange-950/50">
                    <TrendingDown className="size-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-muted-foreground">
                      Monthly Spent
                    </span>
                    <span className="text-xl font-bold text-foreground">
                      AED {formatCurrency(monthlySpent)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <Badge className="bg-orange-50 text-orange-700 border-0 text-[11px] font-medium dark:bg-orange-950/40 dark:text-orange-400">
                    <TrendingDown className="size-3" />
                    {monthlySpent > 0 ? "-" : ""}
                    {monthlySpent > 0 ? "5.2%" : "0%"}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">this month</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Pending Transactions */}
        <motion.div variants={fadeUp} custom={4}>
          <Card className="border-emerald-100 py-0 transition-shadow hover:shadow-md dark:border-emerald-900/50">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/50">
                    <Clock className="size-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-muted-foreground">
                      Pending
                    </span>
                    <span className="text-xl font-bold text-foreground">
                      {pendingCount}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <Badge className="bg-amber-50 text-amber-700 border-0 text-[11px] font-medium dark:bg-amber-950/40 dark:text-amber-400">
                    <Clock className="size-3" />
                    {pendingCount > 0 ? "Awaiting" : "Clear"}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">transactions</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ── 3. Chart + Quick Actions ───────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Transaction Activity Chart */}
        <motion.div variants={fadeUp} custom={5} className="lg:col-span-2">
          <Card className="border-emerald-100 dark:border-emerald-900/50">
            <CardHeader className="pb-0">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">
                    Transaction Activity
                  </CardTitle>
                  <CardDescription>
                    Monthly transaction volume
                  </CardDescription>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block size-2.5 rounded-full bg-emerald-500" />
                    <span className="text-muted-foreground">Volume</span>
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartData}
                    margin={{ top: 5, right: 10, left: -10, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="volumeGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor="oklch(0.556 0.17 155)"
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="100%"
                          stopColor="oklch(0.556 0.17 155)"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="oklch(0.9 0.01 155)"
                      className="dark:stroke-emerald-900/40"
                    />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 12, fill: "oklch(0.5 0.03 160)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: "oklch(0.5 0.03 160)" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="volume"
                      name="Volume"
                      stroke="oklch(0.556 0.17 155)"
                      strokeWidth={2.5}
                      fill="url(#volumeGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Quick Actions Panel */}
        <motion.div variants={fadeUp} custom={6}>
          <Card className="border-emerald-100 h-full dark:border-emerald-900/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Quick Actions</CardTitle>
              <CardDescription>Manage your money instantly</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ActionCard
                icon={Send}
                title="Send Money"
                description="Transfer to anyone instantly"
                color="emerald"
              />
              <ActionCard
                icon={Receipt}
                title="Pay Bills"
                description="DEWA, Etisalat, DU & more"
                color="teal"
              />
              <ActionCard
                icon={Globe}
                title="Remit Overseas"
                description="Send money home"
                color="amber"
              />
              <ActionCard
                icon={QrCode}
                title="Scan QR Code"
                description="Pay at stores easily"
                color="slate"
              />
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ── 4. Recent Transactions ─────────────────────────────── */}
      <motion.div variants={fadeUp} custom={7}>
        <Card className="border-emerald-100 dark:border-emerald-900/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  Recent Transactions
                </CardTitle>
                <CardDescription>Your latest wallet activity</CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
              >
                View All
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {transactions.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <Receipt className="size-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  No transactions yet
                </p>
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="pl-6">Description</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="pr-6 text-right">
                          Status
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transactions.map((tx) => {
                        const txConfig = getTxConfig(tx.type);
                        return (
                          <TableRow key={tx.id}>
                            <TableCell className="pl-6">
                              <div className="flex items-center gap-3">
                                <TransactionIcon type={tx.type} />
                                <span className="max-w-[220px] truncate text-sm font-medium">
                                  {tx.description}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <TypeBadge type={tx.type} />
                            </TableCell>
                            <TableCell className="text-right">
                              <span
                                className={`text-sm font-semibold ${
                                  txConfig.isCredit
                                    ? "text-green-600 dark:text-green-400"
                                    : "text-red-600 dark:text-red-400"
                                }`}
                              >
                                {txConfig.isCredit ? "+" : "-"}AED{" "}
                                {formatCurrency(tx.amount)}
                              </span>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {formatDate(tx.createdAt)}
                            </TableCell>
                            <TableCell className="pr-6 text-right">
                              <StatusBadge status={tx.status} />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile cards */}
                <div className="flex flex-col gap-2 px-4 pb-4 md:hidden max-h-[480px] overflow-y-auto">
                  {transactions.map((tx) => {
                    const txConfig = getTxConfig(tx.type);
                    return (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between rounded-lg border border-border p-3 transition-colors hover:bg-muted/50"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="shrink-0">
                            <TransactionIcon type={tx.type} />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="truncate text-sm font-medium">
                              {tx.description}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-muted-foreground">
                                {formatDate(tx.createdAt)}
                              </span>
                              <TypeBadge type={tx.type} />
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0 ml-3">
                          <span
                            className={`text-sm font-semibold ${
                              txConfig.isCredit
                                ? "text-green-600 dark:text-green-400"
                                : "text-red-600 dark:text-red-400"
                            }`}
                          >
                            {txConfig.isCredit ? "+" : "-"}AED{" "}
                            {formatCurrency(tx.amount)}
                          </span>
                          <StatusBadge status={tx.status} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

// ── Sub-components ──────────────────────────────────────────────
function QuickActionButton({
  icon: Icon,
  label,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`h-auto flex-col gap-1 rounded-xl px-3 py-2.5 border-0 ${className ?? ""}`}
    >
      <Icon className="size-4" />
      <span className="text-[11px] font-medium">{label}</span>
    </Button>
  );
}

function ActionCard({
  icon: Icon,
  title,
  description,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  color: "emerald" | "teal" | "amber" | "slate";
}) {
  const colorMap = {
    emerald: {
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
      icon: "text-emerald-600 dark:text-emerald-400",
      hover:
        "hover:border-emerald-200 dark:hover:border-emerald-800/50 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20",
    },
    teal: {
      bg: "bg-teal-50 dark:bg-teal-950/40",
      icon: "text-teal-600 dark:text-teal-400",
      hover:
        "hover:border-teal-200 dark:hover:border-teal-800/50 hover:bg-teal-50/50 dark:hover:bg-teal-950/20",
    },
    amber: {
      bg: "bg-amber-50 dark:bg-amber-950/40",
      icon: "text-amber-600 dark:text-amber-400",
      hover:
        "hover:border-amber-200 dark:hover:border-amber-800/50 hover:bg-amber-50/50 dark:hover:bg-amber-950/20",
    },
    slate: {
      bg: "bg-slate-50 dark:bg-slate-800/40",
      icon: "text-slate-600 dark:text-slate-400",
      hover:
        "hover:border-slate-200 dark:hover:border-slate-700/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/20",
    },
  };

  const c = colorMap[color];

  return (
    <button
      className={`flex w-full items-center gap-3 rounded-xl border border-border p-3.5 text-left transition-all duration-200 ${c.hover} cursor-pointer`}
    >
      <div
        className={`flex size-10 items-center justify-center rounded-lg ${c.bg}`}
      >
        <Icon className={`size-5 ${c.icon}`} />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      <ArrowRight className="ml-auto size-4 text-muted-foreground/50" />
    </button>
  );
}
