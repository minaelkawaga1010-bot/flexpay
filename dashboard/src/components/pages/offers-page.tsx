"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Tag,
  TrendingUp,
  PiggyBank,
  Zap,
  Gift,
  Globe,
  CreditCard,
  Users,
  Banknote,
  Flame,
  ChevronDown,
  Info,
  Clock,
  ArrowRight,
  Percent,
  CircleDot,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";

// ── Types ───────────────────────────────────────────────────────
interface OfferItem {
  id: string;
  title: string;
  description: string;
  type: string;
  discountLabel: string;
  validUntil: string;
  redemptions: string;
  progress: number;
  badge?: string;
  gradient: string;
  action: string;
}

interface CashbackEntry {
  id: string;
  merchant: string;
  amount: number;
  date: string;
}

interface OffersData {
  totalCashback: number;
  monthlyCashback: number;
  activeOfferCount: number;
  offers: OfferItem[];
  cashbackHistory: CashbackEntry[];
  expiredOffers: OfferItem[];
}

// ── Mock Fallback ───────────────────────────────────────────────
const mockData: OffersData = {
  totalCashback: 340.5,
  monthlyCashback: 45.2,
  activeOfferCount: 4,
  offers: [
    {
      id: "1",
      title: "Ramadan Special",
      description: "2x cashback on all remittances to any country",
      type: "REMITTANCE_FEE_WAIVER",
      discountLabel: "100% discount",
      validUntil: "Jun 30, 2025",
      redemptions: "234/500",
      progress: 46.8,
      badge: "HOT",
      gradient: "from-emerald-500 to-teal-600",
      action: "Redeem",
    },
    {
      id: "2",
      title: "First Card Free",
      description: "Get your virtual FlexPay card with zero setup fees",
      type: "SIGNUP_BONUS",
      discountLabel: "AED 30 off",
      validUntil: "No expiry",
      redemptions: "Unlimited",
      progress: 0,
      gradient: "from-teal-500 to-emerald-600",
      action: "Redeem",
    },
    {
      id: "3",
      title: "Refer & Earn",
      description: "Earn AED 50 for every friend who signs up using your code",
      type: "REFER_BONUS",
      discountLabel: "Fixed AED 50",
      validUntil: "Jul 31, 2025",
      redemptions: "12/unlimited",
      progress: 0,
      gradient: "from-amber-500 to-emerald-500",
      action: "View Details",
    },
    {
      id: "4",
      title: "Salary Advance",
      description: "0% fee on your first earned wage access withdrawal",
      type: "CASHBACK",
      discountLabel: "AED 10 cashback",
      validUntil: "Jun 15, 2025",
      redemptions: "89/200",
      progress: 44.5,
      gradient: "from-emerald-600 to-teal-500",
      action: "Redeem",
    },
  ],
  cashbackHistory: [
    { id: "1", merchant: "Remittance to India", amount: 12.5, date: "Jun 12" },
    { id: "2", merchant: "Carrefour", amount: 2.5, date: "Jun 10" },
    { id: "3", merchant: "Luxury spend", amount: 5.0, date: "Jun 8" },
    { id: "4", merchant: "Remittance to Philippines", amount: 15.0, date: "Jun 5" },
    { id: "5", merchant: "LuLu Hypermarket", amount: 1.5, date: "Jun 3" },
    { id: "6", merchant: "Remittance to Pakistan", amount: 8.75, date: "May 30" },
  ],
  expiredOffers: [
    {
      id: "e1",
      title: "Eid Mubarak Bonus",
      description: "Extra AED 25 cashback on first remittance in June",
      type: "CASHBACK",
      discountLabel: "AED 25 cashback",
      validUntil: "Jun 5, 2025",
      redemptions: "150/150",
      progress: 100,
      gradient: "from-gray-400 to-gray-500",
      action: "Expired",
    },
    {
      id: "e2",
      title: "New User Welcome",
      description: "AED 20 credit on your first top-up",
      type: "SIGNUP_BONUS",
      discountLabel: "AED 20 off",
      validUntil: "May 31, 2025",
      redemptions: "500/500",
      progress: 100,
      gradient: "from-gray-400 to-gray-500",
      action: "Expired",
    },
  ],
};

// ── Animation Variants ─────────────────────────────────────────────
const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

// ── Skeleton Component ──────────────────────────────────────────
function OffersSkeleton() {
  return (
    <div className="space-y-6">
      {/* Hero skeleton */}
      <Card className="relative overflow-hidden">
        <CardContent className="flex flex-col items-center gap-6 py-8 sm:flex-row sm:items-center sm:justify-center sm:gap-12">
          <Skeleton className="size-16 rounded-2xl" />
          <div className="flex flex-col gap-3 text-center sm:text-left">
            <Skeleton className="h-8 w-52" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-7 w-36 rounded-full" />
          </div>
        </CardContent>
      </Card>
      {/* Stats skeleton */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="flex items-center gap-4 p-4">
              <Skeleton className="size-10 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-6 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {/* Offers grid skeleton */}
      <div className="grid gap-4 sm:grid-cols-2">
        {[1, 2].map((i) => (
          <Card key={i}>
            <CardContent className="p-4 space-y-3">
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-3 w-full" />
              <div className="flex gap-2">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
              <Skeleton className="h-9 w-full rounded-lg" />
            </CardContent>
          </Card>
        ))}
      </div>
      {/* Cashback history skeleton */}
      <Card>
        <CardContent className="p-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-lg" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────
export function OffersPage() {
  const [data, setData] = useState<OffersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expiredOpen, setExpiredOpen] = useState(false);

  const fetchOffers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/offers");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Failed to fetch offers data:", err);
      toast.error("Could not load offers. Showing sample data.");
      setData(mockData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOffers();
  }, [fetchOffers]);

  if (loading) {
    return (
      <motion.div
        className="space-y-6"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <OffersSkeleton />
      </motion.div>
    );
  }

  const offers = data ?? mockData;

  return (
    <motion.div
      className="space-y-6"
      variants={container}
      initial="hidden"
      animate="show"
    >
      {/* Hero Section */}
      <motion.div variants={item}>
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/80 via-transparent to-teal-50/80 dark:from-emerald-950/30 dark:to-teal-950/30" />
          <CardContent className="relative flex flex-col items-center gap-6 py-8 sm:flex-row sm:items-center sm:justify-center sm:gap-12">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25">
              <Tag className="size-8 text-white" />
            </div>
            <div className="flex flex-col gap-3 text-center sm:text-left">
              <div>
                <h1 className="text-2xl font-bold sm:text-3xl">
                  Offers & <span className="text-emerald-600 dark:text-emerald-400">Cashback</span>
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">Save more with every transaction</p>
              </div>
              <Badge className="w-fit border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-xs px-3 py-1">
                <Gift className="mr-1.5 size-3.5" />
                Total cashback earned: AED {offers.totalCashback.toFixed(2)}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Cashback Overview */}
      <motion.div variants={item}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                <TrendingUp className="size-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">This Month</p>
                <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">AED {offers.monthlyCashback.toFixed(2)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-teal-500/10">
                <PiggyBank className="size-5 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">All Time</p>
                <p className="text-xl font-bold text-teal-600 dark:text-teal-400">AED {offers.totalCashback.toFixed(2)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                <Zap className="size-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Active Offers</p>
                <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{offers.activeOfferCount}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* Cashback Rates */}
      <motion.div variants={item}>
        <Card className="overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/30 via-transparent to-teal-50/30 dark:from-emerald-950/10 dark:to-teal-950/10" />
          <CardHeader className="relative pb-2">
            <div className="flex items-center gap-2">
              <Percent className="size-4 text-emerald-600 dark:text-emerald-400" />
              <CardTitle className="text-sm font-semibold">Cashback Rates</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="relative">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-start gap-3 rounded-lg bg-emerald-500/5 p-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                  <CreditCard className="size-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Basic Spending</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">1% cashback</span> on everyday purchases
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">Cap: AED 100/month</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg bg-teal-500/5 p-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-teal-500/10">
                  <Banknote className="size-4 text-teal-600 dark:text-teal-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Luxury Spending</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-bold text-teal-600 dark:text-teal-400">2.5% cashback</span> on purchases of AED 100+
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">Cap: AED 300/month</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Active Offers */}
      <motion.div variants={item}>
        <h2 className="mb-4 text-lg font-semibold">Active Offers</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {offers.offers.map((offer) => (
            <Card key={offer.id} className="overflow-hidden transition-shadow hover:shadow-md">
              {/* Gradient header image placeholder */}
              <div className={`relative h-28 bg-gradient-to-br ${offer.gradient} flex items-center justify-center`}>
                <div className="absolute inset-0 bg-black/5" />
                <div className="relative flex flex-col items-center gap-2">
                  <Gift className="size-8 text-white/80" />
                  <span className="text-xs font-bold text-white/90 uppercase tracking-wider">{offer.type.replace(/_/g, " ")}</span>
                </div>
                {offer.badge && (
                  <Badge className="absolute right-3 top-3 border-0 bg-white/20 text-white text-[10px] backdrop-blur-sm gap-1">
                    <Flame className="size-3" />
                    {offer.badge}
                  </Badge>
                )}
              </div>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <h3 className="text-sm font-bold">{offer.title}</h3>
                  <Badge variant="outline" className="shrink-0 ml-2 text-[10px] border-emerald-200 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400">
                    {offer.discountLabel}
                  </Badge>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{offer.description}</p>

                <div className="mt-3 flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    {offer.validUntil}
                  </span>
                  <span className="flex items-center gap-1">
                    <CircleDot className="size-3" />
                    {offer.redemptions}
                  </span>
                </div>

                {offer.progress > 0 && (
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Redemptions</span>
                      <span>{Math.round(offer.progress)}%</span>
                    </div>
                    <Progress value={offer.progress} className="h-1.5" />
                  </div>
                )}

                <Button
                  size="sm"
                  className="mt-3 w-full gap-1.5"
                  onClick={() => {
                    if (offer.action === "Redeem") {
                      toast.success(`"${offer.title}" offer redeemed! Check your wallet.`);
                    } else {
                      toast.info(`Viewing details for "${offer.title}"`);
                    }
                  }}
                >
                  {offer.action === "Redeem" ? (
                    <><Zap className="size-3.5" /> {offer.action}</>
                  ) : (
                    <><ArrowRight className="size-3.5" /> {offer.action}</>
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </motion.div>

      {/* Cashback History */}
      <motion.div variants={item}>
        <h2 className="mb-4 text-lg font-semibold">Recent Cashback</h2>
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {offers.cashbackHistory.map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/30">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                    <TrendingUp className="size-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{entry.merchant}</p>
                    <p className="text-[10px] text-muted-foreground">{entry.date}</p>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    +AED {entry.amount.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Expired Offers */}
      <motion.div variants={item}>
        <Collapsible open={expiredOpen} onOpenChange={setExpiredOpen}>
          <Card className="opacity-70">
            <CollapsibleTrigger className="w-full">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <XCircle className="size-4 text-muted-foreground" />
                    <CardTitle className="text-sm font-semibold text-muted-foreground">Expired Offers</CardTitle>
                    <Badge variant="outline" className="text-[10px] border-muted text-muted-foreground">
                      {offers.expiredOffers.length}
                    </Badge>
                  </div>
                  <ChevronDown className={`size-4 text-muted-foreground transition-transform ${expiredOpen ? "rotate-180" : ""}`} />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Separator />
              <CardContent className="pt-4 space-y-4">
                {offers.expiredOffers.map((offer) => (
                  <Card key={offer.id} className="border-dashed opacity-60">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${offer.gradient}`}>
                          <Gift className="size-5 text-white/60" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-muted-foreground line-through">{offer.title}</h3>
                            <Badge variant="outline" className="text-[10px] border-gray-300 text-gray-500 dark:border-gray-700 dark:text-gray-400">
                              Expired
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{offer.description}</p>
                          <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="size-3" />
                              {offer.validUntil}
                            </span>
                            <span className="flex items-center gap-1">
                              <CircleDot className="size-3" />
                              {offer.redemptions}
                            </span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </motion.div>
    </motion.div>
  );
}
