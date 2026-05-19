import { NextResponse } from "next/server";

// Board Deck API — SRE & Compliance Q2 2025
export async function GET() {
  const data = {
    report: {
      title: "SRE & Compliance Quarterly Report",
      quarter: "Q2 2025",
      period: "Apr 1 – Jun 30, 2025",
      nextReview: "2025-09-30",
      audience: "Board of Directors",
    },
    executiveSummary: {
      compositeSLO: "99.97%",
      sloTarget: "99.90%",
      errorBudgetRemaining: "68%",
      sev1Incidents: 0,
      sev2Incidents: 2,
      regulatoryCompliance: "100%",
    },
    sloServices: [
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
    ],
    incidentDrills: {
      drillsCompleted: 3,
      meanRTO: "5.8 min",
      rtoTarget: "< 8 min",
      falsePositiveRate: "7%",
      falsePositivePrevious: "14%",
      avgMTTR: "4.2 min",
    },
    incidents: [
      {
        severity: "SEV-2",
        title: "NymCard API latency spike",
        date: "2025-06-15",
        resolution: "Resolved in 4.2 min",
        detail: "Card service error budget entered Watch (31%). Triggered circuit breaker investigation.",
      },
      {
        severity: "SEV-2",
        title: "Redis connection pool exhaustion",
        date: "2025-06-08",
        resolution: "Resolved in 7.3 min",
        detail: "Pool size increased from 20 to 50. Automated scaling policy added.",
      },
    ],
    compliance: [
      {
        framework: "CBUAE WPS",
        articles: "WPS Compliance",
        status: "Compliant",
        details: "Salary protection via WPS integration, automated payroll disbursement",
      },
      {
        framework: "UAE PDPL",
        articles: "Art. 10, 14, 24",
        status: "Compliant",
        details: "Data processing, breach notification (72hr), cross-border transfer controls",
      },
      {
        framework: "ISO 27001",
        articles: "A.16 (Incident Mgmt)",
        status: "Compliant",
        details: "Incident response plan, 3 drills completed, post-incident reviews enforced",
      },
      {
        framework: "NESA IAS",
        articles: "Data Localization",
        status: "Compliant",
        details: "All data stored in AWS me-south-1 (UAE), KMS encryption at rest",
      },
    ],
    cicd: {
      deployments: 47,
      rollbacks: 1,
      rollbackRate: "0.8%",
      deployFrequency: "2.1/wk",
      leadTime: "2.1 hrs",
      qualityGates: [
        { label: "Lint", detail: "ESLint 0 errors", passPercent: 100 },
        { label: "TypeScript", detail: "Strict mode", passPercent: 100 },
        { label: "Unit Tests", detail: "26/26 passing", passPercent: 100 },
        { label: "Security Scan", detail: "0 critical/high", passPercent: 100 },
        { label: "Helm Validate", detail: "kubeconform pass", passPercent: 100 },
      ],
    },
    financialImpact: {
      downtimeLoss: "AED 0",
      slaPenalties: "AED 0",
      alertOptimizationSavings: "~15 hrs/mo",
      roadmapDeliveryRate: "85%",
      roadmapPlanned: 20,
      roadmapDelivered: 17,
    },
    roadmap: [
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
    ],
  };

  return NextResponse.json(data);
}
