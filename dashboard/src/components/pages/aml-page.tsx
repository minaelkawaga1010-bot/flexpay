"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Eye,
  Check,
  ChevronUp,
  Globe,
  Repeat,
  Zap,
  Moon,
  Users,
  MapPin,
  FileText,
  Bot,
  Bell,
  Search,
  RefreshCw,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { toast } from "sonner";

// ── Types ───────────────────────────────────────────────────────
type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

interface AlertItem {
  id: string;
  userId: string | null;
  transactionId: string | null;
  type: string;
  severity: Severity;
  description: string;
  isResolved: boolean;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  user?: { id: string; fullName: string; phone: string } | null;
}

interface AmlStats {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  unresolved: number;
}

interface AmlData {
  alerts: AlertItem[];
  stats: AmlStats;
}

// ── Mock Fallback ───────────────────────────────────────────────
const mockData: AmlData = {
  alerts: [
    {
      id: "AML-001",
      userId: "u1",
      transactionId: "t1",
      type: "STRUCTURED",
      severity: "CRITICAL",
      description: "Multiple deposits just below reporting threshold (AED 34,900) detected over 5 days",
      isResolved: false,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: new Date(Date.now() - 12 * 60000).toISOString(),
      user: { id: "u1", fullName: "Ahmed Al Rashid", phone: "+971501111111" },
    },
    {
      id: "AML-002",
      userId: "u2",
      transactionId: "t2",
      type: "VELOCITY",
      severity: "HIGH",
      description: "Unusual spike in transaction velocity: 15 transfers in 2 hours from dormant account",
      isResolved: false,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: new Date(Date.now() - 60 * 60000).toISOString(),
      user: { id: "u2", fullName: "Mohammed Saleh", phone: "+971502222222" },
    },
    {
      id: "AML-003",
      userId: "u3",
      transactionId: "t3",
      type: "RAPID_MOVEMENT",
      severity: "MEDIUM",
      description: "Funds received and transferred out within 30 minutes — potential layering",
      isResolved: false,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: new Date(Date.now() - 180 * 60000).toISOString(),
      user: { id: "u3", fullName: "Fatima Noor", phone: "+971503333333" },
    },
    {
      id: "AML-004",
      userId: "u4",
      transactionId: "t4",
      type: "LATE_NIGHT",
      severity: "HIGH",
      description: "Multiple high-value transfers (AED 45,000 total) between 2:00 AM - 4:00 AM",
      isResolved: false,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: new Date(Date.now() - 300 * 60000).toISOString(),
      user: { id: "u4", fullName: "Raj Patel", phone: "+971504444444" },
    },
    {
      id: "AML-005",
      userId: "u5",
      transactionId: "t5",
      type: "MULTI_BENEFICIARY",
      severity: "LOW",
      description: "Single sender distributing funds to 8 different beneficiaries in one day",
      isResolved: true,
      resolvedBy: "admin",
      resolvedAt: new Date(Date.now() - 86400000).toISOString(),
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      user: { id: "u5", fullName: "Saeed Khan", phone: "+971505555555" },
    },
    {
      id: "AML-006",
      userId: "u6",
      transactionId: "t6",
      type: "HIGH_RISK_COUNTRY",
      severity: "MEDIUM",
      description: "Large remittance (AED 28,000) sent to jurisdiction on FATF grey list",
      isResolved: true,
      resolvedBy: "admin",
      resolvedAt: new Date(Date.now() - 86400000).toISOString(),
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      user: { id: "u6", fullName: "Chen Wei", phone: "+971506666666" },
    },
  ],
  stats: {
    total: 6,
    critical: 1,
    high: 2,
    medium: 2,
    low: 1,
    unresolved: 4,
  },
};

// ── Helpers ────────────────────────────────────────────────────────
const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  STRUCTURED: Repeat,
  VELOCITY: Zap,
  RAPID_MOVEMENT: ArrowUpRight,
  LATE_NIGHT: Moon,
  MULTI_BENEFICIARY: Users,
  LARGE_AMOUNT: Globe,
  HIGH_RISK_COUNTRY: MapPin,
};

const typeLabels: Record<string, string> = {
  STRUCTURED: "Structured Transactions",
  VELOCITY: "Velocity Alert",
  RAPID_MOVEMENT: "Rapid Movement",
  LATE_NIGHT: "Late Night Activity",
  MULTI_BENEFICIARY: "Multi-Beneficiary",
  LARGE_AMOUNT: "Large Amount",
  HIGH_RISK_COUNTRY: "High-Risk Country",
};

function getSeverityColor(severity: Severity): string {
  switch (severity) {
    case "CRITICAL":
      return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700";
    case "HIGH":
      return "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700";
    case "MEDIUM":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700";
    case "LOW":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700";
  }
}

function formatSeverity(severity: string): string {
  return severity.charAt(0) + severity.slice(1).toLowerCase();
}

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? "s" : ""} ago`;
  return `${diffDay} day${diffDay !== 1 ? "s" : ""} ago`;
}

const severityChartConfig = {
  CRITICAL: { label: "Critical", color: "#ef4444" },
  HIGH: { label: "High", color: "#f97316" },
  MEDIUM: { label: "Medium", color: "#eab308" },
  LOW: { label: "Low", color: "#22c55e" },
};

const activityLog = [
  { action: "Auto-flagged transaction for review", detail: "AML-003 — Rapid movement detected", time: "12 min ago", icon: Bot, iconColor: "text-amber-500" },
  { action: "Alert resolved by system", detail: "AML-006 — Cleared after KYC verification", time: "1 hour ago", icon: CheckCircle2, iconColor: "text-emerald-500" },
  { action: "SAR report generated", detail: "Suspicious Activity Report #SAR-2025-0042", time: "3 hours ago", icon: FileText, iconColor: "text-sky-500" },
  { action: "Alert escalated to compliance officer", detail: "AML-001 — Critical severity escalation", time: "5 hours ago", icon: ArrowUpRight, iconColor: "text-red-500" },
  { action: "New alert created", detail: "AML-004 — Late night activity pattern", time: "5 hours ago", icon: Bell, iconColor: "text-amber-500" },
  { action: "User profile reviewed", detail: "Mohammed Saleh — Enhanced due diligence", time: "6 hours ago", icon: Eye, iconColor: "text-muted-foreground" },
];

const severityOptions: ("All" | Severity)[] = ["All", "CRITICAL", "HIGH", "MEDIUM", "LOW"];
const statusOptions = ["All", "Open", "Resolved"] as const;
const typeOptions = [
  "All",
  "Structured",
  "Velocity",
  "Rapid Movement",
  "Late Night",
  "Multi-Beneficiary",
  "Large Amount",
  "High-Risk Country",
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

// ── Skeleton ────────────────────────────────────────────────────────
function AMLSkeleton() {
  return (
    <div className="space-y-6">
      {/* Stats skeleton */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="flex items-center gap-3 p-4">
              <Skeleton className="size-10 rounded-lg" />
              <div>
                <Skeleton className="h-7 w-8" />
                <Skeleton className="h-3 w-16 mt-1" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters skeleton */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Skeleton className="h-3 w-12 mb-1.5" />
              <Skeleton className="h-8 w-full rounded-md" />
            </div>
            <div className="flex gap-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-8 w-20 rounded-md" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Alerts skeleton */}
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Skeleton className="size-9 rounded-lg shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-5 w-24 rounded-full" />
                    <Skeleton className="h-5 w-14 rounded-full" />
                  </div>
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────
export function AMLPage() {
  const [data, setData] = useState<AmlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<(typeof severityOptions)[number]>("All");
  const [statusFilter, setStatusFilter] = useState<(typeof statusOptions)[number]>("All");
  const [typeFilter, setTypeFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchAlerts = useCallback(async (severityParam?: string) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (severityParam) params.set("severity", severityParam);
      const res = await fetch(`/api/aml${params.toString() ? `?${params.toString()}` : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Failed to fetch AML alerts:", err);
      toast.error("Could not load AML alerts. Showing sample data.");
      setData(mockData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const handleSeverityChange = useCallback((val: (typeof severityOptions)[number]) => {
    setSeverityFilter(val);
    fetchAlerts(val === "All" ? undefined : val);
  }, [fetchAlerts]);

  const handleResolve = useCallback(async (alertId: string) => {
    try {
      setResolvingId(alertId);
      const res = await fetch("/api/aml", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId, isResolved: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      toast.success(json.message || `Alert ${alertId} resolved`);
      // Re-fetch alerts to reflect change
      fetchAlerts(severityFilter === "All" ? undefined : severityFilter);
    } catch (err) {
      console.error("Failed to resolve alert:", err);
      toast.error("Failed to resolve alert. Please try again.");
    } finally {
      setResolvingId(null);
    }
  }, [fetchAlerts, severityFilter]);

  const handleReopen = useCallback(async (alertId: string) => {
    try {
      setResolvingId(alertId);
      const res = await fetch("/api/aml", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId, isResolved: false }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      toast.success(json.message || `Alert ${alertId} reopened`);
      fetchAlerts(severityFilter === "All" ? undefined : severityFilter);
    } catch (err) {
      console.error("Failed to reopen alert:", err);
      toast.error("Failed to reopen alert. Please try again.");
    } finally {
      setResolvingId(null);
    }
  }, [fetchAlerts, severityFilter]);

  if (loading) {
    return (
      <motion.div
        className="space-y-6"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <AMLSkeleton />
      </motion.div>
    );
  }

  const amlData = data ?? mockData;
  const allAlerts = amlData.alerts;
  const stats = amlData.stats;

  // Client-side filtering for status, type, and search
  const filteredAlerts = allAlerts.filter((alert) => {
    if (statusFilter === "Open" && alert.isResolved) return false;
    if (statusFilter === "Resolved" && !alert.isResolved) return false;
    if (typeFilter !== "All" && !alert.type.includes(typeFilter.toUpperCase().replace(" ", "_"))) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchesDesc = alert.description.toLowerCase().includes(q);
      const matchesUser = alert.user?.fullName?.toLowerCase().includes(q);
      const matchesId = alert.id.toLowerCase().includes(q);
      if (!matchesDesc && !matchesUser && !matchesId) return false;
    }
    return true;
  });

  const totalAlerts = allAlerts.length;
  const resolvedCount = allAlerts.filter((a) => a.isResolved).length;

  // Severity distribution from stats
  const severityCounts = [
    { name: "Critical", value: stats.critical, color: "#ef4444" },
    { name: "High", value: stats.high, color: "#f97316" },
    { name: "Medium", value: stats.medium, color: "#eab308" },
    { name: "Low", value: stats.low, color: "#22c55e" },
  ];

  return (
    <motion.div
      className="space-y-6"
      variants={container}
      initial="hidden"
      animate="show"
    >
      {/* Alert Summary Stats */}
      <motion.div variants={item}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10">
                <Shield className="size-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Total Alerts</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-red-500/10">
                <AlertTriangle className="size-5 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.critical}</p>
                <p className="text-xs text-muted-foreground">Critical</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-amber-500/10">
                <AlertCircle className="size-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.unresolved}</p>
                <p className="text-xs text-muted-foreground">Unresolved</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10">
                <CheckCircle2 className="size-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{resolvedCount}</p>
                <p className="text-xs text-muted-foreground">Resolved</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* Filters */}
      <motion.div variants={item}>
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Search</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search alerts..."
                    className="pl-8"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Severity</label>
                  <div className="flex gap-1">
                    {severityOptions.map((opt) => (
                      <Button
                        key={opt}
                        size="sm"
                        variant={severityFilter === opt ? "default" : "outline"}
                        className="h-8 text-[11px] px-2.5"
                        onClick={() => handleSeverityChange(opt)}
                      >
                        {opt === "All" ? "All" : formatSeverity(opt)}
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Status</label>
                  <div className="flex gap-1">
                    {statusOptions.map((opt) => (
                      <Button
                        key={opt}
                        size="sm"
                        variant={statusFilter === opt ? "default" : "outline"}
                        className="h-8 text-[11px] px-2.5"
                        onClick={() => setStatusFilter(opt)}
                      >
                        {opt}
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Type</label>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2.5 text-[11px] outline-none ring-ring/50 focus:ring-2"
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                  >
                    {typeOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Alerts List */}
        <motion.div variants={item} className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Alerts
              {filteredAlerts.length !== totalAlerts && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({filteredAlerts.length} of {totalAlerts})
                </span>
              )}
            </h2>
          </div>
          <div className="space-y-3 max-h-[700px] overflow-y-auto pr-1">
            <AnimatePresence mode="popLayout">
              {filteredAlerts.map((alert) => {
                const IconComponent = typeIcons[alert.type] || AlertCircle;
                const isCritical = alert.severity === "CRITICAL";
                const isResolved = alert.isResolved;
                const isResolving = resolvingId === alert.id;

                return (
                  <motion.div
                    key={alert.id}
                    layout
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Card
                      className={`relative overflow-hidden transition-shadow hover:shadow-md ${
                        isResolved ? "opacity-60" : ""
                      } ${
                        isCritical && !isResolved
                          ? "border-red-300 dark:border-red-700"
                          : ""
                      }`}
                    >
                      {/* Pulse indicator for critical */}
                      {isCritical && !isResolved && (
                        <div className="absolute left-0 top-0 h-full w-1 bg-red-500">
                          <div className="absolute inset-0 animate-ping bg-red-500/50" />
                        </div>
                      )}
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <div
                              className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                                isCritical
                                  ? "bg-red-500/10"
                                  : isResolved
                                  ? "bg-muted"
                                  : "bg-amber-500/10"
                              }`}
                            >
                              <IconComponent
                                className={`size-4 ${
                                  isCritical
                                    ? "text-red-500"
                                    : isResolved
                                    ? "text-muted-foreground"
                                    : "text-amber-500"
                                }`}
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] ${getSeverityColor(alert.severity)}`}
                                >
                                  {formatSeverity(alert.severity)}
                                </Badge>
                                <Badge variant="secondary" className="text-[10px]">
                                  {typeLabels[alert.type] || alert.type}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] ${
                                    isResolved
                                      ? "border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400"
                                      : "border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400"
                                  }`}
                                >
                                  {isResolved ? "Resolved" : "Open"}
                                </Badge>
                              </div>
                              <p className="mt-1.5 text-sm text-foreground/90">{alert.description}</p>
                              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                {alert.user && (
                                  <span className="flex items-center gap-1">
                                    <Users className="size-3" /> {alert.user.fullName}
                                  </span>
                                )}
                                <span className="flex items-center gap-1">
                                  <Clock className="size-3" /> {formatTimeAgo(alert.createdAt)}
                                </span>
                                <span className="font-mono text-[10px]">{alert.id.substring(0, 8)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        {/* Action Buttons */}
                        <div className="mt-3 flex gap-2 border-t pt-3">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-xs h-7"
                            onClick={() => toast.info(`Reviewing ${alert.id.substring(0, 8)}...`)}
                          >
                            <Eye className="size-3" /> Review
                          </Button>
                          {!isResolved ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5 text-xs h-7 border-emerald-300 text-emerald-600 hover:text-emerald-700 dark:border-emerald-700 dark:text-emerald-400"
                              onClick={() => handleResolve(alert.id)}
                              disabled={isResolving}
                            >
                              {isResolving ? (
                                <RefreshCw className="size-3 animate-spin" />
                              ) : (
                                <Check className="size-3" />
                              )} Resolve
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5 text-xs h-7"
                              onClick={() => handleReopen(alert.id)}
                              disabled={isResolving}
                            >
                              {isResolving ? (
                                <RefreshCw className="size-3 animate-spin" />
                              ) : (
                                <RefreshCw className="size-3" />
                              )} Reopen
                            </Button>
                          )}
                          {!isResolved && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5 text-xs h-7 border-red-300 text-red-600 hover:text-red-700 dark:border-red-700 dark:text-red-400"
                              onClick={() => toast.warning(`Alert ${alert.id.substring(0, 8)} escalated to senior compliance`)}
                            >
                              <ChevronUp className="size-3" /> Escalate
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {filteredAlerts.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                <Shield className="size-8 opacity-30" />
                <p className="text-sm">No alerts match your filters</p>
              </div>
            )}
          </div>
        </motion.div>

        {/* Sidebar - Chart + Activity */}
        <motion.div variants={item} className="space-y-4">
          {/* Severity Distribution */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Severity Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={severityChartConfig} className="h-[200px] w-full">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Pie
                    data={severityCounts}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    strokeWidth={2}
                    stroke="oklch(0.985 0.002 155)"
                  >
                    {severityCounts.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
              <div className="mt-2 flex flex-wrap justify-center gap-3">
                {severityCounts.map((s) => (
                  <div key={s.name} className="flex items-center gap-1.5">
                    <div className="size-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                    <span className="text-[10px] text-muted-foreground">{s.name} ({s.value})</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Activity Log */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Recent Activity</CardTitle>
              <CardDescription>Latest compliance actions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {activityLog.map((log, idx) => {
                  const LogIcon = log.icon;
                  return (
                    <div key={idx} className="flex gap-3">
                      <div className="relative mt-0.5 flex flex-col items-center">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                          <LogIcon className={`size-3.5 ${log.iconColor}`} />
                        </div>
                        {idx < activityLog.length - 1 && (
                          <div className="mt-1 h-full w-px bg-border" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 pb-3">
                        <p className="text-xs font-medium">{log.action}</p>
                        <p className="text-[10px] text-muted-foreground">{log.detail}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground/60">{log.time}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
