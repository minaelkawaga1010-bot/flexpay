"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Database, Shield, Server, Activity, Lock, Wallet, Clock, Code2,
  Layers, Zap, CheckCircle2, FolderOpen, Copy, Check, ChevronDown,
  ChevronRight, ArrowLeftRight, Globe, BadgeCheck, Terminal, KeyRound,
  RefreshCw, Cpu, HardDrive, Bug, Timer, ShieldCheck, Braces, FileJson,
  Mail, Phone, Building2, UserCircle, CreditCard, Receipt, Hash,
  Briefcase, FileCode, Play, Square, Package, Settings, CircleDot,
  GitBranch, type LucideIcon,
} from "lucide-react";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";

// ── Animation ──────────────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.05, duration: 0.4, ease: "easeOut" },
  }),
};

// ── Data ───────────────────────────────────────────────────────
const TREE = `flexpay-backend/
├── prisma/
│   └── schema.prisma              # 7 Models · 7 Enums · PostgreSQL
├── scripts/
│   └── seed.ts                    # DB Seeder (Company + Employees)
├── src/
│   ├── index.ts                   # Bootstrap (DB + Redis + Worker)
│   ├── app.ts                     # Express App Factory
│   ├── types/
│   │   └── express.d.ts           # Request Augmentation
│   ├── config/
│   │   ├── env.ts                 # Zod Env Validation (30+ vars)
│   │   ├── prisma.ts              # Prisma Singleton + Connect
│   │   └── redis.ts               # Redis + Cache Helpers
│   ├── utils/
│   │   ├── app-error.ts           # 7 Custom Error Classes
│   │   ├── async-handler.ts       # Async Route Wrapper
│   │   └── logger.ts              # Winston Logger
│   ├── middleware/
│   │   ├── error-handler.ts       # Global Error Handler
│   │   ├── idempotency.ts         # Redis Idempotency (24h TTL)
│   │   ├── rate-limiter.ts        # Sliding-Window (Redis + In-Mem)
│   │   ├── security.ts            # Helmet + HSTS + CORS + Compression
│   │   ├── validate.ts            # Zod Validation Middleware
│   │   └── index.ts               # Barrel Export
│   └── modules/
│       ├── auth/                  # 5 files — OTP + JWT Auth
│       │   ├── auth.controller.ts
│       │   ├── auth.service.ts    # ~575 lines
│       │   ├── auth.validation.ts
│       │   ├── auth.routes.ts
│       │   └── auth.types.ts
│       ├── health/                # 2 files — Liveness + Readiness
│       │   ├── health.service.ts
│       │   └── health.routes.ts
│       ├── wallet/                # 4 files — P2P Transfer + Fee
│       │   ├── wallet.controller.ts
│       │   ├── wallet.service.ts  # ~477 lines
│       │   ├── wallet.validation.ts
│       │   └── wallet.routes.ts
│       └── payroll/               # 5 files — Bull Queue Processing
│           ├── payroll.controller.ts
│           ├── payroll.service.ts  # ~634 lines
│           ├── payroll.worker.ts   # ~162 lines
│           ├── payroll.validation.ts
│           └── payroll.routes.ts
├── .env.example                   # Environment Template (50+ vars)
├── package.json
└── tsconfig.json`;

const ENV_EXAMPLE = `# ── Application ─────────────────────────────
NODE_ENV=development
PORT=3001
HOST=0.0.0.0

# ── Database (PostgreSQL) ────────────────
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/flexpay

# ── Redis ────────────────────────────────
REDIS_URL=redis://localhost:6379
REDIS_PREFIX=flexpay:

# ── JWT / Authentication ────────────────
JWT_ACCESS_SECRET=change-me-to-a-random-32-char-secret-key-here
JWT_REFRESH_SECRET=change-me-to-another-random-32-char-secret-key
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# ── OTP ──────────────────────────────────
OTP_EXPIRY_SECONDS=300
OTP_MAX_ATTEMPTS=3
OTP_LENGTH=6

# ── SMS Provider (twilio|vonage|dummy) ──
SMS_PROVIDER=dummy
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# ── CORS ────────────────────────────────
CORS_ORIGIN=http://localhost:3000
CORS_CREDENTIALS=true

# ── Idempotency ─────────────────────────
IDEMPOTENCY_TTL_HOURS=24

# ── Logging ─────────────────────────────
LOG_LEVEL=debug
LOG_FORMAT=console`;

const RUN_COMMANDS = [
  { cmd: "cd flexpay-backend && bun install", desc: "Install dependencies" },
  { cmd: "cp .env.example .env", desc: "Create environment file" },
  { cmd: "bun run db:generate", desc: "Generate Prisma client" },
  { cmd: "bun run db:push", desc: "Push schema to PostgreSQL" },
  { cmd: "bun run db:seed", desc: "Seed database with sample data" },
  { cmd: "bun run dev", desc: "Start dev server (port 3001)" },
  { cmd: "bun run build", desc: "Build for production" },
  { cmd: "bun run start", desc: "Start production server" },
];

const API_ENDPOINTS = [
  { method: "POST", path: "/auth/otp/request", auth: false, rate: "3/hr/phone", desc: "Request OTP via Twilio" },
  { method: "POST", path: "/auth/otp/verify", auth: false, rate: "—", desc: "Verify OTP, issue JWT" },
  { method: "POST", path: "/auth/company/register", auth: false, rate: "Idempotent", desc: "Register company account" },
  { method: "POST", path: "/auth/company/login", auth: false, rate: "5/15min/email", desc: "Company login (email+password)" },
  { method: "POST", path: "/auth/refresh", auth: true, rate: "—", desc: "Rotate access token" },
  { method: "GET", path: "/wallet/balance", auth: true, rate: "—", desc: "Get wallet balance" },
  { method: "POST", path: "/wallet/transfer", auth: true, rate: "10/min + Idem", desc: "P2P transfer with fees" },
  { method: "GET", path: "/wallet/transactions", auth: true, rate: "—", desc: "Transaction history" },
  { method: "POST", path: "/wallet/freeze/:id", auth: true, rate: "Admin", desc: "Freeze wallet" },
  { method: "POST", path: "/wallet/unfreeze/:id", auth: true, rate: "Admin", desc: "Unfreeze wallet" },
  { method: "POST", path: "/payroll", auth: true, rate: "Idempotent", desc: "Create single payroll" },
  { method: "POST", path: "/payroll/batch", auth: true, rate: "Idempotent", desc: "Batch payroll (max 500)" },
  { method: "POST", path: "/payroll/schedule", auth: true, rate: "—", desc: "Schedule recurring payroll" },
  { method: "GET", path: "/payroll/history", auth: true, rate: "—", desc: "Payroll history" },
  { method: "GET", path: "/payroll/stats", auth: true, rate: "—", desc: "Payroll statistics" },
  { method: "GET", path: "/health", auth: false, rate: "—", desc: "Liveness probe" },
  { method: "GET", path: "/health/ready", auth: false, rate: "—", desc: "Readiness (DB+Redis)" },
];

const SPECS: { icon: LucideIcon; title: string; sub: string; cat: string; status: "done" | "partial" }[] = [
  { icon: Database, title: "Prisma + PostgreSQL + Redis", sub: "7 Models, 7 Enums, Caching, OTP storage", cat: "Database", status: "done" },
  { icon: Shield, title: "Helmet + HSTS + CORS + Compression", sub: "10kb JSON limit, CSP, strict-origin", cat: "Security", status: "done" },
  { icon: Bug, title: "Unified Error Handling", sub: "7 AppError classes, Prisma/Zod mapping", cat: "Middleware", status: "done" },
  { icon: Activity, title: "/health + /health/ready", sub: "Liveness + DB/Redis readiness checks", cat: "Monitoring", status: "done" },
  { icon: RefreshCw, title: "Idempotency Middleware", sub: "Redis-backed, 24h TTL, race-guard", cat: "Reliability", status: "done" },
  { icon: Lock, title: "Auth Module", sub: "Employee OTP + Company Email/Password + JWT", cat: "Authentication", status: "done" },
  { icon: Wallet, title: "Wallet Module", sub: "P2P transfer, atomic tx, fee logic", cat: "Financial", status: "done" },
  { icon: Clock, title: "Payroll Module", sub: "Bull Queue, scheduling, batch processing", cat: "Async", status: "done" },
  { icon: Code2, title: "Zod + Winston + asyncHandler", sub: "Validation, structured logging, error wrap", cat: "DX", status: "done" },
  { icon: Layers, title: "Rate Limiting", sub: "Redis sliding-window + in-memory fallback", cat: "Security", status: "done" },
];

const CRITERIA = [
  { title: "Security & Infrastructure", icon: Shield, color: "emerald", items: [
    "Helmet enabled with strict CSP directives",
    "HSTS: max-age=31536000, includeSubDomains, preload",
    "CORS restricted to CORS_ORIGIN env (comma-separated)",
    "Compression: gzip level 6, threshold 1KB",
    "JSON body limit enforced at 10kb",
    "Request ID: UUID v4 per request, X-Request-Id header",
  ]},
  { title: "Health Checks", icon: Activity, color: "teal", items: [
    "GET /health → 200, uptime + timestamp (liveness)",
    "GET /health/ready → DB SELECT 1 + Redis PING (readiness)",
    "Returns 503 with dependency details on failure",
  ]},
  { title: "Idempotency", icon: RefreshCw, color: "green", items: [
    "Idempotency-Key header on POST/PUT routes",
    "Redis SET NX race-condition guard (30s lock)",
    "Response cached with 24h TTL",
    "X-Idempotency-Replayed / X-Idempotency-Created headers",
    "Graceful degradation if Redis unavailable",
  ]},
  { title: "Auth — Employee", icon: Phone, color: "cyan", items: [
    "POST /auth/otp/request → OTP via Twilio (or dummy console)",
    "OTP stored in DB + Redis with 5-min TTL",
    "Rate limit: 3 requests/hour/phone number",
    "Max 3 verification attempts per OTP",
    "Auto-creates Employee + Wallet on first verify",
    "JWT access (15m) + refresh (7d) tokens",
  ]},
  { title: "Auth — Company", icon: Building2, color: "sky", items: [
    "POST /auth/company/register → bcrypt password hashing",
    "Unique email + tradeLicense validation",
    "Auto-creates Company + Wallet in transaction",
    "POST /auth/company/login → email/password verification",
    "Rate limit: 5 attempts/15min/email",
    "JWT refresh with Redis revocation + rotation",
  ]},
  { title: "Wallet", icon: CreditCard, color: "lime", items: [
    "GET /wallet/balance → balance, currency, frozen status",
    "POST /wallet/transfer → P2P atomic Prisma $transaction",
    "Fee: 0.5% (min 1 AED, max 25 AED)",
    "Self-transfer prevention, frozen wallet check",
    "Idempotent: same key returns cached transfer result",
    "Rate limit: 10 transfers/min per user",
    "Admin: freeze/unfreeze wallet with reason",
  ]},
  { title: "Payroll", icon: Briefcase, color: "amber", items: [
    "POST /payroll → create single payroll, enqueue to Bull",
    "POST /payroll/batch → up to 500 employees, dedup",
    "POST /payroll/schedule → cron + Bull repeatable job",
    "Bull queue: 3 retries, exponential backoff",
    "Worker concurrency: 5 payroll, 1 scheduled",
    "Atomic: wallet credit + PAYROLL_CREDIT transaction",
  ]},
  { title: "Error Handling", icon: Bug, color: "rose", items: [
    "7 AppError subclasses (404/401/403/400/409/429/503)",
    "ZodError → 400 with field-level details",
    "Prisma P2002→409, P2025→404, P2003→400",
    "JSON parse error → 400",
    "Production: sanitized 500, dev: stack trace",
  ]},
  { title: "Logging", icon: FileJson, color: "violet", items: [
    "Winston: console (dev) + JSON (prod)",
    "Request/response logging with duration + request ID",
    "Error logging with stack traces",
    "Redis event logging (connect/reconnect/error)",
  ]},
  { title: "DX & Tooling", icon: Code2, color: "orange", items: [
    "Zod: env validation + request body/query/params",
    "asyncHandler: wraps async Express handlers",
    "TypeScript strict mode, path aliases (@/*)",
    "ESM modules, tsx for dev/build",
    "Graceful shutdown: SIGINT/SIGTERM handlers",
  ]},
];

const CODE_SNIPPETS = [
  {
    title: "app.ts — Express App Factory",
    lang: "typescript",
    code: `import express from "express";
import { securityHeaders } from "@/middleware/security";
import { errorHandler, notFoundHandler } from "@/middleware/error-handler";
import healthRouter from "@/modules/health/health.routes.js";
import authRouter from "@/modules/auth/auth.routes.js";
import walletRouter from "@/modules/wallet/wallet.routes.js";
import payrollRouter from "@/modules/payroll/payroll.routes.js";

export function createApp(): express.Application {
  const app = express();

  // Security: Helmet + HSTS + CORS + Compression + JSON 10kb
  securityHeaders(app);

  // Routes
  app.use("/health", healthRouter);
  app.use("/auth", authRouter);
  app.use("/wallet", walletRouter);
  app.use("/payroll", payrollRouter);

  // 404 → Error Handler
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}`,
  },
  {
    title: "app-error.ts — Custom Error Classes",
    lang: "typescript",
    code: `export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, statusCode = 500, opts?) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.statusCode = statusCode;
    this.isOperational = opts?.isOperational ?? true;
    this.details = opts?.details;
  }
}

export class NotFoundError extends AppError { /* 404 */ }
export class UnauthorizedError extends AppError { /* 401 */ }
export class ForbiddenError extends AppError { /* 403 */ }
export class BadRequestError extends AppError { /* 400 */ }
export class ConflictError extends AppError { /* 409 */ }
export class TooManyRequestsError extends AppError { /* 429 */ }
export class ServiceUnavailableError extends AppError { /* 503 */ }`,
  },
  {
    title: "idempotency.ts — Redis Idempotency Middleware",
    lang: "typescript",
    code: `export function idempotencyMiddleware(options?) {
  const ttlSeconds = (options?.ttlHours ?? 24) * 3600;

  return async (req, res, next) => {
    const key = req.headers["idempotency-key"];
    if (!key) return next();

    const redisKey = \`idem:\${req.method}:\${req.originalUrl}:\${key}\`;
    const existing = await redis.get(redisKey);

    if (existing) {
      // Replay cached response
      res.setHeader("X-Idempotency-Replayed", "true");
      return res.status(cached.statusCode).json(cached.responseBody);
    }

    // Race-condition guard via SET NX
    const lockAcquired = await redis.set(\`\${redisKey}:lock\`, "1", "EX", 30, "NX");

    // Wrap res.json to capture handler response
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      redis.set(redisKey, JSON.stringify(cacheEntry), "EX", ttlSeconds);
      res.setHeader("X-Idempotency-Created", "true");
      res.json = originalJson;
      return originalJson(body);
    };

    next();
  };
}`,
  },
  {
    title: "wallet.service.ts — Atomic P2P Transfer",
    lang: "typescript",
    code: `async transfer(senderId: string, recipientPhone: string, amount: number) {
  return prisma.$transaction(async (tx) => {
    // 1. Validate wallets
    const senderWallet = await tx.wallet.findUniqueOrThrow({
      where: { ownerId: senderId }
    });

    // 2. Calculate fee (0.5%, min 1, max 25 AED)
    const fee = Math.min(Math.max(amount * 0.005, 1), 25);

    // 3. Debit sender
    await tx.wallet.update({
      where: { id: senderWallet.id },
      data: { balance: { decrement: amount + fee } }
    });

    // 4. Credit recipient
    await tx.wallet.update({
      where: { id: recipientWallet.id },
      data: { balance: { increment: amount } }
    });

    // 5. Create transaction records
    await tx.transaction.createMany({
      data: [
        { type: "TRANSFER_OUT", amount, fee, walletId: senderWallet.id },
        { type: "TRANSFER_IN", amount, fee: 0, walletId: recipientWallet.id },
        { type: "FEE", amount: fee, walletId: senderWallet.id },
      ]
    });
  });
}`,
  },
  {
    title: "rate-limiter.ts — Sliding Window (Redis)",
    lang: "typescript",
    code: `async function checkRedisLimit(key, windowMs, maxRequests) {
  const now = Date.now();
  const pipeline = redis.pipeline();

  // Remove timestamps outside the sliding window
  pipeline.zremrangebyscore(key, 0, now - windowMs);

  // Add current request timestamp
  pipeline.zadd(key, now, \`\${now}:\${randomId}\`);

  // Count requests in window
  pipeline.zcard(key);
  pipeline.expire(key, Math.ceil(windowMs / 1000) + 10);

  const results = await pipeline.exec();
  const count = results?.[2]?.[1] ?? 0;

  return {
    limit: maxRequests,
    remaining: Math.max(0, maxRequests - count),
    reset: now + windowMs,
  };
}`,
  },
  {
    title: "payroll.worker.ts — Bull Queue Worker",
    lang: "typescript",
    code: `export async function startWorker() {
  const queue = createPayrollQueue();

  // Process payroll: concurrency 5
  queue.process("process-payroll", 5, async (job) => {
    const { payrollId } = job.data;
    return processPayroll(payrollId);
  });

  // Scheduled payroll: concurrency 1
  queue.process("scheduled-payroll", 1, async (job) => {
    const { companyId, schedule } = job.data;
    return processScheduledPayroll(companyId, schedule);
  });

  // Event handlers
  queue.on("completed", (job) => logger.info(\`Payroll \${job.id} completed\`));
  queue.on("failed", (job, err) => logger.error(\`Payroll \${job.id} failed\`, { error: err }));
  queue.on("stalled", (job) => logger.warn(\`Payroll \${job.id} stalled\`));
}`,
  },
];

const DB_MODELS = [
  { name: "Company", icon: Building2, fields: ["id UUID PK", "tradeLicense UNIQUE", "name String", "email UNIQUE", "passwordHash String", "phone String", "employeeCount Int", "isActive Boolean"] },
  { name: "Employee", icon: UserCircle, fields: ["id UUID PK", "companyId UUID FK", "firstName String", "lastName String", "phone UNIQUE", "email UNIQUE?", "passwordHash String?", "kycLevel Enum(NONE|BASIC|FULL)"] },
  { name: "Wallet", icon: Wallet, fields: ["id UUID PK", "ownerId UNIQUE", "type Enum(EMP|COMP)", "balance Decimal(18,4)", "currency String", "isFrozen Boolean", "frozenReason String?"] },
  { name: "Transaction", icon: Receipt, fields: ["id UUID PK", "walletId UUID FK", "type Enum(8 types)", "amount Decimal(18,4)", "fee Decimal(18,4)", "referenceId UNIQUE?", "status Enum(PENDING|COMPLETED|FAILED|REVERSED)"] },
  { name: "OTP", icon: Hash, fields: ["id UUID PK", "phone String", "code String", "purpose Enum(LOGIN|REG|RESET)", "attempts Int", "maxAttempts Int", "expiresAt DateTime"] },
  { name: "Payroll", icon: Briefcase, fields: ["id UUID PK", "companyId UUID FK", "employeeId UUID FK", "grossAmount Decimal", "netAmount Decimal", "deductions Decimal", "status Enum(PENDING|PROCESSING|COMPLETED|FAILED)"] },
  { name: "IdempotencyKey", icon: KeyRound, fields: ["id UUID PK", "key UNIQUE", "endpoint String", "method String", "requestBody JSON", "responseBody JSON?", "statusCode Int", "expiresAt DateTime"] },
];

// ── Color Map ──────────────────────────────────────────────────
const colorMap: Record<string, { text: string; border: string; bg: string; badge: string }> = {
  emerald: { text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-200 dark:border-emerald-800/50", bg: "bg-emerald-50/50 dark:bg-emerald-950/20", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  teal: { text: "text-teal-600 dark:text-teal-400", border: "border-teal-200 dark:border-teal-800/50", bg: "bg-teal-50/50 dark:bg-teal-950/20", badge: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300" },
  green: { text: "text-green-600 dark:text-green-400", border: "border-green-200 dark:border-green-800/50", bg: "bg-green-50/50 dark:bg-green-950/20", badge: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  cyan: { text: "text-cyan-600 dark:text-cyan-400", border: "border-cyan-200 dark:border-cyan-800/50", bg: "bg-cyan-50/50 dark:bg-cyan-950/20", badge: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300" },
  sky: { text: "text-sky-600 dark:text-sky-400", border: "border-sky-200 dark:border-sky-800/50", bg: "bg-sky-50/50 dark:bg-sky-950/20", badge: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" },
  lime: { text: "text-lime-600 dark:text-lime-400", border: "border-lime-200 dark:border-lime-800/50", bg: "bg-lime-50/50 dark:bg-lime-950/20", badge: "bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300" },
  amber: { text: "text-amber-600 dark:text-amber-400", border: "border-amber-200 dark:border-amber-800/50", bg: "bg-amber-50/50 dark:bg-amber-950/20", badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  rose: { text: "text-rose-600 dark:text-rose-400", border: "border-rose-200 dark:border-rose-800/50", bg: "bg-rose-50/50 dark:bg-rose-950/20", badge: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
  violet: { text: "text-violet-600 dark:text-violet-400", border: "border-violet-200 dark:border-violet-800/50", bg: "bg-violet-50/50 dark:bg-violet-950/20", badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  orange: { text: "text-orange-600 dark:text-orange-400", border: "border-orange-200 dark:border-orange-800/50", bg: "bg-orange-50/50 dark:bg-orange-950/20", badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
};

const methodColors: Record<string, string> = {
  GET: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/50",
  POST: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/50",
  PUT: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/50",
  DELETE: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/50",
};

// ── Components ─────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  }, [text]);
  return (
    <button onClick={copy} className="absolute right-3 top-3 flex items-center gap-1.5 rounded-md border border-border/50 bg-background/80 px-2.5 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-sm transition-all hover:border-emerald-300 hover:text-emerald-700 dark:hover:border-emerald-700 dark:hover:text-emerald-300 z-10">
      {copied ? <><Check className="size-3 text-emerald-600" />Copied</> : <><Copy className="size-3" />Copy</>}
    </button>
  );
}

function MethodBadge({ method }: { method: string }) {
  return <Badge variant="outline" className={`min-w-[3rem] justify-center font-mono text-[10px] font-bold ${methodColors[method] ?? ""}`}>{method}</Badge>;
}

function SectionHeader({ icon: Icon, title, badge }: { icon: LucideIcon; title: string; badge?: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <Icon className="size-5 text-emerald-600 dark:text-emerald-400" />
      <h2 className="text-lg font-bold text-foreground">{title}</h2>
      {badge && <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{badge}</Badge>}
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 rounded-xl bg-white/10 p-3 backdrop-blur-sm">
      <Icon className="size-4.5 shrink-0 text-emerald-200" />
      <div>
        <p className="text-lg font-bold leading-none text-white">{value}</p>
        <p className="text-[10px] font-medium text-emerald-200/60">{label}</p>
      </div>
    </motion.div>
  );
}

// ── Hero ───────────────────────────────────────────────────────
function Hero() {
  return (
    <motion.div variants={fadeUp} custom={0}>
      <Card className="relative overflow-hidden border-0 py-0 shadow-xl">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-600 via-teal-700 to-cyan-800 dark:from-emerald-900 dark:via-teal-900 dark:to-cyan-950" />
        <div className="absolute -right-16 -top-16 size-72 rounded-full bg-white/5" />
        <div className="absolute -bottom-20 -left-12 size-56 rounded-full bg-white/5" />
        <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
        <CardContent className="relative p-6 sm:p-8">
          <div className="flex flex-col gap-6">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm"><Server className="size-4.5 text-white" /></div>
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-200/80">Express.js + TypeScript Backend</span>
                <p className="text-[10px] text-emerald-300/50">Production-Ready API · FlexPay</p>
              </div>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl lg:text-4xl">
              Express.js + TypeScript Backend
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-emerald-100/70 sm:text-base">
              مشروع backend كامل ومُنتَج بـ 10 مواصفات، 17 endpoint، 7 نماذج قاعدة بيانات،
              و middleware pipeline بمستوى المؤسسات. يشمل: Auth (OTP+JWT)، Wallet (P2P+رسوم)، Payroll (Bull Queue)، Health Checks، Idempotency، و Rate Limiting.
            </p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
              <StatCard icon={BadgeCheck} label="Specifications" value="10/10" />
              <StatCard icon={Globe} label="API Endpoints" value="17" />
              <StatCard icon={Database} label="DB Models" value="7" />
              <StatCard icon={Layers} label="Middleware" value="6" />
              <StatCard icon={FileCode} label="Source Files" value="31" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Specs Grid ─────────────────────────────────────────────────
function SpecsGrid() {
  return (
    <motion.div variants={fadeUp} custom={1}>
      <SectionHeader icon={BadgeCheck} title="Specifications" badge="All 10 Implemented" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {SPECS.map((s, i) => (
          <motion.div key={s.title} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.04, duration: 0.35 }}>
            <Card className="group overflow-hidden border-border/60 transition-all duration-300 hover:border-emerald-200 hover:shadow-md dark:hover:border-emerald-800/60">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40"><s.icon className="size-4 text-emerald-600 dark:text-emerald-400" /></div>
                  <CheckCircle2 className="size-4 text-emerald-500" />
                </div>
                <h3 className="mt-3 text-xs font-bold leading-tight text-foreground">{s.title}</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{s.sub}</p>
                <Badge variant="outline" className="mt-2.5 border-border/50 text-[9px] font-medium text-muted-foreground">{s.cat}</Badge>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

// ── Run Commands ───────────────────────────────────────────────
function RunCommands() {
  return (
    <motion.div variants={fadeUp} custom={2}>
      <SectionHeader icon={Terminal} title="Run Commands" badge="Quick Start" />
      <Card className="overflow-hidden border-border/60">
        <CardContent className="relative p-0">
          <CopyBtn text={RUN_COMMANDS.map(c => c.cmd).join("\n")} />
          <div className="bg-slate-950 p-5 dark:bg-slate-950">
            <pre className="text-[13px] leading-7 font-mono">
              {RUN_COMMANDS.map((c, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="select-none text-emerald-500/60">$</span>
                  <div className="flex-1">
                    <span className="text-emerald-300">{c.cmd}</span>
                    <span className="ml-3 text-slate-500"># {c.desc}</span>
                  </div>
                </div>
              ))}
            </pre>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Tree Structure ─────────────────────────────────────────────
function TreeStructure() {
  const lines = TREE.split("\n");
  return (
    <motion.div variants={fadeUp} custom={3}>
      <SectionHeader icon={FolderOpen} title="Project Structure" badge="31 Source Files" />
      <Card className="overflow-hidden border-border/60">
        <CardContent className="relative p-0">
          <CopyBtn text={TREE} />
          <div className="overflow-x-auto bg-slate-950 p-5 dark:bg-slate-950">
            <pre className="text-[12.5px] leading-6 font-mono">
              {lines.map((line, i) => {
                let cls = "text-slate-400";
                if (line.startsWith("flexpay-backend/") || line.trim() === "") cls = "text-slate-200 font-bold";
                else if (line.endsWith("/")) cls = "text-emerald-400 font-semibold";
                else if (line.includes("├──") || line.includes("└──")) cls = "text-slate-300";
                return (
                  <div key={i} className={cls}>
                    {line || "\u00A0"}
                    {line.includes("#") && <span className="text-slate-600 ml-2">#{line.split("#").slice(1).join("#")}</span>}
                  </div>
                );
              })}
            </pre>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Architecture Diagram ───────────────────────────────────────
function ArchitectureDiagram() {
  const nodeCls = "flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-all duration-200";
  const arrow = <div className="flex flex-col items-center py-1"><div className="h-5 w-px bg-emerald-300 dark:bg-emerald-700" /><ChevronRight className="size-3.5 -rotate-90 text-emerald-400" /></div>;
  return (
    <motion.div variants={fadeUp} custom={4}>
      <SectionHeader icon={Braces} title="Architecture Diagram" />
      <Card className="overflow-hidden border-border/60">
        <CardContent className="p-5 sm:p-8">
          <div className="flex flex-col items-center gap-2">
            <div className={`${nodeCls} border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300`}>
              <Globe className="size-4" />Client (Web / Mobile)
            </div>
            {arrow}
            <div className={`w-full max-w-2xl ${nodeCls} justify-center border-emerald-400 bg-emerald-50 text-emerald-700 shadow-md dark:border-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300`}>
              <Server className="size-4" />Express Server
              <span className="ml-2 text-[10px] font-normal text-emerald-500 dark:text-emerald-400">Helmet · HSTS · CORS · Compression · JSON 10kb</span>
            </div>
            {arrow}
            <div className="w-full max-w-2xl">
              <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Middleware Pipeline</p>
              <div className="flex flex-wrap justify-center gap-1.5 sm:flex-row sm:gap-2">
                {[{ icon: KeyRound, l: "Request ID" }, { icon: Timer, l: "Rate Limiter" }, { icon: CheckCircle2, l: "Zod Validate" }, { icon: RefreshCw, l: "Idempotency" }, { icon: Lock, l: "JWT Auth" }].map(m => (
                  <div key={m.l} className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
                    <m.icon className="size-3" />{m.l}
                  </div>
                ))}
              </div>
            </div>
            {arrow}
            <div className="w-full max-w-2xl">
              <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Route Modules</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[{ icon: Lock, l: "Auth", c: "cyan" }, { icon: Wallet, l: "Wallet", c: "emerald" }, { icon: Briefcase, l: "Payroll", c: "amber" }, { icon: Activity, l: "Health", c: "teal" }].map(m => (
                  <div key={m.l} className={`flex items-center justify-center gap-1.5 rounded-lg border border-${m.c}-200 bg-${m.c}-50 px-3 py-2.5 text-xs font-semibold text-${m.c}-700 dark:border-${m.c}-800/60 dark:bg-${m.c}-950/30 dark:text-${m.c}-300`}>
                    <m.icon className="size-3.5" />{m.l}
                  </div>
                ))}
              </div>
            </div>
            {arrow}
            <div className="flex w-full max-w-2xl flex-col gap-2 sm:flex-row sm:items-stretch">
              <div className="flex-1">
                <p className="mb-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Data Layer</p>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs font-semibold text-blue-700 dark:border-blue-800/60 dark:bg-blue-950/30 dark:text-blue-300"><Database className="size-3.5" />PostgreSQL (Prisma ORM)</div>
                  <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-300"><HardDrive className="size-3.5" />Redis (ioredis)</div>
                </div>
              </div>
              <div className="flex-1">
                <p className="mb-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Job Queue</p>
                <div className="flex h-full flex-col justify-center">
                  <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs font-semibold text-violet-700 dark:border-violet-800/60 dark:bg-violet-950/30 dark:text-violet-300"><Layers className="size-3.5" />Bull Queue (Payroll Worker)</div>
                </div>
              </div>
            </div>
            {arrow}
            <div className={`${nodeCls} border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300`}>
              <ArrowLeftRight className="size-4" />JSON Response (structured error format)
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── API Endpoints ──────────────────────────────────────────────
function ApiEndpoints() {
  return (
    <motion.div variants={fadeUp} custom={5}>
      <SectionHeader icon={Globe} title="API Endpoints" badge="17 Endpoints" />
      <Card className="overflow-hidden border-border/60">
        <CardContent className="p-0">
          <ScrollArea className="max-h-[480px] overflow-y-auto">
            <Table>
              <TableHeader><TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-[72px] font-semibold text-xs">Method</TableHead>
                <TableHead className="font-semibold text-xs">Endpoint</TableHead>
                <TableHead className="w-[60px] font-semibold text-xs">Auth</TableHead>
                <TableHead className="w-[140px] font-semibold text-xs">Rate Limit</TableHead>
                <TableHead className="font-semibold text-xs">Description</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {API_ENDPOINTS.map((ep, i) => (
                  <TableRow key={i} className="hover:bg-muted/20">
                    <TableCell><MethodBadge method={ep.method} /></TableCell>
                    <TableCell><code className="rounded bg-muted/60 px-1.5 py-0.5 text-xs font-mono text-foreground">{ep.path}</code></TableCell>
                    <TableCell>{ep.auth ? <Badge className={`${colorMap.emerald.badge} border-0 text-[10px]`}><Lock className="mr-0.5 size-2" />JWT</Badge> : <Badge variant="outline" className="text-[10px] text-muted-foreground">Public</Badge>}</TableCell>
                    <TableCell><span className="text-xs text-muted-foreground">{ep.rate === "—" ? <span className="text-muted-foreground/40">—</span> : ep.rate === "Idempotent" ? <Badge variant="outline" className={`border-amber-200 bg-amber-50 text-amber-700 text-[10px] dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300`}><RefreshCw className="mr-0.5 size-2" />{ep.rate}</Badge> : ep.rate === "Admin" ? <Badge variant="outline" className={`border-rose-200 bg-rose-50 text-rose-700 text-[10px] dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-300`}><Shield className="mr-0.5 size-2" />{ep.rate}</Badge> : <Badge variant="outline" className={`border-blue-200 bg-blue-50 text-blue-700 text-[10px] dark:border-blue-800/50 dark:bg-blue-950/30 dark:text-blue-300`}><Timer className="mr-0.5 size-2" />{ep.rate}</Badge>}</span></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{ep.desc}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Database Schema ────────────────────────────────────────────
function DatabaseSchema() {
  return (
    <motion.div variants={fadeUp} custom={6}>
      <SectionHeader icon={Database} title="Database Schema" badge="7 Models · 7 Enums · PostgreSQL" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {DB_MODELS.map((m, i) => (
          <motion.div key={m.name} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.35 }}>
            <Card className="group overflow-hidden border-border/60 transition-all duration-300 hover:shadow-md">
              <CardHeader className="border-b bg-muted/20 p-3 pb-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40"><m.icon className="size-4 text-emerald-600 dark:text-emerald-400" /></div>
                  <CardTitle className="text-sm">{m.name}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-3">
                <div className="space-y-1">
                  {m.fields.map(f => (
                    <div key={f} className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] hover:bg-muted/40">
                      <CircleDot className="size-2 shrink-0 text-muted-foreground/40" />
                      <span className="font-mono text-foreground/80">{f}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

// ── Code Snippets ──────────────────────────────────────────────
function CodeSnippets() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <motion.div variants={fadeUp} custom={7}>
      <SectionHeader icon={FileCode} title="Key Source Code" badge={`${CODE_SNIPPETS.length} Snippets`} />
      <div className="space-y-2">
        {CODE_SNIPPETS.map((snippet, i) => (
          <Collapsible key={i} open={openIdx === i} onOpenChange={(v) => setOpenIdx(v ? i : null)}>
            <Card className="overflow-hidden border-border/60 transition-all duration-200 hover:border-emerald-200 dark:hover:border-emerald-800/50">
              <CollapsibleTrigger className="flex w-full items-center justify-between p-4 text-left hover:bg-muted/20 transition-colors">
                <div className="flex items-center gap-2.5">
                  <FileCode className="size-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-sm font-semibold text-foreground">{snippet.title}</span>
                  <Badge variant="outline" className="text-[9px] font-medium text-muted-foreground">{snippet.lang}</Badge>
                </div>
                {openIdx === i ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
              </CollapsibleTrigger>
              <AnimatePresence>
                {openIdx === i && (
                  <CollapsibleContent>
                    <div className="relative border-t bg-slate-950 p-0 dark:bg-slate-950">
                      <CopyBtn text={snippet.code} />
                      <pre className="overflow-x-auto p-4 text-[12px] leading-6 font-mono text-slate-300">
                        <code>{snippet.code}</code>
                      </pre>
                    </div>
                  </CollapsibleContent>
                )}
              </AnimatePresence>
            </Card>
          </Collapsible>
        ))}
      </div>
    </motion.div>
  );
}

// ── Acceptance Criteria ────────────────────────────────────────
function AcceptanceCriteria() {
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    CRITERIA.forEach(g => g.items.forEach(item => { init[item] = true; }));
    return init;
  });

  const toggle = (item: string) => setChecked(prev => ({ ...prev, [item]: !prev[item] }));
  const total = CRITERIA.reduce((s, g) => s + g.items.length, 0);
  const done = Object.values(checked).filter(Boolean).length;

  return (
    <motion.div variants={fadeUp} custom={8}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-lg font-bold text-foreground">Acceptance Criteria</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${(done / total) * 100}%` }} />
          </div>
          <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{done}/{total}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CRITERIA.map((g) => {
          const c = colorMap[g.color] ?? colorMap.emerald;
          return (
            <motion.div key={g.title} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
              <Card className={`border ${c.border} overflow-hidden`}>
                <CardHeader className={`border-b ${c.bg} p-3 pb-2.5`}>
                  <div className="flex items-center gap-2">
                    <g.icon className={`size-4 ${c.text}`} />
                    <CardTitle className="text-sm">{g.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1.5 p-3">
                  {g.items.map(item => (
                    <label key={item} className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-[11px] leading-relaxed hover:bg-muted/30 transition-colors">
                      <input
                        type="checkbox"
                        checked={checked[item] ?? false}
                        onChange={() => toggle(item)}
                        className="mt-0.5 size-3.5 rounded border-border accent-emerald-600"
                      />
                      <span className={checked[item] ? "text-foreground" : "text-muted-foreground"}>{item}</span>
                    </label>
                  ))}
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Environment Variables ──────────────────────────────────────
function EnvSection() {
  return (
    <motion.div variants={fadeUp} custom={9}>
      <SectionHeader icon={Settings} title="Environment Variables" badge=".env.example" />
      <Card className="overflow-hidden border-border/60">
        <CardContent className="relative p-0">
          <CopyBtn text={ENV_EXAMPLE} />
          <div className="bg-slate-950 p-5 dark:bg-slate-950">
            <pre className="overflow-x-auto text-[12.5px] leading-6 font-mono">
              {ENV_EXAMPLE.split("\n").map((line, i) => (
                <div key={i} className={line.startsWith("#") ? "text-slate-500" : line.includes("=") ? "text-slate-300" : "text-slate-400"}>
                  {line.includes("=") ? (
                    <>
                      <span className="text-cyan-400">{line.split("=")[0]}</span>
                      <span className="text-slate-600">=</span>
                      <span className="text-amber-300/80">{line.split("=").slice(1).join("=")}</span>
                    </>
                  ) : line || "\u00A0"}
                </div>
              ))}
            </pre>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Dependencies ───────────────────────────────────────────────
function Dependencies() {
  const deps = [
    { name: "express", ver: "^5.1.0", cat: "Core" },
    { name: "@prisma/client", ver: "^6.11.1", cat: "Database" },
    { name: "ioredis", ver: "^5.6.1", cat: "Cache" },
    { name: "bull", ver: "^4.16.5", cat: "Queue" },
    { name: "helmet", ver: "^8.1.0", cat: "Security" },
    { name: "cors", ver: "^2.8.5", cat: "Security" },
    { name: "compression", ver: "^1.8.0", cat: "Perf" },
    { name: "jsonwebtoken", ver: "^9.0.2", cat: "Auth" },
    { name: "bcryptjs", ver: "^3.0.2", cat: "Auth" },
    { name: "twilio", ver: "^5.7.0", cat: "SMS" },
    { name: "zod", ver: "^3.25.76", cat: "Validation" },
    { name: "winston", ver: "^3.17.0", cat: "Logging" },
    { name: "uuid", ver: "^11.1.0", cat: "Utils" },
    { name: "tsx", ver: "^4.19.0", cat: "Dev" },
    { name: "typescript", ver: "^5.8", cat: "Dev" },
  ];

  return (
    <motion.div variants={fadeUp} custom={10}>
      <SectionHeader icon={Package} title="Dependencies" badge={`${deps.length} Packages`} />
      <Card className="overflow-hidden border-border/60">
        <CardContent className="p-0">
          <div className="grid grid-cols-1 gap-0 sm:grid-cols-2 lg:grid-cols-3">
            {deps.map(d => (
              <div key={d.name} className="flex items-center gap-2.5 border-b border-r border-border/40 px-4 py-2.5 hover:bg-muted/20 transition-colors">
                <GitBranch className="size-3.5 shrink-0 text-muted-foreground/50" />
                <span className="text-xs font-mono font-semibold text-foreground">{d.name}</span>
                <span className="text-[10px] font-mono text-muted-foreground">{d.ver}</span>
                <Badge variant="outline" className="ml-auto text-[9px] text-muted-foreground">{d.cat}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Main Component ─────────────────────────────────────────────
export function BackendOverviewPage() {
  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <Hero />
      <SpecsGrid />

      <Tabs defaultValue="commands" className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto bg-muted/50 p-0.5 h-auto flex-wrap gap-1">
          {[
            { v: "commands", l: "Commands", ic: Terminal },
            { v: "tree", l: "Project Tree", ic: FolderOpen },
            { v: "arch", l: "Architecture", ic: Braces },
            { v: "api", l: "API Endpoints", ic: Globe },
            { v: "db", l: "DB Schema", ic: Database },
            { v: "code", l: "Source Code", ic: FileCode },
            { v: "criteria", l: "Acceptance Criteria", ic: ShieldCheck },
            { v: "env", l: "Environment", ic: Settings },
            { v: "deps", l: "Dependencies", ic: Package },
          ].map(t => (
            <TabsTrigger key={t.v} value={t.v} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <t.ic className="size-3.5" />{t.l}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="mt-4">
          <TabsContent value="commands"><RunCommands /></TabsContent>
          <TabsContent value="tree"><TreeStructure /></TabsContent>
          <TabsContent value="arch"><ArchitectureDiagram /></TabsContent>
          <TabsContent value="api"><ApiEndpoints /></TabsContent>
          <TabsContent value="db"><DatabaseSchema /></TabsContent>
          <TabsContent value="code"><CodeSnippets /></TabsContent>
          <TabsContent value="criteria"><AcceptanceCriteria /></TabsContent>
          <TabsContent value="env"><EnvSection /></TabsContent>
          <TabsContent value="deps"><Dependencies /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

export default BackendOverviewPage;
