"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Globe,
  ArrowRight,
  Send,
  Clock,
  TrendingDown,
  UserPlus,
  Banknote,
  CreditCard,
  CheckCircle2,
  Loader2,
  Info,
  Zap,
  AlertCircle,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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

/* ──────────────── Types ──────────────── */

interface Beneficiary {
  id: string;
  userId: string;
  fullName: string;
  country: string;
  bankName: string | null;
  accountNumber: string;
  ifscCode: string | null;
  isVerified: boolean;
  createdAt: string;
}

interface ExchangeRateInfo {
  rate: number;
  currency: string;
}

interface RemittanceData {
  beneficiaries: Beneficiary[];
  exchangeRates: Record<string, ExchangeRateInfo>;
  feeRate: number;
  aedBalance: number;
}

interface RemittancePostResponse {
  message: string;
  transaction: {
    id: string;
    amount: number;
    fee: number;
    reference: string;
  };
  summary: {
    sentAED: number;
    feeAED: number;
    totalDebitAED: number;
    destinationCurrency: string;
    exchangeRate: number;
    receivedAmount: number;
    beneficiary: string;
    country: string;
  };
}

/* ──────────────── Mock Fallback Data ──────────────── */

const mockCorridors = [
  { id: "in", flag: "\u{1F1EE}\u{1F1F3}", country: "India", currency: "INR", rate: 22.85, fee: 0.75, minFee: 5, delivery: "Instant \u2013 2 hours" },
  { id: "ph", flag: "\u{1F1F5}\u{1F1ED}", country: "Philippines", currency: "PHP", rate: 15.42, fee: 0.85, minFee: 5, delivery: "1 \u2013 4 hours" },
  { id: "pk", flag: "\u{1F1F5}\u{1F1F0}", country: "Pakistan", currency: "PKR", rate: 76.12, fee: 0.80, minFee: 5, delivery: "Instant \u2013 3 hours" },
  { id: "bd", flag: "\u{1F1E7}\u{1F1E9}", country: "Bangladesh", currency: "BDT", rate: 29.75, fee: 0.90, minFee: 5, delivery: "2 \u2013 6 hours" },
  { id: "np", flag: "\u{1F1F3}\u{1F1F5}", country: "Nepal", currency: "NPR", rate: 35.90, fee: 0.70, minFee: 5, delivery: "1 \u2013 3 hours" },
  { id: "lk", flag: "\u{1F1F1}\u{1F1F0}", country: "Sri Lanka", currency: "LKR", rate: 84.30, fee: 1.00, minFee: 7, delivery: "2 \u2013 8 hours" },
];

const mockBeneficiaries: Beneficiary[] = [
  { id: "mock-1", userId: "mock", fullName: "Sunita Kumar", country: "India", bankName: "State Bank of India", accountNumber: "****4523", ifscCode: "SBIN0001234", isVerified: true, createdAt: "2024-12-01T00:00:00.000Z" },
  { id: "mock-2", userId: "mock", fullName: "Ramesh Kumar", country: "India", bankName: "HDFC Bank", accountNumber: "****8891", ifscCode: "HDFC0005678", isVerified: true, createdAt: "2024-12-15T00:00:00.000Z" },
  { id: "mock-3", userId: "mock", fullName: "Maria Santos", country: "Philippines", bankName: "BDO Unibank", accountNumber: "****3344", ifscCode: null, isVerified: false, createdAt: "2025-01-05T00:00:00.000Z" },
];

const mockRecentRemittances = [
  { id: "r1", recipient: "Sunita Kumar", country: "India", amount: 2000, currency: "AED", converted: 45700, destCurrency: "INR", date: "2025-01-14", status: "delivered" },
  { id: "r2", recipient: "Maria Santos", country: "Philippines", amount: 1000, currency: "AED", converted: 15420, destCurrency: "PHP", date: "2025-01-12", status: "delivered" },
  { id: "r3", recipient: "Ramesh Kumar", country: "India", amount: 3000, currency: "AED", converted: 68550, destCurrency: "INR", date: "2025-01-10", status: "sent" },
  { id: "r4", recipient: "Ahmed Khan", country: "Pakistan", amount: 1500, currency: "AED", converted: 114180, destCurrency: "PKR", date: "2025-01-08", status: "processing" },
];

const mockExchangeRates: Record<string, ExchangeRateInfo> = {
  INR: { rate: 22.85, currency: "INR" },
  PHP: { rate: 15.42, currency: "PHP" },
  PKR: { rate: 76.12, currency: "PKR" },
  BDT: { rate: 29.75, currency: "BDT" },
  NPR: { rate: 35.90, currency: "NPR" },
  LKR: { rate: 84.30, currency: "LKR" },
};

const mockRemittanceData: RemittanceData = {
  beneficiaries: mockBeneficiaries,
  exchangeRates: mockExchangeRates,
  feeRate: 0.75,
  aedBalance: 12450,
};

/* ──────────────── Helpers ──────────────── */

function getCountryFlag(country: string): string {
  const flags: Record<string, string> = {
    India: "\u{1F1EE}\u{1F1F3}",
    Philippines: "\u{1F1F5}\u{1F1ED}",
    Pakistan: "\u{1F1F5}\u{1F1F0}",
    Bangladesh: "\u{1F1E7}\u{1F1E9}",
    Nepal: "\u{1F1F3}\u{1F1F5}",
    "Sri Lanka": "\u{1F1F1}\u{1F1F0}",
  };
  return flags[country] ?? "\u{1F30D}";
}

function getCurrencyForCountry(country: string): string {
  const map: Record<string, string> = {
    India: "INR",
    Philippines: "PHP",
    Pakistan: "PKR",
    Bangladesh: "BDT",
    Nepal: "NPR",
    "Sri Lanka": "LKR",
  };
  return map[country] ?? "USD";
}

function getDeliveryTime(country: string): string {
  const map: Record<string, string> = {
    India: "Instant \u2013 2 hours",
    Philippines: "1 \u2013 4 hours",
    Pakistan: "Instant \u2013 3 hours",
    Bangladesh: "2 \u2013 6 hours",
    Nepal: "1 \u2013 3 hours",
    "Sri Lanka": "2 \u2013 8 hours",
  };
  return map[country] ?? "1 \u2013 3 business days";
}

function maskAccount(accountNumber: string): string {
  if (!accountNumber) return "****";
  if (accountNumber.length <= 4) return accountNumber;
  return "****" + accountNumber.slice(-4);
}

function statusBadge(status: string) {
  switch (status) {
    case "processing":
      return <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700 gap-1 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-400"><Loader2 className="size-3 animate-spin" />Processing</Badge>;
    case "sent":
      return <Badge variant="outline" className="border-sky-300 bg-sky-50 text-sky-700 gap-1 dark:border-sky-600 dark:bg-sky-950/40 dark:text-sky-400"><Send className="size-3" />Sent</Badge>;
    case "delivered":
      return <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700 gap-1 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"><CheckCircle2 className="size-3" />Delivered</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

/* ──────────────── Loading Skeleton Components ──────────────── */

function CorridorSkeleton() {
  return (
    <Card className="p-0 overflow-hidden">
      <CardContent className="p-5 sm:p-6">
        <Skeleton className="mb-4 h-5 w-32" />
        <div className="mb-4 flex items-center justify-center gap-3 rounded-xl bg-muted/50 p-4">
          <Skeleton className="size-12 rounded-lg" />
          <Skeleton className="size-5" />
          <Skeleton className="size-12 rounded-lg" />
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-full" />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-background p-3">
              <Skeleton className="mb-1 h-3 w-20" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TransferFormSkeleton() {
  return (
    <Card className="p-0 overflow-hidden">
      <CardHeader className="pb-4">
        <Skeleton className="h-5 w-36" />
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <Skeleton className="mb-2 h-4 w-16" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <div className="mt-2 flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24 rounded-md" />
            ))}
          </div>
        </div>
        <Separator />
        <div>
          <Skeleton className="mb-2 h-4 w-28" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
        <Separator />
        <div>
          <Skeleton className="mb-2 h-4 w-24" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="mb-2 h-16 w-full rounded-lg" />
          ))}
        </div>
        <Separator />
        <Skeleton className="h-12 w-full rounded-lg" />
      </CardContent>
    </Card>
  );
}

function RecentRemittancesSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-1">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-36" />
              </div>
              <div className="flex flex-col items-end gap-1">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-16 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ──────────────── Main Component ──────────────── */

export function RemittancePage() {
  // API state
  const [isLoading, setIsLoading] = useState(true);
  const [remittanceData, setRemittanceData] = useState<RemittanceData | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  // UI state
  const [selectedCountry, setSelectedCountry] = useState("India");
  const [sendAmount, setSendAmount] = useState<string>("1000");
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<"wallet" | "card">("wallet");
  const [beneficiaryDialogOpen, setBeneficiaryDialogOpen] = useState(false);
  const [newBeneficiary, setNewBeneficiary] = useState({ fullName: "", country: "", bankName: "", accountNumber: "", ifscCode: "" });

  // Derived data: use API data or fallback to mock
  const data = remittanceData ?? mockRemittanceData;
  const beneficiaries = data.beneficiaries;
  const feeRate = data.feeRate;
  const aedBalance = data.aedBalance;

  // Build corridors from exchange rates + mock metadata
  const corridors = useMemo(() => {
    const apiCurrencyCountries: Record<string, { flag: string; country: string; delivery: string }> = {
      INR: { flag: "\u{1F1EE}\u{1F1F3}", country: "India", delivery: "Instant \u2013 2 hours" },
      PHP: { flag: "\u{1F1F5}\u{1F1ED}", country: "Philippines", delivery: "1 \u2013 4 hours" },
      PKR: { flag: "\u{1F1F5}\u{1F1F0}", country: "Pakistan", delivery: "Instant \u2013 3 hours" },
    };

    const apiCorridors = Object.entries(data.exchangeRates).map(([currency, info]) => {
      const meta = apiCurrencyCountries[currency] ?? {
        flag: "\u{1F30D}",
        country: currency,
        delivery: "1 \u2013 3 business days",
      };
      return {
        id: currency.toLowerCase(),
        flag: meta.flag,
        country: meta.country,
        currency: info.currency,
        rate: info.rate,
        fee: feeRate,
        minFee: 5,
        delivery: meta.delivery,
      };
    });

    // Add mock-only corridors for countries not in API exchange rates
    const apiCurrencies = new Set(Object.keys(data.exchangeRates));
    const extraCorridors = mockCorridors.filter((c) => !apiCurrencies.has(c.currency));

    return [...apiCorridors, ...extraCorridors];
  }, [data.exchangeRates, feeRate]);

  const selectedCorridor = useMemo(
    () => corridors.find((c) => c.country === selectedCountry) ?? corridors[0],
    [corridors, selectedCountry]
  );

  // Dynamic calculations
  const numericAmount = parseFloat(sendAmount) || 0;
  const calculatedFee = numericAmount * (feeRate / 100);
  const fee = calculatedFee > 0 ? calculatedFee : 0;
  const destinationAmount = (numericAmount - fee) * selectedCorridor.rate;
  const quickAmounts = [500, 1000, 2000, 5000];

  // Auto-select first beneficiary on data load
  useEffect(() => {
    if (beneficiaries.length > 0 && !selectedBeneficiary) {
      setSelectedBeneficiary(beneficiaries[0].id);
    }
  }, [beneficiaries, selectedBeneficiary]);

  // Fetch remittance data from API
  const fetchRemittanceData = useCallback(async () => {
    try {
      setIsLoading(true);
      setFetchError(null);
      const res = await fetch("/api/remittance");
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const json = await res.json();
      setRemittanceData(json as RemittanceData);
    } catch (err) {
      console.error("Failed to fetch remittance data, using mock fallback:", err);
      setFetchError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRemittanceData();
  }, [fetchRemittanceData]);

  // Handlers
  const handleQuickAmount = (val: number) => setSendAmount(val.toString());

  const handleSend = async () => {
    if (numericAmount <= 0 || !selectedBeneficiary) {
      toast.error("Please enter an amount and select a beneficiary");
      return;
    }

    const selectedBene = beneficiaries.find((b) => b.id === selectedBeneficiary);
    const destCurrency = selectedBene
      ? getCurrencyForCountry(selectedBene.country)
      : selectedCorridor.currency;

    setIsSending(true);
    try {
      const res = await fetch("/api/remittance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beneficiaryId: selectedBeneficiary,
          amount: numericAmount,
          currency: destCurrency,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(errData.error || `Error ${res.status}`);
      }

      const result: RemittancePostResponse = await res.json();

      toast.success("Remittance initiated successfully!", {
        description: `AED ${result.summary.sentAED.toFixed(2)} \u2192 ${result.summary.receivedAmount.toFixed(2)} ${result.summary.destinationCurrency} (${result.summary.beneficiary})`,
        duration: 5000,
      });

      setSendAmount("1000");
      fetchRemittanceData();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send remittance";
      toast.error("Remittance failed", { description: message });
    } finally {
      setIsSending(false);
    }
  };

  const handleSaveBeneficiary = () => {
    if (!newBeneficiary.fullName || !newBeneficiary.bankName || !newBeneficiary.accountNumber) {
      toast.error("Please fill in all required fields");
      return;
    }
    toast.success("Beneficiary added successfully!");
    setBeneficiaryDialogOpen(false);
    setNewBeneficiary({ fullName: "", country: "", bankName: "", accountNumber: "", ifscCode: "" });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* ── Hero Section ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 p-6 text-white sm:p-8"
      >
        <div className="pointer-events-none absolute -right-12 -top-12 size-48 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-8 -left-8 size-32 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute right-20 bottom-4 size-16 rounded-full bg-emerald-400/10" />

        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Send Money Home</h1>
            <p className="mt-1 text-sm text-emerald-100/80 sm:text-base">Fast, affordable transfers to 50+ countries</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge className="border-0 bg-white/15 text-white text-xs"><Zap className="mr-1 size-3" />Instant Transfers</Badge>
              <Badge className="border-0 bg-white/15 text-white text-xs"><TrendingDown className="mr-1 size-3" />Low Fees</Badge>
            </div>
          </div>
          <motion.div
            animate={{ rotate: [0, 10, -10, 0] }}
            transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" as const }}
            className="hidden sm:block"
          >
            <Globe className="size-20 text-emerald-300/60" />
          </motion.div>
        </div>
      </motion.div>

      {/* ── Corridor Selector ── */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.4 }}>
        {isLoading ? (
          <CorridorSkeleton />
        ) : (
          <Card className="p-0 overflow-hidden">
            <CardContent className="p-5 sm:p-6">
              <h2 className="mb-4 text-base font-semibold">Select Corridor</h2>

              {/* Flag-to-flag display */}
              <div className="mb-4 flex items-center justify-center gap-3 sm:gap-5 rounded-xl bg-muted/50 p-4">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-3xl sm:text-4xl">{"\u{1F1E6}\u{1F1EA}"}</span>
                  <span className="text-xs font-medium text-muted-foreground">UAE</span>
                  <span className="text-xs font-bold text-emerald-600">AED</span>
                </div>
                <ArrowRight className="size-5 text-emerald-500 shrink-0" />
                <div className="flex flex-col items-center gap-1">
                  <span className="text-3xl sm:text-4xl">{selectedCorridor.flag}</span>
                  <span className="text-xs font-medium text-muted-foreground">{selectedCorridor.country}</span>
                  <span className="text-xs font-bold text-emerald-600">{selectedCorridor.currency}</span>
                </div>
              </div>

              {/* Popular corridors */}
              <div className="flex flex-wrap gap-2">
                {corridors.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setSelectedCountry(c.country);
                      // Auto-select matching beneficiary
                      const match = beneficiaries.find((b) => b.country === c.country);
                      if (match) setSelectedBeneficiary(match.id);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-all ${
                      selectedCorridor.id === c.id
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700 shadow-sm dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                        : "border-border bg-card text-muted-foreground hover:border-emerald-200 hover:text-foreground"
                    }`}
                  >
                    <span className="text-base leading-none">{c.flag}</span>
                    {c.country}
                  </button>
                ))}
              </div>

              {/* Corridor info */}
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Exchange Rate</p>
                  <p className="mt-0.5 text-sm font-bold">1 AED = {selectedCorridor.rate} {selectedCorridor.currency}</p>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Transfer Fee</p>
                  <p className="mt-0.5 text-sm font-bold">{feeRate}% (min AED 5)</p>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="size-3" />Est. Delivery</p>
                  <p className="mt-0.5 text-sm font-bold">{selectedCorridor.delivery}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </motion.div>

      {/* ── Transfer Form ── */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.4 }}>
        {isLoading ? (
          <TransferFormSkeleton />
        ) : (
          <Card className="p-0 overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Transfer Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* API error banner */}
              {fetchError && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                  <AlertCircle className="size-4 shrink-0" />
                  <span>Using offline data. Some information may not be up to date.</span>
                </div>
              )}

              {/* You Send */}
              <div>
                <Label className="text-sm font-medium">You Send</Label>
                <div className="mt-2 flex items-center gap-2 rounded-lg border bg-background p-1">
                  <span className="flex items-center gap-1.5 rounded-md bg-muted px-3 py-2 text-sm font-bold text-emerald-600 shrink-0">
                    {"\u{1F1E6}\u{1F1EA}"} AED
                  </span>
                  <input
                    type="number"
                    value={sendAmount}
                    onChange={(e) => setSendAmount(e.target.value)}
                    className="flex-1 border-0 bg-transparent text-2xl font-bold outline-none placeholder:text-muted-foreground/40 min-w-0"
                    placeholder="0.00"
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {quickAmounts.map((val) => (
                    <Button
                      key={val}
                      variant={sendAmount === val.toString() ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleQuickAmount(val)}
                      className={sendAmount === val.toString() ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
                    >
                      {val.toLocaleString()} AED
                    </Button>
                  ))}
                </div>
              </div>

              <Separator />

              {/* They Receive */}
              <div>
                <Label className="text-sm font-medium">They Receive</Label>
                <div className="mt-2 rounded-lg border bg-emerald-50/50 p-4 dark:bg-emerald-950/20">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                      {destinationAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-sm font-semibold text-emerald-600">{selectedCorridor.flag} {selectedCorridor.currency}</span>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <p>Rate: 1 AED = {selectedCorridor.rate} {selectedCorridor.currency}</p>
                    <p>Fee: AED {fee.toFixed(2)} ({feeRate}%)</p>
                    <p>Total debit: AED {(numericAmount + fee).toFixed(2)}</p>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Beneficiary Selector */}
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">
                    Beneficiary
                    {beneficiaries.length > 0 && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">({beneficiaries.length} saved)</span>
                    )}
                  </Label>
                  <Dialog open={beneficiaryDialogOpen} onOpenChange={setBeneficiaryDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-emerald-600 hover:text-emerald-700 gap-1 text-xs">
                        <UserPlus className="size-3.5" /> Add New
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add Beneficiary</DialogTitle>
                        <DialogDescription>Enter the recipient&apos;s bank details</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-2">
                        <div className="space-y-2">
                          <Label htmlFor="bene-name">Full Name *</Label>
                          <Input id="bene-name" placeholder="e.g. Sunita Kumar" value={newBeneficiary.fullName} onChange={(e) => setNewBeneficiary((p) => ({ ...p, fullName: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="bene-country">Country *</Label>
                          <Select value={newBeneficiary.country} onValueChange={(v) => setNewBeneficiary((p) => ({ ...p, country: v }))}>
                            <SelectTrigger className="w-full"><SelectValue placeholder="Select country" /></SelectTrigger>
                            <SelectContent>
                              {corridors.map((c) => (
                                <SelectItem key={c.id} value={c.country}>{c.flag} {c.country}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="bene-bank">Bank Name *</Label>
                          <Input id="bene-bank" placeholder="e.g. State Bank of India" value={newBeneficiary.bankName} onChange={(e) => setNewBeneficiary((p) => ({ ...p, bankName: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="bene-account">Account Number *</Label>
                          <Input id="bene-account" placeholder="Enter account number" value={newBeneficiary.accountNumber} onChange={(e) => setNewBeneficiary((p) => ({ ...p, accountNumber: e.target.value }))} />
                        </div>
                        {newBeneficiary.country === "India" && (
                          <div className="space-y-2">
                            <Label htmlFor="bene-ifsc">IFSC Code</Label>
                            <Input id="bene-ifsc" placeholder="e.g. SBIN0001234" value={newBeneficiary.ifscCode} onChange={(e) => setNewBeneficiary((p) => ({ ...p, ifscCode: e.target.value }))} />
                          </div>
                        )}
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setBeneficiaryDialogOpen(false)}>Cancel</Button>
                        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleSaveBeneficiary}>Save Beneficiary</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>

                {beneficiaries.length === 0 ? (
                  <div className="mt-2 rounded-lg border border-dashed p-6 text-center">
                    <UserPlus className="mx-auto size-8 text-muted-foreground/40" />
                    <p className="mt-2 text-sm text-muted-foreground">No saved beneficiaries</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 text-emerald-600 hover:text-emerald-700"
                      onClick={() => setBeneficiaryDialogOpen(true)}
                    >
                      <UserPlus className="mr-1 size-3.5" /> Add your first beneficiary
                    </Button>
                  </div>
                ) : (
                  <div className="mt-2 space-y-2 max-h-60 overflow-y-auto">
                    {beneficiaries.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => setSelectedBeneficiary(b.id)}
                        className={`w-full rounded-lg border p-3 text-left transition-all ${
                          selectedBeneficiary === b.id
                            ? "border-emerald-300 bg-emerald-50/50 ring-1 ring-emerald-200 dark:border-emerald-700 dark:bg-emerald-950/30 dark:ring-emerald-800"
                            : "border-border hover:border-emerald-200 hover:bg-muted/30"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold truncate">{b.fullName}</p>
                              {b.isVerified && (
                                <ShieldCheck className="size-3.5 text-emerald-500 shrink-0" />
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground truncate">
                              {b.bankName ?? "Bank"} &middot; {maskAccount(b.accountNumber)}
                            </p>
                            {b.ifscCode && (
                              <p className="text-xs text-muted-foreground">IFSC: {b.ifscCode}</p>
                            )}
                          </div>
                          {selectedBeneficiary === b.id && <CheckCircle2 className="size-5 text-emerald-500 shrink-0 ml-2" />}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Separator />

              {/* Payment Method */}
              <div>
                <Label className="text-sm font-medium">Payment Method</Label>
                <div className="mt-2 flex gap-3">
                  <button
                    onClick={() => setPaymentMethod("wallet")}
                    className={`flex-1 flex items-center gap-2 rounded-lg border p-3 transition-all ${
                      paymentMethod === "wallet"
                        ? "border-emerald-300 bg-emerald-50/50 ring-1 ring-emerald-200 dark:border-emerald-700 dark:bg-emerald-950/30"
                        : "border-border hover:border-emerald-200"
                    }`}
                  >
                    <Banknote className={`size-5 ${paymentMethod === "wallet" ? "text-emerald-600" : "text-muted-foreground"}`} />
                    <div className="text-left">
                      <p className="text-sm font-medium">Wallet Balance</p>
                      <p className="text-xs text-muted-foreground">AED {aedBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                    {paymentMethod === "wallet" && <CheckCircle2 className="ml-auto size-4 text-emerald-500" />}
                  </button>
                  <button
                    onClick={() => setPaymentMethod("card")}
                    className={`flex-1 flex items-center gap-2 rounded-lg border p-3 transition-all ${
                      paymentMethod === "card"
                        ? "border-emerald-300 bg-emerald-50/50 ring-1 ring-emerald-200 dark:border-emerald-700 dark:bg-emerald-950/30"
                        : "border-border hover:border-emerald-200"
                    }`}
                  >
                    <CreditCard className={`size-5 ${paymentMethod === "card" ? "text-emerald-600" : "text-muted-foreground"}`} />
                    <div className="text-left">
                      <p className="text-sm font-medium">Card</p>
                      <p className="text-xs text-muted-foreground">Visa / MC</p>
                    </div>
                    {paymentMethod === "card" && <CheckCircle2 className="ml-auto size-4 text-emerald-500" />}
                  </button>
                </div>
              </div>

              {/* Send Button */}
              <Button
                onClick={handleSend}
                disabled={numericAmount <= 0 || isSending || !selectedBeneficiary || beneficiaries.length === 0}
                className="w-full bg-emerald-600 py-6 text-base font-semibold hover:bg-emerald-700"
                size="lg"
              >
                {isSending ? (
                  <>
                    <Loader2 className="mr-2 size-5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 size-5" />
                    Send AED {numericAmount.toFixed(2)}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </motion.div>

      {/* ── Rate Comparison ── */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.4 }}>
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="size-4 text-emerald-500" />
              Rate Comparison
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { name: "FlexPay", fee: `AED ${(numericAmount * feeRate / 100).toFixed(2)} (${feeRate}%)`, highlight: true },
                { name: "Exchange House", fee: "AED 15 \u2013 30", highlight: false },
                { name: "Bank Transfer", fee: "AED 25 \u2013 45", highlight: false },
              ].map((item) => (
                <div key={item.name} className={`flex items-center justify-between rounded-lg p-3 ${item.highlight ? "bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800" : "bg-muted/40"}`}>
                  <div className="flex items-center gap-2">
                    {item.highlight && <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500"><CheckCircle2 className="size-3 text-white" /></span>}
                    <span className={`text-sm font-medium ${item.highlight ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{item.name}</span>
                  </div>
                  <span className={`text-sm font-semibold ${item.highlight ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>{item.fee}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-center text-sm font-bold text-emerald-600">You save up to 80% with FlexPay!</p>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Recent Remittances ── */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.4 }}>
        {isLoading ? (
          <RecentRemittancesSkeleton />
        ) : (
          <Card className="overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent Remittances</CardTitle>
            </CardHeader>
            <CardContent>
              {mockRecentRemittances.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center">
                  <Send className="mx-auto size-8 text-muted-foreground/40" />
                  <p className="mt-2 text-sm text-muted-foreground">No remittances yet</p>
                  <p className="text-xs text-muted-foreground">Send your first remittance above</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {mockRecentRemittances.map((r) => (
                    <div key={r.id} className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/30">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{r.recipient}</p>
                        <p className="text-xs text-muted-foreground">{r.country} &middot; {formatDate(r.date)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0 ml-3">
                        <p className="text-sm font-bold">AED {r.amount.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">{r.destCurrency} {r.converted.toLocaleString()}</p>
                        {statusBadge(r.status)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </motion.div>
    </div>
  );
}
