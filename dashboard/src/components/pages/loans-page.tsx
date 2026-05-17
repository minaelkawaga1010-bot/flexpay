"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Banknote,
  Zap,
  Clock,
  ArrowRight,
  Calendar,
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  Info,
  Shield,
  TrendingUp,
  ShoppingBag,
  Gauge,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
interface Loan {
  id: string;
  purpose: string;
  amount: number;
  apr: number;
  termMonths: number;
  monthlyPayment: number;
  outstandingBalance: number;
  nextPaymentDate: string;
  status: string;
  repaidAmount: number;
}

interface Repayment {
  id: string;
  loanId: string;
  date: string;
  amount: number;
  principal: number;
  interest: number;
  status: string;
}

interface LoansData {
  loans: Loan[];
  repayments: Repayment[];
  creditScore: number;
  ewaAvailable: number;
  ewaFee: number;
  monthlySalary: number;
}

// ── Mock Fallback ───────────────────────────────────────────────
const mockData: LoansData = {
  loans: [
    {
      id: "mock-l1",
      purpose: "Personal Loan",
      amount: 3000,
      apr: 12,
      termMonths: 6,
      monthlyPayment: 520,
      outstandingBalance: 2400,
      nextPaymentDate: "2025-06-15",
      status: "REPAYING",
      repaidAmount: 600,
    },
    {
      id: "mock-l2",
      purpose: "Emergency Loan",
      amount: 1500,
      apr: 0,
      termMonths: 3,
      monthlyPayment: 500,
      outstandingBalance: 1000,
      nextPaymentDate: "2025-06-10",
      status: "REPAYING",
      repaidAmount: 500,
    },
  ],
  repayments: [
    {
      id: "mock-r1",
      loanId: "mock-l1",
      date: "2025-07-15",
      amount: 520,
      principal: 490,
      interest: 30,
      status: "UPCOMING",
    },
    {
      id: "mock-r2",
      loanId: "mock-l2",
      date: "2025-06-10",
      amount: 500,
      principal: 500,
      interest: 0,
      status: "UPCOMING",
    },
    {
      id: "mock-r3",
      loanId: "mock-l1",
      date: "2025-06-15",
      amount: 520,
      principal: 490,
      interest: 30,
      status: "UPCOMING",
    },
    {
      id: "mock-r4",
      loanId: "mock-l1",
      date: "2025-05-15",
      amount: 520,
      principal: 490,
      interest: 30,
      status: "PAID",
    },
  ],
  creditScore: 78,
  ewaAvailable: 2125,
  ewaFee: 5,
  monthlySalary: 8500,
};

// ── Static Data ─────────────────────────────────────────────────
const loanPurposeIcons: Record<string, { icon: string; color: string }> = {
  "Personal Loan": { icon: "🏦", color: "text-emerald-600 dark:text-emerald-400" },
  "Emergency Loan": { icon: "🚑", color: "text-rose-500" },
};

const repaymentStatusColors: Record<string, string> = {
  UPCOMING: "border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30",
  PAID: "border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30",
  OVERDUE: "border-red-300 text-red-600 dark:border-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30",
};

const loanProducts = [
  {
    name: "EWA",
    subtitle: "Earned Wage Access",
    icon: Zap,
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/10",
    features: [
      "Up to 25% of salary",
      "AED 5 flat fee",
      "Instant access",
      "No credit check required",
    ],
  },
  {
    name: "Personal Loan",
    subtitle: "Flexible financing",
    icon: CreditCard,
    color: "text-teal-600 dark:text-teal-400",
    bg: "bg-teal-500/10",
    features: [
      "Up to AED 10,000",
      "12-18% APR",
      "1-24 month terms",
      "Credit score required",
    ],
  },
  {
    name: "BNPL",
    subtitle: "Buy Now Pay Later",
    icon: ShoppingBag,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10",
    features: [
      "Up to AED 5,000",
      "0% interest",
      "3 installments",
      "Partner merchants only",
    ],
  },
];

const creditImpactTips = [
  { label: "On-time payments", description: "Boost your score by 2-5 points per payment", positive: true },
  { label: "Missed payments", description: "Decrease your score by 5-10 points", positive: false },
  { label: "EWA usage", description: "No impact on credit score at all", positive: true },
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
function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getRepaymentPercent(repaid: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((repaid / total) * 100);
}

function getScoreLabel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "Excellent", color: "text-emerald-600 dark:text-emerald-400" };
  if (score >= 60) return { label: "Good", color: "text-teal-600 dark:text-teal-400" };
  if (score >= 40) return { label: "Fair", color: "text-amber-600 dark:text-amber-400" };
  return { label: "Poor", color: "text-red-500" };
}

// ── SVG Mini Gauge ────────────────────────────────────────────────
function CreditScoreGauge({ score }: { score: number }) {
  const { label, color } = getScoreLabel(score);
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const percent = score / 100;
  const strokeDashoffset = circumference * (1 - percent);

  return (
    <div className="flex flex-col items-center">
      <svg width="100" height="70" viewBox="0 0 100 70">
        {/* Background arc */}
        <path
          d="M 10 60 A 40 40 0 0 1 90 60"
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-muted-foreground/15"
          strokeLinecap="round"
        />
        {/* Filled arc */}
        <path
          d="M 10 60 A 40 40 0 0 1 90 60"
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className={
            score >= 80
              ? "text-emerald-500"
              : score >= 60
                ? "text-teal-500"
                : score >= 40
                  ? "text-amber-500"
                  : "text-red-500"
          }
          strokeLinecap="round"
          strokeDasharray={`${circumference * 0.5} ${circumference}`}
          strokeDashoffset={strokeDashoffset * 0.5}
          style={{ transition: "stroke-dashoffset 1s ease" }}
        />
        <text
          x="50"
          y="50"
          textAnchor="middle"
          className="fill-foreground text-xl font-bold"
          dominantBaseline="middle"
        >
          {score}
        </text>
      </svg>
      <p className={`text-xs font-semibold ${color}`}>{label}</p>
    </div>
  );
}

// ── Skeleton Component ────────────────────────────────────────────
function LoansSkeleton() {
  return (
    <div className="space-y-6">
      {/* Hero skeleton */}
      <Card className="relative overflow-hidden">
        <CardContent className="flex flex-col items-center gap-6 py-8 sm:flex-row sm:items-center sm:justify-center sm:gap-12">
          <Skeleton className="size-20 rounded-2xl" />
          <div className="flex flex-col gap-3 text-center sm:text-left">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-9 w-32 rounded-full" />
          </div>
        </CardContent>
      </Card>

      {/* EWA skeleton */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-10 w-40" />
              <Skeleton className="h-4 w-64" />
            </div>
            <Skeleton className="h-10 w-28 rounded-full" />
          </div>
        </CardContent>
      </Card>

      {/* Loans skeleton */}
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-lg" />
                  <div>
                    <Skeleton className="h-5 w-28" />
                    <Skeleton className="mt-1 h-3 w-16" />
                  </div>
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="mt-4 h-3 w-full rounded-full" />
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[1, 2, 3, 4].map((j) => (
                  <Skeleton key={j} className="h-12 rounded-lg" />
                ))}
              </div>
              <Skeleton className="mt-4 h-8 w-28 rounded-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────
export function LoansPage() {
  const [data, setData] = useState<LoansData | null>(null);
  const [loading, setLoading] = useState(true);

  // Loan Application Dialog state
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [loanPurpose, setLoanPurpose] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [loanTerm, setLoanTerm] = useState("");
  const [checkingEligibility, setCheckingEligibility] = useState(false);
  const [submittingApplication, setSubmittingApplication] = useState(false);
  const [eligibilityResult, setEligibilityResult] = useState<{
    estimatedRate: number;
    monthlyPayment: number;
    approved: boolean;
  } | null>(null);

  const fetchLoans = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/loans");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Map API response to internal format
      const purposeLabels: Record<string, string> = {
        RENT: "Personal Loan",
        EDUCATION: "Education Loan",
        MEDICAL: "Medical Loan",
        EMERGENCY: "Emergency Loan",
        DEBT_CONSOLIDATION: "Debt Consolidation",
        OTHER: "Personal Loan",
      };
      const apiLoans = (json.loans ?? []).filter(
        (l: Record<string, unknown>) =>
          l.status === "APPROVED" || l.status === "DISBURSED" || l.status === "REPAYING"
      );
      const mapped: LoansData = {
        loans: apiLoans.map((l: Record<string, unknown>) => ({
          id: l.id,
          purpose: purposeLabels[(l.purpose as string) ?? "OTHER"] ?? "Personal Loan",
          amount: l.amount ?? 0,
          apr: l.interestRate ?? 0,
          termMonths: l.termMonths ?? 6,
          monthlyPayment: l.monthlyPayment ?? 0,
          outstandingBalance: l.outstandingBalance ?? 0,
          nextPaymentDate: l.nextPaymentDate ?? "",
          status: l.status === "DISBURSED" ? "REPAYING" : (l.status ?? "REPAYING"),
          repaidAmount: (Number(l.amount ?? 0) - Number(l.outstandingBalance ?? 0)),
        })),
        repayments: mockData.repayments,
        creditScore: json.creditScore ?? 78,
        ewaAvailable: json.summary?.ewaAvailable ?? 2125,
        ewaFee: 5,
        monthlySalary: 8500,
      };
      // If no active loans from API, use mock loans
      if (mapped.loans.length === 0) {
        setData(mockData);
      } else {
        setData(mapped);
      }
    } catch (err) {
      console.error("Failed to fetch loans data:", err);
      toast.error("Could not load loans data. Showing sample data.");
      setData(mockData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLoans();
  }, [fetchLoans]);

  const handleCheckEligibility = async () => {
    if (!loanPurpose || !loanAmount || !loanTerm) {
      toast.error("Please fill in all fields.");
      return;
    }
    setCheckingEligibility(true);
    await new Promise((r) => setTimeout(r, 1500));
    setCheckingEligibility(false);
    const amount = Number(loanAmount);
    const months = Number(loanTerm);
    const rate = loanPurpose === "emergency" ? 0 : 12 + Math.floor(Math.random() * 6);
    const monthly = Math.round((amount * (1 + (rate / 100) * (months / 12))) / months);
    setEligibilityResult({
      estimatedRate: rate,
      monthlyPayment: monthly,
      approved: amount <= 10000,
    });
  };

  const handleSubmitApplication = async () => {
    setSubmittingApplication(true);
    await new Promise((r) => setTimeout(r, 1500));
    setSubmittingApplication(false);
    setApplyDialogOpen(false);
    toast.success("Loan application submitted successfully!");
    setLoanPurpose("");
    setLoanAmount("");
    setLoanTerm("");
    setEligibilityResult(null);
  };

  const handleMakePayment = (loan: Loan) => {
    toast.success(`Payment of AED ${loan.monthlyPayment.toLocaleString()} for "${loan.purpose}" initiated.`);
  };

  if (loading) {
    return (
      <motion.div
        className="space-y-6"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <LoansSkeleton />
      </motion.div>
    );
  }

  const loans = data ?? mockData;

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
              <Banknote className="size-10 text-white" />
            </div>
            <div className="flex flex-col gap-3 text-center sm:text-left">
              <div>
                <h1 className="text-2xl font-bold sm:text-3xl">
                  Loans & Wage{" "}
                  <span className="text-emerald-600 dark:text-emerald-400">Access</span>
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Get paid before payday
                </p>
              </div>
              <Badge
                variant="outline"
                className={`w-fit border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400 text-xs`}
              >
                <Gauge className="mr-1 size-3.5" /> Credit Score:{" "}
                <span className="ml-1 font-bold">{loans.creditScore}</span> —{" "}
                {getScoreLabel(loans.creditScore).label}
              </Badge>
              <Dialog open={applyDialogOpen} onOpenChange={setApplyDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="w-fit gap-1.5">
                    <ArrowRight className="size-4" /> Apply Now
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Loan Application</DialogTitle>
                    <DialogDescription>
                      Apply for a loan and get a decision in minutes.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-2">
                    <div className="grid gap-2">
                      <Label>Loan Purpose</Label>
                      <Select value={loanPurpose} onValueChange={(v) => { setLoanPurpose(v); setEligibilityResult(null); }}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select purpose" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="rent">Rent</SelectItem>
                          <SelectItem value="education">Education</SelectItem>
                          <SelectItem value="medical">Medical</SelectItem>
                          <SelectItem value="emergency">Emergency</SelectItem>
                          <SelectItem value="debt">Debt Consolidation</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="loan-amount">Amount</Label>
                      <div className="relative">
                        <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                          AED
                        </span>
                        <Input
                          id="loan-amount"
                          type="number"
                          placeholder="1,000"
                          min={500}
                          max={10000}
                          className="pl-12"
                          value={loanAmount}
                          onChange={(e) => { setLoanAmount(e.target.value); setEligibilityResult(null); }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Min AED 500 — Max AED 10,000
                      </p>
                    </div>
                    <div className="grid gap-2">
                      <Label>Term</Label>
                      <Select value={loanTerm} onValueChange={(v) => { setLoanTerm(v); setEligibilityResult(null); }}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select term" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="3">3 months</SelectItem>
                          <SelectItem value="6">6 months</SelectItem>
                          <SelectItem value="12">12 months</SelectItem>
                          <SelectItem value="24">24 months</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Employment info */}
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        Employment Information
                      </p>
                      <p className="mt-1 text-sm font-semibold">
                        Rajesh Kumar — Employee
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Monthly Salary: AED {loans.monthlySalary.toLocaleString()} ·
                        KYC Level 2 Verified
                      </p>
                    </div>

                    {!eligibilityResult && (
                      <Button
                        className="w-full"
                        onClick={handleCheckEligibility}
                        disabled={checkingEligibility}
                      >
                        {checkingEligibility ? "Checking..." : "Check Eligibility"}
                      </Button>
                    )}

                    {eligibilityResult && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`rounded-lg border p-4 ${
                          eligibilityResult.approved
                            ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
                            : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {eligibilityResult.approved ? (
                            <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <AlertTriangle className="size-5 text-red-500" />
                          )}
                          <span className="text-sm font-bold">
                            {eligibilityResult.approved
                              ? "You're eligible!"
                              : "Amount exceeds limit"}
                          </span>
                        </div>
                        {eligibilityResult.approved && (
                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <p className="text-muted-foreground">Est. Rate</p>
                              <p className="font-bold">
                                {eligibilityResult.estimatedRate}%
                                {eligibilityResult.estimatedRate === 0 && " (special)"}
                              </p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Monthly Payment</p>
                              <p className="font-bold">
                                AED {eligibilityResult.monthlyPayment.toLocaleString()}
                              </p>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setApplyDialogOpen(false);
                        setEligibilityResult(null);
                      }}
                    >
                      Cancel
                    </Button>
                    {eligibilityResult?.approved && (
                      <Button
                        onClick={handleSubmitApplication}
                        disabled={submittingApplication}
                      >
                        {submittingApplication ? "Submitting..." : "Submit Application"}
                      </Button>
                    )}
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ─── 2. EWA Quick Access ─────────────────────────────── */}
      <motion.div variants={item}>
        <Card className="relative overflow-hidden border-emerald-200 dark:border-emerald-800/50">
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-50/40 to-teal-50/30 dark:from-emerald-950/20 dark:to-teal-950/10" />
          <CardContent className="relative p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Zap className="size-5 text-emerald-600 dark:text-emerald-400" />
                  <h2 className="text-base font-bold">
                    Earned Wage Access
                  </h2>
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-0 text-[10px]">
                    Instant
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Get up to 25% of your earned wages instantly
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  Monthly Salary: AED {loans.monthlySalary.toLocaleString()} · Available: 25%
                </p>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-xs text-muted-foreground">Available</span>
                  <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                    AED {loans.ewaAvailable.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground ml-2">
                    · Fee: AED {loans.ewaFee} flat
                  </span>
                </div>
              </div>
              <Button className="gap-1.5 shrink-0" onClick={() => toast.success("AED 2,125 accessed! Fee: AED 5")}>
                <Zap className="size-4" /> Access Now
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ─── 3. Active Loans ─────────────────────────────────── */}
      <motion.div variants={item}>
        <h2 className="mb-4 text-lg font-semibold">Active Loans</h2>
        <div className="space-y-4">
          {loans.loans.map((loan) => {
            const repaidPercent = getRepaymentPercent(loan.repaidAmount, loan.amount);
            const purposeInfo = loanPurposeIcons[loan.purpose] ?? {
              icon: "🏦",
              color: "text-emerald-600 dark:text-emerald-400",
            };

            return (
              <Card
                key={loan.id}
                className="transition-shadow hover:shadow-md"
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-lg">
                        {purposeInfo.icon}
                      </div>
                      <div>
                        <h3 className="text-sm font-bold">{loan.purpose}</h3>
                        <p className="text-xs text-muted-foreground">
                          {loan.apr === 0 ? "0% APR (special)" : `${loan.apr}% APR`} · {loan.termMonths} months
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className="border-emerald-300 text-[10px] text-emerald-600 dark:border-emerald-700 dark:text-emerald-400"
                    >
                      {loan.status}
                    </Badge>
                  </div>

                  {/* Repayment progress */}
                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="font-semibold">
                        Repaid AED {loan.repaidAmount.toLocaleString()}
                      </span>
                      <span className="text-muted-foreground">
                        AED {loan.amount.toLocaleString()}
                      </span>
                    </div>
                    <Progress value={repaidPercent} className="h-2.5 [&>div]:bg-emerald-500" />
                    <p className="mt-1 text-right text-[10px] text-muted-foreground">
                      {repaidPercent}% repaid
                    </p>
                  </div>

                  {/* Loan details grid */}
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-lg bg-muted/30 px-3 py-2">
                      <p className="text-[10px] text-muted-foreground">Outstanding</p>
                      <p className="text-sm font-bold">
                        AED {loan.outstandingBalance.toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/30 px-3 py-2">
                      <p className="text-[10px] text-muted-foreground">Monthly Payment</p>
                      <p className="text-sm font-bold">
                        AED {loan.monthlyPayment.toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/30 px-3 py-2">
                      <p className="text-[10px] text-muted-foreground">Next Due</p>
                      <p className="text-sm font-semibold">{formatDate(loan.nextPaymentDate)}</p>
                    </div>
                    <div className="rounded-lg bg-muted/30 px-3 py-2">
                      <p className="text-[10px] text-muted-foreground">Status</p>
                      <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                        Repaying
                      </p>
                    </div>
                  </div>

                  {/* Make Payment button */}
                  <div className="mt-4">
                    <Button
                      size="sm"
                      className="gap-1.5"
                      onClick={() => handleMakePayment(loan)}
                    >
                      <CreditCard className="size-3.5" /> Make Payment
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </motion.div>

      {/* ─── 4. Repayment Schedule ───────────────────────────── */}
      <motion.div variants={item}>
        <h2 className="mb-4 text-lg font-semibold">Repayment Schedule</h2>
        <Card>
          <CardContent className="p-0">
            {/* Table header */}
            <div className="grid grid-cols-5 gap-2 border-b px-4 py-3 text-xs font-medium text-muted-foreground sm:grid-cols-5">
              <span>Date</span>
              <span>Amount</span>
              <span className="hidden sm:block">Principal</span>
              <span className="hidden sm:block">Interest</span>
              <span className="text-right">Status</span>
            </div>
            {/* Table rows */}
            <div className="divide-y">
              {loans.repayments.map((rep) => {
                const statusColor =
                  repaymentStatusColors[rep.status] ??
                  repaymentStatusColors.UPCOMING;
                return (
                  <div
                    key={rep.id}
                    className="grid grid-cols-5 gap-2 px-4 py-3 text-sm sm:grid-cols-5"
                  >
                    <span className="font-medium">
                      {formatDate(rep.date)}
                    </span>
                    <span className="font-semibold">
                      AED {rep.amount.toLocaleString()}
                    </span>
                    <span className="hidden sm:block text-muted-foreground">
                      AED {rep.principal.toLocaleString()}
                    </span>
                    <span className="hidden sm:block text-muted-foreground">
                      AED {rep.interest.toLocaleString()}
                    </span>
                    <span className="text-right">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${statusColor}`}
                      >
                        {rep.status}
                      </Badge>
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ─── 5. Loan Products Comparison ────────────────────── */}
      <motion.div variants={item}>
        <h2 className="mb-4 text-lg font-semibold">Loan Products</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {loanProducts.map((product) => {
            const Icon = product.icon;
            return (
              <Card
                key={product.name}
                className="relative overflow-hidden transition-shadow hover:shadow-md"
              >
                <div className="h-2 bg-gradient-to-r from-emerald-400 to-teal-500" />
                <CardContent className="p-5">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex size-10 items-center justify-center rounded-lg ${product.bg}`}
                    >
                      <Icon className={`size-5 ${product.color}`} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold">{product.name}</h3>
                      <p className="text-[10px] text-muted-foreground">
                        {product.subtitle}
                      </p>
                    </div>
                  </div>
                  <Separator className="my-3" />
                  <ul className="space-y-2">
                    {product.features.map((feat) => (
                      <li
                        key={feat}
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />
                        {feat}
                      </li>
                    ))}
                  </ul>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-4 w-full gap-1.5"
                    onClick={() =>
                      toast.info(`Learn more about ${product.name}`)
                    }
                  >
                    <Info className="size-3.5" /> Learn More
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </motion.div>

      {/* ─── 6. Credit Score Impact ──────────────────────────── */}
      <motion.div variants={item}>
        <h2 className="mb-4 text-lg font-semibold">Credit Score Impact</h2>
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/30 via-transparent to-teal-50/20 dark:from-emerald-950/10 dark:to-teal-950/5" />
          <CardContent className="relative p-6">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-col gap-4">
                <h3 className="flex items-center gap-2 text-sm font-bold">
                  <Shield className="size-4 text-emerald-600 dark:text-emerald-400" />
                  How loans affect your score
                </h3>
                <div className="space-y-3">
                  {creditImpactTips.map((tip) => (
                    <div key={tip.label} className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${
                          tip.positive
                            ? "bg-emerald-500/10"
                            : "bg-red-500/10"
                        }`}
                      >
                        {tip.positive ? (
                          <TrendingUp className="size-3 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <AlertTriangle className="size-3 text-red-500" />
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-semibold">{tip.label}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {tip.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col items-center gap-1 rounded-xl border bg-muted/20 px-6 py-4">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Your Score
                </p>
                <CreditScoreGauge score={loans.creditScore} />
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
