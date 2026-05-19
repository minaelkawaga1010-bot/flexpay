"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Send,
  Download,
  MoreHorizontal,
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowUpRight,
  Eye,
  EyeOff,
  Phone,
  Banknote,
  CreditCard,
  Building2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Balance {
  id: string;
  walletId: string;
  currency: string;
  amount: number;
  updatedAt: string;
}

interface WalletData {
  wallet: {
    id: string;
    isActive: boolean;
    balances: Balance[];
  };
  totalBalanceAED: number;
}

interface CurrencyPocket {
  currency: string;
  amount: number;
  flag: string;
  change: number;
}

// ─── Mock Fallback Data ───────────────────────────────────────────────────────
const mockPockets: CurrencyPocket[] = [
  { currency: "AED", amount: 12500.0, flag: "\u{1F1E6}\u{1F1EA}", change: +2.5 },
  { currency: "INR", amount: 52000.0, flag: "\u{1F1EE}\u{1F1F3}", change: +1.2 },
  { currency: "PHP", amount: 15000.0, flag: "\u{1F1F5}\u{1F1ED}", change: -0.8 },
];

// Currency → flag map
const CURRENCY_FLAGS: Record<string, string> = {
  AED: "\u{1F1E6}\u{1F1EA}",
  INR: "\u{1F1EE}\u{1F1F3}",
  PHP: "\u{1F1F5}\u{1F1ED}",
  PKR: "\u{1F1F5}\u{1F1F0}",
  USD: "\u{1F1FA}\u{1F1F8}",
};

// Mini sparkline data for visual flair
const sparkData: Record<string, number[]> = {
  AED: [40, 45, 42, 50, 48, 55, 60, 58, 62, 65, 63, 68],
  INR: [30, 35, 32, 38, 40, 37, 42, 45, 43, 48, 50, 52],
  PHP: [50, 48, 45, 47, 42, 40, 43, 38, 36, 35, 37, 34],
  PKR: [20, 22, 21, 24, 23, 26, 25, 28, 27, 30, 29, 32],
  USD: [60, 62, 58, 64, 66, 63, 68, 70, 67, 72, 74, 71],
};

// Random sparkline for currencies not in the map
function getSparkData(currency: string): number[] {
  if (sparkData[currency]) return sparkData[currency];
  const arr: number[] = [];
  let val = 30 + Math.random() * 40;
  for (let i = 0; i < 12; i++) {
    val += (Math.random() - 0.45) * 8;
    arr.push(Math.max(5, val));
  }
  return arr;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────
function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function getFlag(currency: string): string {
  return CURRENCY_FLAGS[currency] || "\u{1F310}";
}

function MiniSparkline({ data, positive }: { data: number[]; positive: boolean }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 64;
  const h = 24;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={positive ? "#10b981" : "#ef4444"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={w}
        cy={h - ((data[data.length - 1] - min) / range) * h}
        r="2.5"
        fill={positive ? "#10b981" : "#ef4444"}
      />
    </svg>
  );
}

// ─── Loading Skeletons ────────────────────────────────────────────────────────
function HeroSkeleton() {
  return (
    <Card className="overflow-hidden border-0 bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 shadow-lg">
      <CardContent className="p-6 sm:p-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="size-5 rounded-full bg-white/20" />
            <Skeleton className="h-4 w-24 rounded bg-white/20" />
          </div>
          <Skeleton className="size-8 rounded-full bg-white/20" />
        </div>
        <div className="mt-4 space-y-2">
          <Skeleton className="h-12 w-56 rounded bg-white/20" />
          <Skeleton className="h-4 w-32 rounded bg-white/20" />
        </div>
        <div className="mt-6">
          <Skeleton className="h-9 w-full rounded-lg bg-white/20" />
        </div>
      </CardContent>
    </Card>
  );
}

function PocketSkeleton() {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-5 w-28" />
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-4 w-12" />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Quick Action Button ───────────────────────────────────────────────────────
function QuickAction({
  icon: Icon,
  label,
  color,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  color: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-center gap-2 rounded-xl p-3 transition-all hover:bg-accent focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none"
    >
      <div
        className={`flex size-12 items-center justify-center rounded-xl shadow-sm transition-transform group-hover:scale-105 ${color}`}
      >
        <Icon className="size-5 text-white" />
      </div>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
    </button>
  );
}

// ─── P2P Transfer Dialog ───────────────────────────────────────────────────────
function P2PTransferDialog({
  pockets,
  onTransferSuccess,
}: {
  pockets: CurrencyPocket[];
  onTransferSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  const aedBalance = pockets.find((b) => b.currency === "AED")?.amount ?? 0;
  const numAmount = parseFloat(amount) || 0;
  const isValid = phone.length >= 10 && numAmount > 0 && numAmount <= aedBalance;

  async function handleTransfer() {
    if (!isValid) return;
    setLoading(true);
    try {
      const res = await fetch("/api/wallet/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiverPhone: phone,
          amount: numAmount,
          currency: "AED",
          note: note || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error("Transfer failed", {
          description: data.error || "Something went wrong. Please try again.",
        });
        return;
      }

      toast.success("Transfer successful!", {
        description: `${formatAmount(numAmount, "AED")} sent to ${phone}`,
      });
      setOpen(false);
      setPhone("");
      setAmount("");
      setNote("");
      onTransferSuccess();
    } catch {
      toast.error("Transfer failed", {
        description: "Network error. Please check your connection and try again.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <QuickAction icon={Send} label="Send" color="bg-teal-500" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="size-5 text-teal-500" />
            Send Money (P2P)
          </DialogTitle>
          <DialogDescription>
            Transfer money instantly to another FlexPay wallet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Available Balance */}
          <div className="rounded-lg bg-emerald-50 px-4 py-3 dark:bg-emerald-950/30">
            <p className="text-xs text-muted-foreground">Available Balance</p>
            <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
              {formatAmount(aedBalance, "AED")}
            </p>
          </div>

          {/* Receiver Phone */}
          <div className="space-y-2">
            <Label htmlFor="p2p-phone" className="flex items-center gap-1.5">
              <Phone className="size-3.5 text-muted-foreground" />
              Receiver Phone Number
            </Label>
            <Input
              id="p2p-phone"
              placeholder="+971 50 XXX XXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              type="tel"
            />
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="p2p-amount" className="flex items-center gap-1.5">
              <Banknote className="size-3.5 text-muted-foreground" />
              Amount (AED)
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                AED
              </span>
              <Input
                id="p2p-amount"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number"
                min="0"
                step="0.01"
                className="pl-14"
              />
            </div>
            {numAmount > aedBalance && (
              <p className="flex items-center gap-1 text-xs text-red-500">
                <AlertCircle className="size-3" />
                Insufficient balance
              </p>
            )}
          </div>

          {/* Note */}
          <div className="space-y-2">
            <Label htmlFor="p2p-note" className="flex items-center gap-1.5">
              <Wallet className="size-3.5 text-muted-foreground" />
              Note (optional)
            </Label>
            <Input
              id="p2p-note"
              placeholder="What&apos;s this for?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleTransfer}
            disabled={!isValid || loading}
            className="bg-teal-600 hover:bg-teal-700 text-white"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                Sending...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Send className="size-4" />
                Confirm Transfer
              </span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Top Up Dialog ─────────────────────────────────────────────────────────────
function TopUpDialog({
  onTopUpSuccess,
}: {
  onTopUpSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [loading, setLoading] = useState(false);

  const quickAmounts = [100, 500, 1000, 5000];
  const numAmount = parseFloat(amount) || 0;
  const isValid = numAmount > 0 && method.length > 0;

  async function handleTopUp() {
    if (!isValid) return;
    setLoading(true);
    try {
      const res = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: numAmount,
          currency: "AED",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error("Top-up failed", {
          description: data.error || "Something went wrong. Please try again.",
        });
        return;
      }

      toast.success("Top-up successful!", {
        description: `${formatAmount(numAmount, "AED")} has been added to your wallet.`,
      });
      setOpen(false);
      setAmount("");
      setMethod("");
      onTopUpSuccess();
    } catch {
      toast.error("Top-up failed", {
        description: "Network error. Please check your connection and try again.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <QuickAction icon={Plus} label="Top Up" color="bg-emerald-500" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-5 text-emerald-500" />
            Top Up Wallet
          </DialogTitle>
          <DialogDescription>
            Add funds to your FlexPay wallet instantly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Quick Amounts */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Banknote className="size-3.5 text-muted-foreground" />
              Quick Amount
            </Label>
            <div className="grid grid-cols-4 gap-2">
              {quickAmounts.map((qa) => (
                <button
                  key={qa}
                  onClick={() => setAmount(String(qa))}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-all ${
                    amount === String(qa)
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                      : "border-border bg-card hover:border-emerald-300 hover:bg-emerald-50/50 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/20"
                  }`}
                >
                  {qa}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Amount */}
          <div className="space-y-2">
            <Label htmlFor="topup-amount">Custom Amount (AED)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                AED
              </span>
              <Input
                id="topup-amount"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number"
                min="0"
                step="0.01"
                className="pl-14"
              />
            </div>
          </div>

          {/* Payment Method */}
          <div className="space-y-2">
            <Label htmlFor="topup-method" className="flex items-center gap-1.5">
              <CreditCard className="size-3.5 text-muted-foreground" />
              Payment Method
            </Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select payment method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bank">
                  <span className="flex items-center gap-2">
                    <Building2 className="size-4 text-muted-foreground" />
                    Bank Transfer
                  </span>
                </SelectItem>
                <SelectItem value="cash">
                  <span className="flex items-center gap-2">
                    <Banknote className="size-4 text-muted-foreground" />
                    Cash Deposit
                  </span>
                </SelectItem>
                <SelectItem value="card">
                  <span className="flex items-center gap-2">
                    <CreditCard className="size-4 text-muted-foreground" />
                    Card Payment
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleTopUp}
            disabled={!isValid || loading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                Processing...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <CheckCircle2 className="size-4" />
                Confirm Top Up
              </span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Request Money Dialog ──────────────────────────────────────────────────────
function RequestMoneyDialog() {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");

  const isValid = (parseFloat(amount) || 0) > 0 && phone.length >= 10;

  function handleRequest() {
    if (!isValid) return;
    setOpen(false);
    toast.success("Request sent!", {
      description: `${formatAmount(parseFloat(amount), "AED")} requested from ${phone}`,
    });
    setAmount("");
    setPhone("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <QuickAction icon={Download} label="Request" color="bg-amber-500" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="size-5 text-amber-500" />
            Request Money
          </DialogTitle>
          <DialogDescription>
            Send a payment request to another FlexPay user.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="req-phone" className="flex items-center gap-1.5">
              <Phone className="size-3.5 text-muted-foreground" />
              Request From (Phone)
            </Label>
            <Input
              id="req-phone"
              placeholder="+971 50 XXX XXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              type="tel"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="req-amount" className="flex items-center gap-1.5">
              <Banknote className="size-3.5 text-muted-foreground" />
              Amount (AED)
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                AED
              </span>
              <Input
                id="req-amount"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number"
                min="0"
                step="0.01"
                className="pl-14"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleRequest}
            disabled={!isValid}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            <span className="flex items-center gap-2">
              <Download className="size-4" />
              Send Request
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── More Actions Menu ─────────────────────────────────────────────────────────
function MoreActionsMenu() {
  return (
    <QuickAction
      icon={MoreHorizontal}
      label="More"
      color="bg-gray-500"
      onClick={() => toast.info("More actions coming soon!")}
    />
  );
}

// ─── Main Wallet Page ──────────────────────────────────────────────────────────
export function WalletPage() {
  const [activeCurrency, setActiveCurrency] = useState("AED");
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Derive currency pockets from API data, fallback to mock
  const pockets: CurrencyPocket[] = walletData
    ? walletData.wallet.balances.map((b) => ({
        currency: b.currency,
        amount: b.amount,
        flag: getFlag(b.currency),
        change: mockPockets.find((m) => m.currency === b.currency)?.change ?? 0,
      }))
    : mockPockets;

  const currentPocket = pockets.find((p) => p.currency === activeCurrency);

  // Fetch wallet data
  const fetchWalletData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const res = await fetch("/api/wallet");
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch wallet data");
      }

      setWalletData(data);
    } catch (err) {
      console.error("Failed to fetch wallet:", err);
      setError(err instanceof Error ? err.message : "Failed to load wallet");
      toast.error("Could not load wallet data", {
        description: "Showing offline data. Tap refresh to retry.",
      });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchWalletData();
  }, [fetchWalletData]);

  // Reset active currency if not in pockets after data loads
  useEffect(() => {
    if (pockets.length > 0 && !pockets.find((p) => p.currency === activeCurrency)) {
      setActiveCurrency(pockets[0].currency);
    }
  }, [pockets, activeCurrency]);

  // Callbacks for dialogs to refresh wallet
  const handleTopUpSuccess = useCallback(() => {
    fetchWalletData(true);
  }, [fetchWalletData]);

  const handleTransferSuccess = useCallback(() => {
    fetchWalletData(true);
  }, [fetchWalletData]);

  const handleManualRefresh = useCallback(() => {
    fetchWalletData(true);
  }, [fetchWalletData]);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* ── Hero Balance Section ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" as const }}
      >
        {isLoading ? (
          <HeroSkeleton />
        ) : (
          <Card className="overflow-hidden border-0 bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 shadow-lg">
            <CardContent className="relative p-6 sm:p-8">
              {/* Background decorative circles */}
              <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-white/5" />
              <div className="pointer-events-none absolute -bottom-8 -left-8 size-32 rounded-full bg-white/5" />

              <div className="relative z-10">
                {/* Top row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wallet className="size-5 text-white/80" />
                    <span className="text-sm font-medium text-white/70">
                      Total Balance
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleManualRefresh}
                      className="flex size-8 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
                      aria-label="Refresh wallet data"
                    >
                      <RefreshCw
                        className={`size-4 text-white/80 ${isRefreshing ? "animate-spin" : ""}`}
                      />
                    </button>
                    <button
                      onClick={() => setBalanceHidden(!balanceHidden)}
                      className="flex size-8 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
                      aria-label={balanceHidden ? "Show balance" : "Hide balance"}
                    >
                      {balanceHidden ? (
                        <EyeOff className="size-4 text-white/80" />
                      ) : (
                        <Eye className="size-4 text-white/80" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Main balance */}
                <div className="mt-4 flex items-baseline gap-3">
                  {currentPocket && (
                    <>
                      <span className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
                        {balanceHidden
                          ? "****.**"
                          : formatAmount(currentPocket.amount, activeCurrency)}
                      </span>
                      <span className="text-2xl">{currentPocket.flag}</span>
                    </>
                  )}
                </div>

                {/* Currency change indicator */}
                {currentPocket && !balanceHidden && (
                  <div className="mt-2 flex items-center gap-1.5">
                    {currentPocket.change >= 0 ? (
                      <TrendingUp className="size-3.5 text-emerald-300" />
                    ) : (
                      <TrendingDown className="size-3.5 text-red-300" />
                    )}
                    <span
                      className={`text-xs font-medium ${
                        currentPocket.change >= 0
                          ? "text-emerald-300"
                          : "text-red-300"
                      }`}
                    >
                      {currentPocket.change >= 0 ? "+" : ""}
                      {currentPocket.change}% this month
                    </span>
                  </div>
                )}

                {/* Offline indicator */}
                {error && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <AlertCircle className="size-3.5 text-amber-300" />
                    <span className="text-xs font-medium text-amber-300">
                      Offline mode — showing cached data
                    </span>
                  </div>
                )}

                {/* Currency Tabs */}
                <div className="mt-6">
                  <Tabs
                    value={activeCurrency}
                    onValueChange={setActiveCurrency}
                    className="w-full"
                  >
                    <TabsList className="h-9 w-full bg-white/10 p-0.5">
                      {pockets.map((pocket) => (
                        <TabsTrigger
                          key={pocket.currency}
                          value={pocket.currency}
                          className="flex-1 gap-1.5 rounded-md text-xs font-medium data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm"
                        >
                          <span>{pocket.flag}</span>
                          <span>{pocket.currency}</span>
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </motion.div>

      {/* ── Currency Pockets Grid ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" as const }}
      >
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Currency Pockets
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {isLoading ? (
            <>
              <PocketSkeleton />
              <PocketSkeleton />
              <PocketSkeleton />
            </>
          ) : (
            <AnimatePresence mode="popLayout">
              {pockets.map((pocket, idx) => {
                const isActive = pocket.currency === activeCurrency;
                return (
                  <motion.div
                    key={pocket.currency}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.25, delay: idx * 0.05 }}
                  >
                    <Card
                      className={`cursor-pointer transition-all hover:shadow-md ${
                        isActive
                          ? "border-emerald-300 bg-emerald-50/50 ring-1 ring-emerald-500/20 dark:border-emerald-700 dark:bg-emerald-950/20"
                          : "hover:border-emerald-200 dark:hover:border-emerald-800"
                      }`}
                      onClick={() => setActiveCurrency(pocket.currency)}
                    >
                      <CardContent className="flex items-center justify-between p-4">
                        <div className="flex items-center gap-3">
                          <span className="text-3xl">{pocket.flag}</span>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">
                              {pocket.currency}
                            </p>
                            <p className="text-lg font-bold text-foreground">
                              {balanceHidden
                                ? "****.**"
                                : formatAmount(pocket.amount, pocket.currency)}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <MiniSparkline
                            data={getSparkData(pocket.currency)}
                            positive={pocket.change >= 0}
                          />
                          <Badge
                            variant="secondary"
                            className={`text-[10px] ${
                              pocket.change >= 0
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                                : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                            }`}
                          >
                            {pocket.change >= 0 ? "+" : ""}
                            {pocket.change}%
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>
      </motion.div>

      {/* ── Quick Actions ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" as const }}
      >
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Quick Actions
        </h2>
        <Card>
          <CardContent className="p-2">
            <div className="grid grid-cols-4 gap-1">
              <TopUpDialog onTopUpSuccess={handleTopUpSuccess} />
              <P2PTransferDialog
                pockets={pockets}
                onTransferSuccess={handleTransferSuccess}
              />
              <RequestMoneyDialog />
              <MoreActionsMenu />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Recent Activity Teaser ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.3, ease: "easeOut" as const }}
      >
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Recent Activity
        </h2>
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-0">
                {[0, 1, 2].map((i) => (
                  <div key={i}>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <Skeleton className="size-10 rounded-xl" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-36" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                      <div className="text-right space-y-2">
                        <Skeleton className="ml-auto h-4 w-24" />
                        <Skeleton className="ml-auto h-3 w-16" />
                      </div>
                    </div>
                    {i < 2 && <Separator />}
                  </div>
                ))}
              </div>
            ) : (
              [
                {
                  icon: Wallet,
                  iconBg: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400",
                  title: "Monthly Salary",
                  desc: "Al Fardan Group",
                  amount: "+8,500.00 AED",
                  amountColor: "text-emerald-600 dark:text-emerald-400",
                  time: "1 hour ago",
                },
                {
                  icon: ArrowUpRight,
                  iconBg: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400",
                  title: "Carrefour Supermarket",
                  desc: "Grocery shopping",
                  amount: "-234.50 AED",
                  amountColor: "text-red-600 dark:text-red-400",
                  time: "2 hours ago",
                },
                {
                  icon: Send,
                  iconBg: "bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400",
                  title: "Remittance to India",
                  desc: "Via Wise",
                  amount: "-2,000.00 AED",
                  amountColor: "text-red-600 dark:text-red-400",
                  time: "Yesterday",
                },
              ].map((item, idx) => (
                <div key={idx}>
                  <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50">
                    <div
                      className={`flex size-10 items-center justify-center rounded-xl ${item.iconBg}`}
                    >
                      <item.icon className="size-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {item.title}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {item.desc}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-semibold ${item.amountColor}`}>
                        {item.amount}
                      </p>
                      <p className="text-xs text-muted-foreground">{item.time}</p>
                    </div>
                  </div>
                  {idx < 2 && <Separator />}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
