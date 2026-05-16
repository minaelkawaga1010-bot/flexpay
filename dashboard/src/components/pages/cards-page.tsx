"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CreditCard,
  Snowflake,
  Sun,
  Eye,
  EyeOff,
  Wifi,
  Lock,
  ShoppingBag,
  UtensilsCrossed,
  Car,
  Plane,
  Zap,
  ChevronRight,
  CircleDollarSign,
  Wallet,
  ShieldCheck,
  Globe,
  Loader2,
  CreditCard as CardIcon,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/* ──────────────── Types ──────────────── */

interface ApiCard {
  id: string;
  userId: string;
  type: "VIRTUAL" | "PHYSICAL";
  status: "ACTIVE" | "FROZEN" | "BLOCKED" | "EXPIRED";
  last4Digits: string;
  expiryMonth: number;
  expiryYear: number;
  cardholderName: string;
  dailyLimit: number;
  monthlyLimit: number;
  spentToday: number;
  spentMonth: number;
  isApplePay: boolean;
  isGooglePay: boolean;
  createdAt: string;
  updatedAt: string;
}

interface MockCard {
  id: string;
  type: "virtual" | "physical";
  label: string;
  holderName: string;
  number: string;
  maskedNumber: string;
  expiry: string;
  frozen: boolean;
  gradient: string;
  textColor: string;
  status: "ACTIVE" | "FROZEN";
  dailyLimit: number;
  monthlyLimit: number;
  spentToday: number;
  spentMonth: number;
  isApplePay: boolean;
  isGooglePay: boolean;
}

interface CardItem {
  id: string;
  type: "VIRTUAL" | "PHYSICAL";
  label: string;
  holderName: string;
  number: string;
  maskedNumber: string;
  expiry: string;
  frozen: boolean;
  gradient: string;
  textColor: string;
  status: ApiCard["status"];
  dailyLimit: number;
  monthlyLimit: number;
  spentToday: number;
  spentMonth: number;
  isApplePay: boolean;
  isGooglePay: boolean;
}

/* ──────────────── Fallback Mock Data ──────────────── */

const fallbackMockCards: MockCard[] = [
  {
    id: "v1",
    type: "virtual",
    label: "Virtual Card",
    holderName: "RAJESH KUMAR",
    number: "4521 3890 6724 4521",
    maskedNumber: "\u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 4521",
    expiry: "12/27",
    frozen: false,
    gradient: "from-emerald-600 via-emerald-700 to-teal-800",
    textColor: "text-white",
    status: "ACTIVE",
    dailyLimit: 5000,
    monthlyLimit: 50000,
    spentToday: 350.5,
    spentMonth: 4200,
    isApplePay: true,
    isGooglePay: true,
  },
  {
    id: "p1",
    type: "physical",
    label: "Physical Card",
    holderName: "RAJESH KUMAR",
    number: "5412 7534 9081 2234",
    maskedNumber: "\u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 2234",
    expiry: "08/28",
    frozen: false,
    gradient: "from-gray-800 via-gray-900 to-black",
    textColor: "text-white",
    status: "ACTIVE",
    dailyLimit: 5000,
    monthlyLimit: 50000,
    spentToday: 0,
    spentMonth: 1500,
    isApplePay: false,
    isGooglePay: false,
  },
];

const recentTransactions = [
  { id: "t1", merchant: "Carrefour", icon: ShoppingBag, amount: -245.5, date: "14 Jan 2025", category: "Shopping" },
  { id: "t2", merchant: "Zomato UAE", icon: UtensilsCrossed, amount: -89.0, date: "13 Jan 2025", category: "Food" },
  { id: "t3", merchant: "Careem Ride", icon: Car, amount: -32.0, date: "12 Jan 2025", category: "Transport" },
  { id: "t4", merchant: "Emirates Airlines", icon: Plane, amount: -1250.0, date: "10 Jan 2025", category: "Travel" },
  { id: "t5", merchant: "Salary Credit", icon: CircleDollarSign, amount: 12000.0, date: "01 Jan 2025", category: "Income" },
];

/* ──────────────── Helpers ──────────────── */

function getCardGradient(type: ApiCard["type"], status: ApiCard["status"]): string {
  if (status === "FROZEN" || status === "BLOCKED" || status === "EXPIRED") {
    return "from-gray-400 via-gray-500 to-gray-600";
  }
  if (type === "PHYSICAL") {
    return "from-gray-800 via-gray-900 to-black";
  }
  return "from-emerald-600 via-emerald-700 to-teal-800";
}

function getCardLabel(type: ApiCard["type"], cardholderName: string): string {
  if (type === "PHYSICAL") return "Physical Card";
  const firstName = cardholderName.split(" ")[0] || "My";
  return `${firstName}'s Virtual Card`;
}

function formatExpiry(month: number, year: number): string {
  return `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`;
}

function formatMaskedNumber(last4: string): string {
  return `\u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 ${last4}`;
}

function formatFullNumber(last4: string): string {
  return `4521 3890 6724 ${last4}`;
}

function mapApiCardToCardItem(c: ApiCard): CardItem {
  return {
    id: c.id,
    type: c.type,
    label: getCardLabel(c.type, c.cardholderName),
    holderName: c.cardholderName,
    number: formatFullNumber(c.last4Digits),
    maskedNumber: formatMaskedNumber(c.last4Digits),
    expiry: formatExpiry(c.expiryMonth, c.expiryYear),
    frozen: c.status === "FROZEN",
    gradient: getCardGradient(c.type, c.status),
    textColor: "text-white",
    status: c.status,
    dailyLimit: c.dailyLimit,
    monthlyLimit: c.monthlyLimit,
    spentToday: c.spentToday,
    spentMonth: c.spentMonth,
    isApplePay: c.isApplePay,
    isGooglePay: c.isGooglePay,
  };
}

function mapMockCardToCardItem(c: MockCard): CardItem {
  return {
    id: c.id,
    type: c.type === "virtual" ? "VIRTUAL" : "PHYSICAL",
    label: c.label,
    holderName: c.holderName,
    number: c.number,
    maskedNumber: c.maskedNumber,
    expiry: c.expiry,
    frozen: c.frozen,
    gradient: c.gradient,
    textColor: c.textColor,
    status: c.status,
    dailyLimit: c.dailyLimit,
    monthlyLimit: c.monthlyLimit,
    spentToday: c.spentToday,
    spentMonth: c.spentMonth,
    isApplePay: c.isApplePay,
    isGooglePay: c.isGooglePay,
  };
}

/* ──────────────── Loading Skeleton ──────────────── */

function CardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Main card skeleton */}
      <Skeleton className="h-48 w-full rounded-2xl" />
      {/* Action buttons skeleton */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      {/* Tabs skeleton */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-0">
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent className="pt-2">
          <Skeleton className="mb-4 h-9 w-64" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </CardContent>
      </Card>
      {/* Spending overview skeleton */}
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-36" />
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-2.5 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-2.5 w-full" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ──────────────── Empty State ──────────────── */

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center rounded-2xl border border-dashed p-12 text-center"
    >
      <div className="flex size-16 items-center justify-center rounded-full bg-muted">
        <CardIcon className="size-8 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">No Cards Yet</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        You don&apos;t have any cards. Create your first virtual card to get started.
      </p>
      <Button
        className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white"
        onClick={() => toast.info("Coming soon!", { description: "Card creation will be available shortly." })}
      >
        <CreditCard className="mr-2 size-4" />
        Create Virtual Card
      </Button>
    </motion.div>
  );
}

/* ──────────────── CSS Credit Card Component ──────────────── */

function CreditCardVisual({
  card,
  showDetails,
  isActive,
}: {
  card: CardItem;
  showDetails: boolean;
  isActive: boolean;
}) {
  const isInactive = card.status === "BLOCKED" || card.status === "EXPIRED";
  return (
    <motion.div
      initial={{ opacity: 0, rotateY: -15 }}
      animate={{ opacity: 1, rotateY: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className={`group relative w-full overflow-hidden rounded-2xl ${isActive ? "" : "scale-[0.88] opacity-75"} transition-transform`}
      style={{ aspectRatio: "1.586 / 1" }}
    >
      {/* Card Background */}
      <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${card.gradient}`} />

      {/* Shimmer effect on hover */}
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background:
            "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.12) 45%, rgba(255,255,255,0.18) 50%, rgba(255,255,255,0.12) 55%, transparent 60%)",
          backgroundSize: "200% 100%",
          animation: "card-shimmer 2s ease-in-out infinite",
        }}
      />

      {/* Frozen overlay */}
      {card.frozen && (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/30 backdrop-blur-[2px]">
          <Snowflake className="size-12 text-white/60" />
        </div>
      )}

      {/* Blocked/Expired overlay */}
      {isInactive && !card.frozen && (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/40 backdrop-blur-[2px]">
          <Lock className="size-12 text-white/60" />
        </div>
      )}

      {/* Decorative circles */}
      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-white/5" />
      <div className="pointer-events-none absolute -bottom-12 -left-12 size-40 rounded-full bg-white/5" />

      {/* Card Content */}
      <div className="relative z-10 flex h-full flex-col justify-between p-5 sm:p-6">
        {/* Top row */}
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-bold tracking-widest uppercase text-white/80">FlexPay</span>
            <span className="text-[10px] font-medium tracking-wider uppercase text-white/50">
              Digital Wallet
            </span>
          </div>
          <div className="flex items-center gap-2">
            {card.type === "VIRTUAL" && (
              <Badge className="border-0 bg-white/15 px-2 py-0 text-[10px] font-bold uppercase tracking-wider text-white">
                Virtual
              </Badge>
            )}
            <Wifi className="size-5 -rotate-90 text-white/70" />
          </div>
        </div>

        {/* Chip */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <div className="size-7 rounded-sm bg-gradient-to-br from-yellow-300 via-yellow-500 to-amber-600" />
            <div className="ml-0.5 size-7 rounded-sm bg-gradient-to-br from-yellow-200 via-yellow-400 to-amber-500" />
          </div>
          <Lock className="size-3.5 text-white/40" />
        </div>

        {/* Card number */}
        <div className="flex items-center gap-3">
          <p className="flex-1 font-mono text-sm font-semibold tracking-[0.18em] text-white sm:text-base">
            {showDetails ? card.number : card.maskedNumber}
          </p>
        </div>

        {/* Bottom row */}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-white/50">Card Holder</p>
            <p className="mt-0.5 text-xs font-semibold tracking-wider text-white sm:text-sm">
              {card.holderName}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-medium uppercase tracking-wider text-white/50">Expires</p>
            <p className="mt-0.5 text-xs font-semibold text-white sm:text-sm">{card.expiry}</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ──────────────── Main Component ──────────────── */

export function CardsPage() {
  const [cards, setCards] = useState<CardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUsingFallback, setIsUsingFallback] = useState(false);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [isTogglingFreeze, setIsTogglingFreeze] = useState(false);
  const [apiCards, setApiCards] = useState<ApiCard[]>([]);

  const fetchCards = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/cards");
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const data = await res.json();
      const apiCardList: ApiCard[] = data.cards ?? [];

      if (apiCardList.length === 0) {
        setCards([]);
        setApiCards([]);
        setIsUsingFallback(false);
        setIsLoading(false);
        return;
      }

      setApiCards(apiCardList);
      const mapped = apiCardList.map(mapApiCardToCardItem);
      setCards(mapped);
      setIsUsingFallback(false);

      // Select primary card: first ACTIVE VIRTUAL, or first card
      const primary = apiCardList.find((c) => c.status === "ACTIVE" && c.type === "VIRTUAL");
      setActiveCardId((primary ?? apiCardList[0]).id);
    } catch (err) {
      console.error("Failed to fetch cards, using fallback:", err);
      setError(err instanceof Error ? err.message : "Failed to load cards");
      const mapped = fallbackMockCards.map(mapMockCardToCardItem);
      setCards(mapped);
      setIsUsingFallback(true);
      setActiveCardId(mapped[0].id);
      toast.error("Using offline data", {
        description: "Could not connect to server. Showing saved card info.",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  const activeCard = cards.find((c) => c.id === activeCardId) ?? cards[0] ?? null;

  const handleToggleFreeze = async () => {
    if (!activeCard) return;
    if (isUsingFallback) {
      // Offline fallback: toggle locally
      setCards((prev) =>
        prev.map((c) => (c.id === activeCardId ? { ...c, frozen: !c.frozen } : c))
      );
      const isCurrentlyFrozen = activeCard.frozen;
      toast.success(isCurrentlyFrozen ? "Card unfrozen" : "Card frozen", {
        description: isCurrentlyFrozen ? "Your card is now active again." : "All transactions are paused.",
      });
      return;
    }

    setIsTogglingFreeze(true);
    const newStatus = activeCard.frozen ? "ACTIVE" : "FROZEN";
    try {
      const res = await fetch("/api/cards", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: activeCard.id, status: newStatus }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Request failed with status ${res.status}`);
      }
      toast.success(newStatus === "FROZEN" ? "Card frozen" : "Card unfrozen", {
        description: newStatus === "FROZEN" ? "All transactions are paused." : "Your card is now active again.",
      });
      // Re-fetch to get fresh data
      await fetchCards();
    } catch (err) {
      toast.error("Failed to update card", {
        description: err instanceof Error ? err.message : "Please try again later.",
      });
    } finally {
      setIsTogglingFreeze(false);
    }
  };

  const handleShowDetails = () => {
    setShowDetails((prev) => !prev);
    if (!showDetails) {
      toast.info("Card details revealed", {
        description: "Number will be hidden again shortly.",
      });
      setTimeout(() => setShowDetails(false), 8000);
    }
  };

  /* ────── Loading State ────── */
  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl">
        <CardSkeleton />
      </div>
    );
  }

  /* ────── Empty State ────── */
  if (cards.length === 0 && !isUsingFallback) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <EmptyState />
        {/* Physical Card CTA still shown */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
        >
          <PhysicalCardCTA />
        </motion.div>
      </div>
    );
  }

  /* ────── Error banner ────── */
  const errorBanner = error && isUsingFallback ? (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30"
    >
      <AlertCircle className="size-5 shrink-0 text-amber-500" />
      <p className="text-sm text-amber-700 dark:text-amber-400">
        Showing offline data. API connection failed.
      </p>
    </motion.div>
  ) : null;

  /* ────── Spending data from active card or defaults ────── */
  const dailySpend = activeCard?.spentToday ?? 0;
  const dailyLimit = activeCard?.dailyLimit ?? 5000;
  const monthlySpend = activeCard?.spentMonth ?? 0;
  const monthlyLimit = activeCard?.monthlyLimit ?? 50000;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Error banner */}
      {errorBanner}

      {/* ── Virtual Card Display ── */}
      {activeCard && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <CreditCardVisual card={activeCard} showDetails={showDetails} isActive />
        </motion.div>
      )}

      {/* ── Card Actions ── */}
      {activeCard && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <button
              onClick={handleToggleFreeze}
              disabled={isTogglingFreeze || activeCard.status === "BLOCKED" || activeCard.status === "EXPIRED"}
              className={`flex flex-col items-center gap-2 rounded-xl border p-4 transition-all hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                activeCard.frozen
                  ? "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
                  : "border-border hover:border-emerald-200"
              }`}
            >
              {isTogglingFreeze ? (
                <Loader2 className="size-5 animate-spin text-emerald-500" />
              ) : activeCard.frozen ? (
                <Sun className="size-5 text-amber-500" />
              ) : (
                <Snowflake className="size-5 text-emerald-500" />
              )}
              <span className="text-xs font-medium">
                {isTogglingFreeze ? "Updating..." : activeCard.frozen ? "Unfreeze" : "Freeze"}
              </span>
            </button>
            <button
              onClick={handleShowDetails}
              className="flex flex-col items-center gap-2 rounded-xl border border-border p-4 transition-all hover:border-emerald-200 hover:shadow-sm"
            >
              {showDetails ? (
                <EyeOff className="size-5 text-emerald-500" />
              ) : (
                <Eye className="size-5 text-emerald-500" />
              )}
              <span className="text-xs font-medium">{showDetails ? "Hide" : "Show"} Details</span>
            </button>
            {activeCard.isApplePay && (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-border p-4">
                <div className="flex size-5 items-center justify-center rounded bg-black">
                  <span className="text-[8px] font-bold text-white">&#xF8FF;</span>
                </div>
                <span className="text-xs font-medium">Apple Pay</span>
              </div>
            )}
            {activeCard.isGooglePay && (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-border p-4">
                <div className="flex size-5 items-center justify-center rounded-full bg-white shadow-sm">
                  <span className="text-[10px] font-bold text-emerald-600">G</span>
                </div>
                <span className="text-xs font-medium">Google Pay</span>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── Card Tabs ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
      >
        <Card className="overflow-hidden">
          <Tabs defaultValue="my-cards">
            <CardHeader className="pb-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">My Cards</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              <TabsList className="mb-4">
                <TabsTrigger value="my-cards">My Cards</TabsTrigger>
                <TabsTrigger value="spending">Spending</TabsTrigger>
                <TabsTrigger value="transactions">Transactions</TabsTrigger>
              </TabsList>

              {/* My Cards Tab */}
              <TabsContent value="my-cards">
                <div className="flex gap-4 overflow-x-auto pb-2">
                  <AnimatePresence mode="popLayout">
                    {cards.map((c) => (
                      <motion.button
                        key={c.id}
                        layout
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        onClick={() => setActiveCardId(c.id)}
                        className="min-w-[240px] shrink-0 transition-all"
                      >
                        <CreditCardVisual
                          card={c}
                          showDetails={false}
                          isActive={c.id === activeCardId}
                        />
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-sm font-medium">{c.label}</span>
                          <div className="flex items-center gap-1.5">
                            {c.status === "FROZEN" && (
                              <Badge variant="secondary" className="text-[10px]">
                                <Snowflake className="mr-0.5 size-3" />Frozen
                              </Badge>
                            )}
                            {c.status === "BLOCKED" && (
                              <Badge variant="secondary" className="border-red-300 bg-red-50 text-red-700 text-[10px] dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
                                <Lock className="mr-0.5 size-3" />Blocked
                              </Badge>
                            )}
                            {c.status === "EXPIRED" && (
                              <Badge variant="secondary" className="text-[10px]">
                                Expired
                              </Badge>
                            )}
                            {c.status === "ACTIVE" && (
                              <Badge
                                variant="outline"
                                className="border-emerald-300 bg-emerald-50 text-emerald-700 text-[10px] dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400"
                              >
                                Active
                              </Badge>
                            )}
                          </div>
                        </div>
                      </motion.button>
                    ))}
                  </AnimatePresence>
                </div>
              </TabsContent>

              {/* Spending Tab */}
              <TabsContent value="spending">
                <div className="space-y-6">
                  {/* Daily Spending */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Zap className="size-4 text-emerald-500" />
                        <span className="text-sm font-medium">Daily Spend</span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        AED {dailySpend.toFixed(2)} / AED {dailyLimit.toLocaleString()}
                      </span>
                    </div>
                    <Progress
                      value={dailyLimit > 0 ? (dailySpend / dailyLimit) * 100 : 0}
                      className="h-3 [&>div]:bg-emerald-500"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {dailyLimit > 0
                        ? `${((dailySpend / dailyLimit) * 100).toFixed(1)}% of daily limit used`
                        : "No daily limit set"}
                    </p>
                  </div>

                  <Separator />

                  {/* Monthly Spending */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CreditCard className="size-4 text-emerald-500" />
                        <span className="text-sm font-medium">Monthly Spend</span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        AED {monthlySpend.toLocaleString()} / AED {monthlyLimit.toLocaleString()}
                      </span>
                    </div>
                    <Progress
                      value={monthlyLimit > 0 ? (monthlySpend / monthlyLimit) * 100 : 0}
                      className="h-3 [&>div]:bg-emerald-500"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {monthlyLimit > 0
                        ? `${((monthlySpend / monthlyLimit) * 100).toFixed(1)}% of monthly limit used`
                        : "No monthly limit set"}
                    </p>
                  </div>
                </div>
              </TabsContent>

              {/* Transactions Tab */}
              <TabsContent value="transactions">
                <div className="max-h-96 space-y-2 overflow-y-auto">
                  {recentTransactions.map((tx) => {
                    const Icon = tx.icon;
                    const isCredit = tx.amount > 0;
                    return (
                      <div
                        key={tx.id}
                        className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/30"
                      >
                        <div
                          className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
                            isCredit
                              ? "bg-emerald-100 dark:bg-emerald-950/50"
                              : "bg-muted"
                          }`}
                        >
                          <Icon
                            className={`size-4 ${
                              isCredit
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-muted-foreground"
                            }`}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{tx.merchant}</p>
                          <p className="text-xs text-muted-foreground">{tx.date}</p>
                        </div>
                        <div className="ml-2 flex shrink-0 flex-col items-end gap-1">
                          <span
                            className={`text-sm font-bold ${
                              isCredit
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-foreground"
                            }`}
                          >
                            {isCredit ? "+" : ""}AED{" "}
                            {Math.abs(tx.amount).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {tx.category}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>
      </motion.div>

      {/* ── Spending Overview (always visible) ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.4 }}
      >
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Spending Overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Zap className="size-4 text-emerald-500" />
                  Today
                </span>
                <span className="text-sm text-muted-foreground">
                  AED {dailySpend.toFixed(2)} / AED {dailyLimit.toLocaleString()}
                </span>
              </div>
              <Progress
                value={dailyLimit > 0 ? (dailySpend / dailyLimit) * 100 : 0}
                className="h-2.5 [&>div]:bg-emerald-500"
              />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <CreditCard className="size-4 text-emerald-500" />
                  This Month
                </span>
                <span className="text-sm text-muted-foreground">
                  AED {monthlySpend.toLocaleString()} / AED {monthlyLimit.toLocaleString()}
                </span>
              </div>
              <Progress
                value={monthlyLimit > 0 ? (monthlySpend / monthlyLimit) * 100 : 0}
                className="h-2.5 [&>div]:bg-emerald-500"
              />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Request Physical Card CTA ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.4 }}
      >
        <PhysicalCardCTA />
      </motion.div>

      {/* ── Shimmer animation keyframes ── */}
      <style jsx global>{`
        @keyframes card-shimmer {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }
      `}</style>
    </div>
  );
}

/* ──────────────── Physical Card CTA (extracted) ──────────────── */

function PhysicalCardCTA() {
  return (
    <Card className="overflow-hidden border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50/50 dark:border-emerald-800 dark:from-emerald-950/30 dark:to-teal-950/20">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-bold text-emerald-800 dark:text-emerald-300">
              Order a Physical Card
            </h3>
            <p className="mt-1 text-sm text-emerald-700/70 dark:text-emerald-400/70">
              One-time fee of AED 30. Get your card delivered to your doorstep.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { icon: Wallet, label: "ATM Withdrawals" },
                { icon: ShieldCheck, label: "Higher Limits" },
                { icon: Globe, label: "Global Acceptance" },
              ].map((benefit) => (
                <Badge
                  key={benefit.label}
                  variant="outline"
                  className="gap-1 border-emerald-300 bg-white/60 text-xs text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                >
                  <benefit.icon className="size-3" />
                  {benefit.label}
                </Badge>
              ))}
            </div>
          </div>
          <Button
            onClick={() =>
              toast.success("Physical card ordered!", {
                description: "Your card will be delivered in 3-5 business days.",
              })
            }
            className="shrink-0 bg-emerald-600 px-6 py-3 font-semibold text-white hover:bg-emerald-700"
          >
            Order Physical Card
            <ChevronRight className="ml-1 size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
