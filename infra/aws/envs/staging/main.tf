# ---------------------------------------------------------------------------
# FurlPay — staging
#
# Production's shape at a fraction of its size: same VPC topology, same WAF,
# same secret layout, same deploy path. Differences are capacity and retention
# ONLY, so a change that works here fails here rather than in production.
#
# This is the environment the Android, iOS and Wear OS internal-track builds
# point at. See docs/aws/CLIENT-ENVIRONMENTS.md.
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.9.0"

  backend "s3" {
    bucket       = "furlpay-tfstate"
    key          = "staging/terraform.tfstate"
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
      Environment = "staging"
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
  description = "us-east-1 ACM cert covering api-staging.furlpay.com."
  type        = string
}

variable "container_image" {
  description = "ECR image with an immutable tag or digest."
  type        = string
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

  env         = "staging"
  region      = var.region
  vpc_cidr    = "10.20.0.0/16"
  domain_name = "api-staging.furlpay.com"

  hosted_zone_id      = var.hosted_zone_id
  acm_certificate_arn = var.acm_certificate_arn
  container_image     = var.container_image

  task_cpu      = 1024
  task_memory   = 2048
  desired_count = 2 # two tasks so a rolling deploy is actually exercised
  max_count     = 4

  db_min_acu = 0.5
  db_max_acu = 4

  # Single-AZ on purpose. Multi-AZ failover is a production property, and
  # paying for a staging reader buys a capability nobody tests.
  multi_az            = false
  deletion_protection = false
  log_retention_days  = 30

  enable_waf  = true
  alarm_email = var.alarm_email
}

output "api_base_url" { value = module.env.api_base_url }
output "ci_deploy_role_arn" { value = module.env.ci_deploy_role_arn }
output "assets_bucket" { value = module.env.assets_bucket }
output "cloudfront_distribution_id" { value = module.env.cloudfront_distribution_id }
output "app_secret_arns" { value = module.env.app_secret_arns }
