import { NextResponse } from "next/server";

export async function GET() {
  try {
    return NextResponse.json({
      slo: {
        target: 99.95,
        actual: 99.97,
        period: "Q2 2025",
        status: "HEALTHY",
      },
      errorBudget: {
        total: 100,
        consumed: 32,
        remaining: 68,
        status: "HEALTHY",
      },
      services: [
        { name: "Auth / KYC", sloTarget: 99.9, actual: 99.94, errorBudget: 60, status: "HEALTHY" },
        { name: "Wallet / Payroll", sloTarget: 99.95, actual: 99.97, errorBudget: 40, status: "HEALTHY" },
        { name: "Card (NymCard)", sloTarget: 99.9, actual: 99.93, errorBudget: 31, status: "WATCH" },
        { name: "Webhooks", sloTarget: 99.8, actual: 99.85, errorBudget: 25, status: "WATCH" },
      ],
      incidents: {
        summary: { sev1: 0, sev2: 2, sev3: 5, meanRTO: 5.8, falsePositiveRate: 7, falsePositivePrev: 14 },
        recent: [
          { id: "INC-0042", severity: "SEV-2", title: "NymCard API latency spike", timestamp: "2025-06-15T14:23:00Z", resolvedIn: 4.2, status: "RESOLVED", assignee: "@ahmed-oncall" },
          { id: "INC-0041", severity: "SEV-2", title: "Redis connection pool exhaustion", timestamp: "2025-06-08T09:11:00Z", resolvedIn: 7.3, status: "RESOLVED", assignee: "@omar-oncall" },
          { id: "INC-0040", severity: "SEV-3", title: "Scheduled maintenance — DB failover", timestamp: "2025-05-28T02:00:00Z", resolvedIn: 15, status: "COMPLETED", assignee: "@infra-team" },
        ],
      },
      monitoring: {
        prometheus: { status: "RUNNING", activeAlerts: 847, scrapeInterval: "15s" },
        grafana: { status: "RUNNING", dashboards: 12, uptime: "99.99%" },
        alertmanager: { status: "RUNNING", escalationPolicies: 3, integrations: ["Slack", "PagerDuty", "Email"] },
        thanos: { status: "RUNNING", retention: "6 months", compaction: "Enabled" },
      },
      alertRules: [
        { name: "API Error Rate", condition: "rate > 1% (5min window)", severity: "CRITICAL", enabled: true },
        { name: "Payment Processing Latency", condition: "p99 > 3s", severity: "WARNING", enabled: true },
        { name: "Database Connection Pool", condition: "usage > 80%", severity: "WARNING", enabled: true },
        { name: "Card Transaction Failure", condition: "failure rate > 0.5%", severity: "CRITICAL", enabled: true },
        { name: "Disk Usage", condition: "usage > 85%", severity: "WARNING", enabled: true },
      ],
      uptime: { thirtyDays: 99.99, ninetyDays: 99.98, yearToDate: 99.97 },
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch SRE metrics" }, { status: 500 });
  }
}
