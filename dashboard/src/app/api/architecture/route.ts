import { NextRequest, NextResponse } from "next/server";

// ─────────────────────────────────────────────────────────────
// TypeScript types for the Architecture API response
// ─────────────────────────────────────────────────────────────

interface ArchitectureOverview {
  platform: string;
  version: string;
  region: string;
  dataResidency: string;
  totalServices: number;
  totalDatabases: number;
  uptime30d: string;
}

interface ArchitectureService {
  id: string;
  name: string;
  type: string;
  icon: string;
  description: string;
  tech: string[];
  status: string;
  version: string;
  connections: string[];
  users?: string;
  endpoints?: number;
  sla?: string;
  tables?: number;
  backupRetention?: string;
  memory?: string;
  encryptionKeys?: number;
  dashboards?: number;
  activeAlerts?: number;
}

interface ArchitectureConnection {
  from: string;
  to: string;
  protocol: string;
  latency: string;
}

interface TechStack {
  frontend: string[];
  backend: string[];
  database: string[];
  devops: string[];
  cloud: string[];
  monitoring: string[];
  security: string[];
  compliance: string[];
}

interface Deployment {
  environments: string[];
  strategy: string;
  rollbackTime: string;
  cicd: string;
  containerRegistry: string;
  lastDeploy: string;
}

interface ArchitectureResponse {
  overview: ArchitectureOverview;
  services: ArchitectureService[];
  connections: ArchitectureConnection[];
  techStack: TechStack;
  deployment: Deployment;
}

// ─────────────────────────────────────────────────────────────
// Static architecture data — no database required
// ─────────────────────────────────────────────────────────────

const architectureData: ArchitectureResponse = {
  overview: {
    platform: "FlexPay Digital Wallet Platform",
    version: "2.0.0",
    region: "AWS me-south-1 (Bahrain)",
    dataResidency: "UAE Data Localization Compliant",
    totalServices: 8,
    totalDatabases: 3,
    uptime30d: "99.97%",
  },

  services: [
    {
      id: "employee-app",
      name: "React Native Employee App",
      type: "mobile",
      icon: "smartphone",
      description:
        "Native mobile app for blue-collar workers - wallet, cards, remittance, savings",
      tech: ["React Native 0.76", "TypeScript", "Expo SDK 52"],
      users: "12,400+",
      status: "active",
      version: "3.2.1",
      connections: ["express-backend", "push-notifications"],
    },
    {
      id: "admin-dashboard",
      name: "React Dashboard (Company Admin)",
      type: "web",
      icon: "monitor",
      description:
        "Company admin portal - payroll management, employee onboarding, compliance reports",
      tech: ["React 19", "Vite 6", "TailwindCSS 4", "shadcn/ui"],
      users: "340+",
      status: "active",
      version: "2.8.0",
      connections: ["express-backend"],
    },
    {
      id: "express-backend",
      name: "Express Backend (Node.js/TS)",
      type: "backend",
      icon: "server",
      description:
        "Core API server handling all business logic - auth, wallet, payroll, cards, compliance",
      tech: ["Node.js 22 LTS", "Express 5", "TypeScript 5.7", "Prisma ORM"],
      status: "active",
      version: "2.5.3",
      endpoints: 68,
      connections: [
        "postgres-db",
        "redis-cache",
        "nymcard-baas",
        "aws-kms",
        "prometheus",
      ],
    },
    {
      id: "nymcard-baas",
      name: "NymCard BaaS (Visa Cards)",
      type: "external",
      icon: "credit-card",
      description:
        "Card issuing platform - virtual & physical Visa cards, tokenization (Apple/Google/Samsung Pay)",
      tech: ["NymCard API v3", "Visa Network"],
      status: "active",
      version: "API v3.2",
      sla: "99.90%",
      connections: ["express-backend"],
    },
    {
      id: "postgres-db",
      name: "PostgreSQL Database",
      type: "database",
      icon: "database",
      description:
        "Primary relational database for all transactional data - users, wallets, payroll, compliance",
      tech: ["PostgreSQL 16", "RDS Multi-AZ", "100GB gp3"],
      status: "active",
      version: "16.0",
      tables: 26,
      backupRetention: "30 days",
      connections: ["express-backend"],
    },
    {
      id: "redis-cache",
      name: "Redis Cache",
      type: "cache",
      icon: "cpu",
      description:
        "In-memory cache for sessions, rate limiting, OTP storage, and real-time feature flags",
      tech: ["Redis 7.2", "ElastiCache Cluster", "3 nodes"],
      status: "active",
      version: "7.2",
      memory: "6GB total",
      connections: ["express-backend"],
    },
    {
      id: "aws-kms",
      name: "AWS KMS / S3",
      type: "security",
      icon: "lock",
      description:
        "Envelope encryption for PII (KMS) and document storage for KYC files, compliance records (S3)",
      tech: ["AWS KMS AES-256", "S3 Standard", "me-south-1"],
      status: "active",
      version: "N/A",
      encryptionKeys: 12,
      connections: ["express-backend"],
    },
    {
      id: "prometheus",
      name: "Prometheus / Grafana / Alertmanager",
      type: "monitoring",
      icon: "activity",
      description:
        "Full observability stack - metrics collection, dashboards, alerting, and SLO tracking",
      tech: [
        "Prometheus 2.54",
        "Grafana 11",
        "Alertmanager",
        "Thanos 0.36",
      ],
      status: "active",
      version: "N/A",
      dashboards: 12,
      activeAlerts: 847,
      connections: ["express-backend"],
    },
  ],

  connections: [
    {
      from: "employee-app",
      to: "express-backend",
      protocol: "HTTPS/REST",
      latency: "45ms avg",
    },
    {
      from: "admin-dashboard",
      to: "express-backend",
      protocol: "HTTPS/REST",
      latency: "38ms avg",
    },
    {
      from: "express-backend",
      to: "postgres-db",
      protocol: "TCP/5432",
      latency: "2ms avg",
    },
    {
      from: "express-backend",
      to: "redis-cache",
      protocol: "TCP/6379",
      latency: "<1ms avg",
    },
    {
      from: "express-backend",
      to: "nymcard-baas",
      protocol: "HTTPS/REST",
      latency: "120ms avg",
    },
    {
      from: "express-backend",
      to: "aws-kms",
      protocol: "HTTPS/AWS SDK",
      latency: "15ms avg",
    },
    {
      from: "express-backend",
      to: "prometheus",
      protocol: "HTTP/metrics",
      latency: "N/A",
    },
  ],

  techStack: {
    frontend: [
      "React Native 0.76",
      "React 19",
      "Vite 6",
      "TailwindCSS 4",
      "shadcn/ui",
      "Framer Motion",
    ],
    backend: [
      "Node.js 22 LTS",
      "Express 5",
      "TypeScript 5.7",
      "Prisma ORM",
      "BullMQ",
    ],
    database: ["PostgreSQL 16", "Redis 7.2", "Prisma Migrate"],
    devops: [
      "Docker",
      "Kubernetes (EKS)",
      "Helm 3",
      "GitHub Actions",
      "ArgoCD",
    ],
    cloud: [
      "AWS me-south-1",
      "RDS",
      "ElastiCache",
      "KMS",
      "S3",
      "EKS",
      "ALB",
    ],
    monitoring: ["Prometheus", "Grafana", "Alertmanager", "Thanos", "Trivy"],
    security: [
      "KMS AES-256",
      "PBKDF2",
      "JWT",
      "mTLS",
      "SOC 2 Type II",
    ],
    compliance: ["CBUAE WPS", "UAE PDPL", "ISO 27001", "NESA IAS"],
  },

  deployment: {
    environments: ["staging", "production"],
    strategy: "Blue-Green Deployment",
    rollbackTime: "< 30 seconds",
    cicd: "GitHub Actions \u2192 ArgoCD \u2192 Helm",
    containerRegistry: "OCI (ghcr.io/flexpay)",
    lastDeploy: "2025-06-28T14:30:00Z",
  },
};

// ─────────────────────────────────────────────────────────────
// GET handler — returns full architecture data
// ─────────────────────────────────────────────────────────────

export async function GET(_request: NextRequest) {
  try {
    return NextResponse.json(architectureData, {
      status: 200,
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (error) {
    console.error("[GET /api/architecture] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch architecture data" },
      { status: 500 },
    );
  }
}
