import { NextResponse } from "next/server";

export async function GET() {
  try {
    return NextResponse.json({
      region: {
        name: "me-south-1",
        location: "Bahrain / UAE Edge",
        compliance: ["CBUAE", "PDPL", "ISO 27001", "NESA IAS"],
        availabilityZones: 2,
      },
      kubernetes: {
        cluster: "flexpay-prod",
        provider: "EKS-compatible",
        nodes: 3,
        namespaces: ["production", "staging", "monitoring"],
        pods: { running: 12, pending: 0, crashloop: 0 },
        deployments: [
          { name: "api", replicas: 3, image: "flexpay-api:2.14.3", cpu: "500m", memory: "512Mi" },
          { name: "worker", replicas: 2, image: "flexpay-worker:2.14.3", cpu: "250m", memory: "256Mi" },
          { name: "ingress", replicas: 2, image: "nginx-ingress:1.9.0", cpu: "100m", memory: "128Mi" },
        ],
      },
      awsServices: [
        { name: "RDS PostgreSQL 16", status: "AVAILABLE", details: { engine: "PostgreSQL 16.2", multiAZ: true, storage: "100 GB gp3", backups: "Automated, 30-day retention", instanceClass: "db.r6g.large" } },
        { name: "ElastiCache Redis 7", status: "AVAILABLE", details: { engine: "Redis 7.2", nodes: 3, nodeSize: "cache.r6g.large", memory: "2 GB each", replication: "Cluster mode enabled" } },
        { name: "S3", status: "AVAILABLE", details: { buckets: 2, encryption: "AES-256 SSE-S3", versioning: "Enabled", lifecycle: "90-day transition to Glacier" } },
        { name: "KMS", status: "AVAILABLE", details: { keys: 3, algorithm: "AES-256", rotation: "Annual automatic", usage: ["PII encryption", "Card data envelope encryption", "Database TDE"] } },
        { name: "Application Load Balancer", status: "AVAILABLE", details: { scheme: "Internet-facing", sslPolicy: "ELBSecurityPolicy-TLS13-1-2-Res-2021-06", waf: "AWS WAF enabled", targetGroups: 3 } },
        { name: "CloudWatch", status: "AVAILABLE", details: { logRetention: "30 days", dashboards: 8, alarms: 24, customMetrics: 156 } },
      ],
      security: {
        encryption: { atRest: "AES-256", inTransit: "TLS 1.3", piiHandling: "KMS envelope encryption" },
        network: { vpc: "10.0.0.0/16", subnets: "Private (2 AZs)", securityGroups: 6, nacls: 3 },
        accessControl: { iam: "Least privilege roles", mfa: "Enforced for all users", secrets: "AWS Secrets Manager", audit: "CloudTrail enabled" },
        complianceFrameworks: ["CBUAE WPS", "UAE PDPL Art.10/14/24", "ISO 27001 A.16", "NESA IAS"],
      },
      environments: [
        { name: "Production", region: "me-south-1", nodes: 3, ha: "Multi-AZ", pods: 12, status: "HEALTHY" },
        { name: "Staging", region: "me-south-1", nodes: 2, ha: "Single-AZ", pods: 6, status: "HEALTHY" },
        { name: "Development", region: "Local", nodes: 1, ha: "N/A", pods: "Docker Compose", status: "ACTIVE" },
      ],
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch infrastructure data" }, { status: 500 });
  }
}
