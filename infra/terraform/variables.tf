variable "env" {
  description = "Environment name (dev/staging/prod)."
  type        = string
  default     = "dev"
}

variable "region" {
  description = "AWS region. FlexPay requires UAE residency."
  type        = string
  default     = "me-central-1"

  validation {
    condition     = var.region == "me-central-1"
    error_message = "CBUAE residency: region must be me-central-1."
  }
}

variable "vpc_cidr" {
  type    = string
  default = "10.42.0.0/16"
}

variable "azs" {
  type    = list(string)
  default = ["me-central-1a", "me-central-1b", "me-central-1c"]
}

variable "eks_version" {
  type    = string
  default = "1.30"
}

variable "db_instance_class" {
  type    = string
  default = "db.r6g.large"
}

variable "db_allocated_storage" {
  type    = number
  default = 100
}

variable "redis_node_type" {
  type    = string
  default = "cache.r6g.large"
}
