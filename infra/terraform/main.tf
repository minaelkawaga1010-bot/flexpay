locals {
  name = "flexpay-${var.env}"
}

# ---------------------------------------------------------------------------
# Network
# ---------------------------------------------------------------------------

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.8"

  name = "${local.name}-vpc"
  cidr = var.vpc_cidr

  azs              = var.azs
  private_subnets  = [for i, _ in var.azs : cidrsubnet(var.vpc_cidr, 4, i)]
  public_subnets   = [for i, _ in var.azs : cidrsubnet(var.vpc_cidr, 4, i + 8)]
  database_subnets = [for i, _ in var.azs : cidrsubnet(var.vpc_cidr, 4, i + 12)]

  enable_nat_gateway     = true
  single_nat_gateway     = var.env != "prod"
  enable_dns_hostnames   = true
  enable_flow_log        = true
  create_flow_log_cloudwatch_log_group = true
  create_flow_log_cloudwatch_iam_role  = true
}

# ---------------------------------------------------------------------------
# KMS — one CMK per data class for clean audit
# ---------------------------------------------------------------------------

resource "aws_kms_key" "data" {
  description             = "${local.name} application data encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_key" "backup" {
  description             = "${local.name} backup encryption (separate from app data)"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

# ---------------------------------------------------------------------------
# EKS — runs the FastAPI services
# ---------------------------------------------------------------------------

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.20"

  cluster_name    = "${local.name}-eks"
  cluster_version = var.eks_version

  vpc_id                         = module.vpc.vpc_id
  subnet_ids                     = module.vpc.private_subnets
  cluster_endpoint_public_access = false

  enable_irsa = true

  eks_managed_node_groups = {
    primary = {
      min_size     = 2
      max_size     = 6
      desired_size = 3
      instance_types = ["m6i.large"]
    }
  }
}

# ---------------------------------------------------------------------------
# Postgres — ledger of record
# ---------------------------------------------------------------------------

resource "random_password" "db" {
  length  = 32
  special = true
}

resource "aws_secretsmanager_secret" "db" {
  name       = "${local.name}/db/master"
  kms_key_id = aws_kms_key.data.arn
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id     = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({ username = "flexpay", password = random_password.db.result })
}

resource "aws_db_subnet_group" "this" {
  name       = "${local.name}-db"
  subnet_ids = module.vpc.database_subnets
}

resource "aws_security_group" "db" {
  name   = "${local.name}-db-sg"
  vpc_id = module.vpc.vpc_id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "postgres" {
  identifier                  = "${local.name}-pg"
  engine                      = "postgres"
  engine_version              = "15"
  instance_class              = var.db_instance_class
  allocated_storage           = var.db_allocated_storage
  storage_encrypted           = true
  kms_key_id                  = aws_kms_key.data.arn
  multi_az                    = var.env == "prod"
  backup_retention_period     = 35
  backup_window               = "02:00-03:00"
  copy_tags_to_snapshot       = true
  performance_insights_enabled = true
  performance_insights_kms_key_id = aws_kms_key.data.arn
  username                    = "flexpay"
  password                    = random_password.db.result
  db_subnet_group_name        = aws_db_subnet_group.this.name
  vpc_security_group_ids      = [aws_security_group.db.id]
  skip_final_snapshot         = var.env != "prod"
  deletion_protection         = var.env == "prod"
}

# ---------------------------------------------------------------------------
# Redis — cache + idempotency + rate limiting
# ---------------------------------------------------------------------------

resource "aws_elasticache_subnet_group" "this" {
  name       = "${local.name}-redis"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_security_group" "redis" {
  name   = "${local.name}-redis-sg"
  vpc_id = module.vpc.vpc_id
  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = "${local.name}-redis"
  description                = "FlexPay Redis"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  num_cache_clusters         = var.env == "prod" ? 3 : 2
  automatic_failover_enabled = true
  multi_az_enabled           = var.env == "prod"
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  kms_key_id                 = aws_kms_key.data.arn
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  security_group_ids         = [aws_security_group.redis.id]
}

# ---------------------------------------------------------------------------
# S3 — documents (KYC artefacts) + backups (separate buckets)
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "docs" {
  bucket        = "${local.name}-documents"
  force_destroy = var.env != "prod"
}

resource "aws_s3_bucket_versioning" "docs" {
  bucket = aws_s3_bucket.docs.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "docs" {
  bucket = aws_s3_bucket.docs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.data.arn
    }
  }
}

resource "aws_s3_bucket_public_access_block" "docs" {
  bucket                  = aws_s3_bucket.docs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "random_id" "rand" {
  byte_length = 4
}
