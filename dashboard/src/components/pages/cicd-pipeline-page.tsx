"use client";

import { motion } from "framer-motion";
import {
  GitBranch,
  Rocket,
  Shield,
  CheckCircle2,
  XCircle,
  Clock,
  Upload,
  Code2,
  TestTube2,
  Lock,
  Container,
  ArrowRight,
  Zap,
  GitCommitHorizontal,
  Timer,
  Play,
  RotateCcw,
  Workflow,
  FileCode2,
  Boxes,
  Layers,
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

interface PipelineStage {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  duration?: string;
}

const pipelineStages: PipelineStage[] = [
  { label: "Code Push", icon: GitCommitHorizontal },
  { label: "Lint & Type Check", icon: Code2 },
  { label: "Unit Tests", icon: TestTube2 },
  { label: "Security Scan (Trivy)", icon: Shield },
  { label: "Build & Push (OCI)", icon: Container },
  { label: "Deploy (Helm)", icon: Rocket },
];

interface Workflow {
  name: string;
  trigger: string;
  steps: string;
  duration: string;
  icon: React.ComponentType<{ className?: string }>;
}

const workflows: Workflow[] = [
  {
    name: "ci.yml",
    trigger: "On PR",
    steps: "lint, typecheck, test, security scan",
    duration: "~4 min avg",
    icon: Code2,
  },
  {
    name: "deploy-staging.yml",
    trigger: "On merge to main",
    steps: "build, push, deploy staging",
    duration: "~6 min avg",
    icon: Play,
  },
  {
    name: "deploy-production.yml",
    trigger: "Manual trigger + approval",
    steps: "blue-green deploy",
    duration: "~8 min avg",
    icon: Rocket,
  },
];

interface Deployment {
  version: string;
  date: string;
  environment: string;
  status: "Success" | "Rolled Back";
  description: string;
  author: string;
}

const deployments: Deployment[] = [
  {
    version: "v2.14.3",
    date: "Jun 18, 2025",
    environment: "Production",
    status: "Success",
    description: "Fix NymCard circuit breaker",
    author: "@ahmed-dev",
  },
  {
    version: "v2.14.2",
    date: "Jun 16, 2025",
    environment: "Production",
    status: "Success",
    description: "Add savings auto-contribute",
    author: "@sarah-dev",
  },
  {
    version: "v2.14.1",
    date: "Jun 15, 2025",
    environment: "Production",
    status: "Rolled Back",
    description: "Card service timeout fix",
    author: "@ahmed-dev",
  },
  {
    version: "v2.14.0",
    date: "Jun 14, 2025",
    environment: "Staging",
    status: "Success",
    description: "Q2 feature release",
    author: "@release-bot",
  },
  {
    version: "v2.13.5",
    date: "Jun 12, 2025",
    environment: "Production",
    status: "Success",
    description: "Referral program v2",
    author: "@sarah-dev",
  },
  {
    version: "v2.13.4",
    date: "Jun 10, 2025",
    environment: "Production",
    status: "Success",
    description: "AML rule engine update",
    author: "@omar-dev",
  },
];

interface QualityGate {
  label: string;
  detail: string;
  passPercent: number;
}

const qualityGates: QualityGate[] = [
  { label: "Lint", detail: "100% pass rate", passPercent: 100 },
  { label: "TypeScript", detail: "100% strict mode", passPercent: 100 },
  { label: "Unit Tests", detail: "100% pass, 26 tests", passPercent: 100 },
  { label: "Security Scan", detail: "0 critical, 0 high findings", passPercent: 100 },
  { label: "Helm Validation", detail: "kubeconform passing", passPercent: 100 },
];

interface IaCTool {
  name: string;
  description: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const iacTools: IaCTool[] = [
  {
    name: "Helm Charts",
    description: "3 charts (api, worker, ingress)",
    detail: "OCI hosted",
    icon: Layers,
    color: "emerald",
  },
  {
    name: "Kustomize",
    description: "Base + 3 overlays (dev, staging, prod)",
    detail: "Environment-aware",
    icon: Boxes,
    color: "teal",
  },
  {
    name: "Terraform",
    description: "AWS me-south-1, 24 resources",
    detail: "IaC managed",
    icon: FileCode2,
    color: "amber",
  },
  {
    name: "Docker",
    description: "Multi-stage builds, Alpine base",
    detail: "Optimized images",
    icon: Container,
    color: "slate",
  },
];

// ── Sub-components ──────────────────────────────────────────────

function HeroBanner() {
  const stats = [
    { label: "Deployments", value: "47", sub: "this quarter", icon: Rocket },
    { label: "Rollback Rate", value: "0.8%", sub: "last 90 days", icon: RotateCcw },
    { label: "Lead Time", value: "2.1 hrs", sub: "commit → prod", icon: Timer },
    { label: "Deploy Freq", value: "2.1/wk", sub: "avg cadence", icon: Workflow },
  ];

  return (
    <motion.div variants={fadeUp} custom={0}>
      <Card className="relative overflow-hidden border-0 py-0 shadow-xl">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-700 via-teal-800 to-slate-900 dark:from-emerald-900 dark:via-teal-950 dark:to-slate-950" />

        {/* Decorative elements */}
        <div className="absolute -right-16 -top-16 size-72 rounded-full bg-white/[0.03]" />
        <div className="absolute -bottom-20 -left-10 size-56 rounded-full bg-white/[0.03]" />
        <div className="absolute right-1/4 top-1/3 size-24 rounded-full bg-emerald-400/[0.06]" />

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
                  <GitBranch className="size-4 text-white" />
                </div>
                <span className="text-xs font-medium uppercase tracking-wider text-emerald-200/80">
                  DevOps & Release
                </span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
                CI/CD &amp; Deployment Pipeline
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-emerald-100/70 sm:text-base">
                Automated deployments with built-in quality gates, security scanning,
                and progressive delivery. From code push to production in under 10 minutes
                with zero-downtime blue-green deployments.
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

function PipelineStagesVisual() {
  return (
    <motion.div variants={fadeUp} custom={1}>
      <Card className="border-emerald-100 dark:border-emerald-900/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
              <Workflow className="size-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-base">Pipeline Stages</CardTitle>
              <CardDescription>
                Automated CI/CD flow from commit to production
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {/* Desktop: horizontal flow */}
          <div className="hidden lg:flex items-center gap-0 overflow-x-auto pb-2">
            {pipelineStages.map((stage, i) => (
              <div key={stage.label} className="flex items-center gap-0">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.2 + i * 0.1, duration: 0.4 }}
                  className="flex flex-col items-center gap-2"
                >
                  <div className="flex size-14 items-center justify-center rounded-xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white dark:border-emerald-800 dark:from-emerald-950/60 dark:to-emerald-950/30 shadow-sm">
                    <stage.icon className="size-6 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-xs font-semibold text-foreground whitespace-nowrap">
                      {stage.label}
                    </span>
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="size-3 text-emerald-500" />
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                        Passing
                      </span>
                    </div>
                  </div>
                </motion.div>
                {i < pipelineStages.length - 1 && (
                  <div className="mx-2 flex items-center">
                    <ArrowRight className="size-4 text-emerald-400 dark:text-emerald-500" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Mobile & Tablet: vertical flow */}
          <div className="flex flex-col gap-0 lg:hidden">
            {pipelineStages.map((stage, i) => (
              <div key={stage.label} className="flex items-center gap-3">
                <motion.div
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 + i * 0.08, duration: 0.35 }}
                  className="flex items-center gap-3 flex-1 rounded-lg border border-border p-3 transition-colors hover:bg-muted/30"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
                    <stage.icon className="size-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm font-semibold text-foreground truncate">
                      {stage.label}
                    </span>
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="size-3 text-emerald-500" />
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                        Passing
                      </span>
                    </div>
                  </div>
                  <Badge className="ml-auto shrink-0 border-0 bg-emerald-50 text-emerald-700 text-[10px] font-medium dark:bg-emerald-950/40 dark:text-emerald-400">
                    Step {i + 1}
                  </Badge>
                </motion.div>
                {i < pipelineStages.length - 1 && (
                  <div className="flex flex-col items-center gap-0 pl-7 shrink-0">
                    <ChevronRight className="size-4 text-emerald-300 dark:text-emerald-600 rotate-90" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function GitHubActionsWorkflows() {
  const triggerColors: Record<string, string> = {
    "On PR": "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
    "On merge to main": "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400",
    "Manual trigger + approval": "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  };

  const iconBgs: Record<string, string> = {
    "ci.yml": "bg-emerald-50 dark:bg-emerald-950/40",
    "deploy-staging.yml": "bg-teal-50 dark:bg-teal-950/40",
    "deploy-production.yml": "bg-amber-50 dark:bg-amber-950/40",
  };

  const iconColors: Record<string, string> = {
    "ci.yml": "text-emerald-600 dark:text-emerald-400",
    "deploy-staging.yml": "text-teal-600 dark:text-teal-400",
    "deploy-production.yml": "text-amber-600 dark:text-amber-400",
  };

  return (
    <motion.div variants={fadeUp} custom={2}>
      <Card className="border-emerald-100 dark:border-emerald-900/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
              <GitBranch className="size-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-base">GitHub Actions Workflows</CardTitle>
              <CardDescription>
                Automated CI/CD workflows for testing and deployment
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {workflows.map((wf) => (
              <div
                key={wf.name}
                className="flex flex-col gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted/30"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${iconBgs[wf.name]}`}
                  >
                    <wf.icon className={`size-5 ${iconColors[wf.name]}`} />
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-sm font-bold font-mono text-foreground truncate">
                      {wf.name}
                    </span>
                    <Badge
                      className={`w-fit border-0 text-[10px] font-medium ${triggerColors[wf.trigger]}`}
                    >
                      {wf.trigger}
                    </Badge>
                  </div>
                </div>
                <Separator />
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      Steps
                    </span>
                    <span className="text-xs text-foreground leading-relaxed">
                      {wf.steps}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="size-3 text-muted-foreground" />
                    <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      {wf.duration}
                    </span>
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

function DeploymentHistory() {
  return (
    <motion.div variants={fadeUp} custom={3}>
      <Card className="border-emerald-100 dark:border-emerald-900/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
              <Upload className="size-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-base">Deployment History</CardTitle>
              <CardDescription>
                Recent deployment activity across environments
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border sm:left-[19px]" />

            <div className="flex flex-col gap-3">
              {deployments.map((dep, i) => {
                const isRolledBack = dep.status === "Rolled Back";
                return (
                  <div
                    key={dep.version}
                    className="relative flex items-start gap-3 pl-1 sm:pl-2"
                  >
                    {/* Timeline dot */}
                    <div
                      className={`relative z-10 mt-1.5 size-[7px] shrink-0 rounded-full sm:mt-1 sm:size-[9px] ${
                        isRolledBack
                          ? "bg-red-500"
                          : "bg-emerald-500"
                      }`}
                    />

                    {/* Content */}
                    <div className="flex flex-1 flex-col gap-2 rounded-lg border border-border p-3 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold font-mono text-foreground">
                            {dep.version}
                          </span>
                          <Badge
                            className={`border-0 text-[10px] font-medium ${
                              dep.environment === "Production"
                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                : "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400"
                            }`}
                          >
                            {dep.environment}
                          </Badge>
                          <Badge
                            className={`border-0 text-[10px] font-bold ${
                              isRolledBack
                                ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                                : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                            }`}
                          >
                            {isRolledBack ? (
                              <RotateCcw className="size-3" />
                            ) : (
                              <CheckCircle2 className="size-3" />
                            )}
                            {dep.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {dep.description}
                        </p>
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="size-3" />
                            {dep.date}
                          </span>
                          <span className="flex items-center gap-1">
                            <GitBranch className="size-3" />
                            {dep.author}
                          </span>
                        </div>
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

function QualityGates() {
  return (
    <motion.div variants={fadeUp} custom={4}>
      <Card className="border-emerald-100 dark:border-emerald-900/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
              <Shield className="size-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-base">Quality Gates</CardTitle>
              <CardDescription>
                All quality gates must pass before merge and deploy
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-col gap-3">
            {qualityGates.map((gate) => (
              <div
                key={gate.label}
                className="flex flex-col gap-2 rounded-lg border border-border p-3.5 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40 shrink-0">
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-foreground">
                      {gate.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {gate.detail}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 sm:w-40">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${gate.passPercent}%` }}
                    />
                  </div>
                  <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 w-9 text-right">
                    {gate.passPercent}%
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

function InfrastructureAsCode() {
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
    <motion.div variants={fadeUp} custom={5}>
      <Card className="border-emerald-100 dark:border-emerald-900/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
              <FileCode2 className="size-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-base">Infrastructure as Code</CardTitle>
              <CardDescription>
                IaC tooling powering FlexPay&apos;s cloud infrastructure
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {iacTools.map((tool) => {
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
                        {tool.detail}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {tool.description}
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

// ── Main Component ──────────────────────────────────────────────
export function CICDPipelinePage() {
  return (
    <motion.div
      className="flex flex-col gap-6"
      initial="hidden"
      animate="visible"
      variants={stagger}
    >
      {/* 1. Hero Banner */}
      <HeroBanner />

      {/* 2. Pipeline Stages Visual */}
      <PipelineStagesVisual />

      {/* 3. GitHub Actions Workflows */}
      <GitHubActionsWorkflows />

      {/* 4. Deployment History */}
      <DeploymentHistory />

      {/* 5. Quality Gates */}
      <QualityGates />

      {/* 6. Infrastructure as Code */}
      <InfrastructureAsCode />

      {/* Divider */}
      <motion.div variants={fadeUp} custom={6}>
        <div className="relative flex items-center gap-4 py-2">
          <Separator className="flex-1" />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Zap className="size-3.5 text-emerald-500" />
            <span className="font-medium">DevOps Engineering</span>
            <Zap className="size-3.5 text-emerald-500" />
          </div>
          <Separator className="flex-1" />
        </div>
      </motion.div>

      {/* Bottom Stats Footer */}
      <motion.div variants={fadeUp} custom={7}>
        <Card className="border-emerald-200/60 bg-gradient-to-r from-emerald-50/60 via-white to-teal-50/60 py-0 dark:border-emerald-900/40 dark:from-emerald-950/20 dark:via-emerald-950/10 dark:to-teal-950/20">
          <CardContent className="p-4 sm:p-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {[
                { label: "Pipeline Stages", value: "6", icon: Workflow },
                { label: "Workflows", value: "3", icon: GitBranch },
                { label: "Deployments", value: "47", icon: Rocket },
                { label: "Quality Gates", value: "5", icon: Shield },
                { label: "Lead Time", value: "2.1 hrs", icon: Timer },
                { label: "Rollback Rate", value: "0.8%", icon: RotateCcw },
                { label: "IaC Resources", value: "24", icon: FileCode2 },
                { label: "Uptime", value: "99.97%", icon: CheckCircle2 },
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
          FlexPay CI/CD &amp; Deployment Pipeline &middot; Last updated June 2025
        </p>
      </motion.div>
    </motion.div>
  );
}
