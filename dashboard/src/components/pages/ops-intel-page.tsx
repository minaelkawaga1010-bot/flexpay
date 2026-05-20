"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Activity,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  RefreshCw,
  CheckCircle2,
  Clock,
  Users,
  Building2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CANARY_DEFAULT_RATE,
  CANARY_WARN_RATE,
  classifyCohort,
  formatAED,
  formatRatio,
  opsIntelClient,
  type CohortDefault,
  type FraudScanResult,
  type LiquidityForecast,
  type ReportMetrics,
} from "@/lib/ops-intel-client";

/**
 * Operational Intelligence — corporate-facing live view of the three
 * Command-5 endpoints we shipped:
 *
 *   1. /api/v1/admin/reports/metrics    → board-deck KPIs + canary
 *   2. /api/v1/admin/reports/liquidity  → 7/15/30 runway curve
 *   3. /api/v1/admin/reports/fraud-scan → velocity + attendance alerts
 *
 * The canary banner is the most important pixel on the page: a
 * tripped 1.5% cohort means autonomous DCSE limit-raising has been
 * stripped for that cohort (STRATEGY.md §F). A warning row (>= 1.25%)
 * means we're within 25 bps of the trigger and ops should look.
 */

interface PageData {
  metrics: ReportMetrics | null;
  liquidity: LiquidityForecast | null;
  fraud: FraudScanResult | null;
  loading: boolean;
  error: string | null;
  refreshedAt: Date | null;
}

const INITIAL: PageData = {
  metrics: null,
  liquidity: null,
  fraud: null,
  loading: true,
  error: null,
  refreshedAt: null,
};

export function OpsIntelPage() {
  const [data, setData] = useState<PageData>(INITIAL);

  const loadAll = useCallback(async () => {
    setData((d) => ({ ...d, loading: true, error: null }));
    try {
      const [metrics, liquidity, fraud] = await Promise.all([
        opsIntelClient.fetchMetrics(30),
        opsIntelClient.fetchLiquidity(),
        opsIntelClient.runFraudScan(),
      ]);
      setData({
        metrics,
        liquidity,
        fraud,
        loading: false,
        error: null,
        refreshedAt: new Date(),
      });
    } catch (err) {
      setData((d) => ({
        ...d,
        loading: false,
        error: (err as Error).message ?? "Unknown error",
      }));
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  return (
    <div className="space-y-6 p-6">
      <Header data={data} onRefresh={loadAll} />

      {data.error ? (
        <Alert variant="destructive" data-testid="ops-intel-error">
          <AlertTriangle className="size-4" />
          <AlertTitle>Could not load operational intelligence</AlertTitle>
          <AlertDescription>{data.error}</AlertDescription>
        </Alert>
      ) : null}

      <CanaryBanner metrics={data.metrics} />

      <KpiGrid metrics={data.metrics} liquidity={data.liquidity} />

      <Tabs defaultValue="liquidity" className="w-full">
        <TabsList>
          <TabsTrigger value="liquidity">Liquidity runway</TabsTrigger>
          <TabsTrigger value="cohorts">Cohort defaults</TabsTrigger>
          <TabsTrigger value="fraud">Fraud signals</TabsTrigger>
        </TabsList>

        <TabsContent value="liquidity">
          <LiquidityPanel forecast={data.liquidity} />
        </TabsContent>

        <TabsContent value="cohorts">
          <CohortsPanel cohorts={data.metrics?.companyCohortDefaults ?? []} />
        </TabsContent>

        <TabsContent value="fraud">
          <FraudPanel fraud={data.fraud} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Header
// ═══════════════════════════════════════════════════════════════════

function Header({
  data,
  onRefresh,
}: {
  data: PageData;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Operational Intelligence</h1>
        <p className="text-sm text-muted-foreground">
          Live board-deck metrics, liquidity runway, and fraud surveillance — sourced from{" "}
          <code className="text-xs">/api/v1/admin/reports/*</code>.
        </p>
      </div>
      <div className="flex items-center gap-3">
        {data.refreshedAt ? (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3" />
            {data.refreshedAt.toLocaleTimeString()}
          </div>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          onClick={onRefresh}
          disabled={data.loading}
          data-testid="ops-intel-refresh"
        >
          <RefreshCw className={`size-4 ${data.loading ? "animate-spin" : ""}`} />
          <span className="ml-2">Refresh</span>
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Canary banner — the most important pixel on the page
// ═══════════════════════════════════════════════════════════════════

function CanaryBanner({ metrics }: { metrics: ReportMetrics | null }) {
  if (!metrics) return null;

  // Anything between WARN_RATE and CANARY_RATE is a "near-freeze" flag.
  const nearFreeze = metrics.companyCohortDefaults.filter(
    (c) => c.defaultRatio >= CANARY_WARN_RATE && c.defaultRatio < CANARY_DEFAULT_RATE,
  );

  if (metrics.canaryTripped) {
    return (
      <Alert variant="destructive" data-testid="canary-tripped-banner">
        <ShieldAlert className="size-5" />
        <AlertTitle>Canary TRIPPED — autonomous DCSE limits stripped</AlertTitle>
        <AlertDescription>
          {metrics.canaryCompanyIds.length} cohort
          {metrics.canaryCompanyIds.length === 1 ? "" : "s"} above the{" "}
          {formatRatio(CANARY_DEFAULT_RATE)} default threshold. Per STRATEGY.md §F, the
          DCSE failsafe is now enforcing hard-coded safety guardrails (20% absolute
          exposure cap) for affected cohorts. Manual ops review required before
          autonomous limits are restored.
        </AlertDescription>
      </Alert>
    );
  }

  if (nearFreeze.length > 0) {
    return (
      <Alert
        className="border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/20 dark:text-amber-100"
        data-testid="canary-warning-banner"
      >
        <AlertTriangle className="size-5" />
        <AlertTitle>
          {nearFreeze.length} cohort{nearFreeze.length === 1 ? "" : "s"} approaching
          canary freeze
        </AlertTitle>
        <AlertDescription>
          Within 25 bps of the {formatRatio(CANARY_DEFAULT_RATE)} trigger. Investigate
          before autonomous DCSE limit-raising is stripped:{" "}
          {nearFreeze
            .slice(0, 3)
            .map((c) => `${c.companyName} (${formatRatio(c.defaultRatio)})`)
            .join(" · ")}
          {nearFreeze.length > 3 ? " · …" : ""}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert
      className="border-emerald-400 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100"
      data-testid="canary-healthy-banner"
    >
      <CheckCircle2 className="size-5" />
      <AlertTitle>All cohorts below canary threshold</AlertTitle>
      <AlertDescription>
        Platform default ratio: {formatRatio(metrics.defaultRatio)} · DCSE autonomous
        limit-raising active across all {metrics.companyCohortDefaults.length} cohort
        {metrics.companyCohortDefaults.length === 1 ? "" : "s"}.
      </AlertDescription>
    </Alert>
  );
}

// ═══════════════════════════════════════════════════════════════════
// KPI grid
// ═══════════════════════════════════════════════════════════════════

function KpiGrid({
  metrics,
  liquidity,
}: {
  metrics: ReportMetrics | null;
  liquidity: LiquidityForecast | null;
}) {
  const cards: { title: string; value: string; sub?: string; icon: React.ReactNode }[] =
    [
      {
        title: "GMV (30d)",
        value: metrics ? formatAED(metrics.gmvAED) : "—",
        sub: "Advance + remittance + card + P2P",
        icon: <TrendingUp className="size-4" />,
      },
      {
        title: "MAU (30d)",
        value: metrics ? metrics.mau.toLocaleString("en-AE") : "—",
        sub: "Distinct active employees",
        icon: <Users className="size-4" />,
      },
      {
        title: "Net marginal revenue",
        value: metrics ? formatAED(metrics.netMarginalRevenueAED) : "—",
        sub: "Fees + 50bps FX + 110bps card IC",
        icon: <Activity className="size-4" />,
      },
      {
        title: "Default ratio (platform)",
        value: metrics ? formatRatio(metrics.defaultRatio) : "—",
        sub: `Canary at ${formatRatio(CANARY_DEFAULT_RATE)}`,
        icon: <ShieldAlert className="size-4" />,
      },
      {
        title: "Outstanding advances",
        value: liquidity ? formatAED(liquidity.outstandingAED) : "—",
        sub: liquidity ? `${liquidity.outstandingCount} RESERVED rows` : undefined,
        icon: <Building2 className="size-4" />,
      },
    ];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
      {cards.map((c, i) => (
        <Card key={i} data-testid={`kpi-card-${i}`}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              {c.title}
            </CardTitle>
            {c.icon}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{c.value}</div>
            {c.sub ? (
              <p className="mt-1 text-xs text-muted-foreground">{c.sub}</p>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Liquidity panel — 7/15/30 runway chart
// ═══════════════════════════════════════════════════════════════════

function LiquidityPanel({ forecast }: { forecast: LiquidityForecast | null }) {
  if (!forecast) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-sm text-muted-foreground">
          Loading liquidity forecast…
        </CardContent>
      </Card>
    );
  }

  const chartData = [7, 15, 30].map((h) => {
    const out =
      forecast.buckets.find((b) => b.horizonDays === h)?.inboundAED ?? 0;
    const inb =
      forecast.corporateInboundsAED.find((b) => b.horizonDays === h)?.amountAED ?? 0;
    const net =
      forecast.netByHorizonAED.find((b) => b.horizonDays === h)?.netAED ?? 0;
    return {
      horizon: `≤ ${h}d`,
      Outstanding: out,
      "Corporate Inbound": inb,
      Net: net,
    };
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>7 / 15 / 30-day liquidity runway</CardTitle>
        <CardDescription>
          Outstanding RESERVED advances bucketed by cycle settlement date, plotted
          against corporate WPS inbound funding in the same horizon. Net = inbound −
          outstanding. Cumulative ("≤ N days"), not exclusive.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-80 w-full" data-testid="liquidity-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="horizon" />
              <YAxis tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
              <Tooltip
                formatter={(v: number) => formatAED(v)}
                labelFormatter={(l: string) => `Horizon: ${l}`}
              />
              <Legend />
              <Bar dataKey="Outstanding" fill="#ef4444" />
              <Bar dataKey="Corporate Inbound" fill="#10b981" />
              <Bar dataKey="Net">
                {chartData.map((row, i) => (
                  <Cell key={i} fill={row.Net >= 0 ? "#3b82f6" : "#f59e0b"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {chartData.map((row, i) => (
            <Card
              key={i}
              className={
                row.Net < 0
                  ? "border-amber-400 bg-amber-50/50 dark:bg-amber-950/10"
                  : ""
              }
              data-testid={`runway-bucket-${row.horizon.replace(/[^0-9]/g, "")}`}
            >
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">{row.horizon} net</div>
                <div
                  className={`text-xl font-bold ${
                    row.Net < 0 ? "text-amber-700 dark:text-amber-400" : ""
                  }`}
                >
                  {row.Net < 0 ? "−" : ""}
                  {formatAED(Math.abs(row.Net))}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {row.Net >= 0
                    ? "Inbound covers exposure in window"
                    : "Outbound exceeds expected inbound — review"}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Cohorts panel — per-company default ratios with canary highlight
// ═══════════════════════════════════════════════════════════════════

function CohortsPanel({ cohorts }: { cohorts: CohortDefault[] }) {
  if (cohorts.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-sm text-muted-foreground">
          No cohort default data for the current window.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Per-cohort default ratios (30-day)</CardTitle>
        <CardDescription>
          Canary trigger fires the moment any single cohort crosses{" "}
          {formatRatio(CANARY_DEFAULT_RATE)} — autonomous DCSE limit-raising is then
          stripped for that cohort.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead className="text-right">Disbursed</TableHead>
              <TableHead className="text-right">Default ratio</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cohorts.map((c) => {
              const status = classifyCohort(c.defaultRatio);
              const rowClass =
                status === "tripped"
                  ? "bg-red-50 dark:bg-red-950/20"
                  : status === "warning"
                    ? "bg-amber-50 dark:bg-amber-950/10"
                    : "";
              return (
                <TableRow
                  key={c.companyId}
                  className={rowClass}
                  data-testid={`cohort-row-${c.companyId}`}
                >
                  <TableCell className="font-medium">{c.companyName}</TableCell>
                  <TableCell className="text-right">
                    {formatAED(c.disbursedAED)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatRatio(c.defaultRatio)}
                  </TableCell>
                  <TableCell className="text-right">
                    {status === "tripped" ? (
                      <Badge variant="destructive">CANARY TRIPPED</Badge>
                    ) : status === "warning" ? (
                      <Badge className="bg-amber-500 hover:bg-amber-600">
                        Approaching freeze
                      </Badge>
                    ) : (
                      <Badge variant="outline">Healthy</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Fraud panel — velocity + attendance drop alerts
// ═══════════════════════════════════════════════════════════════════

function FraudPanel({ fraud }: { fraud: FraudScanResult | null }) {
  if (!fraud) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-sm text-muted-foreground">
          Loading fraud scan results…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-5" />
            Velocity alerts ({fraud.velocityAlerts.length})
          </CardTitle>
          <CardDescription>
            Workers whose advance count in the last 24h is ≥ 4× their 30-day baseline.
            Flag-only — the mobile-API four-factor stack already gates the transactional
            request itself.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {fraud.velocityAlerts.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No velocity anomalies detected in the last 15 minutes.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">24h count</TableHead>
                  <TableHead className="text-right">30d baseline / day</TableHead>
                  <TableHead className="text-right">Multiple</TableHead>
                  <TableHead className="text-right">24h AED</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fraud.velocityAlerts.map((a) => (
                  <TableRow
                    key={a.employeeId}
                    data-testid={`velocity-row-${a.employeeId}`}
                  >
                    <TableCell className="font-mono text-xs">{a.employeeId}</TableCell>
                    <TableCell className="text-right">{a.windowCount}</TableCell>
                    <TableCell className="text-right">
                      {a.baselineMean.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {Number.isFinite(a.multiple) ? `${a.multiple.toFixed(1)}×` : "∞"}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatAED(a.totalAEDInWindow)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="size-5" />
            Attendance drop alerts ({fraud.attendanceDropAlerts.length})
          </CardTitle>
          <CardDescription>
            Companies whose aggregate accrued wages today are ≥ 35% below their 7-day
            mean. Classic UAE ghost-employee fraud vector — surfaced for ops review,
            not auto-blocked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {fraud.attendanceDropAlerts.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No attendance anomalies detected.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead className="text-right">Today accrued</TableHead>
                  <TableHead className="text-right">7d baseline</TableHead>
                  <TableHead className="text-right">Drop</TableHead>
                  <TableHead className="text-right">Intents today</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fraud.attendanceDropAlerts.map((a) => (
                  <TableRow
                    key={a.companyId}
                    data-testid={`attendance-row-${a.companyId}`}
                  >
                    <TableCell className="font-medium">{a.companyName}</TableCell>
                    <TableCell className="text-right">
                      {formatAED(a.todayAccruedAED)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatAED(a.baselineMeanAED)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-amber-700 dark:text-amber-400">
                      −{(a.dropFraction * 100).toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right">
                      {a.affectedIntentCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
