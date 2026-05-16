import { NextResponse } from "next/server";

export async function GET() {
  try {
    return NextResponse.json({
      summary: {
        deploymentsThisQuarter: 47,
        rollbackRate: 0.8,
        leadTime: 2.1,
        deploymentFrequency: 2.1,
        lastDeployment: "2025-06-18T16:30:00Z",
      },
      pipelines: [
        { name: "ci.yml", trigger: "On Pull Request", stages: ["Lint", "Type Check", "Unit Tests", "Security Scan"], avgDuration: 4, status: "PASSING" },
        { name: "deploy-staging.yml", trigger: "On merge to main", stages: ["Build", "Push Image", "Deploy Staging"], avgDuration: 6, status: "PASSING" },
        { name: "deploy-production.yml", trigger: "Manual + Approval", stages: ["Build", "Push Image", "Blue-Green Deploy", "Health Check", "Switch"], avgDuration: 8, status: "PASSING" },
      ],
      recentDeployments: [
        { version: "v2.14.3", date: "2025-06-18", env: "production", status: "SUCCESS", description: "Fix NymCard circuit breaker timeout", author: "@ahmed-dev", duration: "6m 12s" },
        { version: "v2.14.2", date: "2025-06-16", env: "production", status: "SUCCESS", description: "Add savings auto-contribute feature", author: "@sarah-dev", duration: "5m 48s" },
        { version: "v2.14.1", date: "2025-06-15", env: "production", status: "ROLLED_BACK", description: "Card service timeout fix (reverted)", author: "@ahmed-dev", duration: "3m 22s" },
        { version: "v2.14.0", date: "2025-06-14", env: "staging", status: "SUCCESS", description: "Q2 feature release — 14 PRs", author: "@release-bot", duration: "7m 03s" },
        { version: "v2.13.5", date: "2025-06-12", env: "production", status: "SUCCESS", description: "Referral program v2 — reward rules", author: "@sarah-dev", duration: "5m 55s" },
        { version: "v2.13.4", date: "2025-06-10", env: "production", status: "SUCCESS", description: "AML rule engine — velocity updates", author: "@omar-dev", duration: "6m 31s" },
      ],
      qualityGates: [
        { name: "ESLint", passRate: 100, description: "Zero warnings/errors" },
        { name: "TypeScript Strict", passRate: 100, description: "Strict mode enforced" },
        { name: "Unit Tests", passRate: 100, description: "26 tests passing" },
        { name: "Security Scan (Trivy)", passRate: 100, description: "0 critical, 0 high findings" },
        { name: "Helm Validation", passRate: 100, description: "kubeconform passing" },
      ],
      infrastructureAsCode: {
        helmCharts: [{ name: "flexpay-api", version: "2.14.3", repo: "OCI registry" }, { name: "flexpay-worker", version: "2.14.3", repo: "OCI registry" }, { name: "flexpay-ingress", version: "1.5.0", repo: "OCI registry" }],
        kustomize: { base: true, overlays: ["dev", "staging", "production"] },
        terraform: { provider: "AWS", region: "me-south-1", resources: 24, stateBackend: "S3 + DynamoDB" },
        docker: { baseImage: "node:20-alpine", stages: ["install", "build", "production"], strategy: "multi-stage" },
      },
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch CI/CD data" }, { status: 500 });
  }
}
