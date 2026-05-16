"use client";

import { motion } from "framer-motion";
import {
  ShieldCheck,
  Activity,
  Clock,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Server,
  BarChart3,
  Bell,
  Database,
  Wifi,
  Timer,
  ArrowDownRight,
  Gauge,
  Radio,
  HardDrive,
  MonitorDot,
  Eye,
  Zap,
  Webhook,
  Layers,
  CircleDot,
  ChevronRight,
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

interface SLORow {
  service: string;
  sloTarget: string;
  actual: string;
  errorBudget: string;
  budgetPercent: number;
  status: "Healthy" | "Watch" | "Critical";
}

const sloData: SLORow[] = [
  {
    service: "Auth / KYC",
    sloTarget: "99.90%",
    actual: "99.94%",
    errorBudget: "60%",
    budgetPercent: 60,
    status: "Healthy",
  },
  {
    service: "Wallet / Payroll",
    sloTarget: "99.95%",
    actual: "99.97%",
    errorBudget: "40%",
    budgetPercent: 40,
    status: "Healthy",
  },
  {
    service: "Card (NymCard)",
    sloTarget: "99.90%",
    actual: "99.93%",
    errorBudget: "31%",
    budgetPercent: 31,
    status: "Watch",
  },
  {
    service: "Webhooks",
    sloTarget: "99.80%",
    actual: "99.85%",
    errorBudget: "25%",
    budgetPercent: 25,
    status: "Watch",
  },
];

interface Incident {
  severity: string;
  title: string;
  date: string;
  resolution: string;
  status: "Resolved" | "Active" | "Completed";
}

const recentIncidents: Incident[] = [
  {
    severity: "SEV-2",
    title: "NymCard API latency spike",
    date: "Jun 15, 2025",
    resolution: "Resolved in 4.2 min",
    status: "Resolved",
  },
  {
    severity: "SEV-2",
    title: "Redis connection pool exhaustion",
    date: "Jun 8, 2025",
    resolution: "Resolved in 7.3 min",
    status: "Resolved",
  },
  {
    severity: "SEV-3",
    title: "Scheduled maintenance",
    date: "May 28, 2025",
    resolution: "Completed",
    status: "Completed",
  },
];

interface AlertRule {
  name: string;
  condition: string;
  severity: "Critical" | "Warning";
}

const alertRules: AlertRule[] = [
  {
    name: "API Error Rate",
    condition: "> 1% (5min window)",
    severity: "Critical",
  },
  {
    name: "Payment Processing Latency",
    condition: "> 3s p99",
    severity: "Warning",
  },
  {
    name: "Database Connection Pool",
    condition: "> 80% utilization",
    severity: "Warning",
  },
  {
    name: "Card Transaction Failure Rate",
    condition: "> 0.5% (5min window)",
    severity: "Critical",
  },
  {
    name: "Disk Usage",
    condition: "> 85% on any node",
    severity: "Warning",
  },
];

interface MonitoringTool {
  name: string;
  description: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const monitoringTools: MonitoringTool[] = [
  {
    name: "Prometheus",
    description: "Metrics collection",
    detail: "847 active alerts",
    icon: Activity,
    color: "emerald",
  },
  {
    name: "Grafana",
    description: "Dashboards",
    detail: "12 dashboards, 24/7 uptime",
    icon: BarChart3,
    color: "teal",
  },
  {
    name: "Alertmanager",
    description: "Alert routing",
    detail: "3 escalation policies",
    icon: Bell,
    color: "amber",
  },
  {
    name: "Thanos",
    description: "Long-term storage",
    detail: "6 months retention",
    icon: Database,
    color: "slate",
  },
];

// ── Sub-components ──────────────────────────────────────────────

function HeroBanner() {
  const stats = [
    { label: "SLO", value: "99.97%", icon: ShieldCheck },
    { label: "Error Budget", value: "68%", icon: Gauge },
    { label: "MTTR", value: "5.8 min", icon: Timer },
    { label: "Uptime", value: "99.99%", icon: Activity },
  ];

  return (
    <motion.div variants={fadeUp} custom={0}>
      <Card className="relative overflow-hidden border-0 py-0 shadow-xl">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-700 via-teal-800 to-slate-900 dark:from-emerald-900 dark:via-teal-950 dark:to-slate-950" />

        {/* Decorative elements */}
        <div className="absolute -right-16 -top-16 size-72 rounded-full bg-white/[0.03]" />
        <div className="absolute -bottom-20 -left-10 size-56 rounded-full bg-white/[0.03]" />
        <div className="absolute right-1/3 top-1/4 size-20 rounded-full bg-emerald-400/[0.06]" />

        {/* Grid pattern overlay */}
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
            {/* Title section */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm">
                  <Eye className="size-4 text-white" />
                </div>
                <span className="text-xs font-medium uppercase tracking-wider text-emerald-200/80">
                  Platform Reliability
                </span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
                SRE & Observability
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-emerald-100/70 sm:text-base">
                Real-time visibility into FlexPay&apos;s production infrastructure.
                Maintaining 99.97% platform reliability with proactive monitoring,
                automated alerting, and incident management across all critical services.
              </p>
            </div>

            {/* Hero stat badges */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {stats.map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.1, duration: 0.4 }}
                  className="flex items-center gap-3 rounded-xl bg-white/10 p-3 backdrop-blur-sm"
                >
                  <stat.icon className="size-5 shrink-0 text-emerald-200" />
                  <div>
                    <p className="text-lg font-bold leading-none text-white">
                      {stat.value}
                    </p>
                    <p className="text-[10px] font-medium text-emerald-200/70">
                      {stat.label}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function SLOTable() {
  return (
    <motion.div variants={fadeUp} custom={1}>
      <Card className="border-emerald-100 dark:border-emerald-900/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
              <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-base">SLO & Error Budget</CardTitle>
              <CardDescription>
                Service-level objectives across critical services
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
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Service
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    SLO Target
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Actual
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Error Budget
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {sloData.map((row) => (
                  <tr
                    key={row.service}
                    className="border-b border-border/50 transition-colors last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-7 items-center justify-center rounded-md bg-emerald-50 dark:bg-emerald-950/40">
                          <Server className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <span className="text-sm font-semibold text-foreground">
                          {row.service}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-sm text-muted-foreground">
                      {row.sloTarget}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                        {row.actual}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full transition-all ${
                              row.status === "Healthy"
                                ? "bg-emerald-500"
                                : "bg-amber-500"
                            }`}
                            style={{ width: `${row.budgetPercent}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-muted-foreground">
                          {row.errorBudget}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5">
                      <Badge
                        className={`border-0 text-[11px] font-medium ${
                          row.status === "Healthy"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                        }`}
                      >
                        {row.status === "Healthy" ? (
                          <CheckCircle2 className="size-3" />
                        ) : (
                          <AlertTriangle className="size-3" />
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
            {sloData.map((row) => (
              <div
                key={row.service}
                className="rounded-lg border border-border p-3.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex size-7 items-center justify-center rounded-md bg-emerald-50 dark:bg-emerald-950/40">
                      <Server className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <span className="text-sm font-semibold text-foreground">
                      {row.service}
                    </span>
                  </div>
                  <Badge
                    className={`border-0 text-[10px] font-medium ${
                      row.status === "Healthy"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                    }`}
                  >
                    {row.status === "Healthy" ? (
                      <CheckCircle2 className="size-3" />
                    ) : (
                      <AlertTriangle className="size-3" />
                    )}
                    {row.status}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground">SLO Target</span>
                    <span className="text-xs font-semibold text-foreground">{row.sloTarget}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground">Actual</span>
                    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">{row.actual}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground">Error Budget</span>
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

function IncidentSummary() {
  const cards = [
    {
      label: "SEV-1 Incidents",
      value: "0",
      icon: AlertCircle,
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
      iconColor: "text-emerald-600 dark:text-emerald-400",
      textColor: "text-emerald-700 dark:text-emerald-300",
      description: "Last 30 days",
      border: "border-emerald-100 dark:border-emerald-900/50",
    },
    {
      label: "SEV-2 Incidents",
      value: "2",
      icon: AlertTriangle,
      bg: "bg-amber-50 dark:bg-amber-950/40",
      iconColor: "text-amber-600 dark:text-amber-400",
      textColor: "text-amber-700 dark:text-amber-300",
      description: "Last 30 days",
      border: "border-amber-100 dark:border-amber-900/50",
    },
    {
      label: "Mean RTO",
      value: "5.8 min",
      icon: Timer,
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
      iconColor: "text-emerald-600 dark:text-emerald-400",
      textColor: "text-emerald-700 dark:text-emerald-300",
      description: "Recovery time objective",
      border: "border-emerald-100 dark:border-emerald-900/50",
    },
    {
      label: "False Positive Rate",
      value: "7%",
      icon: TrendingUp,
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
      iconColor: "text-emerald-600 dark:text-emerald-400",
      textColor: "text-emerald-700 dark:text-emerald-300",
      description: "↓ from 14%",
      border: "border-emerald-100 dark:border-emerald-900/50",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card, i) => (
        <motion.div key={card.label} variants={fadeUp} custom={i + 2}>
          <Card className={`border ${card.border} transition-shadow hover:shadow-md`}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div
                  className={`flex size-11 items-center justify-center rounded-xl ${card.bg}`}
                >
                  <card.icon className={`size-5 ${card.iconColor}`} />
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className={`text-2xl font-bold ${card.textColor}`}>
                    {card.value}
                  </span>
                </div>
              </div>
              <div className="mt-3">
                <p className="text-sm font-semibold text-foreground">
                  {card.label}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {card.description}
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

function MonitoringStack() {
  const colorMap: Record<string, { bg: string; icon: string; bar: string; border: string }> = {
    emerald: {
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
      icon: "text-emerald-600 dark:text-emerald-400",
      bar: "bg-emerald-500",
      border: "border-emerald-100 dark:border-emerald-900/50",
    },
    teal: {
      bg: "bg-teal-50 dark:bg-teal-950/40",
      icon: "text-teal-600 dark:text-teal-400",
      bar: "bg-teal-500",
      border: "border-teal-100 dark:border-teal-900/50",
    },
    amber: {
      bg: "bg-amber-50 dark:bg-amber-950/40",
      icon: "text-amber-600 dark:text-amber-400",
      bar: "bg-amber-500",
      border: "border-amber-100 dark:border-amber-900/50",
    },
    slate: {
      bg: "bg-slate-100 dark:bg-slate-800/60",
      icon: "text-slate-600 dark:text-slate-400",
      bar: "bg-slate-500",
      border: "border-slate-200 dark:border-slate-700/50",
    },
  };

  return (
    <motion.div variants={fadeUp} custom={6}>
      <Card className="border-emerald-100 dark:border-emerald-900/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
              <Layers className="size-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-base">Monitoring Stack</CardTitle>
              <CardDescription>
                Infrastructure monitoring and observability tools
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {monitoringTools.map((tool) => {
              const c = colorMap[tool.color];
              return (
                <div
                  key={tool.name}
                  className={`flex items-start gap-3.5 rounded-xl border ${c.border} p-4 transition-colors hover:bg-muted/30`}
                >
                  <div
                    className={`flex size-10 items-center justify-center rounded-lg ${c.bg} shrink-0`}
                  >
                    <tool.icon className={`size-5 ${c.icon}`} />
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-foreground">
                        {tool.name}
                      </span>
                      <Badge
                        variant="outline"
                        className="border-0 bg-muted/60 px-1.5 py-0 text-[10px] text-muted-foreground"
                      >
                        {tool.description}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {tool.detail}
                    </p>
                    {/* Mini bar indicator */}
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1 w-20 overflow-hidden rounded-full bg-muted">
                        <div className={`h-full w-4/5 rounded-full ${c.bar}`} />
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        Active
                      </span>
                    </div>
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

function RecentIncidentsTimeline() {
  const severityConfig: Record<string, { className: string; dot: string }> = {
    "SEV-1": {
      className:
        "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-0",
      dot: "bg-red-500",
    },
    "SEV-2": {
      className:
        "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-0",
      dot: "bg-amber-500",
    },
    "SEV-3": {
      className:
        "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400 border-0",
      dot: "bg-slate-400",
    },
  };

  return (
    <motion.div variants={fadeUp} custom={7}>
      <Card className="border-emerald-100 dark:border-emerald-900/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/40">
              <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <CardTitle className="text-base">Recent Incidents</CardTitle>
              <CardDescription>
                Last 30 days incident timeline
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border sm:left-[19px]" />

            <div className="flex flex-col gap-4">
              {recentIncidents.map((incident, i) => {
                const config =
                  severityConfig[incident.severity] ?? severityConfig["SEV-3"];
                return (
                  <div key={i} className="relative flex items-start gap-3 pl-1 sm:pl-2">
                    {/* Timeline dot */}
                    <div
                      className={`relative z-10 mt-1.5 size-[7px] shrink-0 rounded-full ${config.dot} sm:mt-1 sm:size-[9px]`}
                    />

                    {/* Content */}
                    <div className="flex flex-1 flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            className={`text-[10px] font-bold ${config.className}`}
                          >
                            {incident.severity}
                          </Badge>
                          <span className="text-sm font-semibold text-foreground">
                            {incident.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="size-3" />
                          <span>{incident.date}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {incident.status === "Resolved" ? (
                          <CheckCircle2 className="size-3.5 text-emerald-500" />
                        ) : (
                          <CheckCircle2 className="size-3.5 text-slate-400" />
                        )}
                        <span
                          className={`text-xs font-medium ${
                            incident.status === "Resolved"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-slate-500 dark:text-slate-400"
                          }`}
                        >
                          {incident.resolution}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function AlertRulesSection() {
  return (
    <motion.div variants={fadeUp} custom={8}>
      <Card className="border-emerald-100 dark:border-emerald-900/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-red-50 dark:bg-red-950/40">
              <Bell className="size-4 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <CardTitle className="text-base">Alert Rules</CardTitle>
              <CardDescription>
                Key alerting policies for production monitoring
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-col gap-2.5">
            {alertRules.map((rule, i) => (
              <div
                key={i}
                className="flex flex-col gap-2 rounded-lg border border-border p-3.5 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex size-8 items-center justify-center rounded-lg shrink-0 ${
                      rule.severity === "Critical"
                        ? "bg-red-50 dark:bg-red-950/40"
                        : "bg-amber-50 dark:bg-amber-950/40"
                    }`}
                  >
                    {rule.severity === "Critical" ? (
                      <AlertCircle className="size-4 text-red-600 dark:text-red-400" />
                    ) : (
                      <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-foreground">
                      {rule.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {rule.condition}
                    </span>
                  </div>
                </div>
                <Badge
                  className={`w-fit shrink-0 border-0 text-[10px] font-bold ${
                    rule.severity === "Critical"
                      ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                      : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                  }`}
                >
                  <Radio className="size-3" />
                  {rule.severity}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Main Component ──────────────────────────────────────────────
export function SREObservabilityPage() {
  return (
    <motion.div
      className="flex flex-col gap-6"
      initial="hidden"
      animate="visible"
      variants={stagger}
    >
      {/* 1. Hero Banner */}
      <HeroBanner />

      {/* 2. SLO & Error Budget Table */}
      <SLOTable />

      {/* 3. Incident Summary Grid */}
      <div className="mb-1">
        <motion.div variants={fadeUp} custom={2}>
          <div className="flex items-center gap-2 mb-4">
            <MonitorDot className="size-5 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-lg font-bold text-foreground">Incident Summary</h2>
            <Badge
              variant="outline"
              className="border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              Last 30 days
            </Badge>
          </div>
        </motion.div>
        <IncidentSummary />
      </div>

      {/* 4. Monitoring Stack */}
      <MonitoringStack />

      {/* 5. Recent Incidents Timeline */}
      <RecentIncidentsTimeline />

      {/* 6. Alert Rules */}
      <AlertRulesSection />

      {/* Divider */}
      <motion.div variants={fadeUp} custom={9}>
        <div className="relative flex items-center gap-4 py-2">
          <Separator className="flex-1" />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Zap className="size-3.5 text-emerald-500" />
            <span className="font-medium">Reliability Engineering</span>
            <Zap className="size-3.5 text-emerald-500" />
          </div>
          <Separator className="flex-1" />
        </div>
      </motion.div>

      {/* Bottom Stats Footer */}
      <motion.div variants={fadeUp} custom={10}>
        <Card className="border-emerald-200/60 bg-gradient-to-r from-emerald-50/60 via-white to-teal-50/60 py-0 dark:border-emerald-900/40 dark:from-emerald-950/20 dark:via-emerald-950/10 dark:to-teal-950/20">
          <CardContent className="p-4 sm:p-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {[
                { label: "Services Monitored", value: "4", icon: Server },
                { label: "Active Alerts", value: "847", icon: Bell },
                { label: "Dashboards", value: "12", icon: BarChart3 },
                { label: "Escalation Policies", value: "3", icon: Radio },
                { label: "Alert Rules", value: "5+", icon: AlertTriangle },
                { label: "Data Retention", value: "6 mo", icon: HardDrive },
                { label: "MTTR", value: "5.8 min", icon: Timer },
                { label: "Availability", value: "99.99%", icon: ShieldCheck },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="flex flex-col items-center gap-1 rounded-lg border border-emerald-100 bg-white/60 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/10"
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
          FlexPay SRE & Observability Dashboard &middot; Last updated June 2025
        </p>
      </motion.div>
    </motion.div>
  );
}
