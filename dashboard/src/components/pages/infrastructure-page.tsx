"use client";

import { motion } from "framer-motion";
import {
  Cloud,
  Globe,
  Server,
  Database,
  ShieldCheck,
  Lock,
  KeyRound,
  Network,
  Cpu,
  Box,
  HardDrive,
  CircleDot,
  ArrowRight,
  Layers,
  Shield,
  Scale,
  ShieldAlert,
  Table2,
  MonitorDot,
  ShieldHalf,
  BadgeCheck,
  FolderTree,
  Gauge,
  LockKeyhole,
  Route,
  Workflow,
  Archive,
  Eye,
  Zap,
  ChevronRight,
  CheckCircle2,
  Circle,
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

// ── Data ────────────────────────────────────────────────────────

interface AWSService {
  name: string;
  version: string;
  details: string[];
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  status: string;
}

const awsServices: AWSService[] = [
  {
    name: "RDS PostgreSQL",
    version: "v16",
    details: ["Multi-AZ deployment", "100 GB gp3 storage", "Automated daily backups", "14-day retention"],
    icon: Database,
    color: "emerald",
    status: "Healthy",
  },
  {
    name: "ElastiCache Redis",
    version: "v7",
    details: ["3-node cluster mode", "2 GB per node", "Automatic failover", "Multi-AZ replication"],
    icon: Gauge,
    color: "teal",
    status: "Healthy",
  },
  {
    name: "S3 Storage",
    version: "Standard",
    details: ["AES-256 encryption", "Versioning enabled", "Lifecycle policies", "Document & media bucket"],
    icon: Archive,
    color: "amber",
    status: "Healthy",
  },
  {
    name: "KMS Encryption",
    version: "AES-256",
    details: ["Envelope encryption", "PII & card data", "Auto-rotation (365 days)", "Customer-managed keys"],
    icon: KeyRound,
    color: "rose",
    status: "Active",
  },
  {
    name: "Application LB",
    version: "ALB",
    details: ["SSL termination", "WAF integration", "Health checks", "Path-based routing"],
    icon: Route,
    color: "violet",
    status: "Healthy",
  },
  {
    name: "CloudWatch",
    version: "v2",
    details: ["Logs & metrics", "Alarms & dashboards", "30-day log retention", "Custom namespaces"],
    icon: Eye,
    color: "slate",
    status: "Active",
  },
];

interface SecurityControl {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  items: string[];
  color: string;
}

const securityControls: SecurityControl[] = [
  {
    title: "Data Encryption",
    icon: Lock,
    description: "End-to-end encryption for all sensitive data",
    items: ["At-rest: AES-256 (KMS-managed)", "In-transit: TLS 1.3 minimum", "Envelope encryption for PII", "Certificate auto-renewal"],
    color: "emerald",
  },
  {
    title: "Network Security",
    icon: ShieldHalf,
    description: "Isolated network topology with defense in depth",
    items: ["Custom VPC (10.0.0.0/16)", "Private subnets only", "Security groups & NACLs", "VPC endpoints (AWS services)"],
    color: "teal",
  },
  {
    title: "Access Control",
    icon: KeyRound,
    description: "Least-privilege identity and access management",
    items: ["IAM roles per service", "Least-privilege policies", "MFA enforced (all users)", "SSO integration"],
    color: "amber",
  },
  {
    title: "Compliance",
    icon: Scale,
    description: "UAE regulatory compliance standards",
    items: ["CBUAE regulations", "PDPL data protection", "ISO 27001 certified", "NESA IAS compliant"],
    color: "rose",
  },
];

interface Environment {
  name: string;
  region: string;
  nodes: string;
  ha: string;
  pods: string;
  status: "Active" | "Ready" | "Local";
  statusColor: string;
}

const environments: Environment[] = [
  {
    name: "Production",
    region: "me-south-1",
    nodes: "3 nodes",
    ha: "Multi-AZ",
    pods: "12 pods",
    status: "Active",
    statusColor: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-0",
  },
  {
    name: "Staging",
    region: "me-south-1",
    nodes: "2 nodes",
    ha: "Single-AZ",
    pods: "6 pods",
    status: "Ready",
    statusColor: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-0",
  },
  {
    name: "Development",
    region: "Local (Docker)",
    nodes: "1 node",
    ha: "N/A",
    pods: "3 pods",
    status: "Local",
    statusColor: "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400 border-0",
  },
];

// ── Sub-components ──────────────────────────────────────────────

function HeroBanner() {
  const stats = [
    { label: "Region", value: "me-south-1", icon: Globe, sub: "UAE" },
    { label: "Availability Zones", value: "2", icon: CircleDot, sub: "Active" },
    { label: "Environment", value: "Production", icon: Server, sub: "Live" },
    { label: "Data Residency", value: "Compliant", icon: ShieldCheck, sub: "CBUAE" },
  ];

  return (
    <motion.div variants={fadeUp} custom={0}>
      <Card className="relative overflow-hidden border-0 py-0 shadow-xl">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-700 via-teal-800 to-slate-900 dark:from-emerald-900 dark:via-teal-950 dark:to-slate-950" />

        {/* Decorative elements */}
        <div className="absolute -right-16 -top-16 size-72 rounded-full bg-white/[0.03]" />
        <div className="absolute -bottom-20 -left-10 size-56 rounded-full bg-white/[0.03]" />
        <div className="absolute right-1/4 top-1/3 size-20 rounded-full bg-emerald-400/[0.06]" />
        <div className="absolute left-1/3 top-1/2 size-14 rounded-full bg-teal-400/[0.05]" />

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
                  <Cloud className="size-4 text-white" />
                </div>
                <span className="text-xs font-medium uppercase tracking-wider text-emerald-200/80">
                  Infrastructure
                </span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
                Cloud Infrastructure
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-emerald-100/70 sm:text-base">
                FlexPay&apos;s production infrastructure hosted on AWS me-south-1 (Bahrain), ensuring
                full UAE data residency compliance. Built for high availability with Multi-AZ
                deployments, automated failover, and 99.99% uptime SLA.
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

function ArchitectureDiagram() {
  return (
    <motion.div variants={fadeUp} custom={1}>
      <Card className="border-emerald-100 dark:border-emerald-900/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
              <Workflow className="size-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-base">System Architecture</CardTitle>
              <CardDescription>
                Production topology — request flow from mobile clients to data stores
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <div className="min-w-[600px] p-2">
              {/* Row 1: Client → API Gateway → Backend */}
              <div className="flex flex-col gap-3">
                {/* Connection: Client to Gateway */}
                <div className="flex flex-col items-center gap-1">
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <ArrowRight className="size-3" />
                    <span>HTTPS / TLS 1.3</span>
                  </div>
                  <div className="h-4 w-px bg-emerald-300 dark:bg-emerald-700" />
                </div>

                {/* Client Row */}
                <div className="flex justify-center">
                  <div className="flex items-center gap-2.5 rounded-xl border-2 border-violet-200 bg-violet-50 px-5 py-3.5 dark:border-violet-800 dark:bg-violet-950/30">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/40">
                      <MonitorDot className="size-4 text-violet-600 dark:text-violet-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-violet-800 dark:text-violet-300">React Native App</p>
                      <p className="text-[10px] text-violet-500">iOS & Android</p>
                    </div>
                  </div>
                </div>

                {/* Connection: Client to Gateway */}
                <div className="flex flex-col items-center gap-1">
                  <div className="h-3 w-px bg-emerald-300 dark:bg-emerald-700" />
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <ArrowRight className="size-3" />
                    <span>Port 443</span>
                  </div>
                  <div className="h-3 w-px bg-emerald-300 dark:bg-emerald-700" />
                </div>

                {/* API Gateway Row */}
                <div className="flex justify-center">
                  <div className="flex items-center gap-2.5 rounded-xl border-2 border-teal-200 bg-teal-50 px-5 py-3.5 dark:border-teal-800 dark:bg-teal-950/30">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/40">
                      <Route className="size-4 text-teal-600 dark:text-teal-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-teal-800 dark:text-teal-300">API Gateway (ALB)</p>
                      <p className="text-[10px] text-teal-500">SSL Termination + WAF</p>
                    </div>
                  </div>
                </div>

                {/* Connection: Gateway splits */}
                <div className="flex flex-col items-center gap-1">
                  <div className="h-3 w-px bg-emerald-300 dark:bg-emerald-700" />
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <ArrowRight className="size-3" />
                    <span>Port 8080 / Internal</span>
                  </div>
                  <div className="h-3 w-px bg-emerald-300 dark:bg-emerald-700" />
                </div>

                {/* Backend + Redis Row (side by side) */}
                <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-4">
                  {/* Express Backend */}
                  <div className="flex items-center gap-2.5 rounded-xl border-2 border-emerald-200 bg-emerald-50 px-5 py-3.5 dark:border-emerald-800 dark:bg-emerald-950/30">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/40">
                      <Server className="size-4 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">Express Backend</p>
                      <p className="text-[10px] text-emerald-500">K8s Pod ×3 (Auto-scaling)</p>
                    </div>
                  </div>

                  <div className="hidden sm:flex flex-col items-center gap-1">
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <ArrowRight className="size-3" />
                    </div>
                  </div>

                  {/* Redis Cluster */}
                  <div className="flex items-center gap-2.5 rounded-xl border-2 border-amber-200 bg-amber-50 px-5 py-3.5 dark:border-amber-800 dark:bg-amber-950/30">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/40">
                      <Gauge className="size-4 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-amber-800 dark:text-amber-300">Redis Cluster</p>
                      <p className="text-[10px] text-amber-500">ElastiCache 3-node</p>
                    </div>
                  </div>
                </div>

                {/* Connection: Backend to data stores */}
                <div className="flex flex-col items-center gap-1">
                  <div className="h-3 w-px bg-emerald-300 dark:bg-emerald-700" />
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <ArrowRight className="size-3" />
                    <span>TLS Internal / Port 5432 & 443</span>
                  </div>
                  <div className="h-3 w-px bg-emerald-300 dark:bg-emerald-700" />
                </div>

                {/* Data Stores Row */}
                <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-4">
                  {/* PostgreSQL */}
                  <div className="flex items-center gap-2.5 rounded-xl border-2 border-sky-200 bg-sky-50 px-5 py-3.5 dark:border-sky-800 dark:bg-sky-950/30">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/40">
                      <Database className="size-4 text-sky-600 dark:text-sky-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-sky-800 dark:text-sky-300">PostgreSQL (RDS)</p>
                      <p className="text-[10px] text-sky-500">Multi-AZ · 100 GB</p>
                    </div>
                  </div>

                  <div className="hidden sm:flex flex-col items-center gap-1">
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <ArrowRight className="size-3" />
                    </div>
                  </div>

                  {/* S3 + KMS */}
                  <div className="flex items-center gap-2.5 rounded-xl border-2 border-rose-200 bg-rose-50 px-5 py-3.5 dark:border-rose-800 dark:bg-rose-950/30">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-900/40">
                      <LockKeyhole className="size-4 text-rose-600 dark:text-rose-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-rose-800 dark:text-rose-300">S3 + KMS</p>
                      <p className="text-[10px] text-rose-500">Encrypted Storage</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function KubernetesCluster() {
  const k8sStats = [
    {
      label: "Cluster",
      value: "flexpay-prod",
      sub: "EKS-compatible",
      icon: Cpu,
      color: "emerald",
    },
    {
      label: "Namespaces",
      value: "3",
      sub: "production, staging, monitoring",
      icon: FolderTree,
      color: "teal",
    },
    {
      label: "Pods",
      value: "12 running",
      sub: "0 pending · 0 crashloop",
      icon: CircleDot,
      color: "amber",
    },
    {
      label: "Deployments",
      value: "3 active",
      sub: "api ×3, worker ×2, ingress ×2",
      icon: Layers,
      color: "rose",
    },
  ];

  const deployments = [
    {
      name: "api",
      replicas: 3,
      ready: 3,
      image: "flexpay-api:2.14.0",
      cpu: "250m / 500m",
      memory: "256Mi / 512Mi",
    },
    {
      name: "worker",
      replicas: 2,
      ready: 2,
      image: "flexpay-worker:2.14.0",
      cpu: "200m / 400m",
      memory: "256Mi / 512Mi",
    },
    {
      name: "ingress",
      replicas: 2,
      ready: 2,
      image: "nginx-ingress:1.10.1",
      cpu: "100m / 200m",
      memory: "128Mi / 256Mi",
    },
  ];

  const colorMap: Record<string, { bg: string; icon: string; border: string }> = {
    emerald: {
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
      icon: "text-emerald-600 dark:text-emerald-400",
      border: "border-emerald-100 dark:border-emerald-900/50",
    },
    teal: {
      bg: "bg-teal-50 dark:bg-teal-950/40",
      icon: "text-teal-600 dark:text-teal-400",
      border: "border-teal-100 dark:border-teal-900/50",
    },
    amber: {
      bg: "bg-amber-50 dark:bg-amber-950/40",
      icon: "text-amber-600 dark:text-amber-400",
      border: "border-amber-100 dark:border-amber-900/50",
    },
    rose: {
      bg: "bg-rose-50 dark:bg-rose-950/40",
      icon: "text-rose-600 dark:text-rose-400",
      border: "border-rose-100 dark:border-rose-900/50",
    },
  };

  return (
    <motion.div variants={fadeUp} custom={2}>
      <Card className="border-emerald-100 dark:border-emerald-900/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
              <Cpu className="size-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-base">Kubernetes Cluster</CardTitle>
              <CardDescription>
                Container orchestration and workload management
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-col gap-5">
            {/* K8s Stat Cards Grid */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {k8sStats.map((stat) => {
                const c = colorMap[stat.color];
                return (
                  <div
                    key={stat.label}
                    className={`rounded-xl border ${c.border} ${c.bg} p-4 transition-shadow hover:shadow-md`}
                  >
                    <div className="flex items-center gap-2 mb-2.5">
                      <stat.icon className={`size-4 ${c.icon}`} />
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {stat.label}
                      </span>
                    </div>
                    <p className={`text-sm font-bold ${c.icon}`}>
                      {stat.value}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                      {stat.sub}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Deployments Detail */}
            <Separator />

            <div>
              <div className="flex items-center gap-2 mb-3">
                <Box className="size-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-semibold text-foreground">Active Deployments</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {deployments.map((dep) => (
                  <div
                    key={dep.name}
                    className="flex flex-col gap-2 rounded-lg border border-border p-3.5 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40 shrink-0">
                        <Server className="size-4 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-foreground">
                            {dep.name}
                          </span>
                          <Badge className="border-0 bg-emerald-50 px-1.5 py-0 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                            {dep.ready}/{dep.replicas} ready
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {dep.image}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 pl-11 sm:pl-0">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-[10px] text-muted-foreground">CPU</span>
                        <span className="text-xs font-medium text-foreground">{dep.cpu}</span>
                      </div>
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-[10px] text-muted-foreground">Memory</span>
                        <span className="text-xs font-medium text-foreground">{dep.memory}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function AWSServicesGrid() {
  const colorMap: Record<string, { bg: string; icon: string; border: string; badge: string }> = {
    emerald: {
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
      icon: "text-emerald-600 dark:text-emerald-400",
      border: "border-emerald-100 dark:border-emerald-900/50",
      badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-0",
    },
    teal: {
      bg: "bg-teal-50 dark:bg-teal-950/40",
      icon: "text-teal-600 dark:text-teal-400",
      border: "border-teal-100 dark:border-teal-900/50",
      badge: "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400 border-0",
    },
    amber: {
      bg: "bg-amber-50 dark:bg-amber-950/40",
      icon: "text-amber-600 dark:text-amber-400",
      border: "border-amber-100 dark:border-amber-900/50",
      badge: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-0",
    },
    rose: {
      bg: "bg-rose-50 dark:bg-rose-950/40",
      icon: "text-rose-600 dark:text-rose-400",
      border: "border-rose-100 dark:border-rose-900/50",
      badge: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border-0",
    },
    violet: {
      bg: "bg-violet-50 dark:bg-violet-950/40",
      icon: "text-violet-600 dark:text-violet-400",
      border: "border-violet-100 dark:border-violet-900/50",
      badge: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400 border-0",
    },
    slate: {
      bg: "bg-slate-100 dark:bg-slate-800/60",
      icon: "text-slate-600 dark:text-slate-400",
      border: "border-slate-200 dark:border-slate-700/50",
      badge: "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400 border-0",
    },
  };

  return (
    <div className="flex flex-col gap-4">
      <motion.div variants={fadeUp} custom={3}>
        <div className="flex items-center gap-2 mb-1">
          <HardDrive className="size-5 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-lg font-bold text-foreground">AWS Services</h2>
          <Badge
            variant="outline"
            className="border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
          >
            6 services
          </Badge>
        </div>
      </motion.div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {awsServices.map((service, i) => {
          const c = colorMap[service.color];
          return (
            <motion.div key={service.name} variants={fadeUp} custom={i + 4}>
              <Card className={`border ${c.border} transition-shadow hover:shadow-md h-full`}>
                <CardContent className="p-5">
                  <div className="flex flex-col gap-4">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`flex size-10 items-center justify-center rounded-xl ${c.bg} shrink-0`}>
                          <service.icon className={`size-5 ${c.icon}`} />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-bold text-foreground">
                            {service.name}
                          </span>
                          <Badge variant="outline" className="w-fit border-0 bg-muted/60 px-1.5 py-0 text-[10px] text-muted-foreground">
                            {service.version}
                          </Badge>
                        </div>
                      </div>
                      <Badge className={`border-0 text-[10px] font-medium ${c.badge}`}>
                        <CheckCircle2 className="size-3" />
                        {service.status}
                      </Badge>
                    </div>

                    {/* Details */}
                    <div className="flex flex-col gap-1.5">
                      {service.details.map((detail) => (
                        <div key={detail} className="flex items-center gap-2">
                          <div className={`size-1.5 rounded-full ${c.icon === "text-emerald-600 dark:text-emerald-400" ? "bg-emerald-400" : c.icon === "text-teal-600 dark:text-teal-400" ? "bg-teal-400" : c.icon === "text-amber-600 dark:text-amber-400" ? "bg-amber-400" : c.icon === "text-rose-600 dark:text-rose-400" ? "bg-rose-400" : c.icon === "text-violet-600 dark:text-violet-400" ? "bg-violet-400" : "bg-slate-400"}`} />
                          <span className="text-xs text-muted-foreground">{detail}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function SecurityControls() {
  const colorMap: Record<string, { bg: string; icon: string; border: string; dot: string }> = {
    emerald: {
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
      icon: "text-emerald-600 dark:text-emerald-400",
      border: "border-emerald-100 dark:border-emerald-900/50",
      dot: "bg-emerald-500",
    },
    teal: {
      bg: "bg-teal-50 dark:bg-teal-950/40",
      icon: "text-teal-600 dark:text-teal-400",
      border: "border-teal-100 dark:border-teal-900/50",
      dot: "bg-teal-500",
    },
    amber: {
      bg: "bg-amber-50 dark:bg-amber-950/40",
      icon: "text-amber-600 dark:text-amber-400",
      border: "border-amber-100 dark:border-amber-900/50",
      dot: "bg-amber-500",
    },
    rose: {
      bg: "bg-rose-50 dark:bg-rose-950/40",
      icon: "text-rose-600 dark:text-rose-400",
      border: "border-rose-100 dark:border-rose-900/50",
      dot: "bg-rose-500",
    },
  };

  return (
    <motion.div variants={fadeUp} custom={10}>
      <Card className="border-emerald-100 dark:border-emerald-900/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
              <ShieldAlert className="size-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-base">Security Controls</CardTitle>
              <CardDescription>
                Defense-in-depth security posture for financial data
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {securityControls.map((control) => {
              const c = colorMap[control.color];
              return (
                <div
                  key={control.title}
                  className={`flex flex-col gap-3 rounded-xl border ${c.border} p-4 transition-colors hover:bg-muted/30`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex size-10 items-center justify-center rounded-xl ${c.bg} shrink-0`}>
                      <control.icon className={`size-5 ${c.icon}`} />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-bold text-foreground">
                        {control.title}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {control.description}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 pl-[52px]">
                    {control.items.map((item) => (
                      <div key={item} className="flex items-center gap-2">
                        <div className={`size-1.5 rounded-full ${c.dot}`} />
                        <span className="text-xs text-muted-foreground">{item}</span>
                      </div>
                    ))}
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

function EnvironmentMatrix() {
  return (
    <motion.div variants={fadeUp} custom={11}>
      <Card className="border-emerald-100 dark:border-emerald-900/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
              <Table2 className="size-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-base">Environment Matrix</CardTitle>
              <CardDescription>
                Deployment environments and resource allocation
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
                    Environment
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Region
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Nodes
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    HA Mode
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Pods
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {environments.map((env) => (
                  <tr
                    key={env.name}
                    className="border-b border-border/50 transition-colors last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-7 items-center justify-center rounded-md bg-emerald-50 dark:bg-emerald-950/40">
                          <Server className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <span className="text-sm font-semibold text-foreground">
                          {env.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-sm text-muted-foreground">
                      {env.region}
                    </td>
                    <td className="px-4 py-3.5 text-sm font-medium text-foreground">
                      {env.nodes}
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge
                        variant="outline"
                        className="border-0 bg-muted/60 px-1.5 py-0 text-[11px] font-medium text-muted-foreground"
                      >
                        {env.ha}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                        {env.pods}
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      <Badge
                        className={`border-0 text-[10px] font-bold ${env.statusColor}`}
                      >
                        <Circle className="size-2.5 fill-current" />
                        {env.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="flex flex-col gap-3 px-4 pb-4 sm:hidden">
            {environments.map((env) => (
              <div
                key={env.name}
                className="rounded-lg border border-border p-3.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex size-7 items-center justify-center rounded-md bg-emerald-50 dark:bg-emerald-950/40">
                      <Server className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <span className="text-sm font-semibold text-foreground">
                      {env.name}
                    </span>
                  </div>
                  <Badge
                    className={`border-0 text-[10px] font-bold ${env.statusColor}`}
                  >
                    <Circle className="size-2.5 fill-current" />
                    {env.status}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground">Region</span>
                    <span className="text-xs font-semibold text-foreground truncate">{env.region}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground">Nodes</span>
                    <span className="text-xs font-semibold text-foreground">{env.nodes}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground">HA</span>
                    <span className="text-xs font-semibold text-foreground">{env.ha}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground">Pods</span>
                    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">{env.pods}</span>
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

// ── Main Component ──────────────────────────────────────────────
export function InfrastructurePage() {
  return (
    <motion.div
      className="flex flex-col gap-6"
      initial="hidden"
      animate="visible"
      variants={stagger}
    >
      {/* 1. Hero Banner */}
      <HeroBanner />

      {/* 2. Architecture Diagram */}
      <ArchitectureDiagram />

      {/* 3. Kubernetes Cluster */}
      <KubernetesCluster />

      {/* 4. AWS Services Grid */}
      <AWSServicesGrid />

      {/* 5. Security Controls */}
      <SecurityControls />

      {/* 6. Environment Matrix */}
      <EnvironmentMatrix />

      {/* Divider */}
      <motion.div variants={fadeUp} custom={12}>
        <div className="relative flex items-center gap-4 py-2">
          <Separator className="flex-1" />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Zap className="size-3.5 text-emerald-500" />
            <span className="font-medium">Cloud Infrastructure</span>
            <Zap className="size-3.5 text-emerald-500" />
          </div>
          <Separator className="flex-1" />
        </div>
      </motion.div>

      {/* Bottom Stats Footer */}
      <motion.div variants={fadeUp} custom={13}>
        <Card className="border-emerald-200/60 bg-gradient-to-r from-emerald-50/60 via-white to-teal-50/60 py-0 dark:border-emerald-900/40 dark:from-emerald-950/20 dark:via-emerald-950/10 dark:to-teal-950/20">
          <CardContent className="p-4 sm:p-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {[
                { label: "AWS Region", value: "1", icon: Globe },
                { label: "Availability Zones", value: "2", icon: CircleDot },
                { label: "K8s Nodes", value: "3", icon: Server },
                { label: "Running Pods", value: "12", icon: Cpu },
                { label: "AWS Services", value: "6", icon: HardDrive },
                { label: "Deployments", value: "3", icon: Layers },
                { label: "Namespaces", value: "3", icon: FolderTree },
                { label: "Compliance", value: "4+", icon: ShieldCheck },
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
          FlexPay Cloud Infrastructure &middot; AWS me-south-1 (Bahrain) &middot; Last updated June 2025
        </p>
      </motion.div>
    </motion.div>
  );
}
