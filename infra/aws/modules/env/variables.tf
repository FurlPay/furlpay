# ---------------------------------------------------------------------------
# One FurlPay environment (dev | staging | prod).
#
# Every resource in this module is namespaced by `var.env`, so the three
# environments are three INDEPENDENT stacks: separate VPCs, separate databases,
# separate secrets, separate domains. Nothing is shared across them except the
# Route53 zone and the ECR repository, which live in the root config.
#
# Why full isolation rather than one VPC with three subnets: the clients being
# pointed at these endpoints move money. A staging deploy that can reach the
# production database is not a staging environment, and subnet-level separation
# is one security-group edit away from being exactly that.
# ---------------------------------------------------------------------------

variable "env" {
  description = "Environment name. Drives every resource name and tag."
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.env)
    error_message = "env must be one of: dev, staging, prod."
  }
}

variable "region" {
  description = "AWS region for this environment."
  type        = string
  default     = "eu-west-1"
}

variable "vpc_cidr" {
  description = "CIDR for this environment's VPC. Must not overlap the others — non-overlapping ranges keep a future peering/TGW decision open."
  type        = string
}

variable "domain_name" {
  description = "Public API hostname, e.g. api-staging.furlpay.com."
  type        = string
}

variable "hosted_zone_id" {
  description = "Route53 zone for domain_name. Created outside this module — a zone is an account-level asset, not an environment-level one."
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM cert covering domain_name. MUST be in us-east-1 when fronted by CloudFront."
  type        = string
}

variable "container_image" {
  description = "Full ECR image reference INCLUDING an immutable digest or tag. Never `:latest` — a task definition that says latest cannot be rolled back, because it does not record what it ran."
  type        = string
}

# --- Sizing -----------------------------------------------------------------
# Deliberately different per environment. Identical sizing across dev/staging/
# prod is the usual way an AWS bill triples for no test-fidelity gain.

variable "task_cpu" {
  description = "Fargate task CPU units."
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "Fargate task memory (MiB)."
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Baseline task count."
  type        = number
  default     = 1
}

variable "max_count" {
  description = "Autoscaling ceiling."
  type        = number
  default     = 2
}

variable "db_instance_class" {
  description = "Aurora Serverless v2 is used instead for dev/staging; this is the provisioned class for prod."
  type        = string
  default     = "db.serverless"
}

variable "db_min_acu" {
  description = "Aurora Serverless v2 minimum capacity units. 0 lets dev scale to zero between working sessions."
  type        = number
  default     = 0.5
}

variable "db_max_acu" {
  description = "Aurora Serverless v2 maximum capacity units."
  type        = number
  default     = 2
}

variable "multi_az" {
  description = "Run a reader in a second AZ. Prod only — a single-AZ dev database that fails is a re-seed, not an incident."
  type        = bool
  default     = false
}

variable "deletion_protection" {
  description = "Refuse `terraform destroy` on the database. Prod only."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "CloudWatch retention. Prod keeps a year for payment-dispute lookback; dev keeps a week."
  type        = number
  default     = 7
}

variable "enable_waf" {
  description = "Attach the managed WAF rule set + rate limit to CloudFront."
  type        = bool
  default     = true
}

variable "alarm_email" {
  description = "SNS subscription target for environment alarms. Empty disables the subscription (the topic is still created, so wiring one later needs no infra change)."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Extra tags merged into every resource."
  type        = map(string)
  default     = {}
}
