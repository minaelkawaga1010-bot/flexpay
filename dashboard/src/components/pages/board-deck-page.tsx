"use client";

import { motion } from "framer-motion";
import {
  ShieldCheck,
  Activity,
  Timer,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Server,
  Bell,
  Globe,
  Lock,
  FileCheck,
  Gavel,
  ScrollText,
  Rocket,
  RotateCcw,
  Workflow,
  DollarSign,
  Target,
  CalendarDays,
  Users,
  Wrench,
  ChevronRight,
  Clock,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  ShieldAlert,
  Gauge,
  RefreshCw,
  Eye,
 Layers,
  Briefcase,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";


// ── Animation Variants ──────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: "easeOut" },
  }),
};

const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
};

const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.4 } },
};

// ── Data ────────────────────────────────────────────────────────

interface SLOService {
  service: string;
  sloTarget: string;
  actual: string;
  errorBudget: string;
  budgetPercent: number;
  status: "Healthy" | "Watch" | "Critical";
  downtimeBudget: string;
}

const sloServices: SLOService[] = [
  {
    service: "Auth / KYC",
    sloTarget: "99.90%",
    actual: "99.94%",
    errorBudget: "60%",
    budgetPercent: 60,
    status: "Healthy",
    downtimeBudget: "4.3 hrs/qtr",
  },
  {
    service: "Wallet / Payroll",
    sloTarget: "99.95%",
    actual: "99.97%",
    errorBudget: "40%",
    budgetPercent: 40,
    status: "Healthy",
    downtimeBudget: "2.2 hrs/qtr",
  },
  {
    service: "Card (NymCard)",
    sloTarget: "99.90%",
    actual: "99.93%",
    errorBudget: "31%",
    budgetPercent: 31,
    status: "Watch",
    downtimeBudget: "4.3 hrs/qtr",
  },
  {
    service: "Webhooks",
    sloTarget: "99.80%",
    actual: "99.85%",
    errorBudget: "25%",
    budgetPercent: 25,
    status: "Watch",
    downtimeBudget: "8.8 hrs/qtr",
  },
];

interface ComplianceItem {
  framework: string;
  articles: string;
  status: "Compliant" | "In Progress" | "Partial";
  details: string;
  icon: React.ComponentType<{ className?: string }>;
}

const complianceItems: ComplianceItem[] = [
  {
    framework: "CBUAE WPS",
    articles: "WPS Compliance",
    status: "Compliant",
    details: "Salary protection via WPS integration, automated payroll disbursement",
    icon: Gavel,
  },
  {
    framework: "UAE PDPL",
    articles: "Art. 10, 14, 24",
    status: "Compliant",
    details: "Data processing, breach notification (72hr), cross-border transfer controls",
    icon: ScrollText,
  },
  {
    framework: "ISO 27001",
    articles: "A.16 (Incident Mgmt)",
    status: "Compliant",
    details: "Incident response plan, 3 drills completed, post-incident reviews enforced",
    icon: FileCheck,
  },
  {
    framework: "NESA IAS",
    articles: "Data Localization",
    status: "Compliant",
    details: "All data stored in AWS me-south-1 (UAE), KMS encryption at rest",
    icon: Globe,
  },
];

interface RoadmapItem {
  action: string;
  owner: string;
  eta: string;
  priority: "High" | "Medium" | "Low";
  status: "Planned" | "In Progress" | "Done";
  detail: string;
}

const roadmapItems: RoadmapItem[] = [
  {
    action: "NymCard Circuit Breaker + Fallback Cache",
    owner: "@ahmed-dev",
    eta: "2025-07-15",
    priority: "High",
    status: "In Progress",
    detail: "Timeout: 3s, retry: 2x, cache TTL: 5min",
  },
  {
    action: "Chaos Engineering (Litmus)",
    owner: "@omar-sre",
    eta: "2025-08-01",
    priority: "High",
    status: "Planned",
    detail: "Pod kill, network partition, DNS failure experiments",
  },
  {
    action: "Error Budget Policy Automation",
    owner: "@sarah-dev",
    eta: "2025-08-15",
    priority: "Medium",
    status: "Planned",
    detail: "Auto-freeze deploys when budget < 10%",
  },
  {
    action: "Incident Automation (PagerDuty → Slack)",
    owner: "@omar-sre",
    eta: "2025-09-01",
    priority: "Medium",
    status: "Planned",
    detail: "Auto-escalation, runbook links, status page updates",
  },
];

// ── Sub-components ──────────────────────────────────────────────

function HeroBanner() {
  const stats = [
    { label: "Composite SLO", value: "99.97%", icon: ShieldCheck },
    { label: "Error Budget", value: "68%", icon: Gauge },
    { label: "Compliance", value: "100%", icon: FileCheck },
    { label: "Roadmap Delivered", value: "85%", icon: Target },
  ];

  return (
    <motion.div variants={fadeUp} custom={0}>
      <Card className="relative overflow-hidden border-0 py-0 shadow-xl">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-900 to-zinc-950 dark:from-slate-900 dark:via-zinc-950 dark:to-black" />
        <div className="absolute -right-16 -top-16 size-72 rounded-full bg-white/[0.03]" />
        <div className="absolute -bottom-20 -left-10 size-56 rounded-full bg-white/[0.03]" />
        <div className="absolute right-1/4 top-1/4 size-24 rounded-full bg-emerald-400/[0.06]" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />

        <CardContent className="relative p-6 sm:p-8">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm">
                  <Briefcase className="size-4 text-white" />
                </div>
                <span className="text-xs font-medium uppercase tracking-wider text-slate-300/80">
                  Board Quarterly Review
                </span>
              </div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
                  SRE &amp; Compliance Report
                </h1>
                <Badge className="border-0 bg-emerald-500/20 text-emerald-300 text-xs font-semibold backdrop-blur-sm">
                  Q2 2025
                </Badge>
              </div>
              <p className="max-w-2xl text-sm leading-relaxed text-slate-300/60 sm:text-base">
                Quarterly reliability, compliance, and operational health report for
                the FlexPay platform. Prepared for the Board of Directors.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {stats.map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.1, duration: 0.4 }}
                  className="flex items-center gap-3 rounded-xl bg-white/[0.07] p-3 backdrop-blur-sm border border-white/[0.06]"
                >
                  <stat.icon className="size-5 shrink-0 text-emerald-300/80" />
                  <div>
                    <p className="text-lg font-bold leading-none text-white">
                      {stat.value}
                    </p>
                    <p className="text-[10px] font-medium text-slate-300/60">
                      {stat.label}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400/60">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="size-3" />
                Reporting Period: Apr 1 – Jun 30, 2025
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="size-3" />
                Audience: Board of Directors
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="size-3" />
                Next Review: Sep 30, 2025
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ExecutiveSummary() {
  const cards = [
    {
      label: "Composite SLO",
      value: "99.97%",
      target: "99.90%",
      icon: ShieldCheck,
      trend: "up" as const,
      description: "Above 99.90% target",
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
      iconColor: "text-emerald-600 dark:text-emerald-400",
      textColor: "text-emerald-700 dark:text-emerald-300",
      border: "border-emerald-100 dark:border-emerald-900/50",
    },
    {
      label: "Error Budget Remaining",
      value: "68%",
      target: "> 50%",
      icon: Gauge,
      trend: "up" as const,
      description: "Healthy across all services",
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
      iconColor: "text-emerald-600 dark:text-emerald-400",
      textColor: "text-emerald-700 dark:text-emerald-300",
      border: "border-emerald-100 dark:border-emerald-900/50",
    },
    {
      label: "SEV-2 Incidents",
      value: "2",
      target: "< 3",
      icon: AlertTriangle,
      trend: "down" as const,
      description: "Both resolved < 8 min RTO",
      bg: "bg-amber-50 dark:bg-amber-950/40",
      iconColor: "text-amber-600 dark:text-amber-400",
      textColor: "text-amber-700 dark:text-amber-300",
      border: "border-amber-100 dark:border-amber-900/50",
    },
    {
      label: "Regulatory Compliance",
      value: "100%",
      target: "100%",
      icon: FileCheck,
      trend: "up" as const,
      description: "CBUAE, PDPL, ISO, NESA",
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
      iconColor: "text-emerald-600 dark:text-emerald-400",
      textColor: "text-emerald-700 dark:text-emerald-300",
      border: "border-emerald-100 dark:border-emerald-900/50",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card, i) => (
        <motion.div key={card.label} variants={fadeUp} custom={i + 1}>
          <Card className={`border ${card.border} transition-shadow hover:shadow-md`}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div
                  className={`flex size-11 items-center justify-center rounded-xl ${card.bg}`}
                >
                  <card.icon className={`size-5 ${card.iconColor}`} />
                </div>
                <div className="flex items-center gap-1">
                  {card.trend === "up" ? (
                    <ArrowUpRight className="size-3.5 text-emerald-500" />
                  ) : (
                    <ArrowDownRight className="size-3.5 text-amber-500" />
                  )}
                </div>
              </div>
              <div className="mt-3">
                <p className="text-2xl font-bold text-foreground">{card.value}</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">{card.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{card.description}</p>
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">Target:</span>
                  <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">{card.target}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

function SLOTable() {
  return (
    <motion.div variants={fadeUp} custom={5}>
      <Card className="border-slate-100 dark:border-slate-800/60">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
              <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-base">SLO &amp; Error Budget Status</CardTitle>
              <CardDescription>
                Service-level objectives across 4 critical services
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {/* Desktop Table */}
          <div className="hidden sm:block">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Service</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">SLO Target</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Actual</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Downtime Budget</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Error Budget</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {sloServices.map((row) => (
                  <tr
                    key={row.service}
                    className="border-b border-border/50 transition-colors last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-7 items-center justify-center rounded-md bg-slate-50 dark:bg-slate-800/60">
                          <Server className="size-3.5 text-slate-600 dark:text-slate-400" />
                        </div>
                        <span className="text-sm font-semibold text-foreground">{row.service}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-sm text-muted-foreground">{row.sloTarget}</td>
                    <td className="px-4 py-3.5">
                      <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{row.actual}</span>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-muted-foreground">{row.downtimeBudget}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full transition-all ${
                              row.status === "Healthy"
                                ? "bg-emerald-500"
                                : row.status === "Watch"
                                ? "bg-amber-500"
                                : "bg-red-500"
                            }`}
                            style={{ width: `${row.budgetPercent}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-muted-foreground">{row.errorBudget}</span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5">
                      <Badge
                        className={`border-0 text-[11px] font-medium ${
                          row.status === "Healthy"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                            : row.status === "Watch"
                            ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                            : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                        }`}
                      >
                        {row.status === "Healthy" ? (
                          <CheckCircle2 className="size-3" />
                        ) : row.status === "Watch" ? (
                          <AlertTriangle className="size-3" />
                        ) : (
                          <AlertCircle className="size-3" />
                        )}
                        {row.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="flex flex-col gap-3 px-4 pb-4 sm:hidden">
            {sloServices.map((row) => (
              <div key={row.service} className="rounded-lg border border-border p-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex size-7 items-center justify-center rounded-md bg-slate-50 dark:bg-slate-800/60">
                      <Server className="size-3.5 text-slate-600 dark:text-slate-400" />
                    </div>
                    <span className="text-sm font-semibold text-foreground">{row.service}</span>
                  </div>
                  <Badge
                    className={`border-0 text-[10px] font-medium ${
                      row.status === "Healthy"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                        : row.status === "Watch"
                        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                        : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                    }`}
                  >
                    {row.status}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground">Target</span>
                    <span className="text-xs font-semibold text-foreground">{row.sloTarget}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground">Actual</span>
                    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">{row.actual}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground">Budget</span>
                    <span className="text-xs font-semibold text-foreground">{row.errorBudget}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function IncidentDrillPerformance() {
  const metrics = [
    { label: "Disaster Recovery Drills", value: "3", sub: "Completed Q2", icon: RefreshCw, bg: "bg-emerald-50 dark:bg-emerald-950/40", iconColor: "text-emerald-600 dark:text-emerald-400", textColor: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-100 dark:border-emerald-900/50" },
    { label: "Mean RTO", value: "5.8 min", sub: "Target: < 8 min", icon: Timer, bg: "bg-emerald-50 dark:bg-emerald-950/40", iconColor: "text-emerald-600 dark:text-emerald-400", textColor: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-100 dark:border-emerald-900/50" },
    { label: "False Positive Rate", value: "7%", sub: "↓ from 14% in Q1", icon: TrendingUp, bg: "bg-emerald-50 dark:bg-emerald-950/40", iconColor: "text-emerald-600 dark:text-emerald-400", textColor: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-100 dark:border-emerald-900/50" },
    { label: "Avg MTTR", value: "4.2 min", sub: "Mean time to resolve", icon: Clock, bg: "bg-slate-50 dark:bg-slate-800/60", iconColor: "text-slate-600 dark:text-slate-400", textColor: "text-slate-700 dark:text-slate-300", border: "border-slate-200 dark:border-slate-700/50" },
  ];

  return (
    <motion.div variants={fadeUp} custom={6}>
      <Card className="border-slate-100 dark:border-slate-800/60">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/40">
              <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <CardTitle className="text-base">Incident &amp; Drill Performance</CardTitle>
              <CardDescription>Q2 2025 incident response and disaster recovery drill results</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map((m) => (
              <div key={m.label} className={`flex flex-col gap-2 rounded-xl border ${m.border} p-4`}>
                <div className="flex items-center gap-2.5">
                  <div className={`flex size-9 items-center justify-center rounded-lg ${m.bg}`}>
                    <m.icon className={`size-4 ${m.iconColor}`} />
                  </div>
                  <span className={`text-xl font-bold ${m.textColor}`}>{m.value}</span>
                </div>
                <p className="text-xs font-semibold text-foreground">{m.label}</p>
                <p className="text-[11px] text-muted-foreground">{m.sub}</p>
              </div>
            ))}
          </div>

          {/* Incident details */}
          <div className="mt-4 rounded-lg border border-border p-4">
            <p className="text-xs font-semibold text-foreground mb-3">Q2 Incidents Summary</p>
            <div className="flex flex-col gap-2.5">
              <div className="flex items-start gap-3 rounded-lg bg-muted/30 p-3">
                <Badge className="border-0 bg-amber-50 text-amber-700 text-[10px] font-bold dark:bg-amber-950/40 dark:text-amber-400 shrink-0 mt-0.5">SEV-2</Badge>
                <div>
                  <p className="text-xs font-semibold text-foreground">NymCard API latency spike</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Jun 15 — Resolved in 4.2 min. Card service error budget entered Watch (31%). Triggered circuit breaker investigation.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg bg-muted/30 p-3">
                <Badge className="border-0 bg-amber-50 text-amber-700 text-[10px] font-bold dark:bg-amber-950/40 dark:text-amber-400 shrink-0 mt-0.5">SEV-2</Badge>
                <div>
                  <p className="text-xs font-semibold text-foreground">Redis connection pool exhaustion</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Jun 8 — Resolved in 7.3 min. Pool size increased from 20 → 50. Automated scaling policy added.</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ComplianceSection() {
  const statusConfig: Record<string, { className: string; icon: React.ComponentType<{ className?: string }> }> = {
    Compliant: { className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-0", icon: CheckCircle2 },
    "In Progress": { className: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-0", icon: AlertTriangle },
    Partial: { className: "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400 border-0", icon: AlertCircle },
  };

  return (
    <motion.div variants={fadeUp} custom={7}>
      <Card className="border-slate-100 dark:border-slate-800/60">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
              <ShieldAlert className="size-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-base">Compliance &amp; Regulatory Alignment</CardTitle>
              <CardDescription>Q2 2025 regulatory compliance status across all frameworks</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-col gap-3">
            {complianceItems.map((item) => {
              const config = statusConfig[item.status];
              const StatusIcon = config.icon;
              return (
                <div
                  key={item.framework}
                  className="flex flex-col gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-50 dark:bg-slate-800/60">
                      <item.icon className="size-5 text-slate-600 dark:text-slate-400" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-foreground">{item.framework}</span>
                        <Badge className="border-0 bg-muted/60 px-1.5 py-0 text-[10px] text-muted-foreground">{item.articles}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{item.details}</p>
                    </div>
                  </div>
                  <Badge className={`w-fit shrink-0 text-[10px] font-medium flex items-center gap-1 ${config.className}`}>
                    <StatusIcon className="size-3" />
                    {item.status}
                  </Badge>
                </div>
              );
            })}
          </div>

          {/* Data residency callout */}
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-emerald-100 bg-emerald-50/50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20">
            <Lock className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">UAE Data Residency</p>
              <p className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 mt-0.5">
                All production data stored in AWS me-south-1 (Bahrain/UAE region). KMS envelope encryption (AES-256) for PII at rest. Cross-border transfer controls enforced per PDPL Art.24.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function CICDDeploymentHealth() {
  const metrics = [
    { label: "Deployments", value: "47", sub: "this quarter", icon: Rocket, bg: "bg-slate-50 dark:bg-slate-800/60", iconColor: "text-slate-600 dark:text-slate-400" },
    { label: "Rollbacks", value: "1", sub: "0.8% rollback rate", icon: RotateCcw, bg: "bg-emerald-50 dark:bg-emerald-950/40", iconColor: "text-emerald-600 dark:text-emerald-400" },
    { label: "Deploy Frequency", value: "2.1/wk", sub: "avg cadence", icon: Workflow, bg: "bg-slate-50 dark:bg-slate-800/60", iconColor: "text-slate-600 dark:text-slate-400" },
    { label: "Lead Time", value: "2.1 hrs", sub: "commit → prod", icon: Timer, bg: "bg-slate-50 dark:bg-slate-800/60", iconColor: "text-slate-600 dark:text-slate-400" },
  ];

  return (
    <motion.div variants={fadeUp} custom={8}>
      <Card className="border-slate-100 dark:border-slate-800/60">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-slate-50 dark:bg-slate-800/60">
              <Rocket className="size-4 text-slate-600 dark:text-slate-400" />
            </div>
            <div>
              <CardTitle className="text-base">CI/CD &amp; Deployment Health</CardTitle>
              <CardDescription>Automated deployment pipeline with quality gates</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map((m) => (
              <div key={m.label} className="flex flex-col gap-2 rounded-xl border border-border p-4">
                <div className="flex items-center gap-2.5">
                  <div className={`flex size-9 items-center justify-center rounded-lg ${m.bg}`}>
                    <m.icon className={`size-4 ${m.iconColor}`} />
                  </div>
                  <span className="text-xl font-bold text-foreground">{m.value}</span>
                </div>
                <p className="text-xs font-semibold text-foreground">{m.label}</p>
                <p className="text-[11px] text-muted-foreground">{m.sub}</p>
              </div>
            ))}
          </div>

          {/* Quality gates summary */}
          <div className="mt-4 rounded-lg border border-border p-4">
            <p className="text-xs font-semibold text-foreground mb-3">Quality Gates (100% Pass Rate)</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                { label: "Lint", detail: "ESLint 0 errors" },
                { label: "TypeScript", detail: "Strict mode" },
                { label: "Unit Tests", detail: "26/26 passing" },
                { label: "Trivy Scan", detail: "0 critical/high" },
                { label: "Helm Validate", detail: "kubeconform pass" },
              ].map((gate) => (
                <div key={gate.label} className="flex items-center gap-1.5 rounded-md bg-muted/30 px-2.5 py-2">
                  <CheckCircle2 className="size-3 text-emerald-500 shrink-0" />
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[11px] font-semibold text-foreground">{gate.label}</span>
                    <span className="text-[10px] text-muted-foreground truncate">{gate.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function FinancialResourceImpact() {
  const items = [
    { label: "Downtime Financial Loss", value: "AED 0", description: "Zero SLA breach penalties or revenue loss from downtime", icon: DollarSign, color: "emerald" },
    { label: "SLA Violation Penalties", value: "AED 0", description: "100% SLO compliance across all services", icon: ShieldCheck, color: "emerald" },
    { label: "Alerting Optimization Savings", value: "~15 hrs/mo", description: "Reduced false positives from 14% to 7%, saving engineering hours", icon: Bell, color: "slate" },
    { label: "Roadmap Delivery Rate", value: "85%", description: "17 of 20 planned epic items delivered on schedule", icon: Target, color: "slate" },
  ];

  const colorClasses: Record<string, { valueColor: string; iconBg: string }> = {
    emerald: { valueColor: "text-emerald-700 dark:text-emerald-300", iconBg: "bg-emerald-50 dark:bg-emerald-950/40" },
    slate: { valueColor: "text-slate-700 dark:text-slate-300", iconBg: "bg-slate-50 dark:bg-slate-800/60" },
  };

  return (
    <motion.div variants={fadeUp} custom={9}>
      <Card className="border-slate-100 dark:border-slate-800/60">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
              <DollarSign className="size-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-base">Financial &amp; Resource Impact</CardTitle>
              <CardDescription>Q2 2025 financial impact and resource utilization</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {items.map((item) => {
              const c = colorClasses[item.color];
              return (
                <div key={item.label} className="flex items-start gap-3.5 rounded-xl border border-border p-4 transition-colors hover:bg-muted/30">
                  <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${c.iconBg}`}>
                    <item.icon className={`size-5 ${item.color === "emerald" ? "text-emerald-600 dark:text-emerald-400" : "text-slate-600 dark:text-slate-400"}`} />
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className={`text-lg font-bold ${c.valueColor}`}>{item.value}</span>
                    <span className="text-xs font-semibold text-foreground">{item.label}</span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{item.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ReliabilityRoadmap() {
  const priorityConfig: Record<string, { className: string }> = {
    High: { className: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-0" },
    Medium: { className: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-0" },
    Low: { className: "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400 border-0" },
  };

  const statusConfig: Record<string, { className: string }> = {
    Done: { className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-0" },
    "In Progress": { className: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border-0" },
    Planned: { className: "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400 border-0" },
  };

  return (
    <motion.div variants={fadeUp} custom={10}>
      <Card className="border-slate-100 dark:border-slate-800/60">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-slate-50 dark:bg-slate-800/60">
              <Wrench className="size-4 text-slate-600 dark:text-slate-400" />
            </div>
            <div>
              <CardTitle className="text-base">Reliability Roadmap — Q3 2025</CardTitle>
              <CardDescription>Planned improvements and infrastructure investments</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-col gap-3">
            {roadmapItems.map((item, i) => (
              <div
                key={item.action}
                className="flex flex-col gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted/30 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 dark:bg-slate-800/60 mt-0.5">
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-400">{i + 1}</span>
                  </div>
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{item.action}</p>
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <Badge className={`text-[10px] font-medium ${priorityConfig[item.priority].className}`}>
                        {item.priority}
                      </Badge>
                      <Badge className={`text-[10px] font-medium ${statusConfig[item.status].className}`}>
                        {item.status}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0 sm:ml-4 sm:mt-0">
                  <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <Users className="size-3" />
                    {item.owner}
                  </span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <CalendarDays className="size-3" />
                    {item.eta}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function NextStepsSection() {
  return (
    <motion.div variants={fadeUp} custom={11}>
      <Card className="relative overflow-hidden border-0 py-0 shadow-lg">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-600 via-teal-700 to-cyan-800 dark:from-emerald-800 dark:via-teal-900 dark:to-cyan-950" />
        <div className="absolute -right-12 -top-12 size-64 rounded-full bg-white/5" />
        <div className="absolute -bottom-16 -left-8 size-48 rounded-full bg-white/5" />

        <CardContent className="relative p-6 sm:p-8">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm">
                <ChevronRight className="size-4 text-white" />
              </div>
              <h2 className="text-lg font-bold text-white">Q&amp;A / Next Steps</h2>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex items-start gap-3 rounded-xl bg-white/10 p-4 backdrop-blur-sm border border-white/[0.06]">
                <CalendarDays className="size-5 shrink-0 text-emerald-200 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-white">Next Review</p>
                  <p className="text-xs text-emerald-200/70">Q3 2025 — September 30, 2025</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl bg-white/10 p-4 backdrop-blur-sm border border-white/[0.06]">
                <Target className="size-5 shrink-0 text-emerald-200 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-white">Q3 Focus Areas</p>
                  <p className="text-xs text-emerald-200/70">NymCard resilience, chaos engineering, error budget automation</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl bg-white/10 p-4 backdrop-blur-sm border border-white/[0.06]">
                <Eye className="size-5 shrink-0 text-emerald-200 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-white">Board Requests</p>
                  <p className="text-xs text-emerald-200/70">KPI drill-down dashboards, cost attribution, capacity planning</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl bg-white/10 p-4 backdrop-blur-sm border border-white/[0.06]">
                <Layers className="size-5 shrink-0 text-emerald-200 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-white">Confluence Sync</p>
                  <p className="text-xs text-emerald-200/70">Auto-publish to Confluence wiki for stakeholder access</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Main Component ──────────────────────────────────────────────
export function BoardDeckPage() {
  return (
    <motion.div
      className="flex flex-col gap-6"
      initial="hidden"
      animate="visible"
      variants={stagger}
    >
      {/* Slide 1: Cover / Hero */}
      <HeroBanner />

      {/* Slide 2: Executive Summary */}
      <motion.div variants={fadeUp} custom={1}>
        <div className="flex items-center gap-2 mb-4">
          <Activity className="size-5 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-lg font-bold text-foreground">Executive Summary</h2>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            Slide 2
          </Badge>
        </div>
      </motion.div>
      <ExecutiveSummary />

      {/* Slide 3: SLO & Error Budget */}
      <motion.div variants={fadeUp} custom={4}>
        <div className="flex items-center gap-2 mb-4">
          <Gauge className="size-5 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-lg font-bold text-foreground">SLO &amp; Error Budget</h2>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            Slide 3
          </Badge>
        </div>
      </motion.div>
      <SLOTable />

      {/* Slide 4: Incident & Drill Performance */}
      <IncidentDrillPerformance />

      {/* Slide 5: Compliance & Regulatory */}
      <motion.div variants={fadeUp} custom={7}>
        <div className="flex items-center gap-2 mb-4">
          <ShieldAlert className="size-5 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-lg font-bold text-foreground">Compliance &amp; Regulatory Alignment</h2>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            Slide 5
          </Badge>
        </div>
      </motion.div>
      <ComplianceSection />

      {/* Slide 6: CI/CD & Deployment Health */}
      <CICDDeploymentHealth />

      {/* Slide 7: Financial & Resource Impact */}
      <FinancialResourceImpact />

      {/* Slide 8: Reliability Roadmap */}
      <motion.div variants={fadeUp} custom={10}>
        <div className="flex items-center gap-2 mb-4">
          <Wrench className="size-5 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-lg font-bold text-foreground">Reliability Roadmap</h2>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            Q3 2025
          </Badge>
        </div>
      </motion.div>
      <ReliabilityRoadmap />

      {/* Slide 9: Q&A / Next Steps */}
      <NextStepsSection />

      {/* Divider */}
      <motion.div variants={fadeUp} custom={12}>
        <div className="relative flex items-center gap-4 py-2">
          <Separator className="flex-1" />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Zap className="size-3.5 text-emerald-500" />
            <span className="font-medium">End of Report</span>
            <Zap className="size-3.5 text-emerald-500" />
          </div>
          <Separator className="flex-1" />
        </div>
      </motion.div>

      {/* Footer Stats */}
      <motion.div variants={fadeUp} custom={13}>
        <Card className="border-slate-200/60 bg-gradient-to-r from-slate-50/60 via-white to-emerald-50/60 py-0 dark:border-slate-800/40 dark:from-slate-950/20 dark:via-slate-950/10 dark:to-emerald-950/20">
          <CardContent className="p-4 sm:p-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {[
                { label: "SLO Composite", value: "99.97%", icon: ShieldCheck },
                { label: "Error Budget", value: "68%", icon: Gauge },
                { label: "SEV-1 Incidents", value: "0", icon: AlertCircle },
                { label: "SEV-2 Incidents", value: "2", icon: AlertTriangle },
                { label: "Compliance", value: "100%", icon: FileCheck },
                { label: "Deployments", value: "47", icon: Rocket },
                { label: "Roadmap Delivered", value: "85%", icon: Target },
                { label: "Next Review", value: "Q3", icon: CalendarDays },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="flex flex-col items-center gap-1 rounded-lg border border-slate-100 bg-white/60 p-3 dark:border-slate-800/40 dark:bg-slate-950/10"
                >
                  <stat.icon className="size-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                    {stat.value}
                  </span>
                  <span className="text-[10px] text-muted-foreground text-center">
                    {stat.label}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Bottom note */}
      <motion.div variants={fadeIn} className="text-center">
        <p className="text-xs text-muted-foreground/60">
          FlexPay Board Report &middot; SRE &amp; Compliance Q2 2025 &middot; Confidential
        </p>
      </motion.div>
    </motion.div>
  );
}
