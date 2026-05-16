"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  CheckCircle2,
  Circle,
  BarChart3,
  Brain,
  Smartphone,
  Calendar,
  CreditCard,
  Shield,
  ArrowUpRight,
} from "lucide-react";
import {
  CartesianGrid,
  Area,
  AreaChart,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { toast } from "sonner";

// ── Types ───────────────────────────────────────────────────────
interface CreditScoreData {
  creditScore: {
    id: string;
    userId: string;
    score: number;
    factors: string; // JSON string
    lastEvaluated: string;
    createdAt: string;
    updatedAt: string;
  };
  scoreBand: string;
  recommendation: string;
  scoreHistory: { month: string; score: number }[];
}

interface FactorEntry {
  frequency?: number;
  repayment?: number;
  age?: number;
  telecom?: number;
}

// ── Mock Fallback Data ──────────────────────────────────────────
const mockData: CreditScoreData = {
  creditScore: {
    id: "mock",
    userId: "mock",
    score: 78,
    factors: JSON.stringify({ frequency: 85, repayment: 92, age: 70, telecom: 95 }),
    lastEvaluated: "2025-01-15T00:00:00.000Z",
    createdAt: "2024-08-01T00:00:00.000Z",
    updatedAt: "2025-01-15T00:00:00.000Z",
  },
  scoreBand: "GOOD",
  recommendation: "Good credit score. Keep making timely payments to maintain your standing.",
  scoreHistory: [
    { month: "Aug", score: 50 },
    { month: "Sep", score: 55 },
    { month: "Oct", score: 60 },
    { month: "Nov", score: 65 },
    { month: "Dec", score: 72 },
    { month: "Jan", score: 78 },
  ],
};

const chartConfig = {
  score: {
    label: "Credit Score",
    color: "oklch(0.556 0.17 155)",
  },
};

interface Tip {
  title: string;
  points?: string;
  completed: boolean;
  progress?: string;
}

const tips: Tip[] = [
  { title: "Complete KYC Level 2", points: "+10 points", completed: true },
  { title: "Maintain monthly transaction volume above AED 2,000", completed: false },
  { title: "Add a verified phone number", points: "+8 points", completed: true },
  { title: "No missed payments for 6 months", progress: "4/6", completed: false },
  { title: "Link your Emirates ID", points: "+5 points", completed: false },
];

// ── Helpers ────────────────────────────────────────────────────────
function getScoreColor(score: number): string {
  if (score >= 75) return "text-emerald-500";
  if (score >= 60) return "text-yellow-500";
  if (score >= 40) return "text-amber-500";
  return "text-red-500";
}

function getScoreLabel(score: number, band?: string): string {
  if (band === "EXCELLENT") return "Excellent";
  if (band === "GOOD") return "Good";
  if (band === "FAIR") return "Fair";
  if (band === "POOR") return "Poor";
  if (band === "VERY_POOR") return "Very Poor";
  if (score >= 75) return "Good";
  if (score >= 60) return "Fair";
  if (score >= 40) return "Needs Improvement";
  return "Poor";
}

function getScoreStroke(score: number): string {
  if (score >= 75) return "stroke-emerald-500";
  if (score >= 60) return "stroke-yellow-500";
  if (score >= 40) return "stroke-amber-500";
  return "stroke-red-500";
}

function formatScoreBand(band: string): string {
  return band.charAt(0) + band.slice(1).toLowerCase();
}

function formatFactors(factorsStr: string): Array<{
  name: string;
  value: number;
  label: string;
  color: string;
  bgColor: string;
  icon: React.ComponentType<{ className?: string }>;
}> {
  const factors: FactorEntry = JSON.parse(factorsStr || "{}");

  const freq = factors.frequency ?? 0;
  const repay = factors.repayment ?? 0;
  const age = factors.age ?? 0;
  const telecom = factors.telecom ?? 0;

  return [
    {
      name: "Transaction Frequency",
      value: freq,
      label: freq >= 80 ? "High" : freq >= 50 ? "Medium" : "Low",
      color: freq >= 70 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
      bgColor: "bg-emerald-500",
      icon: BarChart3,
    },
    {
      name: "Repayment History",
      value: repay,
      label: repay >= 85 ? "Excellent" : repay >= 60 ? "Good" : repay >= 40 ? "Fair" : "Needs Work",
      color: repay >= 70 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
      bgColor: "bg-emerald-500",
      icon: CreditCard,
    },
    {
      name: "Account Age",
      value: age,
      label: age >= 80 ? `${Math.round(age / 3.3)} months` : `${Math.round(age / 3.3)} months`,
      color: age >= 70 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
      bgColor: "bg-emerald-500",
      icon: Calendar,
    },
    {
      name: "Telecom Verification",
      value: telecom,
      label: telecom >= 80 ? "Verified" : "Unverified",
      color: telecom >= 70 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
      bgColor: "bg-emerald-500",
      icon: Smartphone,
    },
  ];
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
function ScoreGauge({ score }: { score: number }) {
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className="relative flex flex-col items-center">
      <svg width="200" height="200" viewBox="0 0 200 200" className="-rotate-90">
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          className="stroke-muted"
          strokeWidth="12"
        />
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          className={getScoreStroke(score)}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{ transition: "stroke-dashoffset 1.5s ease-in-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-5xl font-black ${getScoreColor(score)}`}>{score}</span>
        <span className="mt-1 text-sm font-medium text-muted-foreground">
          {/* label set by parent */}
        </span>
      </div>
    </div>
  );
}

function ScoreGaugeWithLabel({ score, label }: { score: number; label: string }) {
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className="relative flex flex-col items-center">
      <svg width="200" height="200" viewBox="0 0 200 200" className="-rotate-90">
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          className="stroke-muted"
          strokeWidth="12"
        />
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          className={getScoreStroke(score)}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{ transition: "stroke-dashoffset 1.5s ease-in-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-5xl font-black ${getScoreColor(score)}`}>{score}</span>
        <span className="mt-1 text-sm font-medium text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

function CreditScoreSkeleton() {
  return (
    <div className="space-y-6">
      {/* Hero skeleton */}
      <Card className="relative overflow-hidden">
        <CardContent className="flex flex-col items-center gap-4 py-8 sm:flex-row sm:justify-center sm:gap-10">
          <Skeleton className="size-[200px] rounded-full" />
          <div className="flex flex-col gap-4 text-center sm:text-left">
            <div className="space-y-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-72" />
            </div>
            <Skeleton className="h-10 w-40 rounded-lg" />
            <div className="flex gap-2">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-32 rounded-full" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Breakdown skeleton */}
      <div>
        <Skeleton className="mb-4 h-6 w-40" />
        <div className="grid gap-4 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="flex items-center gap-4 p-4">
                <Skeleton className="size-10 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                  <Skeleton className="h-1.5 w-full rounded-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Chart skeleton */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-60" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[240px] w-full rounded-lg" />
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────
export function CreditScorePage() {
  const [data, setData] = useState<CreditScoreData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCreditScore = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/credit-score");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Failed to fetch credit score:", err);
      toast.error("Could not load credit score. Showing sample data.");
      setData(mockData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCreditScore();
  }, [fetchCreditScore]);

  if (loading) {
    return (
      <motion.div
        className="space-y-6"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <CreditScoreSkeleton />
      </motion.div>
    );
  }

  // Use API data or mock fallback
  const creditScore = data ?? mockData;
  const score = creditScore.creditScore.score;
  const scoreBand = creditScore.scoreBand;
  const recommendation = creditScore.recommendation;
  const scoreHistory = creditScore.scoreHistory;
  const factorsStr = creditScore.creditScore.factors;
  const scoreFactors = formatFactors(factorsStr);
  const lastEvaluated = creditScore.creditScore.lastEvaluated;

  // Compute month change from history
  const prevMonthScore = scoreHistory.length >= 2 ? scoreHistory[scoreHistory.length - 2].score : score;
  const monthChange = score - prevMonthScore;

  const label = getScoreLabel(score, scoreBand);

  return (
    <motion.div
      className="space-y-6"
      variants={container}
      initial="hidden"
      animate="show"
    >
      {/* Hero - Score Display */}
      <motion.div variants={item}>
        <Card className="relative overflow-hidden">
          <CardContent className="flex flex-col items-center gap-4 py-8 sm:flex-row sm:justify-center sm:gap-10">
            <ScoreGaugeWithLabel score={score} label={label} />
            <div className="flex flex-col gap-4 text-center sm:text-left">
              <div>
                <h1 className="text-2xl font-bold sm:text-3xl">AI Credit Score</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your alternative credit score powered by AI
                </p>
              </div>
              {monthChange > 0 && (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
                  <ArrowUpRight className="size-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                    +{monthChange} point{monthChange !== 1 ? "s" : ""} this month
                  </span>
                </div>
              )}
              {recommendation && (
                <p className="text-xs text-muted-foreground max-w-sm">{recommendation}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400">
                  <Brain className="mr-1 size-3" /> AI Analyzed
                </Badge>
                <Badge variant="outline" className="border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400">
                  {formatScoreBand(scoreBand)}
                </Badge>
                {lastEvaluated && (
                  <Badge variant="outline" className="border-border">
                    Updated: {new Date(lastEvaluated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Score Breakdown */}
      <motion.div variants={item}>
        <h2 className="mb-4 text-lg font-semibold">Score Breakdown</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {scoreFactors.map((factor) => {
            const Icon = factor.icon;
            return (
              <Card key={factor.name} className="transition-shadow hover:shadow-md">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                    <Icon className="size-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">{factor.name}</h3>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${factor.color}`}>
                          {factor.label}
                        </span>
                        <span className="text-sm font-bold">{factor.value}/100</span>
                      </div>
                    </div>
                    <Progress value={factor.value} className="mt-2 h-1.5" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </motion.div>

      {/* Score History Chart */}
      <motion.div variants={item}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Score History</CardTitle>
            <CardDescription>Your credit score trend over the last 6 months</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[240px] w-full">
              <AreaChart data={scoreHistory} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.556 0.17 155)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="oklch(0.556 0.17 155)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="score"
                  stroke="oklch(0.556 0.17 155)"
                  strokeWidth={2.5}
                  fill="url(#scoreGradient)"
                  dot={{ r: 4, fill: "oklch(0.556 0.17 155)", strokeWidth: 0 }}
                  activeDot={{ r: 6, fill: "oklch(0.556 0.17 155)", stroke: "white", strokeWidth: 2 }}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </motion.div>

      {/* Tips to Improve */}
      <motion.div variants={item}>
        <h2 className="mb-4 text-lg font-semibold">Tips to Improve</h2>
        <Card>
          <CardContent className="space-y-3 p-4">
            {tips.map((tip, idx) => (
              <div
                key={idx}
                className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                  tip.completed
                    ? "border-emerald-200 bg-emerald-50/30 dark:border-emerald-800/40 dark:bg-emerald-950/10"
                    : "border-border"
                }`}
              >
                {tip.completed ? (
                  <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
                ) : (
                  <Circle className="size-5 shrink-0 text-muted-foreground" />
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${tip.completed ? "line-through text-muted-foreground" : ""}`}>
                    {tip.title}
                  </p>
                  {tip.progress && (
                    <div className="mt-1 flex items-center gap-2">
                      <Progress value={66} className="h-1 w-20" />
                      <span className="text-[10px] text-muted-foreground">{tip.progress}</span>
                    </div>
                  )}
                </div>
                {tip.points && (
                  <Badge
                    variant="outline"
                    className={`shrink-0 text-[10px] ${
                      tip.completed
                        ? "border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400"
                        : "border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {tip.points}
                  </Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </motion.div>

      {/* How AI Scores Work */}
      <motion.div variants={item}>
        <Card className="overflow-hidden border-emerald-200 bg-emerald-50/30 dark:border-emerald-800/40 dark:bg-emerald-950/10">
          <CardContent className="flex items-start gap-4 p-5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
              <Brain className="size-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">How AI Scores Work</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Our AI analyzes transaction patterns, not bank history. We look at your payment consistency,
                account activity, telecom verification, and other alternative data points to build a credit profile
                that works for everyone — even without a traditional banking history.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline" className="border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400 text-[10px]">
                  <Shield className="mr-1 size-3" /> Secure
                </Badge>
                <Badge variant="outline" className="border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400 text-[10px]">
                  <BarChart3 className="mr-1 size-3" /> Data-Driven
                </Badge>
                <Badge variant="outline" className="border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400 text-[10px]">
                  <TrendingUp className="mr-1 size-3" /> Fair
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
