"use client";

import { motion } from "framer-motion";
import {
  Database,
  ShieldCheck,
  CreditCard,
  Clock,
  FileCode,
  Box,
  CheckCircle2,
  FolderOpen,
  Code2,
  BarChart3,
  Layers,
  Cpu,
  Globe,
  Zap,
  Lock,
  Smartphone,
  RefreshCw,
  BookOpen,
  Boxes,
  Server,
  FileText,
  GitBranch,
  TestTube2,
  Bug,
  Shield,
  Link,
  Timer,
  DollarSign,
  Users,
  Bell,
  HardDrive,
  Activity,
  Cloud,
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
    transition: { delay: i * 0.08, duration: 0.5, ease: "easeOut" as const },
  }),
};

const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
};

const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.4 } },
};

// ── Types ───────────────────────────────────────────────────────
interface ModuleFeature {
  label: string;
  detail?: string;
  icon?: React.ComponentType<{ className?: string }>;
}

interface ModuleData {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  size: string;
  description: string;
  features: ModuleFeature[];
  filePath: string;
  badge: string;
  badgeClass: string;
  iconBg: string;
  iconColor: string;
  borderClass: string;
  headerBg: string;
  accentColor: string;
  stats?: { label: string; value: string }[];
  extraContent?: React.ReactNode;
}

// ── Data ────────────────────────────────────────────────────────
const prismaModels = [
  "Employee",
  "Company",
  "EmployeeTransaction",
  "Payroll",
  "ScheduledPayroll",
  "SavingsGoal",
  "Referral",
  "CreditScore",
  "Loan",
  "Remittance",
  "Offer",
  "OfferClick",
  "Notification",
  "AuditLog",
];

const modules: ModuleData[] = [
  {
    id: "prisma",
    title: "Prisma Schema",
    icon: Database,
    size: "15.8 KB",
    description: "Complete data model with 14+ tables powering the entire FlexPay ecosystem",
    features: [
      { label: "Employee & Company models", icon: Users },
      { label: "Payroll & ScheduledPayroll", icon: DollarSign },
      { label: "CreditScore & Loan", icon: BarChart3 },
      { label: "Remittance & SavingsGoal", icon: Globe },
      { label: "Offer & OfferClick", icon: Zap },
      { label: "Notification & AuditLog", icon: Bell },
    ],
    filePath: "prisma/schema.prisma",
    badge: "SQLite + Prisma ORM",
    badgeClass:
      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/50",
    iconBg: "bg-blue-50 dark:bg-blue-950/40",
    iconColor: "text-blue-600 dark:text-blue-400",
    borderClass: "border-blue-200 dark:border-blue-900/50",
    headerBg: "bg-gradient-to-r from-blue-50/80 to-cyan-50/80 dark:from-blue-950/20 dark:to-cyan-950/20",
    accentColor: "text-blue-600 dark:text-blue-400",
    stats: [
      { label: "Models", value: "20+" },
      { label: "Enums", value: "15+" },
      { label: "Indexes", value: "50+" },
    ],
    extraContent: (
      <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3 dark:border-blue-900/50 dark:bg-blue-950/20">
        <p className="mb-2 text-xs font-semibold text-blue-700 dark:text-blue-300">Key Models</p>
        <div className="flex flex-wrap gap-1.5">
          {prismaModels.map((model) => (
            <span
              key={model}
              className="inline-flex items-center gap-1 rounded-md bg-blue-100/80 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
            >
              <Code2 className="size-2.5" />
              {model}
            </span>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: "auth",
    title: "Auth Module",
    icon: ShieldCheck,
    size: "14.7 KB",
    description: "Enterprise-grade authentication with OTP, JWT tokens, and comprehensive audit logging",
    features: [
      {
        label: "requestOTP",
        detail: "Twilio + Redis, TTL 5min, rate limit 3/hr",
        icon: Smartphone,
      },
      {
        label: "verifyOTP",
        detail: "JWT 15min + refresh 7 days",
        icon: Lock,
      },
      {
        label: "Company Registration",
        detail: "PBKDF2 hashing",
        icon: Shield,
      },
      {
        label: "Logout",
        detail: "Token revocation",
        icon: RefreshCw,
      },
      {
        label: "Audit Logging",
        detail: "All operations tracked",
        icon: FileText,
      },
    ],
    filePath: "src/lib/auth.ts + src/app/api/auth/*",
    badge: "NextAuth + Twilio",
    badgeClass:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50",
    iconBg: "bg-emerald-50 dark:bg-emerald-950/40",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    borderClass: "border-emerald-200 dark:border-emerald-900/50",
    headerBg:
      "bg-gradient-to-r from-emerald-50/80 to-teal-50/80 dark:from-emerald-950/20 dark:to-teal-950/20",
    accentColor: "text-emerald-600 dark:text-emerald-400",
    stats: [
      { label: "Endpoints", value: "5" },
      { label: "Token TTL", value: "15min" },
      { label: "Refresh", value: "7 days" },
    ],
  },
  {
    id: "nymcard",
    title: "NymCard Service",
    icon: CreditCard,
    size: "15.3 KB",
    description: "Complete card issuing and management integration with NymCard platform",
    features: [
      { label: "Customer management", detail: "Create, get, update", icon: Users },
      { label: "Virtual cards", detail: "Issue, freeze, unfreeze, block", icon: CreditCard },
      { label: "Physical cards", detail: "Issue, track status", icon: HardDrive },
      {
        label: "Tokenization",
        detail: "Apple Pay, Google Pay, Samsung Pay",
        icon: Smartphone,
      },
      { label: "Card funding & transfers", detail: "Balance operations", icon: DollarSign },
      { label: "Webhook verification", detail: "Signature validation", icon: Link },
      { label: "NymCardAPIError", detail: "Custom HTTP codes", icon: Bug },
    ],
    filePath: "src/services/nymcard.service.ts",
    badge: "Card Issuing API",
    badgeClass:
      "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800/50",
    iconBg: "bg-violet-50 dark:bg-violet-950/40",
    iconColor: "text-violet-600 dark:text-violet-400",
    borderClass: "border-violet-200 dark:border-violet-900/50",
    headerBg:
      "bg-gradient-to-r from-violet-50/80 to-purple-50/80 dark:from-violet-950/20 dark:to-purple-950/20",
    accentColor: "text-violet-600 dark:text-violet-400",
    stats: [
      { label: "Operations", value: "12+" },
      { label: "Tokenization", value: "3 wallets" },
      { label: "Webhooks", value: "Verified" },
    ],
  },
  {
    id: "payroll",
    title: "Payroll Cron Job",
    icon: Clock,
    size: "11.5 KB",
    description: "Automated payroll processing with queuing, retries, and atomic transactions",
    features: [
      { label: "Daily cron", detail: "2:00 AM GST", icon: Timer },
      { label: "In-memory queue", detail: "Bull-compatible API", icon: Layers },
      { label: "Retry logic", detail: "3 attempts + exponential backoff", icon: RefreshCw },
      { label: "Atomic transactions", detail: "Prisma $transaction", icon: Lock },
      { label: "Push notifications", detail: "Success / failure alerts", icon: Bell },
      { label: "Card reissuance", detail: "Separate worker process", icon: CreditCard },
    ],
    filePath: "src/jobs/payroll-job.ts",
    badge: "Bull Queue + Cron",
    badgeClass:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/50",
    iconBg: "bg-amber-50 dark:bg-amber-950/40",
    iconColor: "text-amber-600 dark:text-amber-400",
    borderClass: "border-amber-200 dark:border-amber-900/50",
    headerBg:
      "bg-gradient-to-r from-amber-50/80 to-orange-50/80 dark:from-amber-950/20 dark:to-orange-950/20",
    accentColor: "text-amber-600 dark:text-amber-400",
    stats: [
      { label: "Schedule", value: "Daily" },
      { label: "Retries", value: "3x" },
      { label: "Workers", value: "2" },
    ],
  },
  {
    id: "tests",
    title: "Unit Tests",
    icon: TestTube2,
    size: "18.2 KB",
    description: "Comprehensive test suites with 26 tests covering critical business logic",
    features: [
      {
        label: "credit-score.test.ts",
        detail: "14 tests — base score, transactions, balance, referrals, penalties, edge cases",
        icon: BarChart3,
      },
      {
        label: "transfer.test.ts",
        detail: "12 tests — successful transfer, LUXURY zero fee, insufficient balance, self-transfer, atomicity, concurrency",
        icon: DollarSign,
      },
    ],
    filePath: "src/__tests__/",
    badge: "100% Pass Rate",
    badgeClass:
      "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800/50",
    iconBg: "bg-green-50 dark:bg-green-950/40",
    iconColor: "text-green-600 dark:text-green-400",
    borderClass: "border-green-200 dark:border-green-900/50",
    headerBg:
      "bg-gradient-to-r from-green-50/80 to-emerald-50/80 dark:from-green-950/20 dark:to-emerald-950/20",
    accentColor: "text-green-600 dark:text-green-400",
    stats: [
      { label: "Tests", value: "26" },
      { label: "Suites", value: "2" },
      { label: "Pass Rate", value: "100%" },
    ],
    extraContent: (
      <div className="mt-3 space-y-2">
        <div className="flex items-center gap-2 rounded-lg border border-green-100 bg-green-50/50 p-3 dark:border-green-900/50 dark:bg-green-950/20">
          <CheckCircle2 className="size-4 shrink-0 text-green-600 dark:text-green-400" />
          <div>
            <p className="text-xs font-semibold text-green-700 dark:text-green-300">
              credit-score.test.ts
            </p>
            <p className="text-[11px] text-green-600/80 dark:text-green-400/80">
              14 tests — scoring, transactions, balance, referrals, penalties, edge cases
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-green-100 bg-green-50/50 p-3 dark:border-green-900/50 dark:bg-green-950/20">
          <CheckCircle2 className="size-4 shrink-0 text-green-600 dark:text-green-400" />
          <div>
            <p className="text-xs font-semibold text-green-700 dark:text-green-300">
              transfer.test.ts
            </p>
            <p className="text-[11px] text-green-600/80 dark:text-green-400/80">
              12 tests — transfers, fees, self-transfer, atomicity, concurrency
            </p>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "openapi",
    title: "OpenAPI Spec",
    icon: FileCode,
    size: "25.5 KB",
    description: "Complete OpenAPI 3.1.0 specification covering all platform endpoints",
    features: [
      { label: "OpenAPI 3.1.0 spec", detail: "Industry standard", icon: BookOpen },
      { label: "Auth & Wallet", detail: "Core endpoints", icon: Lock },
      { label: "Cards & Savings", detail: "Financial products", icon: CreditCard },
      { label: "Offers & Remittance", detail: "Value-added services", icon: Globe },
      { label: "Credit Score & Notifications", detail: "Platform features", icon: Bell },
      { label: "JSON examples", detail: "Every endpoint documented", icon: Code2 },
      { label: "Error patterns", detail: "Standardized responses", icon: Bug },
    ],
    filePath: "openapi.yaml",
    badge: "OpenAPI 3.1.0",
    badgeClass:
      "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/50",
    iconBg: "bg-rose-50 dark:bg-rose-950/40",
    iconColor: "text-rose-600 dark:text-rose-400",
    borderClass: "border-rose-200 dark:border-rose-900/50",
    headerBg:
      "bg-gradient-to-r from-rose-50/80 to-pink-50/80 dark:from-rose-950/20 dark:to-pink-950/20",
    accentColor: "text-rose-600 dark:text-rose-400",
    stats: [
      { label: "Endpoints", value: "50+" },
      { label: "Schemas", value: "30+" },
      { label: "Format", value: "YAML" },
    ],
  },
  {
    id: "docker",
    title: "Docker Setup",
    icon: Box,
    size: "Multi-file",
    description: "Production-ready containerization with multi-stage builds and orchestration",
    features: [
      { label: "Dockerfile", detail: "Multi-stage Node.js 20 Alpine", icon: Boxes },
      { label: "Dockerfile.dev", detail: "Hot reload support", icon: GitBranch },
      {
        label: "docker-compose.yml",
        detail: "API + PostgreSQL 16 + Redis 7 + Commander + pgAdmin + MailHog",
        icon: Server,
      },
      {
        label: "docker-compose.prod.yml",
        detail: "Nginx reverse proxy + worker + resource limits",
        icon: Cpu,
      },
    ],
    filePath: "Dockerfile, Dockerfile.dev, docker-compose.yml, docker-compose.prod.yml",
    badge: "Production Ready",
    badgeClass:
      "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700/50",
    iconBg: "bg-slate-100 dark:bg-slate-800/60",
    iconColor: "text-slate-600 dark:text-slate-300",
    borderClass: "border-slate-200 dark:border-slate-800/50",
    headerBg:
      "bg-gradient-to-r from-slate-50/80 to-gray-50/80 dark:from-slate-900/20 dark:to-gray-900/20",
    accentColor: "text-slate-600 dark:text-slate-300",
    stats: [
      { label: "Services", value: "6" },
      { label: "Stages", value: "3" },
      { label: "Base Image", value: "Alpine" },
    ],
  },
  {
    id: "sre",
    title: "SRE & Observability",
    icon: Activity,
    size: "12.4 KB",
    description: "Production monitoring stack with Prometheus, Grafana, Alertmanager, and Thanos for full observability",
    features: [
      { label: "Prometheus", detail: "847 active alerts, 15s scrape", icon: BarChart3 },
      { label: "Grafana", detail: "12 dashboards, 99.99% uptime", icon: Layers },
      { label: "Alertmanager", detail: "3 escalation policies", icon: Bell },
      { label: "Thanos", detail: "6 months retention", icon: HardDrive },
      { label: "SLO Tracking", detail: "99.97% composite, 4 services", icon: Timer },
    ],
    filePath: "src/app/api/sre/route.ts + src/components/pages/sre-observability-page.tsx",
    badge: "Prometheus + Grafana",
    badgeClass:
      "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-800/50",
    iconBg: "bg-cyan-50 dark:bg-cyan-950/40",
    iconColor: "text-cyan-600 dark:text-cyan-400",
    borderClass: "border-cyan-200 dark:border-cyan-900/50",
    headerBg:
      "bg-gradient-to-r from-cyan-50/80 to-sky-50/80 dark:from-cyan-950/20 dark:to-sky-950/20",
    accentColor: "text-cyan-600 dark:text-cyan-400",
    stats: [
      { label: "SLO", value: "99.97%" },
      { label: "Services", value: "4" },
      { label: "MTTR", value: "5.8m" },
    ],
  },
  {
    id: "cicd",
    title: "CI/CD Pipeline",
    icon: GitBranch,
    size: "10.8 KB",
    description: "Automated deployment pipeline with GitHub Actions, Helm charts, and quality gates",
    features: [
      { label: "ci.yml", detail: "Lint + test + security scan, 4min", icon: TestTube2 },
      { label: "deploy-staging", detail: "On merge to main, 6min", icon: Server },
      { label: "deploy-production", detail: "Blue-green + approval, 8min", icon: Box },
      { label: "Quality Gates", detail: "100% on all 5 gates", icon: ShieldCheck },
      { label: "Helm Charts", detail: "3 charts, OCI hosted", icon: FileCode },
    ],
    filePath: "src/app/api/cicd/route.ts + src/components/pages/cicd-pipeline-page.tsx",
    badge: "GitHub Actions + Helm",
    badgeClass:
      "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800/50",
    iconBg: "bg-orange-50 dark:bg-orange-950/40",
    iconColor: "text-orange-600 dark:text-orange-400",
    borderClass: "border-orange-200 dark:border-orange-900/50",
    headerBg:
      "bg-gradient-to-r from-orange-50/80 to-amber-50/80 dark:from-orange-950/20 dark:to-amber-950/20",
    accentColor: "text-orange-600 dark:text-orange-400",
    stats: [
      { label: "Deploys/Q", value: "47" },
      { label: "Rollback", value: "0.8%" },
      { label: "Lead Time", value: "2.1h" },
    ],
  },
  {
    id: "infra",
    title: "Cloud Infrastructure",
    icon: Cloud,
    size: "11.2 KB",
    description: "AWS me-south-1 infrastructure with Kubernetes, RDS, Redis, KMS encryption and full UAE data residency",
    features: [
      { label: "EKS Cluster", detail: "3 nodes, 12 pods, 2 AZs", icon: Server },
      { label: "RDS PostgreSQL 16", detail: "Multi-AZ, 100GB, automated backups", icon: Database },
      { label: "ElastiCache Redis 7", detail: "3 node cluster, 2GB each", icon: Cpu },
      { label: "KMS + S3", detail: "AES-256 envelope encryption", icon: Lock },
      { label: "Compliance", detail: "CBUAE, PDPL, ISO 27001, NESA", icon: Shield },
    ],
    filePath: "src/app/api/infrastructure/route.ts + src/components/pages/infrastructure-page.tsx",
    badge: "AWS me-south-1",
    badgeClass:
      "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800/50",
    iconBg: "bg-violet-50 dark:bg-violet-950/40",
    iconColor: "text-violet-600 dark:text-violet-400",
    borderClass: "border-violet-200 dark:border-violet-900/50",
    headerBg:
      "bg-gradient-to-r from-violet-50/80 to-purple-50/80 dark:from-violet-950/20 dark:to-purple-950/20",
    accentColor: "text-violet-600 dark:text-violet-400",
    stats: [
      { label: "Region", value: "me-south-1" },
      { label: "Services", value: "6" },
      { label: "AZs", value: "2" },
    ],
  },
];

// ── Sub-components ──────────────────────────────────────────────

function ModuleCard({ module, index }: { module: ModuleData; index: number }) {
  return (
    <motion.div
      variants={fadeUp}
      custom={index}
      className="group"
      layout
    >
      <Card
        className={`h-full border ${module.borderClass} overflow-hidden transition-all duration-300 hover:shadow-lg`}
      >
        {/* Header with gradient */}
        <CardHeader className={`border-b ${module.headerBg} pb-4`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`flex size-11 items-center justify-center rounded-xl ${module.iconBg} shadow-sm`}
              >
                <module.icon className={`size-5 ${module.iconColor}`} />
              </div>
              <div>
                <CardTitle className="text-base leading-tight">
                  {module.title}
                </CardTitle>
                <CardDescription className="mt-0.5 text-xs">
                  {module.size}
                </CardDescription>
              </div>
            </div>
            <Badge
              variant="outline"
              className={`shrink-0 text-[10px] ${module.badgeClass}`}
            >
              {module.badge}
            </Badge>
          </div>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            {module.description}
          </p>
        </CardHeader>

        {/* Content */}
        <CardContent className="p-4">
          {/* Feature list */}
          <div className="space-y-2">
            {module.features.map((feature, i) => (
              <div
                key={i}
                className="flex items-start gap-2.5 rounded-lg p-2 transition-colors hover:bg-muted/40"
              >
                {feature.icon ? (
                  <feature.icon className={`mt-0.5 size-3.5 shrink-0 ${module.accentColor} opacity-70`} />
                ) : (
                  <CheckCircle2 className={`mt-0.5 size-3.5 shrink-0 ${module.accentColor} opacity-70`} />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">
                    {feature.label}
                  </p>
                  {feature.detail && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
                      {feature.detail}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Extra content */}
          {module.extraContent && (
            <div className="mt-3">{module.extraContent}</div>
          )}

          {/* File path */}
          <div className="mt-3 flex items-center gap-1.5 rounded-md bg-muted/50 px-2.5 py-1.5">
            <FolderOpen className="size-3 shrink-0 text-muted-foreground/60" />
            <code className="truncate text-[11px] text-muted-foreground">
              {module.filePath}
            </code>
          </div>

          {/* Stats row */}
          {module.stats && (
            <div className="mt-3 flex items-center gap-2">
              {module.stats.map((stat) => (
                <div
                  key={stat.label}
                  className="flex items-center gap-1 rounded-md bg-muted/40 px-2 py-1"
                >
                  <span className={`text-xs font-bold ${module.accentColor}`}>
                    {stat.value}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {stat.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Hero Section ────────────────────────────────────────────────
function HeroSection() {
  const heroStats = [
    { label: "Backend Modules", value: "15", icon: Layers },
    { label: "Total Code", value: "250+ KB", icon: Code2 },
    { label: "API Endpoints", value: "68+", icon: Globe },
    { label: "Frontend Pages", value: "19", icon: Smartphone },
  ];

  return (
    <motion.div variants={fadeUp} custom={0}>
      <Card className="relative overflow-hidden border-0 py-0 shadow-xl">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-600 via-teal-700 to-cyan-800 dark:from-emerald-800 dark:via-teal-900 dark:to-cyan-950" />

        {/* Decorative elements */}
        <div className="absolute -right-12 -top-12 size-64 rounded-full bg-white/5" />
        <div className="absolute -bottom-16 -left-8 size-48 rounded-full bg-white/5" />
        <div className="absolute right-1/4 bottom-0 size-32 rounded-full bg-white/3" />

        {/* Grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        <CardContent className="relative p-6 sm:p-8">
          <div className="flex flex-col gap-6">
            {/* Title section */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm">
                  <Server className="size-4 text-white" />
                </div>
                <span className="text-xs font-medium uppercase tracking-wider text-emerald-200/80">
                  FlexPay Platform
                </span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
                Backend Architecture
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-emerald-100/70 sm:text-base">
                Comprehensive overview of all backend modules powering the FlexPay
                digital wallet platform. From database schema to Docker deployment,
                every component is built for production reliability.
              </p>
            </div>

            {/* Hero stats */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {heroStats.map((stat, i) => (
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

// ── Stats Footer ────────────────────────────────────────────────
function StatsFooter() {
  const summaryStats = [
    { label: "Lines of Code", value: "~8,500+", icon: Code2 },
    { label: "Database Models", value: "26", icon: Database },
    { label: "API Endpoints", value: "68+", icon: Globe },
    { label: "Unit Tests", value: "26", icon: TestTube2 },
    { label: "Docker Services", value: "6", icon: Boxes },
    { label: "Frontend Pages", value: "19", icon: Smartphone },
    { label: "DB Indexes", value: "50+", icon: BarChart3 },
    { label: "Test Pass Rate", value: "100%", icon: CheckCircle2 },
  ];

  return (
    <motion.div variants={fadeUp} custom={8}>
      <Card className="border-emerald-200/60 bg-gradient-to-r from-emerald-50/60 via-white to-teal-50/60 py-0 dark:border-emerald-900/40 dark:from-emerald-950/20 dark:via-emerald-950/10 dark:to-teal-950/20">
        <CardContent className="p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="size-4 text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-sm font-bold text-foreground">
              Platform Summary
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {summaryStats.map((stat) => (
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
  );
}

// ── Main Component ──────────────────────────────────────────────
export function ArchitecturePage() {
  return (
    <motion.div
      className="flex flex-col gap-6"
      initial="hidden"
      animate="visible"
      variants={stagger}
    >
      {/* Hero Banner */}
      <HeroSection />

      {/* Module Grid */}
      <div>
        <motion.div variants={fadeUp} custom={1} className="mb-4">
          <div className="flex items-center gap-2">
            <Cpu className="size-5 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-lg font-bold text-foreground">Backend Modules</h2>
            <Badge
              variant="outline"
              className="border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              15 modules
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Each module is independently testable, containerized, and production-ready
          </p>
        </motion.div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {modules.map((module, i) => (
            <ModuleCard key={module.id} module={module} index={i + 2} />
          ))}
        </div>
      </div>

      {/* Tech Stack Divider */}
      <motion.div variants={fadeUp} custom={9}>
        <div className="relative flex items-center gap-4 py-2">
          <Separator className="flex-1" />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Zap className="size-3.5 text-emerald-500" />
            <span className="font-medium">Built with Modern Stack</span>
            <Zap className="size-3.5 text-emerald-500" />
          </div>
          <Separator className="flex-1" />
        </div>
      </motion.div>

      {/* Tech Stack Badges */}
      <motion.div variants={fadeUp} custom={10}>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {[
            { label: "Next.js 16", icon: Globe },
            { label: "TypeScript", icon: Code2 },
            { label: "Prisma ORM", icon: Database },
            { label: "SQLite", icon: HardDrive },
            { label: "Redis", icon: Cpu },
            { label: "Twilio", icon: Smartphone },
            { label: "Docker", icon: Box },
            { label: "NymCard", icon: CreditCard },
            { label: "Bull Queue", icon: Layers },
            { label: "JWT Auth", icon: Lock },
            { label: "Node.js 20", icon: Server },
            { label: "OpenAPI 3.1", icon: FileCode },
          ].map((tech) => (
            <div
              key={tech.label}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-emerald-200 hover:text-emerald-700 dark:hover:border-emerald-800 dark:hover:text-emerald-300"
            >
              <tech.icon className="size-3" />
              {tech.label}
            </div>
          ))}
        </div>
      </motion.div>

      {/* Stats Footer */}
      <StatsFooter />

      {/* Bottom note */}
      <motion.div variants={fadeIn} className="text-center">
        <p className="text-xs text-muted-foreground/60">
          FlexPay Backend Architecture &middot; Last updated June 2025
        </p>
      </motion.div>
    </motion.div>
  );
}
