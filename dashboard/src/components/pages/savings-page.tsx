"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  PiggyBank,
  Target,
  Plus,
  TrendingUp,
  Flame,
  Lightbulb,
  ArrowRight,
  Calendar,
  Zap,
  Wallet,
  CircleDollarSign,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// ── Types ───────────────────────────────────────────────────────
interface SavingsGoal {
  id: string;
  name: string;
  currentAmount: number;
  targetAmount: number;
  category: string;
  autoContribute: number | null;
  targetDate: string;
  createdAt: string;
}

interface SavingsData {
  goals: SavingsGoal[];
  totalSaved: number;
  activeGoals: number;
  monthlyAutoSave: number;
  streak: number;
}

// ── Mock Fallback ───────────────────────────────────────────────
const mockData: SavingsData = {
  goals: [
    {
      id: "mock-1",
      name: "Emergency Fund",
      currentAmount: 3200,
      targetAmount: 10000,
      category: "EMERGENCY",
      autoContribute: 500,
      targetDate: "2025-12-31",
      createdAt: "2024-06-01T00:00:00.000Z",
    },
    {
      id: "mock-2",
      name: "Education",
      currentAmount: 4250,
      targetAmount: 5000,
      category: "EDUCATION",
      autoContribute: 750,
      targetDate: "2025-06-30",
      createdAt: "2024-08-15T00:00:00.000Z",
    },
    {
      id: "mock-3",
      name: "Vacation",
      currentAmount: 1000,
      targetAmount: 3000,
      category: "TRAVEL",
      autoContribute: null,
      targetDate: "2026-03-15",
      createdAt: "2025-01-10T00:00:00.000Z",
    },
  ],
  totalSaved: 8450,
  activeGoals: 3,
  monthlyAutoSave: 1500,
  streak: 4,
};

// ── Static Data ─────────────────────────────────────────────────
const categoryColors: Record<
  string,
  { bg: string; text: string; progress: string; badge: string }
> = {
  EMERGENCY: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-600 dark:text-emerald-400",
    progress: "[&>div]:bg-emerald-500",
    badge: "border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400",
  },
  EDUCATION: {
    bg: "bg-teal-500/10",
    text: "text-teal-600 dark:text-teal-400",
    progress: "[&>div]:bg-teal-500",
    badge: "border-teal-300 text-teal-600 dark:border-teal-700 dark:text-teal-400",
  },
  TRAVEL: {
    bg: "bg-amber-500/10",
    text: "text-amber-600 dark:text-amber-400",
    progress: "[&>div]:bg-amber-500",
    badge: "border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400",
  },
  HEALTH: {
    bg: "bg-rose-500/10",
    text: "text-rose-600 dark:text-rose-400",
    progress: "[&>div]:bg-rose-500",
    badge: "border-rose-300 text-rose-600 dark:border-rose-700 dark:text-rose-400",
  },
  INVESTMENT: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-600 dark:text-emerald-400",
    progress: "[&>div]:bg-emerald-500",
    badge: "border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400",
  },
  CUSTOM: {
    bg: "bg-slate-500/10",
    text: "text-slate-600 dark:text-slate-400",
    progress: "[&>div]:bg-slate-500",
    badge: "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400",
  },
};

const categoryIcons: Record<string, string> = {
  EMERGENCY: "🛡️",
  EDUCATION: "🎓",
  TRAVEL: "✈️",
  HEALTH: "🏥",
  INVESTMENT: "📈",
  CUSTOM: "⭐",
};

const savingsTips = [
  {
    title: "Start Small",
    description:
      "Even AED 100/month adds up to AED 1,200/year. Small, consistent contributions make a big difference over time.",
    icon: PiggyBank,
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/10",
  },
  {
    title: "Round-Up Savings",
    description:
      "Enable round-up to automatically save spare change from every transaction. Watch your savings grow effortlessly.",
    icon: CircleDollarSign,
    color: "text-teal-600 dark:text-teal-400",
    bg: "bg-teal-500/10",
  },
  {
    title: "Auto-Contribute",
    description:
      "Set it and forget it. Schedule automatic monthly contributions to reach your goals without thinking about it.",
    icon: Zap,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10",
  },
];

const howItWorksSteps = [
  {
    step: 1,
    title: "Set a Goal",
    description: "Choose a savings goal — emergency fund, education, vacation, or anything you dream of.",
    icon: Target,
  },
  {
    step: 2,
    title: "Save Automatically",
    description: "Enable auto-contribute or round-up savings to grow your balance without effort.",
    icon: Wallet,
  },
  {
    step: 3,
    title: "Reach Your Target",
    description: "Watch your progress grow and celebrate when you hit your savings milestone.",
    icon: CheckCircle2,
  },
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
function getCategoryLabel(cat: string): string {
  return cat.charAt(0) + cat.slice(1).toLowerCase();
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function getPercent(current: number, target: number): number {
  return Math.round((current / target) * 100);
}

// ── Skeleton Component ────────────────────────────────────────────
function SavingsSkeleton() {
  return (
    <div className="space-y-6">
      {/* Hero skeleton */}
      <Card className="relative overflow-hidden">
        <CardContent className="flex flex-col items-center gap-6 py-8 sm:flex-row sm:items-center sm:justify-center sm:gap-12">
          <Skeleton className="size-20 rounded-2xl" />
          <div className="flex flex-col gap-3 text-center sm:text-left">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-9 w-32 rounded-full" />
          </div>
        </CardContent>
      </Card>

      {/* Stats skeleton */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="flex items-center gap-3 p-4">
              <Skeleton className="size-10 rounded-lg" />
              <div className="flex-1">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="mt-1 h-6 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Goals skeleton */}
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-lg" />
                  <div>
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="mt-1 h-3 w-20" />
                  </div>
                </div>
                <Skeleton className="h-5 w-12 rounded-full" />
              </div>
              <Skeleton className="mt-4 h-3 w-full rounded-full" />
              <div className="mt-4 flex gap-2">
                <Skeleton className="h-8 w-24 rounded-full" />
                <Skeleton className="h-8 w-20 rounded-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────
export function SavingsPage() {
  const [data, setData] = useState<SavingsData | null>(null);
  const [loading, setLoading] = useState(true);

  // Create Goal Dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newGoalName, setNewGoalName] = useState("");
  const [newGoalCategory, setNewGoalCategory] = useState("");
  const [newGoalAmount, setNewGoalAmount] = useState("");
  const [newGoalAuto, setNewGoalAuto] = useState(false);
  const [newGoalAutoAmount, setNewGoalAutoAmount] = useState("");
  const [newGoalDate, setNewGoalDate] = useState("");
  const [creatingGoal, setCreatingGoal] = useState(false);

  // Add Funds Dialog state
  const [addFundsDialogOpen, setAddFundsDialogOpen] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<SavingsGoal | null>(null);
  const [fundAmount, setFundAmount] = useState("");
  const [fundSource, setFundSource] = useState("wallet");
  const [addingFunds, setAddingFunds] = useState(false);

  const fetchSavings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/savings");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Map API response to internal format
      const mapped: SavingsData = {
        goals: (json.goals ?? []).map((g: Record<string, unknown>) => ({
          id: g.id,
          name: g.name,
          currentAmount: g.currentAmount ?? 0,
          targetAmount: g.targetAmount ?? 0,
          category: g.category ?? "CUSTOM",
          autoContribute: g.autoContributeAmount ?? null,
          targetDate: g.targetDate ?? "",
          createdAt: g.createdAt ?? "",
        })),
        totalSaved: json.summary?.totalSaved ?? 0,
        activeGoals: json.summary?.activeGoals ?? 0,
        monthlyAutoSave: json.summary?.monthlyAutoSave ?? 0,
        streak: 4,
      };
      setData(mapped);
    } catch (err) {
      console.error("Failed to fetch savings data:", err);
      toast.error("Could not load savings data. Showing sample data.");
      setData(mockData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSavings();
  }, [fetchSavings]);

  const handleCreateGoal = async () => {
    if (!newGoalName.trim() || !newGoalCategory || !newGoalAmount) {
      toast.error("Please fill in all required fields.");
      return;
    }
    setCreatingGoal(true);
    // Simulate API call
    await new Promise((r) => setTimeout(r, 1200));
    setCreatingGoal(false);
    setCreateDialogOpen(false);
    toast.success(`Goal "${newGoalName}" created successfully!`);
    setNewGoalName("");
    setNewGoalCategory("");
    setNewGoalAmount("");
    setNewGoalAuto(false);
    setNewGoalAutoAmount("");
    setNewGoalDate("");
  };

  const handleAddFunds = async () => {
    if (!fundAmount || Number(fundAmount) <= 0) {
      toast.error("Please enter a valid amount.");
      return;
    }
    setAddingFunds(true);
    await new Promise((r) => setTimeout(r, 1000));
    setAddingFunds(false);
    setAddFundsDialogOpen(false);
    toast.success(
      `AED ${Number(fundAmount).toLocaleString()} added to "${selectedGoal?.name}"!`
    );
    setFundAmount("");
    setFundSource("wallet");
    setSelectedGoal(null);
  };

  const openAddFunds = (goal: SavingsGoal) => {
    setSelectedGoal(goal);
    setAddFundsDialogOpen(true);
  };

  if (loading) {
    return (
      <motion.div
        className="space-y-6"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <SavingsSkeleton />
      </motion.div>
    );
  }

  const savings = data ?? mockData;

  return (
    <motion.div
      className="space-y-6"
      variants={container}
      initial="hidden"
      animate="show"
    >
      {/* ─── 1. Hero Section ─────────────────────────────────── */}
      <motion.div variants={item}>
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/60 via-transparent to-teal-50/40 dark:from-emerald-950/30 dark:to-teal-950/20" />
          <CardContent className="relative flex flex-col items-center gap-6 py-8 sm:flex-row sm:items-center sm:justify-center sm:gap-12">
            <div className="flex size-20 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25">
              <PiggyBank className="size-10 text-white" />
            </div>
            <div className="flex flex-col gap-3 text-center sm:text-left">
              <div>
                <h1 className="text-2xl font-bold sm:text-3xl">
                  Savings <span className="text-emerald-600 dark:text-emerald-400">Goals</span>
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Build your future, one AED at a time
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Total Saved
                </p>
                <p className="text-3xl font-black text-foreground">
                  AED {savings.totalSaved.toLocaleString()}
                </p>
              </div>
              <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="w-fit gap-1.5">
                    <Plus className="size-4" /> Create Goal
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Create New Goal</DialogTitle>
                    <DialogDescription>
                      Set a savings target and start building your future.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-2">
                    <div className="grid gap-2">
                      <Label htmlFor="goal-name">Goal Name</Label>
                      <Input
                        id="goal-name"
                        placeholder="e.g. New Car"
                        value={newGoalName}
                        onChange={(e) => setNewGoalName(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Category</Label>
                      <Select
                        value={newGoalCategory}
                        onValueChange={setNewGoalCategory}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="EMERGENCY">Emergency</SelectItem>
                          <SelectItem value="EDUCATION">Education</SelectItem>
                          <SelectItem value="HEALTH">Health</SelectItem>
                          <SelectItem value="TRAVEL">Travel</SelectItem>
                          <SelectItem value="INVESTMENT">Investment</SelectItem>
                          <SelectItem value="CUSTOM">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="goal-amount">Target Amount</Label>
                      <div className="relative">
                        <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                          AED
                        </span>
                        <Input
                          id="goal-amount"
                          type="number"
                          placeholder="10,000"
                          className="pl-12"
                          value={newGoalAmount}
                          onChange={(e) => setNewGoalAmount(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <Label htmlFor="auto-toggle">Auto-contribute</Label>
                        <p className="text-xs text-muted-foreground">
                          Monthly automatic savings
                        </p>
                      </div>
                      <Switch
                        id="auto-toggle"
                        checked={newGoalAuto}
                        onCheckedChange={setNewGoalAuto}
                      />
                    </div>
                    {newGoalAuto && (
                      <div className="grid gap-2">
                        <Label htmlFor="auto-amount">Monthly Amount</Label>
                        <div className="relative">
                          <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                            AED
                          </span>
                          <Input
                            id="auto-amount"
                            type="number"
                            placeholder="500"
                            className="pl-12"
                            value={newGoalAutoAmount}
                            onChange={(e) => setNewGoalAutoAmount(e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                    <div className="grid gap-2">
                      <Label htmlFor="goal-date">Target Date</Label>
                      <Input
                        id="goal-date"
                        type="date"
                        value={newGoalDate}
                        onChange={(e) => setNewGoalDate(e.target.value)}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setCreateDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button onClick={handleCreateGoal} disabled={creatingGoal}>
                      {creatingGoal ? "Creating..." : "Create Goal"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ─── 2. Summary Stats ────────────────────────────────── */}
      <motion.div variants={item}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10">
                <PiggyBank className="size-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Saved</p>
                <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  AED {savings.totalSaved.toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-teal-500/10">
                <Target className="size-5 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Active Goals</p>
                <p className="text-lg font-bold text-teal-600 dark:text-teal-400">
                  {savings.activeGoals}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-amber-500/10">
                <TrendingUp className="size-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Monthly Auto-Save</p>
                <p className="text-lg font-bold text-amber-600 dark:text-amber-400">
                  AED {savings.monthlyAutoSave.toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-rose-500/10">
                <Flame className="size-5 text-rose-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Streak</p>
                <p className="text-lg font-bold text-rose-500">
                  {savings.streak} months
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* ─── 3. Active Goals List ────────────────────────────── */}
      <motion.div variants={item}>
        <h2 className="mb-4 text-lg font-semibold">Active Goals</h2>
        <div className="space-y-4">
          {savings.goals.map((goal) => {
            const percent = getPercent(goal.currentAmount, goal.targetAmount);
            const cat = categoryColors[goal.category] ?? categoryColors.CUSTOM;
            const catIcon = categoryIcons[goal.category] ?? "⭐";

            return (
              <Card
                key={goal.id}
                className="transition-shadow hover:shadow-md"
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex size-10 items-center justify-center rounded-lg text-lg ${cat.bg}`}
                      >
                        {catIcon}
                      </div>
                      <div>
                        <h3 className="text-sm font-bold">{goal.name}</h3>
                        <p className="text-xs text-muted-foreground">
                          {getCategoryLabel(goal.category)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {goal.autoContribute && (
                        <Badge
                          variant="outline"
                          className="border-emerald-300 text-[10px] text-emerald-600 dark:border-emerald-700 dark:text-emerald-400"
                        >
                          <Zap className="mr-0.5 size-3" /> Auto
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${cat.badge}`}
                      >
                        {percent}%
                      </Badge>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="font-semibold">
                        AED {goal.currentAmount.toLocaleString()}
                      </span>
                      <span className="text-muted-foreground">
                        AED {goal.targetAmount.toLocaleString()}
                      </span>
                    </div>
                    <Progress
                      value={percent}
                      className={`h-2.5 ${cat.progress}`}
                    />
                  </div>

                  {/* Meta info */}
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {goal.autoContribute && (
                      <span className="flex items-center gap-1">
                        <Zap className="size-3" />
                        AED {goal.autoContribute.toLocaleString()}/month
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3" />
                      Target: {formatDate(goal.targetDate)}
                    </span>
                  </div>

                  {/* Action buttons */}
                  <div className="mt-4 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => openAddFunds(goal)}
                    >
                      <Plus className="size-3.5" /> Add Funds
                    </Button>
                    <Button size="sm" variant="ghost" className="gap-1.5">
                      <ArrowRight className="size-3.5" /> Details
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </motion.div>

      {/* ─── 4. Add Funds Dialog ─────────────────────────────── */}
      <Dialog open={addFundsDialogOpen} onOpenChange={setAddFundsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Funds</DialogTitle>
            <DialogDescription>
              Add money to{" "}
              <span className="font-semibold text-foreground">
                {selectedGoal?.name}
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="fund-amount">Amount</Label>
              <div className="relative">
                <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                  AED
                </span>
                <Input
                  id="fund-amount"
                  type="number"
                  placeholder="0"
                  className="pl-12"
                  value={fundAmount}
                  onChange={(e) => setFundAmount(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2">
              {[100, 250, 500, 1000].map((amt) => (
                <Button
                  key={amt}
                  size="sm"
                  variant={fundAmount === String(amt) ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setFundAmount(String(amt))}
                >
                  {amt}
                </Button>
              ))}
            </div>
            <div className="grid gap-2">
              <Label>Source</Label>
              <Select value={fundSource} onValueChange={setFundSource}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wallet">Wallet Balance</SelectItem>
                  <SelectItem value="roundup">Round Up Savings</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddFundsDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleAddFunds} disabled={addingFunds}>
              {addingFunds ? "Processing..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── 5. Savings Tips ─────────────────────────────────── */}
      <motion.div variants={item}>
        <h2 className="mb-4 text-lg font-semibold">Savings Tips</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {savingsTips.map((tip) => {
            const Icon = tip.icon;
            return (
              <Card
                key={tip.title}
                className="transition-shadow hover:shadow-md"
              >
                <CardContent className="flex gap-3 p-4">
                  <div
                    className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${tip.bg}`}
                  >
                    <Icon className={`size-5 ${tip.color}`} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">{tip.title}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                      {tip.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </motion.div>

      {/* ─── 6. How It Works ─────────────────────────────────── */}
      <motion.div variants={item}>
        <h2 className="mb-4 text-lg font-semibold">How It Works</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {howItWorksSteps.map((step) => {
            const Icon = step.icon;
            return (
              <Card key={step.step} className="relative overflow-hidden">
                <div className="absolute -right-2 -top-1 text-7xl font-black text-muted-foreground/5">
                  {step.step}
                </div>
                <CardContent className="relative flex flex-col items-center gap-3 p-6 text-center">
                  <div className="flex size-12 items-center justify-center rounded-full bg-emerald-500/10">
                    <Icon className="size-6 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold">{step.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      {step.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}
