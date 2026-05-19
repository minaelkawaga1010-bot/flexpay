"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Star,
  Gift,
  Send,
  Wallet,
  UserPlus,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  Zap,
  CreditCard,
  Crown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

// ── Types ───────────────────────────────────────────────────────
interface LoyaltyData {
  loyalty: {
    id: string;
    userId: string;
    points: number;
    tier: string;
    badges: string; // JSON array string
    createdAt: string;
    updatedAt: string;
  };
  allBadges: Array<{
    id: string;
    name: string;
    description: string;
    icon: string;
    earned: boolean;
  }>;
  tierProgress: {
    currentTier: string;
    nextTier: string | null;
    pointsNeeded: number;
    currentPoints: number;
    progress: number;
  };
}

// ── Mock Fallback ───────────────────────────────────────────────
const mockData: LoyaltyData = {
  loyalty: {
    id: "mock",
    userId: "mock",
    points: 1250,
    tier: "GOLD",
    badges: JSON.stringify(["FIRST_TRANSFER", "FIVE_REMITTANCES", "KYC_COMPLETE", "INVITE_3_FRIENDS"]),
    createdAt: "2024-06-01T00:00:00.000Z",
    updatedAt: "2025-01-15T00:00:00.000Z",
  },
  allBadges: [
    { id: "FIRST_TRANSFER", name: "First Transfer", description: "Completed your first transfer", icon: "✈️", earned: true },
    { id: "FIVE_REMITTANCES", name: "Remittance Pro", description: "Sent 5 remittances", icon: "🌍", earned: true },
    { id: "KYC_COMPLETE", name: "Verified", description: "Completed KYC verification", icon: "✅", earned: true },
    { id: "INVITE_3_FRIENDS", name: "Social Butterfly", description: "Invited 3 friends", icon: "👥", earned: true },
    { id: "INVITE_5_FRIENDS", name: "Community Leader", description: "Invited 5 friends", icon: "🤝", earned: false },
    { id: "CARD_HOLDER", name: "Card Holder", description: "Activated a virtual card", icon: "💳", earned: false },
  ],
  tierProgress: {
    currentTier: "GOLD",
    nextTier: "PLATINUM",
    pointsNeeded: 850,
    currentPoints: 1250,
    progress: 59.5,
  },
};

// ── Static Data ─────────────────────────────────────────────────
const tierBenefits = [
  { tier: "Bronze", minPoints: 0, color: "text-amber-700 dark:text-amber-500", bgColor: "bg-amber-500", icon: ShieldCheck, benefits: ["1x point multiplier", "Basic support"] },
  { tier: "Silver", minPoints: 500, color: "text-slate-500 dark:text-slate-300", bgColor: "bg-slate-400", icon: Star, benefits: ["1.5x point multiplier", "Priority support", "Free transfers"] },
  { tier: "Gold", minPoints: 1500, color: "text-amber-500 dark:text-amber-400", bgColor: "bg-amber-400", icon: Crown, benefits: ["2x point multiplier", "VIP support", "Fee waivers", "Exclusive offers"] },
  { tier: "Platinum", minPoints: 5000, color: "text-emerald-500 dark:text-emerald-400", bgColor: "bg-emerald-400", icon: Sparkles, benefits: ["3x point multiplier", "Dedicated manager", "All Gold benefits", "Cashback rewards"] },
];

const pointsBreakdown = [
  { source: "From remittances", points: 500, icon: Send },
  { source: "From spending", points: 350, icon: CreditCard },
  { source: "From referrals", points: 400, icon: UserPlus },
];

const earnMethods = [
  { action: "Send a remittance", points: "+10 points", icon: Send },
  { action: "Spend AED 20", points: "+1 point", icon: Wallet },
  { action: "Refer a friend", points: "+50 points", icon: UserPlus },
  { action: "Repay on time", points: "+10 points", icon: CheckCircle2 },
  { action: "Complete KYC", points: "+25 points (one-time)", icon: ShieldCheck },
];

const rewards = [
  { name: "Free remittance", cost: 500, description: "One free international transfer up to AED 5,000" },
  { name: "Card fee waiver", cost: 300, description: "Waive your monthly card maintenance fee" },
  { name: "AED 10 cashback", cost: 200, description: "Get AED 10 credited to your wallet" },
];

// ── Helpers ────────────────────────────────────────────────────────
function getTierLabel(tier: string): string {
  const labels: Record<string, string> = {
    BRONZE: "Bronze",
    SILVER: "Silver",
    GOLD: "Gold",
    PLATINUM: "Platinum",
  };
  return labels[tier] || tier;
}

function getMultiplier(tier: string): string {
  const multipliers: Record<string, string> = {
    BRONZE: "1x",
    SILVER: "1.5x",
    GOLD: "2x",
    PLATINUM: "3x",
  };
  return multipliers[tier] || "1x";
}

function formatTier(tier: string): string {
  return tier.charAt(0) + tier.slice(1).toLowerCase();
}

// ── Animation Variants ─────────────────────────────────────────────
const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

// ── Components ─────────────────────────────────────────────────────
function TierMedallion({ tier }: { tier: string }) {
  const tierLower = tier.toLowerCase();
  const isGold = tierLower === "gold";
  const isPlatinum = tierLower === "platinum";
  return (
    <div className="flex flex-col items-center">
      <div
        className={`relative flex size-28 items-center justify-center rounded-full ${
          isGold
            ? "bg-gradient-to-br from-amber-400 via-amber-500 to-yellow-600 shadow-lg shadow-amber-500/25"
            : isPlatinum
            ? "bg-gradient-to-br from-emerald-400 via-teal-500 to-emerald-600 shadow-lg shadow-emerald-500/25"
            : "bg-gradient-to-br from-slate-400 via-slate-500 to-slate-600 shadow-lg shadow-slate-500/25"
        }`}
      >
        <div className="absolute inset-1 rounded-full bg-gradient-to-br from-white/20 to-transparent" />
        <div className="relative text-center">
          <Crown className="mx-auto size-8 text-white" />
          <span className="block text-xs font-black uppercase tracking-widest text-white">
            {tier}
          </span>
        </div>
      </div>
    </div>
  );
}

function LoyaltySkeleton() {
  return (
    <div className="space-y-6">
      {/* Hero skeleton */}
      <Card className="relative overflow-hidden">
        <CardContent className="flex flex-col items-center gap-6 py-8 sm:flex-row sm:items-center sm:justify-center sm:gap-12">
          <Skeleton className="size-28 rounded-full" />
          <div className="flex flex-col gap-3 text-center sm:text-left">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-3 w-full max-w-xs sm:max-w-sm rounded-full" />
            <Skeleton className="h-6 w-44 rounded-full" />
          </div>
        </CardContent>
      </Card>

      {/* Points skeleton */}
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="text-center">
            <Skeleton className="h-3 w-20 mx-auto" />
            <Skeleton className="mt-2 h-10 w-36 mx-auto" />
          </div>
          <div className="grid grid-cols-3 gap-4 sm:gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="text-center">
                <Skeleton className="size-8 rounded-lg mx-auto" />
                <Skeleton className="mt-1 h-4 w-10 mx-auto" />
                <Skeleton className="h-3 w-20 mx-auto" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Badges skeleton */}
      <div>
        <Skeleton className="mb-4 h-6 w-36" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i}>
              <CardContent className="flex flex-col items-center gap-2 p-4">
                <Skeleton className="size-10 rounded-lg" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────
export function LoyaltyPage() {
  const [data, setData] = useState<LoyaltyData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchLoyalty = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/loyalty");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Failed to fetch loyalty data:", err);
      toast.error("Could not load loyalty data. Showing sample data.");
      setData(mockData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLoyalty();
  }, [fetchLoyalty]);

  if (loading) {
    return (
      <motion.div
        className="space-y-6"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <LoyaltySkeleton />
      </motion.div>
    );
  }

  const loyalty = data ?? mockData;
  const currentTier = loyalty.loyalty.tier;
  const currentPoints = loyalty.loyalty.points;
  const tierProg = loyalty.tierProgress;
  const badges = loyalty.allBadges;
  const earnedBadges: string[] = JSON.parse(loyalty.loyalty.badges || "[]");

  const pointsToNext = tierProg.pointsNeeded;
  const nextTier = tierProg.nextTier;
  const tierProgressPercent = tierProg.progress;
  const multiplier = getMultiplier(currentTier);

  return (
    <motion.div
      className="space-y-6"
      variants={container}
      initial="hidden"
      animate="show"
    >
      {/* Hero - Tier Progress */}
      <motion.div variants={item}>
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/50 via-transparent to-amber-50/50 dark:from-emerald-950/20 dark:to-amber-950/20" />
          <CardContent className="relative flex flex-col items-center gap-6 py-8 sm:flex-row sm:items-center sm:justify-center sm:gap-12">
            <TierMedallion tier={currentTier} />
            <div className="flex flex-col gap-3 text-center sm:text-left">
              <div>
                <h1 className="text-2xl font-bold sm:text-3xl">
                  <span className="text-amber-500">{formatTier(currentTier)}</span> Member
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">Your loyalty rewards journey</p>
              </div>
              <div className="w-full max-w-xs sm:max-w-sm">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-amber-600 dark:text-amber-400">{formatTier(currentTier)}</span>
                  <span className="text-muted-foreground">
                    {nextTier ? (
                      <>
                        <span className="font-semibold text-foreground">{pointsToNext.toLocaleString()}</span> more points to{" "}
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatTier(nextTier)}</span>
                      </>
                    ) : (
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">Max tier reached! 🎉</span>
                    )}
                  </span>
                </div>
                <Progress value={nextTier ? tierProgressPercent : 100} className="h-3" />
              </div>
              <Badge variant="outline" className="w-fit border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400 text-[10px]">
                <Star className="mr-1 size-3" /> {multiplier} Point Multiplier Active
              </Badge>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Points Summary */}
      <motion.div variants={item}>
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="text-center">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Your Points</p>
              <p className="mt-1 text-4xl font-black text-foreground">
                {currentPoints.toLocaleString()}
                <span className="ml-1 text-base font-medium text-muted-foreground">pts</span>
              </p>
            </div>
            <Separator orientation="vertical" className="hidden h-12 sm:block" />
            <div className="grid grid-cols-3 gap-4 sm:gap-6">
              {pointsBreakdown.map((pb) => {
                const Icon = pb.icon;
                return (
                  <div key={pb.source} className="text-center">
                    <div className="mx-auto flex size-8 items-center justify-center rounded-lg bg-emerald-500/10">
                      <Icon className="size-4 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <p className="mt-1 text-sm font-bold">{pb.points}</p>
                    <p className="text-[10px] text-muted-foreground">{pb.source}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Earn Points */}
      <motion.div variants={item}>
        <h2 className="mb-4 text-lg font-semibold">Earn Points</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {earnMethods.map((method) => {
            const Icon = method.icon;
            return (
              <Card key={method.action} className="transition-shadow hover:shadow-md">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                    <Icon className="size-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{method.action}</p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">{method.points}</p>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground/50" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      </motion.div>

      {/* Badges Collection */}
      <motion.div variants={item}>
        <h2 className="mb-4 text-lg font-semibold">Badges Collection</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {badges.map((badge) => (
            <Card
              key={badge.id}
              className={`transition-shadow hover:shadow-md ${
                !badge.earned ? "opacity-60" : ""
              }`}
            >
              <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
                <span className="text-3xl">{badge.icon}</span>
                <p className="text-xs font-semibold">{badge.name}</p>
                <Badge
                  variant="outline"
                  className={`text-[10px] ${
                    badge.earned
                      ? "border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400"
                      : "border-muted text-muted-foreground"
                  }`}
                >
                  {badge.earned ? "Earned" : "Locked"}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      </motion.div>

      {/* Redeem Section */}
      <motion.div variants={item}>
        <h2 className="mb-4 text-lg font-semibold">Redeem Points</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {rewards.map((reward) => (
            <Card key={reward.name} className="overflow-hidden transition-shadow hover:shadow-md">
              <div className="h-2 bg-gradient-to-r from-emerald-400 to-teal-500" />
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10">
                    <Gift className="size-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-0 text-[10px]">
                    {reward.cost} pts
                  </Badge>
                </div>
                <h3 className="mt-3 text-sm font-semibold">{reward.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{reward.description}</p>
                <Button
                  size="sm"
                  className="mt-3 w-full gap-1.5"
                  disabled={currentPoints < reward.cost}
                  onClick={() =>
                    toast.success(`"${reward.name}" redeemed for ${reward.cost} points!`)
                  }
                >
                  <Zap className="size-3.5" /> Redeem
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </motion.div>

      {/* Tier Benefits Comparison */}
      <motion.div variants={item}>
        <h2 className="mb-4 text-lg font-semibold">Tier Benefits</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tierBenefits.map((tier) => {
            const Icon = tier.icon;
            const isActive = tier.tier.toLowerCase() === currentTier.toLowerCase();
            return (
              <Card
                key={tier.tier}
                className={`relative overflow-hidden transition-shadow hover:shadow-md ${
                  isActive ? "ring-2 ring-amber-400 dark:ring-amber-500" : ""
                }`}
              >
                {isActive && (
                  <div className="absolute right-2 top-2">
                    <Badge className="bg-amber-400 text-amber-900 border-0 text-[10px]">Current</Badge>
                  </div>
                )}
                <CardContent className="flex flex-col items-center gap-3 p-5 text-center">
                  <div className={`flex size-12 items-center justify-center rounded-full ${tier.bgColor}/15`}>
                    <Icon className={`size-6 ${tier.color}`} />
                  </div>
                  <div>
                    <h3 className={`text-sm font-bold ${tier.color}`}>{tier.tier}</h3>
                    <p className="text-[10px] text-muted-foreground">{tier.minPoints.toLocaleString()}+ points</p>
                  </div>
                  <Separator />
                  <ul className="space-y-1.5 self-start">
                    {tier.benefits.map((b) => (
                      <li key={b} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />
                        {b}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}
