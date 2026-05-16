"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  UserPlus,
  Copy,
  Check,
  Share2,
  MessageCircle,
  Send,
  Gift,
  Users,
  ShieldCheck,
  Wallet,
  Crown,
  Trophy,
  Medal,
  Info,
  ArrowRight,
  CheckCircle2,
  Clock,
  XCircle,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

// ── Types ───────────────────────────────────────────────────────
interface ReferralData {
  referralCode: string;
  totalReferrals: number;
  successfulReferrals: number;
  totalEarned: number;
  referrals: ReferralEntry[];
  leaderboard: LeaderboardEntry[];
}

interface ReferralEntry {
  id: string;
  name: string;
  phone?: string;
  status: "COMPLETED" | "PENDING" | "REWARDED" | "EXPIRED";
  reward?: number;
  note?: string;
  date: string;
  initials: string;
}

interface LeaderboardEntry {
  rank: number;
  name: string;
  referrals: number;
  initials: string;
}

// ── Mock Fallback ───────────────────────────────────────────────
const mockData: ReferralData = {
  referralCode: "RAJESH25",
  totalReferrals: 7,
  successfulReferrals: 5,
  totalEarned: 250,
  referrals: [
    { id: "1", name: "Ahmed K.", phone: "+971509876543", status: "COMPLETED", reward: 50, note: "Signed up and completed KYC", date: "Jun 10", initials: "AK" },
    { id: "2", name: "Priya S.", status: "COMPLETED", reward: 50, date: "Jun 8", initials: "PS" },
    { id: "3", name: "Mohammad A.", status: "PENDING", note: "Awaiting KYC verification", date: "Jun 5", initials: "MA" },
    { id: "4", name: "Juan D.", status: "COMPLETED", reward: 50, date: "May 28", initials: "JD" },
    { id: "5", name: "Maria G.", status: "REWARDED", reward: 50, date: "May 20", initials: "MG" },
    { id: "6", name: "Chen W.", status: "EXPIRED", note: "Did not complete within 30 days", date: "Apr 15", initials: "CW" },
    { id: "7", name: "Singh R.", status: "COMPLETED", reward: 50, date: "Apr 2", initials: "SR" },
  ],
  leaderboard: [
    { rank: 1, name: "Rajesh K.", referrals: 7, initials: "RK" },
    { rank: 2, name: "Ahmed M.", referrals: 5, initials: "AM" },
    { rank: 3, name: "Priya S.", referrals: 4, initials: "PS" },
  ],
};

// ── Static Data ─────────────────────────────────────────────────
const howItWorks = [
  { step: 1, icon: Share2, title: "Share Your Code", description: "Share your unique referral code with friends and family" },
  { step: 2, icon: UserPlus, title: "Friend Signs Up", description: "Your friend downloads FlexPay and creates an account using your code" },
  { step: 3, icon: ShieldCheck, title: "Friend Completes KYC", description: "Your friend completes KYC Level 1 verification" },
  { step: 4, icon: Gift, title: "Both Get Rewarded", description: "You and your friend each receive AED 50 in your wallets" },
];

const rewardRules = [
  { icon: Gift, text: "AED 50 per successful referral" },
  { icon: ShieldCheck, text: "Friend must complete KYC Level 1" },
  { icon: Clock, text: "Referral valid for 30 days" },
  { icon: Users, text: "Maximum 20 referrals/month" },
  { icon: Wallet, text: "Reward credited to wallet within 24 hours" },
];

// ── Animation Variants ─────────────────────────────────────────────
const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

// ── Helpers ────────────────────────────────────────────────────────
function getStatusConfig(status: ReferralEntry["status"]) {
  switch (status) {
    case "COMPLETED":
      return { label: "Completed", bg: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700", icon: CheckCircle2 };
    case "PENDING":
      return { label: "Pending", bg: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700", icon: Clock };
    case "REWARDED":
      return { label: "Rewarded", bg: "bg-teal-500/15 text-teal-700 dark:text-teal-400 border-teal-300 dark:border-teal-700", icon: Gift };
    case "EXPIRED":
      return { label: "Expired", bg: "bg-gray-500/15 text-gray-700 dark:text-gray-400 border-gray-300 dark:border-gray-700", icon: XCircle };
    default:
      return { label: status, bg: "bg-muted text-muted-foreground border-muted", icon: Info };
  }
}

function getLeaderboardStyle(rank: number) {
  switch (rank) {
    case 1:
      return { border: "ring-2 ring-amber-400 dark:ring-amber-500", icon: Crown, color: "text-amber-500 dark:text-amber-400", bg: "bg-amber-500/10" };
    case 2:
      return { border: "ring-2 ring-slate-400 dark:ring-slate-500", icon: Medal, color: "text-slate-500 dark:text-slate-300", bg: "bg-slate-500/10" };
    case 3:
      return { border: "ring-2 ring-amber-700 dark:ring-amber-600", icon: Trophy, color: "text-amber-700 dark:text-amber-600", bg: "bg-amber-700/10" };
    default:
      return { border: "", icon: Users, color: "text-muted-foreground", bg: "bg-muted/50" };
  }
}

// ── Skeleton Component ──────────────────────────────────────────
function ReferralsSkeleton() {
  return (
    <div className="space-y-6">
      <Card className="relative overflow-hidden">
        <CardContent className="flex flex-col items-center gap-6 py-8 sm:flex-row sm:items-center sm:justify-center sm:gap-12">
          <Skeleton className="size-16 rounded-2xl" />
          <div className="flex flex-col gap-3 text-center sm:text-left">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-12 w-64 rounded-xl" />
            <div className="flex gap-2">
              <Skeleton className="h-10 w-24 rounded-lg" />
              <Skeleton className="h-10 w-24 rounded-lg" />
              <Skeleton className="h-10 w-24 rounded-lg" />
            </div>
          </div>
        </CardContent>
      </Card>
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="flex flex-col items-center gap-3 p-5 text-center">
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="p-4 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────
export function ReferralsPage() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const fetchReferrals = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/referrals");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Failed to fetch referrals data:", err);
      toast.error("Could not load referrals data. Showing sample data.");
      setData(mockData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReferrals();
  }, [fetchReferrals]);

  const handleCopyCode = () => {
    const code = data?.referralCode ?? mockData.referralCode;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      toast.success("Referral code copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleShareWhatsApp = () => {
    const code = data?.referralCode ?? mockData.referralCode;
    const text = `Join FlexPay using my referral code ${code} and get AED 50!`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  const handleShareTelegram = () => {
    const code = data?.referralCode ?? mockData.referralCode;
    const text = `Join FlexPay using my referral code ${code} and get AED 50!`;
    const url = `https://t.me/share/url?url=${encodeURIComponent("https://flexpay.ae")}&text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  const handleNativeShare = async () => {
    const code = data?.referralCode ?? mockData.referralCode;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "FlexPay Referral",
          text: `Join FlexPay using my referral code ${code} and get AED 50!`,
          url: "https://flexpay.ae",
        });
      } catch {
        // User cancelled or error
      }
    } else {
      navigator.clipboard.writeText(`Join FlexPay using my referral code ${code} and get AED 50! https://flexpay.ae`);
      toast.success("Referral link copied to clipboard!");
    }
  };

  if (loading) {
    return (
      <motion.div
        className="space-y-6"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <ReferralsSkeleton />
      </motion.div>
    );
  }

  const referrals = data ?? mockData;

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
              <UserPlus className="size-8 text-white" />
            </div>
            <div className="flex flex-col gap-3 text-center sm:text-left">
              <div>
                <h1 className="text-2xl font-bold sm:text-3xl">
                  Refer & <span className="text-emerald-600 dark:text-emerald-400">Earn</span>
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">Share FlexPay with friends and earn rewards</p>
              </div>
              {/* Referral Code Display */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-white/80 px-4 py-2.5 dark:border-emerald-800 dark:bg-emerald-950/50">
                  <span className="text-lg font-black tracking-widest font-mono text-emerald-700 dark:text-emerald-400">
                    {referrals.referralCode}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant={copied ? "default" : "outline"}
                  className={copied ? "bg-emerald-600 hover:bg-emerald-700" : "border-emerald-300 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/50"}
                  onClick={handleCopyCode}
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              {/* Share Buttons */}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/50" onClick={handleShareWhatsApp}>
                  <MessageCircle className="size-4" /> WhatsApp
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/50" onClick={handleShareTelegram}>
                  <Send className="size-4" /> Telegram
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/50" onClick={handleNativeShare}>
                  <Share2 className="size-4" /> Share
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Reward Summary */}
      <motion.div variants={item}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                <Users className="size-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Total Referrals</p>
                <p className="text-xl font-bold">{referrals.totalReferrals}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-teal-500/10">
                <CheckCircle2 className="size-5 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Successful</p>
                <p className="text-xl font-bold">{referrals.successfulReferrals}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                <Gift className="size-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Total Earned</p>
                <p className="text-xl font-bold">AED {referrals.totalEarned}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* How It Works */}
      <motion.div variants={item}>
        <h2 className="mb-4 text-lg font-semibold">How It Works</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {howItWorks.map((step) => {
            const Icon = step.icon;
            return (
              <Card key={step.step} className="relative overflow-hidden transition-shadow hover:shadow-md">
                <CardContent className="flex flex-col items-center gap-3 p-5 text-center">
                  <div className="absolute -right-3 -top-3 text-6xl font-black text-emerald-500/5">
                    {step.step}
                  </div>
                  <div className="flex size-10 items-center justify-center rounded-full bg-emerald-500/10">
                    <Icon className="size-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="relative">
                    <h3 className="text-sm font-semibold">{step.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
                  </div>
                  {step.step < 4 && (
                    <ArrowRight className="hidden size-4 text-emerald-400 lg:block absolute -right-3 top-5" />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </motion.div>

      {/* Referral History */}
      <motion.div variants={item}>
        <h2 className="mb-4 text-lg font-semibold">Referral History</h2>
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {referrals.referrals.map((ref) => {
                const statusConfig = getStatusConfig(ref.status);
                const StatusIcon = statusConfig.icon;
                return (
                  <div
                    key={ref.id}
                    className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/30 sm:gap-4"
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                      {ref.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold truncate">{ref.name}</p>
                        {ref.phone && (
                          <span className="hidden text-xs text-muted-foreground sm:inline">{ref.phone}</span>
                        )}
                      </div>
                      {ref.note && (
                        <p className="text-xs text-muted-foreground truncate">{ref.note}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                      {ref.reward != null && (
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          +AED {ref.reward}
                        </span>
                      )}
                      <Badge variant="outline" className={`gap-1 text-[10px] border ${statusConfig.bg}`}>
                        <StatusIcon className="size-3" />
                        {statusConfig.label}
                      </Badge>
                      <span className="hidden text-xs text-muted-foreground sm:inline w-16 text-right">{ref.date}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Reward Rules */}
      <motion.div variants={item}>
        <Card className="overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/30 via-transparent to-teal-50/30 dark:from-emerald-950/10 dark:to-teal-950/10" />
          <CardHeader className="relative pb-2">
            <div className="flex items-center gap-2">
              <Info className="size-4 text-emerald-600 dark:text-emerald-400" />
              <CardTitle className="text-sm font-semibold">Reward Rules</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="relative">
            <ul className="space-y-2.5">
              {rewardRules.map((rule, idx) => {
                const Icon = rule.icon;
                return (
                  <li key={idx} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-emerald-500/10">
                      <Icon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    {rule.text}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </motion.div>

      {/* Leaderboard */}
      <motion.div variants={item}>
        <h2 className="mb-4 text-lg font-semibold">Top Referrers</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {referrals.leaderboard.map((entry) => {
            const style = getLeaderboardStyle(entry.rank);
            const RankIcon = style.icon;
            return (
              <Card
                key={entry.rank}
                className={`relative overflow-hidden transition-shadow hover:shadow-md ${style.border}`}
              >
                <CardContent className="flex flex-col items-center gap-3 p-5 text-center">
                  <div className={`flex size-12 items-center justify-center rounded-full ${style.bg}`}>
                    <RankIcon className={`size-6 ${style.color}`} />
                  </div>
                  <div className="flex size-10 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                    {entry.initials}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">{entry.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-bold text-foreground">{entry.referrals}</span> referrals
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-[10px] border ${style.bg} ${style.color}`}
                  >
                    #{entry.rank} {entry.rank === 1 ? "Gold" : entry.rank === 2 ? "Silver" : "Bronze"}
                  </Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}
