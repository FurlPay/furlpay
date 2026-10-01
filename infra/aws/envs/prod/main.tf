# ---------------------------------------------------------------------------
# FurlPay — production
#
# Multi-AZ, deletion-protected, 35-day PITR, a year of logs. `terraform apply`
# here is gated in CI behind the GitHub environment named "prod", which carries
# a required-reviewers rule — the IAM trust policy in modules/env/iam.tf pins
# the deploy role to that environment, so the gate cannot be routed around by
# running the workflow on another branch.
#
# BEFORE THE FIRST APPLY: read docs/aws/RUNBOOK.md §2. The app secrets are
# created empty and the service will not start until they are populated.
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.11.0, < 2.0.0"

  backend "s3" {
    bucket       = "furlpay-tfstate"
    key          = "prod/terraform.tfstate"
    region       = "eu-west-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "furlpay"
      Environment = "prod"
      ManagedBy   = "terraform"
    }
  }
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

variable "region" {
  type    = string
  default = "eu-west-1"
}

variable "hosted_zone_id" {
  description = "Route53 zone for furlpay.com."
  type        = string
}

variable "acm_certificate_arn" {
  description = "us-east-1 ACM cert covering api.furlpay.com."
  type        = string
}

variable "alb_certificate_arn" {
  description = "ACM cert in the ALB's region (var.region) covering origin-api.furlpay.com."
  type        = string
}

variable "container_image" {
  description = "ECR image pinned by DIGEST in production — a tag can be moved, a digest cannot."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.container_image))
    error_message = "Production must deploy an image pinned by digest (…@sha256:…), not by tag."
  }
}

variable "alarm_email" {
  type    = string
  default = ""
}

module "env" {
  source = "../../modules/env"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  env         = "prod"
  region      = var.region
  vpc_cidr    = "10.30.0.0/16"
  domain_name = "api.furlpay.com"
  # CloudFront -> ALB TLS name (see modules/env/variables.tf).
  origin_domain_name = "origin-api.furlpay.com"

  hosted_zone_id      = var.hosted_zone_id
  acm_certificate_arn = var.acm_certificate_arn
  alb_certificate_arn = var.alb_certificate_arn
  container_image     = var.container_image

  task_cpu      = 2048
  task_memory   = 4096
  desired_count = 3
  max_count     = 12

  db_min_acu = 2
  db_max_acu = 16

  multi_az            = true
  deletion_protection = true
  log_retention_days  = 365 # payment-dispute lookback

  enable_waf  = true
  alarm_email = var.alarm_email
}

output "api_base_url" { value = module.env.api_base_url }
output "ci_deploy_role_arn" { value = module.env.ci_deploy_role_arn }
output "assets_bucket" { value = module.env.assets_bucket }
output "cloudfront_distribution_id" { value = module.env.cloudfront_distribution_id }
output "app_secret_arns" { value = module.env.app_secret_arns }
