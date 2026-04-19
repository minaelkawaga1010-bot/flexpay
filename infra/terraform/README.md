# FlexPay Infrastructure

Terraform for AWS `me-central-1` (Dubai). The `region` variable is locked via validation to enforce CBUAE residency.

## Components

- **VPC** (3 AZs, private + public + DB subnets, flow logs on)
- **KMS** — two CMKs: application data, and backups (separate blast radius)
- **EKS 1.30** — private API endpoint; managed node group (2–6 x `m6i.large`)
- **RDS Postgres 15** — encrypted with CMK, 35-day backup retention, Performance Insights on
- **ElastiCache Redis 7** — cluster mode, TLS in transit, encryption at rest
- **S3** — documents bucket (versioning + KMS + public-access-block)
- **Secrets Manager** — DB master credentials

## Usage

```bash
cd infra/terraform
terraform init
terraform plan -var env=staging
terraform apply -var env=staging
```

> Production applies require approval via the CI workflow (`.github/workflows/infra.yml`, not in this commit).

## What's intentionally not here

- DNS / ACM — managed outside Terraform for now (separate ops repo)
- CloudFront / WAF — added in the `edge` module once prod domain is live
- Observability stack (Prometheus, Grafana, Loki) — deployed via Helm on EKS, tracked separately

## Residency guardrail

`variables.tf` has a validation block preventing non-`me-central-1` applies. Do not remove it without a compliance review.
