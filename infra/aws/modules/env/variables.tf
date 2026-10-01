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
  description = "VIEWER certificate for CloudFront: ACM cert covering domain_name. MUST be in us-east-1 (CloudFront reads certificates from nowhere else)."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:acm:us-east-1:", var.acm_certificate_arn))
    error_message = "acm_certificate_arn is the CloudFront viewer certificate and must be an ACM ARN in us-east-1."
  }
}

variable "origin_domain_name" {
  description = <<-EOT
    Hostname CloudFront uses to reach the ALB, e.g. origin-api.furlpay.com.
    Needed because the origin request policy does NOT forward the viewer Host,
    so CloudFront validates the ALB certificate against the ORIGIN domain name,
    and no certificate can be issued for *.elb.amazonaws.com. Resolves to the
    ALB (alias record in edge.tf); reaching it directly still meets the
    prefix-list security group and the X-Origin-Verify listener rule.
  EOT
  type        = string
}

variable "alb_certificate_arn" {
  description = "ORIGIN certificate for the ALB listener: ACM cert covering origin_domain_name, in the SAME region as the ALB (an ALB cannot use a certificate from another region)."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:acm:[a-z0-9-]+:", var.alb_certificate_arn))
    error_message = "alb_certificate_arn must be an ACM certificate ARN."
  }
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

variable "enable_aws_data_plane" {
  description = <<-EOT
    Provision Aurora PostgreSQL + ElastiCache and inject DATABASE_URL / REDIS_URL.
    OFF by default (audit P0-5): the application reaches its database only
    through Supabase PostgREST and its KV only through the Upstash REST API, and
    reads neither DATABASE_URL nor REDIS_URL. Turning this on provisions
    infrastructure nothing uses until the data layer is migrated.
  EOT
  type        = bool
  default     = false
}

variable "github_repo" {
  description = "owner/name of the repository whose GitHub Actions environments may assume the deploy role (OIDC sub claim)."
  type        = string
  default     = "Ashutosh0x/furlpay"

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repo))
    error_message = "github_repo must be owner/name."
  }
}

variable "webauthn_rp_id" {
  description = "Passkey relying-party ID (FURLPAY_RP_ID). Off Vercel the app otherwise falls back to 'localhost' and every passkey ceremony fails."
  type        = string
  default     = "furlpay.com"
}

variable "webauthn_origins" {
  description = "Comma-separated expected WebAuthn origins (FURLPAY_ORIGIN)."
  type        = string
  default     = "https://furlpay.com,https://www.furlpay.com"
}

variable "apple_team_id" {
  description = "Apple Developer Team ID (APPLE_TEAM_ID). Empty = the AASA file 404s and iOS universal links / passkeys stay off."
  type        = string
  default     = ""
}
