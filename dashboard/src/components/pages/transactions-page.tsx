"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Wallet,
  ShoppingCart,
  ArrowUpRight,
  ArrowDownLeft,
  CreditCard,
  Banknote,
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle2,
  XCircle,
  Receipt,
  Landmark,
  CircleDollarSign,
  Filter,
  ArrowUpDown,
  FileText,
  Loader2,
  RotateCcw,
  ChevronDown,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

// ─── Types ─────────────────────────────────────────────────────────────────────
type TxType =
  | "SALARY_CREDIT"
  | "SPEND"
  | "TOP_UP"
  | "REMITTANCE"
  | "P2P_SEND"
  | "P2P_RECEIVE"
  | "WITHDRAW"
  | "REFUND";

type TxStatus = "COMPLETED" | "PENDING" | "FAILED" | "CANCELLED";

interface Transaction {
  id: string;
  userId?: string;
  type: TxType;
  status: TxStatus;
  amount: number;
  currency: string;
  fee: number;
  description: string;
  reference?: string | null;
  metadata?: unknown;
  createdAt: string; // ISO string from API
  updatedAt?: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

type DateRange = "all" | "today" | "week" | "month" | "3months";

// ─── Mock Data (fallback if API fails) ────────────────────────────────────────
const mockTransactions: Transaction[] = [
  {
    id: "mock-1",
    type: "SALARY_CREDIT",
    description: "Monthly salary - Al Fardan Group",
    amount: 8500,
    currency: "AED",
    status: "COMPLETED",
    fee: 0,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: "mock-2",
    type: "SPEND",
    description: "Carrefour Supermarket",
    amount: 234.5,
    currency: "AED",
    status: "COMPLETED",
    fee: 1.67,
    createdAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: "mock-3",
    type: "REMITTANCE",
    description: "Remittance to India - Wise",
    amount: 2000,
    currency: "AED",
    status: "COMPLETED",
    fee: 15,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: "mock-4",
    type: "TOP_UP",
    description: "Bank transfer top-up - ADCB",
    amount: 3000,
    currency: "AED",
    status: "COMPLETED",
    fee: 0,
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: "mock-5",
    type: "P2P_SEND",
    description: "Sent to Amit Sharma",
    amount: 500,
    currency: "AED",
    status: "COMPLETED",
    fee: 2.5,
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
  {
    id: "mock-6",
    type: "SPEND",
    description: "Uber ride - Airport to Marina",
    amount: 78.0,
    currency: "AED",
    status: "COMPLETED",
    fee: 0,
    createdAt: new Date(Date.now() - 86400000 * 4).toISOString(),
  },
  {
    id: "mock-7",
    type: "P2P_RECEIVE",
    description: "Received from Priya Patel",
    amount: 1200,
    currency: "AED",
    status: "COMPLETED",
    fee: 0,
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
  {
    id: "mock-8",
    type: "SPEND",
    description: "LuLu Hypermarket - Household items",
    amount: 456.75,
    currency: "AED",
    status: "PENDING",
    fee: 3.24,
    createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
  },
  {
    id: "mock-9",
    type: "WITHDRAW",
    description: "ATM Withdrawal - Emirates NBD",
    amount: 1000,
    currency: "AED",
    status: "COMPLETED",
    fee: 2.0,
    createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
  },
  {
    id: "mock-10",
    type: "TOP_UP",
    description: "Cash deposit - Exchange House",
    amount: 5000,
    currency: "AED",
    status: "FAILED",
    fee: 0,
    createdAt: new Date(Date.now() - 86400000 * 8).toISOString(),
  },
  {
    id: "mock-11",
    type: "SPEND",
    description: "Noon.com - Electronics",
    amount: 349.0,
    currency: "AED",
    status: "COMPLETED",
    fee: 2.47,
    createdAt: new Date(Date.now() - 86400000 * 10).toISOString(),
  },
  {
    id: "mock-12",
    type: "REMITTANCE",
    description: "Remittance to Philippines - GCash",
    amount: 1500,
    currency: "AED",
    status: "COMPLETED",
    fee: 12,
    createdAt: new Date(Date.now() - 86400000 * 12).toISOString(),
  },
  {
    id: "mock-13",
    type: "SALARY_CREDIT",
    description: "Monthly salary - Al Fardan Group",
    amount: 8500,
    currency: "AED",
    status: "COMPLETED",
    fee: 0,
    createdAt: new Date(Date.now() - 86400000 * 32).toISOString(),
  },
  {
    id: "mock-14",
    type: "SPEND",
    description: "Talabat food delivery",
    amount: 65.0,
    currency: "AED",
    status: "COMPLETED",
    fee: 0.46,
    createdAt: new Date(Date.now() - 86400000 * 15).toISOString(),
  },
  {
    id: "mock-15",
    type: "P2P_SEND",
    description: "Sent to Suresh Kumar",
    amount: 250,
    currency: "AED",
    status: "PENDING",
    fee: 1.25,
    createdAt: new Date(Date.now() - 1800000).toISOString(),
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────────
const CREDIT_TYPES: TxType[] = [
  "SALARY_CREDIT",
  "TOP_UP",
  "P2P_RECEIVE",
  "REFUND",
];

function isCredit(type: TxType): boolean {
  return CREDIT_TYPES.includes(type);
}

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  return `${Math.floor(diffDay / 30)}mo ago`;
}

function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTypeConfig(type: TxType) {
  const map: Record<
    TxType,
    {
      icon: React.ElementType;
      label: string;
      iconBg: string;
      badgeClass: string;
    }
  > = {
    SALARY_CREDIT: {
      icon: Wallet,
      label: "Salary",
      iconBg: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400",
      badgeClass:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    },
    SPEND: {
      icon: ShoppingCart,
      label: "Spend",
      iconBg: "bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400",
      badgeClass:
        "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400",
    },
    TOP_UP: {
      icon: CircleDollarSign,
      label: "Top Up",
      iconBg: "bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400",
      badgeClass:
        "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400",
    },
    REMITTANCE: {
      icon: Landmark,
      label: "Remittance",
      iconBg: "bg-cyan-100 text-cyan-600 dark:bg-cyan-900/40 dark:text-cyan-400",
      badgeClass:
        "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400",
    },
    P2P_SEND: {
      icon: ArrowUpRight,
      label: "P2P Send",
      iconBg: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400",
      badgeClass:
        "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    },
    P2P_RECEIVE: {
      icon: ArrowDownLeft,
      label: "P2P Receive",
      iconBg: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400",
      badgeClass:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    },
    WITHDRAW: {
      icon: Banknote,
      label: "Withdraw",
      iconBg: "bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400",
      badgeClass:
        "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400",
    },
    REFUND: {
      icon: RotateCcw,
      label: "Refund",
      iconBg: "bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400",
      badgeClass:
        "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400",
    },
  };
  return map[type];
}

function getStatusConfig(status: TxStatus) {
  const map: Record<
    TxStatus,
    { icon: React.ElementType; label: string; badgeClass: string }
  > = {
    COMPLETED: {
      icon: CheckCircle2,
      label: "Completed",
      badgeClass:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    },
    PENDING: {
      icon: Clock,
      label: "Pending",
      badgeClass:
        "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    },
    FAILED: {
      icon: XCircle,
      label: "Failed",
      badgeClass:
        "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    },
    CANCELLED: {
      icon: XCircle,
      label: "Cancelled",
      badgeClass:
        "bg-gray-100 text-gray-700 dark:bg-gray-900/40 dark:text-gray-400",
    },
  };
  return map[status];
}

function filterByDate(tx: Transaction, range: DateRange): boolean {
  const now = new Date();
  const txDate = new Date(tx.createdAt);
  switch (range) {
    case "today":
      return txDate.toDateString() === now.toDateString();
    case "week": {
      const weekAgo = new Date(now.getTime() - 7 * 86400000);
      return txDate >= weekAgo;
    }
    case "month": {
      const monthAgo = new Date(now.getTime() - 30 * 86400000);
      return txDate >= monthAgo;
    }
    case "3months": {
      const threeMonthsAgo = new Date(now.getTime() - 90 * 86400000);
      return txDate >= threeMonthsAgo;
    }
    case "all":
    default:
      return true;
  }
}

// ─── Loading Skeletons ─────────────────────────────────────────────────────────
function StatSkeleton() {
  return (
    <Card className="flex-1">
      <CardContent className="flex items-center gap-3 p-4">
        <Skeleton className="size-10 rounded-xl" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}

function TransactionSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
      <Skeleton className="size-10 shrink-0 rounded-xl" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-48 max-w-full" />
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-16" />
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Stat cards skeleton */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
      </div>

      {/* Filter bar skeleton */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-9 w-full rounded-md" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        </CardContent>
      </Card>

      {/* Transaction list skeleton */}
      <Card>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <div className="py-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <TransactionSkeleton key={i} />
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── Summary Stat Card ─────────────────────────────────────────────────────────
function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <Card className="flex-1">
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${color}`}
        >
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="text-sm font-bold text-foreground">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Empty State ────────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center gap-4 py-16"
    >
      <div className="flex size-20 items-center justify-center rounded-2xl bg-muted">
        <FileText className="size-10 text-muted-foreground/50" />
      </div>
      <div className="text-center">
        <h3 className="text-lg font-semibold text-foreground">
          No transactions found
        </h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Try adjusting your filters or search query to find what you&apos;re
          looking for.
        </p>
      </div>
    </motion.div>
  );
}

// ─── Transaction Row ───────────────────────────────────────────────────────────
function TransactionRow({ tx, index }: { tx: Transaction; index: number }) {
  const typeConfig = getTypeConfig(tx.type);
  const statusConfig = getStatusConfig(tx.status);
  const TypeIcon = typeConfig.icon;
  const StatusIcon = statusConfig.icon;
  const credit = isCredit(tx.type);

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
      className="group"
    >
      <div
        className="flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-accent/50 sm:px-4"
        title={formatFullDate(tx.createdAt)}
      >
        {/* Icon */}
        <div
          className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${typeConfig.iconBg}`}
        >
          <TypeIcon className="size-5" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {tx.description || tx.type}
          </p>
          <div className="mt-0.5 flex items-center gap-2">
            <Badge
              variant="secondary"
              className={`h-5 rounded-md px-1.5 text-[10px] font-medium border-0 ${typeConfig.badgeClass}`}
            >
              {typeConfig.label}
            </Badge>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {formatRelativeTime(tx.createdAt)}
            </span>
          </div>
        </div>

        {/* Amount + Status */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p
            className={`text-sm font-semibold ${
              credit
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {credit ? "+" : "-"}
            {formatAmount(tx.amount, tx.currency)}
          </p>
          <div className="flex items-center gap-1">
            <StatusIcon className="size-3" />
            <Badge
              variant="secondary"
              className={`h-5 rounded-md px-1.5 text-[10px] font-medium border-0 ${statusConfig.badgeClass}`}
            >
              {statusConfig.label}
            </Badge>
          </div>
          {/* Mobile only time */}
          <span className="text-xs text-muted-foreground sm:hidden">
            {formatRelativeTime(tx.createdAt)}
          </span>
        </div>
      </div>
      <Separator className="mx-3 sm:mx-4 opacity-50" />
    </motion.div>
  );
}

// ─── Main Transactions Page ────────────────────────────────────────────────────
export function TransactionsPage() {
  // ── Filter state ──
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRange>("all");

  // ── Data state ──
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);
  const [page, setPage] = useState(1);

  // ── Fetch from API ──
  const fetchTransactions = useCallback(
    async (pageNum: number, append: boolean) => {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setTransactions([]);
        setPagination(null);
        setError(null);
        setUsingFallback(false);
      }

      try {
        const params = new URLSearchParams();
        params.set("page", String(pageNum));
        params.set("limit", "20");
        if (typeFilter !== "all") params.set("type", typeFilter);
        if (statusFilter !== "all") params.set("status", statusFilter);

        const res = await fetch(`/api/transactions?${params.toString()}`);

        if (!res.ok) throw new Error(`API returned ${res.status}`);

        const data = await res.json();
        const txs: Transaction[] = data.transactions ?? [];
        const pag: Pagination = data.pagination;

        setTransactions((prev) => (append ? [...prev, ...txs] : txs));
        setPagination(pag);
        setError(null);
        setUsingFallback(false);
      } catch (err) {
        console.error("Failed to fetch transactions:", err);

        // On first load failure, fall back to mock data
        if (!append) {
          setUsingFallback(true);
          setTransactions(mockTransactions);
          setPagination({
            page: 1,
            limit: 20,
            total: mockTransactions.length,
            totalPages: 1,
            hasNext: false,
            hasPrev: false,
          });
          setError(null);
        } else {
          setError("Failed to load more transactions.");
        }
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [typeFilter, statusFilter]
  );

  // ── Initial fetch + refetch on filter change ──
  useEffect(() => {
    setPage(1);
    fetchTransactions(1, false);
  }, [fetchTransactions]);

  // ── Client-side filtering (search + date range) ──
  const filtered = useMemo(() => {
    let result = [...transactions];

    // Search filter (by description)
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (tx) =>
          (tx.description && tx.description.toLowerCase().includes(q)) ||
          tx.type.toLowerCase().includes(q)
      );
    }

    // Date range filter (applied client-side)
    if (dateRange !== "all") {
      result = result.filter((tx) => filterByDate(tx, dateRange));
    }

    return result;
  }, [transactions, search, dateRange]);

  // ── Summary stats (computed from ALL fetched transactions, not filtered) ──
  const stats = useMemo(() => {
    const credits = transactions
      .filter((tx) => isCredit(tx.type) && tx.status === "COMPLETED")
      .reduce((sum, tx) => sum + tx.amount, 0);
    const debits = transactions
      .filter((tx) => !isCredit(tx.type) && tx.status === "COMPLETED")
      .reduce((sum, tx) => sum + tx.amount, 0);
    const count = transactions.length;
    const avg =
      count > 0
        ? transactions.reduce((sum, tx) => sum + tx.amount, 0) / count
        : 0;
    return { credits, debits, count, avg };
  }, [transactions]);

  // ── Load More handler ──
  const handleLoadMore = () => {
    if (!pagination?.hasNext || isLoadingMore) return;
    const nextPage = page + 1;
    setPage(nextPage);
    fetchTransactions(nextPage, true);
  };

  // ── Render ──
  // Initial full-page loading skeleton
  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* ── Fallback notice ── */}
      {usingFallback && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            <FileText className="size-4 shrink-0" />
            <span>
              Showing sample data — could not reach the server. Filters are
              limited.
            </span>
          </div>
        </motion.div>
      )}

      {/* ── Summary Stats ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        <StatCard
          icon={TrendingUp}
          label="Credits"
          value={formatAmount(stats.credits, "AED")}
          color="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400"
        />
        <StatCard
          icon={TrendingDown}
          label="Debits"
          value={formatAmount(stats.debits, "AED")}
          color="bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400"
        />
        <StatCard
          icon={Receipt}
          label="Transactions"
          value={String(stats.count)}
          color="bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400"
        />
        <StatCard
          icon={ArrowUpDown}
          label="Avg. Size"
          value={formatAmount(stats.avg, "AED")}
          color="bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400"
        />
      </motion.div>

      {/* ── Filter Bar ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
      >
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Filter className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">
                Filters
              </span>
              {(typeFilter !== "all" || statusFilter !== "all" || dateRange !== "all" || search.trim()) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setTypeFilter("all");
                    setStatusFilter("all");
                    setDateRange("all");
                    setSearch("");
                  }}
                >
                  Clear all
                </Button>
              )}
            </div>

            {/* Search row */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search transactions..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Filter selects */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Transaction Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="SALARY_CREDIT">Salary Credit</SelectItem>
                  <SelectItem value="SPEND">Spend</SelectItem>
                  <SelectItem value="TOP_UP">Top Up</SelectItem>
                  <SelectItem value="REMITTANCE">Remittance</SelectItem>
                  <SelectItem value="P2P_SEND">P2P Send</SelectItem>
                  <SelectItem value="P2P_RECEIVE">P2P Receive</SelectItem>
                  <SelectItem value="WITHDRAW">Withdraw</SelectItem>
                  <SelectItem value="REFUND">Refund</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={dateRange}
                onValueChange={(v) => setDateRange(v as DateRange)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Date Range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="week">This Week</SelectItem>
                  <SelectItem value="month">This Month</SelectItem>
                  <SelectItem value="3months">Last 3 Months</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Transaction List ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
      >
        <Card>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">
              Transaction History
            </h3>
            <div className="flex items-center gap-2">
              {pagination && !usingFallback && (
                <span className="text-xs text-muted-foreground">
                  {pagination.total} total
                </span>
              )}
              <Badge
                variant="secondary"
                className="bg-emerald-100 text-emerald-700 border-0 dark:bg-emerald-900/40 dark:text-emerald-400"
              >
                {filtered.length} {filtered.length === 1 ? "item" : "items"}
              </Badge>
            </div>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            {filtered.length > 0 ? (
              <div className="py-1">
                <AnimatePresence>
                  {filtered.map((tx, idx) => (
                    <TransactionRow
                      key={tx.id}
                      tx={tx}
                      index={idx}
                    />
                  ))}
                </AnimatePresence>

                {/* ── Load More Button ── */}
                {pagination?.hasNext && !usingFallback && (
                  <div className="flex justify-center py-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleLoadMore}
                      disabled={isLoadingMore}
                      className="gap-2"
                    >
                      {isLoadingMore ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        <>
                          <ChevronDown className="size-4" />
                          Load More
                          {pagination.totalPages > pagination.page && (
                            <span className="text-muted-foreground">
                              (Page {pagination.page + 1} of{" "}
                              {pagination.totalPages})
                            </span>
                          )}
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {/* ── Load More Error ── */}
                {error && (
                  <div className="flex items-center justify-center gap-2 py-4 text-sm text-red-500">
                    <XCircle className="size-4" />
                    <span>{error}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-2 h-6 text-xs"
                      onClick={() => fetchTransactions(page + 1, true)}
                    >
                      Retry
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <EmptyState />
            )}
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
