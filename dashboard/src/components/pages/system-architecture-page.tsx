"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Smartphone,
  Monitor,
  Server,
  CreditCard,
  Database,
  Cpu,
  Lock,
  Activity,
  ArrowRight,
  ArrowDown,
  ArrowUpRight,
  ShieldCheck,
  Globe,
  Cloud,
  GitBranch,
  Container,
  Boxes,
  ChevronDown,
  ChevronRight,
  Zap,
  CheckCircle2,
  Circle,
  Clock,
  Gauge,
  HardDrive,
  Layers,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  Radio,
  Rocket,
  Bell,
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
  visible: { transition: { staggerChildren: 0.06 } },
};

const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.4 } },
};

// ── Types ────────────────────────────────────────────────────────
interface ServiceNode {
  id: string;
  name: string;
  type: "mobile" | "web" | "backend" | "external" | "database" | "cache" | "security" | "monitoring";
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  tech: string[];
  version?: string;
  status: "active" | "warning" | "error";
  metric?: { label: string; value: string };
}

interface ConnectionLink {
  from: string;
  to: string;
  protocol: string;
  latency?: string;
  label?: string;
}

interface TechCategory {
  category: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
  borderColor: string;
  items: string[];
}

// ── Data ────────────────────────────────────────────────────────
const services: ServiceNode[] = [
  {
    id: "employee-app",
    name: "React Native Employee App",
    type: "mobile",
    icon: Smartphone,
    description: "Native mobile app for blue-collar workers — wallet, cards, remittance, savings",
    tech: ["React Native 0.76", "TypeScript", "Expo SDK 52"],
    version: "v3.2.1",
    status: "active",
    metric: { label: "Active Users", value: "12,400+" },
  },
  {
    id: "admin-dashboard",
    name: "React Dashboard (Admin)",
    type: "web",
    icon: Monitor,
    description: "Company admin portal — payroll management, employee onboarding, compliance reports",
    tech: ["React 19", "Vite 6", "TailwindCSS 4", "shadcn/ui"],
    version: "v2.8.0",
    status: "active",
    metric: { label: "Companies", value: "340+" },
  },
  {
    id: "express-backend",
    name: "Express Backend",
    type: "backend",
    icon: Server,
    description: "Core API server — auth, wallet, payroll, cards, compliance, all business logic",
    tech: ["Node.js 22 LTS", "Express 5", "TypeScript 5.7", "Prisma ORM"],
    version: "v2.5.3",
    status: "active",
    metric: { label: "Endpoints", value: "68+" },
  },
  {
    id: "nymcard-baas",
    name: "NymCard BaaS",
    type: "external",
    icon: CreditCard,
    description: "Card issuing platform — virtual & physical Visa cards, Apple/Google/Samsung Pay tokenization",
    tech: ["NymCard API v3.2", "Visa Network"],
    status: "warning",
    metric: { label: "SLA", value: "99.90%" },
  },
  {
    id: "postgres-db",
    name: "PostgreSQL 16",
    type: "database",
    icon: Database,
    description: "Primary relational DB — users, wallets, payroll, compliance, 26 tables, Multi-AZ",
    tech: ["RDS Multi-AZ", "100GB gp3", "Automated Backups"],
    status: "active",
    metric: { label: "Tables", value: "26" },
  },
  {
    id: "redis-cache",
    name: "Redis 7.2 Cache",
    type: "cache",
    icon: Cpu,
    description: "In-memory cache — sessions, rate limiting, OTP storage, feature flags",
    tech: ["ElastiCache Cluster", "3 Nodes", "6GB Total"],
    status: "active",
    metric: { label: "Memory", value: "6GB" },
  },
  {
    id: "aws-kms",
    name: "AWS KMS / S3",
    type: "security",
    icon: Lock,
    description: "Envelope encryption (KMS) for PII + document storage (S3) for KYC & compliance",
    tech: ["AES-256", "S3 Standard", "me-south-1"],
    status: "active",
    metric: { label: "Keys", value: "12" },
  },
  {
    id: "prometheus",
    name: "Prometheus / Grafana",
    type: "monitoring",
    icon: Activity,
    description: "Full observability — metrics, dashboards, alerting, SLO tracking, 6-month retention",
    tech: ["Prometheus 2.54", "Grafana 11", "Thanos 0.36"],
    status: "active",
    metric: { label: "Dashboards", value: "12" },
  },
];

const connections: ConnectionLink[] = [
  { from: "employee-app", to: "express-backend", protocol: "HTTPS/REST", latency: "45ms", label: "API Calls" },
  { from: "admin-dashboard", to: "express-backend", protocol: "HTTPS/REST", latency: "38ms", label: "Admin API" },
  { from: "express-backend", to: "postgres-db", protocol: "TCP/5432", latency: "2ms", label: "Queries" },
  { from: "express-backend", to: "redis-cache", protocol: "TCP/6379", latency: "<1ms", label: "Cache R/W" },
  { from: "express-backend", to: "nymcard-baas", protocol: "HTTPS/REST", latency: "120ms", label: "Card Ops" },
  { from: "express-backend", to: "aws-kms", protocol: "AWS SDK", latency: "15ms", label: "Encrypt/Decrypt" },
  { from: "express-backend", to: "prometheus", protocol: "/metrics", label: "Scrape" },
];

const techCategories: TechCategory[] = [
  {
    category: "Frontend",
    icon: Monitor,
    color: "text-violet-600 dark:text-violet-400",
    bgColor: "bg-violet-50 dark:bg-violet-950/30",
    borderColor: "border-violet-200 dark:border-violet-800/50",
    items: ["React Native 0.76", "React 19", "Vite 6", "TailwindCSS 4", "shadcn/ui", "Framer Motion"],
  },
  {
    category: "Backend",
    icon: Server,
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-50 dark:bg-emerald-950/30",
    borderColor: "border-emerald-200 dark:border-emerald-800/50",
    items: ["Node.js 22 LTS", "Express 5", "TypeScript 5.7", "Prisma ORM", "BullMQ"],
  },
  {
    category: "Database",
    icon: Database,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-50 dark:bg-amber-950/30",
    borderColor: "border-amber-200 dark:border-amber-800/50",
    items: ["PostgreSQL 16", "Redis 7.2", "Prisma Migrate", "RDS Multi-AZ"],
  },
  {
    category: "DevOps",
    icon: GitBranch,
    color: "text-sky-600 dark:text-sky-400",
    bgColor: "bg-sky-50 dark:bg-sky-950/30",
    borderColor: "border-sky-200 dark:border-sky-800/50",
    items: ["Docker", "Kubernetes (EKS)", "Helm 3", "GitHub Actions", "ArgoCD"],
  },
  {
    category: "Cloud (AWS)",
    icon: Cloud,
    color: "text-orange-600 dark:text-orange-400",
    bgColor: "bg-orange-50 dark:bg-orange-950/30",
    borderColor: "border-orange-200 dark:border-orange-800/50",
    items: ["me-south-1", "RDS", "ElastiCache", "KMS", "S3", "EKS", "ALB"],
  },
  {
    category: "Monitoring",
    icon: Activity,
    color: "text-cyan-600 dark:text-cyan-400",
    bgColor: "bg-cyan-50 dark:bg-cyan-950/30",
    borderColor: "border-cyan-200 dark:border-cyan-800/50",
    items: ["Prometheus", "Grafana", "Alertmanager", "Thanos", "Trivy"],
  },
  {
    category: "Security",
    icon: ShieldCheck,
    color: "text-rose-600 dark:text-rose-400",
    bgColor: "bg-rose-50 dark:bg-rose-950/30",
    borderColor: "border-rose-200 dark:border-rose-800/50",
    items: ["KMS AES-256", "PBKDF2", "JWT", "mTLS", "SOC 2 Type II"],
  },
  {
    category: "Compliance",
    icon: Globe,
    color: "text-teal-600 dark:text-teal-400",
    bgColor: "bg-teal-50 dark:bg-teal-950/30",
    borderColor: "border-teal-200 dark:border-teal-800/50",
    items: ["CBUAE WPS", "UAE PDPL", "ISO 27001", "NESA IAS"],
  },
];

// ── Color helpers ────────────────────────────────────────────────
function getTypeColor(type: ServiceNode["type"]) {
  const map: Record<ServiceNode["type"], { bg: string; border: string; icon: string; glow: string; label: string }> = {
    mobile: { bg: "bg-violet-50 dark:bg-violet-950/40", border: "border-violet-200 dark:border-violet-800/50", icon: "text-violet-600 dark:text-violet-400", glow: "shadow-violet-200/50 dark:shadow-violet-900/30", label: "Mobile" },
    web: { bg: "bg-sky-50 dark:bg-sky-950/40", border: "border-sky-200 dark:border-sky-800/50", icon: "text-sky-600 dark:text-sky-400", glow: "shadow-sky-200/50 dark:shadow-sky-900/30", label: "Web App" },
    backend: { bg: "bg-emerald-50 dark:bg-emerald-950/40", border: "border-emerald-200 dark:border-emerald-800/50", icon: "text-emerald-600 dark:text-emerald-400", glow: "shadow-emerald-200/50 dark:shadow-emerald-900/30", label: "Backend" },
    external: { bg: "bg-amber-50 dark:bg-amber-950/40", border: "border-amber-200 dark:border-amber-800/50", icon: "text-amber-600 dark:text-amber-400", glow: "shadow-amber-200/50 dark:shadow-amber-900/30", label: "External" },
    database: { bg: "bg-orange-50 dark:bg-orange-950/40", border: "border-orange-200 dark:border-orange-800/50", icon: "text-orange-600 dark:text-orange-400", glow: "shadow-orange-200/50 dark:shadow-orange-900/30", label: "Database" },
    cache: { bg: "bg-rose-50 dark:bg-rose-950/40", border: "border-rose-200 dark:border-rose-800/50", icon: "text-rose-600 dark:text-rose-400", glow: "shadow-rose-200/50 dark:shadow-rose-900/30", label: "Cache" },
    security: { bg: "bg-rose-50 dark:bg-rose-950/40", border: "border-rose-200 dark:border-rose-800/50", icon: "text-rose-600 dark:text-rose-400", glow: "shadow-rose-200/50 dark:shadow-rose-900/30", label: "Security" },
    monitoring: { bg: "bg-cyan-50 dark:bg-cyan-950/40", border: "border-cyan-200 dark:border-cyan-800/50", icon: "text-cyan-600 dark:text-cyan-400", glow: "shadow-cyan-200/50 dark:shadow-cyan-900/30", label: "Monitoring" },
  };
  return map[type];
}

// ── Hero Section ────────────────────────────────────────────────
function HeroBanner() {
  const heroStats = [
    { label: "Services", value: "8", icon: Layers },
    { label: "Region", value: "me-south-1", icon: Globe },
    { label: "Uptime 30d", value: "99.97%", icon: Gauge },
    { label: "Connections", value: "7", icon: RefreshCw },
  ];

  return (
    <motion.div variants={fadeUp} custom={0}>
      <Card className="relative overflow-hidden border-0 py-0 shadow-xl">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-600 via-teal-700 to-cyan-800 dark:from-emerald-800 dark:via-teal-900 dark:to-cyan-950" />
        <div className="absolute -right-16 -top-16 size-72 rounded-full bg-white/5" />
        <div className="absolute -bottom-20 -left-10 size-56 rounded-full bg-white/5" />
        <div className="absolute right-1/3 top-1/4 size-32 rounded-full bg-white/[0.03]" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        <CardContent className="relative p-6 sm:p-8">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm">
                  <Container className="size-4 text-white" />
                </div>
                <span className="text-xs font-medium uppercase tracking-wider text-emerald-200/80">
                  System Architecture
                </span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
                FlexPay Platform Architecture
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-emerald-100/70 sm:text-base">
                Complete production architecture for the FlexPay digital wallet platform.
                React Native mobile, Express backend, PostgreSQL, Redis, and full observability
                — all deployed on AWS me-south-1 with UAE data residency compliance.
              </p>
            </div>

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
                    <p className="text-lg font-bold leading-none text-white">{stat.value}</p>
                    <p className="text-[10px] font-medium text-emerald-200/70">{stat.label}</p>
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

// ── Interactive Architecture Diagram ────────────────────────────
function ServiceCard({ service, isSelected, onClick }: { service: ServiceNode; isSelected: boolean; onClick: () => void }) {
  const colors = getTypeColor(service.type);

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -3, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={`relative w-full text-left rounded-2xl border-2 transition-all duration-300 ${colors.border} ${
        isSelected ? `${colors.bg} shadow-lg ${colors.glow}` : "bg-card"
      }`}
    >
      <div className="p-4 sm:p-5">
        {/* Status indicator */}
        <div className="absolute -top-1.5 -right-1.5">
          <div className={`flex items-center justify-center rounded-full p-0.5 ${
            service.status === "active" ? "bg-emerald-500" : "bg-amber-500"
          }`}>
            <div className="size-1.5 rounded-full bg-white" />
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className={`flex size-11 items-center justify-center rounded-xl ${colors.bg} shrink-0`}>
            <service.icon className={`size-5 ${colors.icon}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-foreground">{service.name}</h3>
            </div>
            <Badge
              className={`mt-1 border-0 text-[10px] font-medium ${colors.bg} ${colors.icon}`}
            >
              {colors.label}
            </Badge>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed line-clamp-2">
              {service.description}
            </p>

            {/* Metric */}
            {service.metric && (
              <div className="mt-3 flex items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1">
                  <Gauge className="size-3 text-muted-foreground/60" />
                  <span className="text-[11px] font-bold text-foreground">{service.metric.value}</span>
                  <span className="text-[10px] text-muted-foreground">{service.metric.label}</span>
                </div>
                {service.version && (
                  <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1">
                    <Radio className="size-3 text-muted-foreground/60" />
                    <span className="text-[11px] font-medium text-muted-foreground">{service.version}</span>
                  </div>
                )}
              </div>
            )}

            {/* Tech tags */}
            <div className="mt-3 flex flex-wrap gap-1">
              {service.tech.slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >
                  {t}
                </span>
              ))}
              {service.tech.length > 3 && (
                <span className="rounded-md bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  +{service.tech.length - 3}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.button>
  );
}

function ConnectionBadge({ conn, direction }: { conn: ConnectionLink; direction: "down" | "right" }) {
  const ArrowIcon = direction === "down" ? ArrowDown : ArrowRight;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-1.5 px-2 py-1"
    >
      <div className="flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5">
        <ArrowIcon className="size-3 text-emerald-500" />
        <span className="text-[10px] font-medium text-muted-foreground">{conn.protocol}</span>
        {conn.latency && (
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">{conn.latency}</span>
        )}
      </div>
    </motion.div>
  );
}

function ArchitectureDiagram() {
  const [selected, setSelected] = useState<string | null>("express-backend");

  const selectedService = services.find((s) => s.id === selected);
  const selectedConnections = connections.filter(
    (c) => c.from === selected || c.to === selected
  );

  // Layout: Row 1 (mobile + web), Row 2 (backend), Row 3 (DB + Cache + External + KMS + Monitoring)
  const row1 = services.filter((s) => s.type === "mobile" || s.type === "web");
  const row2 = services.filter((s) => s.type === "backend");
  const row3 = services.filter(
    (s) => s.type === "database" || s.type === "cache" || s.type === "external" || s.type === "security" || s.type === "monitoring"
  );

  return (
    <motion.div variants={fadeUp} custom={2}>
      <Card className="border-slate-100 dark:border-slate-800/60 overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
                <Boxes className="size-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <CardTitle className="text-base">Service Architecture</CardTitle>
                <CardDescription>Interactive service topology — click any node to inspect</CardDescription>
              </div>
            </div>
            <Badge className="border-0 bg-emerald-50 text-emerald-700 text-[11px] dark:bg-emerald-950/40 dark:text-emerald-400">
              <CheckCircle2 className="size-3 mr-1" />
              8 Services
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {/* Architecture Visualization */}
          <div className="flex flex-col items-center gap-3">
            {/* Row 1: Client Apps */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-3xl">
              {row1.map((s) => (
                <ServiceCard key={s.id} service={s} isSelected={selected === s.id} onClick={() => setSelected(s.id)} />
              ))}
            </div>

            {/* Connection arrows Row 1 → Row 2 */}
            <div className="flex flex-col items-center gap-1 py-1">
              <div className="h-4 w-px bg-emerald-300 dark:bg-emerald-700" />
              <div className="flex items-center gap-2">
                {row1.map((s) => {
                  const conn = connections.find((c) => c.from === s.id && c.to === "express-backend");
                  return conn ? <ConnectionBadge key={s.id} conn={conn} direction="down" /> : null;
                })}
              </div>
              <div className="h-4 w-px bg-emerald-300 dark:bg-emerald-700" />
            </div>

            {/* Row 2: Express Backend (center, highlighted) */}
            <div className="w-full max-w-3xl">
              <ServiceCard service={row2[0]} isSelected={selected === row2[0].id} onClick={() => setSelected(row2[0].id)} />
            </div>

            {/* Connection arrows Row 2 → Row 3 */}
            <div className="flex flex-col items-center gap-1 py-1">
              <div className="h-4 w-px bg-emerald-300 dark:bg-emerald-700" />
              <div className="flex flex-wrap items-center justify-center gap-1.5 px-4">
                {row2.flatMap((s) =>
                  connections
                    .filter((c) => c.from === s.id && row3.some((r) => r.id === c.to))
                    .map((c) => <ConnectionBadge key={c.to} conn={c} direction="down" />)
                )}
              </div>
              <div className="h-4 w-px bg-emerald-300 dark:bg-emerald-700" />
            </div>

            {/* Row 3: Datastores + External + Security + Monitoring */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full max-w-4xl">
              {row3.map((s) => (
                <ServiceCard key={s.id} service={s} isSelected={selected === s.id} onClick={() => setSelected(s.id)} />
              ))}
            </div>
          </div>

          {/* Selected service detail panel */}
          <AnimatePresence mode="wait">
            {selectedService && (
              <motion.div
                key={selectedService.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="mt-4 overflow-hidden"
              >
                <div className="rounded-xl border border-border bg-muted/20 p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`flex size-8 items-center justify-center rounded-lg ${getTypeColor(selectedService.type).bg}`}>
                        <selectedService.icon className={`size-4 ${getTypeColor(selectedService.type).icon}`} />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-foreground">{selectedService.name}</h4>
                        <p className="text-[11px] text-muted-foreground">{selectedService.description}</p>
                      </div>
                    </div>
                    <Badge className={`border-0 text-[10px] font-medium ${getTypeColor(selectedService.type).bg} ${getTypeColor(selectedService.type).icon}`}>
                      {getTypeColor(selectedService.type).label}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-lg bg-background border p-2.5">
                      <p className="text-[10px] text-muted-foreground">Status</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <Circle className={`size-2 fill-current ${selectedService.status === "active" ? "text-emerald-500" : "text-amber-500"}`} />
                        <span className="text-xs font-semibold capitalize text-foreground">{selectedService.status}</span>
                      </div>
                    </div>
                    {selectedService.version && (
                      <div className="rounded-lg bg-background border p-2.5">
                        <p className="text-[10px] text-muted-foreground">Version</p>
                        <p className="mt-1 text-xs font-semibold text-foreground">{selectedService.version}</p>
                      </div>
                    )}
                    {selectedService.metric && (
                      <div className="rounded-lg bg-background border p-2.5">
                        <p className="text-[10px] text-muted-foreground">{selectedService.metric.label}</p>
                        <p className="mt-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">{selectedService.metric.value}</p>
                      </div>
                    )}
                    <div className="rounded-lg bg-background border p-2.5">
                      <p className="text-[10px] text-muted-foreground">Connections</p>
                      <p className="mt-1 text-xs font-semibold text-foreground">{selectedConnections.length}</p>
                    </div>
                  </div>

                  {/* Connection details */}
                  {selectedConnections.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[11px] font-semibold text-muted-foreground mb-2">Active Connections</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedConnections.map((c) => (
                          <div key={`${c.from}-${c.to}`} className="flex items-center gap-1.5 rounded-lg border bg-background px-2 py-1.5">
                            <ArrowRight className="size-3 text-emerald-500" />
                            <span className="text-[10px] text-muted-foreground">
                              {selected === c.from ? c.to : c.from}
                            </span>
                            <span className="text-[10px] font-medium text-foreground">{c.protocol}</span>
                            {c.latency && (
                              <span className="text-[10px] text-emerald-600 dark:text-emerald-400">{c.latency}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Full tech stack */}
                  <div className="mt-3">
                    <p className="text-[11px] font-semibold text-muted-foreground mb-2">Technology Stack</p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedService.tech.map((t) => (
                        <span key={t} className="rounded-md bg-background border px-2 py-0.5 text-[10px] font-medium text-foreground">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Deployment Pipeline Section ──────────────────────────────────
function DeploymentSection() {
  const stages = [
    { label: "Code Push", icon: GitBranch, detail: "Feature branch → PR", color: "text-sky-600 dark:text-sky-400", bg: "bg-sky-50 dark:bg-sky-950/40", border: "border-sky-200 dark:border-sky-800/50" },
    { label: "CI Checks", icon: ShieldCheck, detail: "Lint + Test + Trivy", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40", border: "border-emerald-200 dark:border-emerald-800/50" },
    { label: "Build Image", icon: Container, detail: "Docker → ghcr.io", color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-950/40", border: "border-violet-200 dark:border-violet-800/50" },
    { label: "Deploy Staging", icon: Cloud, detail: "ArgoCD → Helm", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/40", border: "border-amber-200 dark:border-amber-800/50" },
    { label: "Manual Approval", icon: ExternalLink, detail: "Team lead sign-off", color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-50 dark:bg-rose-950/40", border: "border-rose-200 dark:border-rose-800/50" },
    { label: "Blue-Green Prod", icon: Zap, detail: "Zero-downtime switch", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40", border: "border-emerald-200 dark:border-emerald-800/50" },
  ];

  return (
    <motion.div variants={fadeUp} custom={4}>
      <Card className="border-slate-100 dark:border-slate-800/60">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-sky-50 dark:bg-sky-950/40">
              <GitBranch className="size-4 text-sky-600 dark:text-sky-400" />
            </div>
            <div>
              <CardTitle className="text-base">CI/CD Deployment Pipeline</CardTitle>
              <CardDescription>GitHub Actions → ArgoCD → Helm → Blue-Green on EKS</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {/* Pipeline visual */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-0 overflow-x-auto pb-2">
            {stages.map((stage, i) => (
              <div key={stage.label} className="flex items-center gap-2 sm:gap-0 shrink-0">
                <div className={`flex items-center gap-3 rounded-xl border ${stage.border} ${stage.bg} px-4 py-3 transition-all hover:shadow-md`}>
                  <stage.icon className={`size-4 ${stage.color}`} />
                  <div>
                    <p className="text-xs font-bold text-foreground">{stage.label}</p>
                    <p className="text-[10px] text-muted-foreground">{stage.detail}</p>
                  </div>
                </div>
                {i < stages.length - 1 && (
                  <ArrowRight className="size-4 text-muted-foreground/40 mx-1 hidden sm:block shrink-0" />
                )}
              </div>
            ))}
          </div>

          {/* Deployment stats */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Strategy", value: "Blue-Green", icon: RefreshCw },
              { label: "Rollback", value: "< 30 sec", icon: Clock },
              { label: "Deploys/Q", value: "47", icon: Rocket },
              { label: "Lead Time", value: "2.1 hrs", icon: Gauge },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/20 p-3">
                <s.icon className="size-4 text-muted-foreground/70" />
                <div>
                  <p className="text-xs font-bold text-foreground">{s.value}</p>
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Environment matrix */}
          <div className="mt-4 rounded-lg border border-border p-4">
            <p className="text-xs font-semibold text-foreground mb-3">Environments</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                { env: "Staging", url: "staging-api.flexpay.ae", k8s: "staging-cluster", replicas: "2 pods", status: "auto-deploy on merge to main" },
                { env: "Production", url: "api.flexpay.ae", k8s: "prod-cluster", replicas: "3 pods", status: "manual approval + blue-green" },
              ].map((e) => (
                <div key={e.env} className="flex flex-col gap-1.5 rounded-lg bg-background border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground">{e.env}</span>
                    <Badge className={`border-0 text-[10px] font-medium ${e.env === "Production" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400"}`}>
                      {e.status.split(" ").slice(0, 2).join(" ")}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                    <span>{e.url}</span>
                    <span>{e.k8s}</span>
                    <span>{e.replicas}</span>
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

// ── Tech Stack Grid ─────────────────────────────────────────────
function TechStackGrid() {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <motion.div variants={fadeUp} custom={5}>
      <Card className="border-slate-100 dark:border-slate-800/60">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-slate-50 dark:bg-slate-800/60">
              <HardDrive className="size-4 text-slate-600 dark:text-slate-400" />
            </div>
            <div>
              <CardTitle className="text-base">Complete Technology Stack</CardTitle>
              <CardDescription>All technologies powering the FlexPay platform across 8 categories</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {techCategories.map((cat) => (
              <motion.button
                key={cat.category}
                onClick={() => setExpanded(expanded === cat.category ? null : cat.category)}
                whileHover={{ y: -2 }}
                className={`text-left rounded-xl border ${cat.borderColor} ${cat.bgColor} p-4 transition-all hover:shadow-md ${
                  expanded === cat.category ? "ring-2 ring-offset-1 ring-emerald-500/50" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <cat.icon className={`size-4 ${cat.color}`} />
                    <h4 className={`text-sm font-bold ${cat.color}`}>{cat.category}</h4>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge className={`border-0 text-[10px] font-medium ${cat.bgColor} ${cat.color}`}>
                      {cat.items.length}
                    </Badge>
                    {expanded === cat.category ? (
                      <ChevronDown className="size-3 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-3 text-muted-foreground" />
                    )}
                  </div>
                </div>
                <AnimatePresence>
                  {expanded === cat.category ? (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {cat.items.map((item) => (
                          <span
                            key={item}
                            className="rounded-md border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-foreground"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </motion.div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {cat.items.slice(0, 3).map((item) => (
                        <span
                          key={item}
                          className="rounded-md bg-background/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {item}
                        </span>
                      ))}
                      {cat.items.length > 3 && (
                        <span className="text-[10px] text-muted-foreground">+{cat.items.length - 3}</span>
                      )}
                    </div>
                  )}
                </AnimatePresence>
              </motion.button>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Data Flow & Integration Map ─────────────────────────────────
function DataFlowSection() {
  const flows = [
    {
      title: "Payroll Disbursement",
      steps: ["WPS Payroll File", "→ Express Backend", "→ Balance Credit", "→ Push Notification"],
      icon: ArrowUpRight,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
    },
    {
      title: "Card Transaction Flow",
      steps: ["NymCard API", "→ Webhook", "→ Express Backend", "→ Balance Deduct", "→ Notification"],
      icon: CreditCard,
      color: "text-violet-600 dark:text-violet-400",
      bg: "bg-violet-50 dark:bg-violet-950/30",
    },
    {
      title: "KYC Verification",
      steps: ["Doc Upload → S3", "→ KMS Decrypt", "→ Express Backend", "→ KYC Provider", "→ Status Update"],
      icon: ShieldCheck,
      color: "text-sky-600 dark:text-sky-400",
      bg: "bg-sky-50 dark:bg-sky-950/30",
    },
    {
      title: "Remittance Transfer",
      steps: ["User Request", "→ Balance Lock", "→ FX Rate API", "→ Partner API", "→ Confirmation"],
      icon: Globe,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-950/30",
    },
  ];

  return (
    <motion.div variants={fadeUp} custom={6}>
      <Card className="border-slate-100 dark:border-slate-800/60">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/40">
              <RefreshCw className="size-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <CardTitle className="text-base">Key Data Flows</CardTitle>
              <CardDescription>Critical transaction flows through the platform architecture</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {flows.map((flow) => (
              <div key={flow.title} className={`rounded-xl border border-border ${flow.bg} p-4`}>
                <div className="flex items-center gap-2 mb-3">
                  <flow.icon className={`size-4 ${flow.color}`} />
                  <h4 className="text-sm font-bold text-foreground">{flow.title}</h4>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {flow.steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium text-foreground">
                        {step.replace("→ ", "")}
                      </span>
                      {i < flow.steps.length - 1 && step.includes("→") && (
                        <span className="text-[10px] text-muted-foreground">{step.split(" →")[0]} →</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Security & Compliance Summary ────────────────────────────────
function SecurityComplianceSection() {
  return (
    <motion.div variants={fadeUp} custom={7}>
      <Card className="relative overflow-hidden border-0 py-0 shadow-lg">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-900 to-zinc-950 dark:from-slate-900 dark:via-zinc-950 dark:to-black" />
        <div className="absolute -right-12 -top-12 size-56 rounded-full bg-white/[0.03]" />
        <div className="absolute -bottom-12 -left-8 size-40 rounded-full bg-emerald-400/[0.05]" />

        <CardContent className="relative p-6 sm:p-8">
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm">
                <ShieldCheck className="size-4 text-emerald-300" />
              </div>
              <h2 className="text-lg font-bold text-white">Security & Compliance</h2>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Data Residency", value: "UAE Only", icon: Globe },
                { label: "Encryption", value: "AES-256", icon: Lock },
                { label: "Auth", value: "JWT + mTLS", icon: ShieldCheck },
                { label: "Audit", value: "SOC 2 II", icon: Activity },
              ].map((s) => (
                <div key={s.label} className="flex items-center gap-2.5 rounded-xl bg-white/[0.07] p-3 border border-white/[0.06]">
                  <s.icon className="size-4 text-emerald-300/80" />
                  <div>
                    <p className="text-sm font-bold text-white">{s.value}</p>
                    <p className="text-[10px] text-slate-300/60">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "CBUAE WPS", status: "Compliant" },
                { label: "UAE PDPL", status: "Compliant" },
                { label: "ISO 27001", status: "Compliant" },
                { label: "NESA IAS", status: "Compliant" },
              ].map((c) => (
                <div key={c.label} className="flex items-center gap-2 rounded-lg bg-white/[0.05] px-3 py-2 border border-white/[0.06]">
                  <CheckCircle2 className="size-3 text-emerald-400" />
                  <span className="text-[11px] font-medium text-slate-200">{c.label}</span>
                </div>
              ))}
            </div>

            <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3">
              <AlertTriangle className="size-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-emerald-300">NymCard Circuit Breaker (Watch)</p>
                <p className="text-[11px] text-slate-300/60 mt-0.5">
                  Card service error budget at 31% — entering Watch state. Circuit breaker + fallback cache planned for Q3 2025.
                  Timeout: 3s, retry: 2x, cache TTL: 5min.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Connection Table ─────────────────────────────────────────────
function ConnectionTable() {
  return (
    <motion.div variants={fadeUp} custom={8}>
      <Card className="border-slate-100 dark:border-slate-800/60">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-slate-50 dark:bg-slate-800/60">
              <RefreshCw className="size-4 text-slate-600 dark:text-slate-400" />
            </div>
            <div>
              <CardTitle className="text-base">Service Connections</CardTitle>
              <CardDescription>All inter-service communication channels with protocol and latency</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Source</th>
                  <th className="px-2 py-3 text-xs text-muted-foreground" />
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Target</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Protocol</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Latency</th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Purpose</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((c) => {
                  const src = services.find((s) => s.id === c.from);
                  const tgt = services.find((s) => s.id === c.to);
                  if (!src || !tgt) return null;
                  return (
                    <tr key={`${c.from}-${c.to}`} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <src.icon className={`size-3.5 ${getTypeColor(src.type).icon}`} />
                          <span className="text-xs font-medium text-foreground">{src.name.split(" (")[0].split(" ")[0]}</span>
                        </div>
                      </td>
                      <td className="px-2"><ArrowRight className="size-3.5 text-emerald-500" /></td>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <tgt.icon className={`size-3.5 ${getTypeColor(tgt.type).icon}`} />
                          <span className="text-xs font-medium text-foreground">{tgt.name.split(" (")[0].split(" ")[0]}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3"><Badge className="border-0 bg-muted/50 text-[10px] text-muted-foreground">{c.protocol}</Badge></td>
                      <td className="px-4 py-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300">{c.latency ?? "N/A"}</td>
                      <td className="px-6 py-3 text-xs text-muted-foreground">{c.label ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Footer ──────────────────────────────────────────────────────
function FooterSection() {
  return (
    <motion.div variants={fadeUp} custom={9}>
      <Card className="border-emerald-200/60 bg-gradient-to-r from-emerald-50/60 via-white to-teal-50/60 py-0 dark:border-emerald-900/40 dark:from-emerald-950/20 dark:via-emerald-950/10 dark:to-teal-950/20">
        <CardContent className="p-4 sm:p-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {[
              { label: "Services", value: "8", icon: Layers },
              { label: "Endpoints", value: "68+", icon: Globe },
              { label: "DB Tables", value: "26", icon: Database },
              { label: "Dashboards", value: "12", icon: Activity },
              { label: "Alerts", value: "847", icon: Bell },
              { label: "Tech Stack", value: "40+", icon: HardDrive },
              { label: "Compliance", value: "100%", icon: ShieldCheck },
              { label: "Uptime", value: "99.97%", icon: Gauge },
            ].map((s) => (
              <div key={s.label} className="flex flex-col items-center gap-1 rounded-lg border border-emerald-100 bg-white/60 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/10">
                <s.icon className="size-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{s.value}</span>
                <span className="text-[10px] text-muted-foreground text-center">{s.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Main Component ──────────────────────────────────────────────
export function SystemArchitecturePage() {
  return (
    <motion.div
      className="flex flex-col gap-6"
      initial="hidden"
      animate="visible"
      variants={stagger}
    >
      <HeroBanner />
      <ArchitectureDiagram />
      <DataFlowSection />
      <DeploymentSection />
      <TechStackGrid />
      <ConnectionTable />
      <SecurityComplianceSection />
      <FooterSection />

      <motion.div variants={fadeIn} className="text-center pb-4">
        <p className="text-xs text-muted-foreground/60">
          FlexPay System Architecture &middot; Last updated June 2025
        </p>
      </motion.div>
    </motion.div>
  );
}
