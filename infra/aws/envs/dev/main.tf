# ---------------------------------------------------------------------------
# FurlPay — dev
#
# Sized to be cheap and disposable. Scales to near-zero between working
# sessions, keeps a week of logs, and has no deletion protection: a dev
# environment you cannot tear down and rebuild is not serving its purpose.
#
#   terraform init && terraform apply
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.11.0, < 2.0.0"

  backend "s3" {
    bucket       = "furlpay-tfstate"
    key          = "dev/terraform.tfstate"
    region       = "eu-west-1"
    encrypt      = true
    use_lockfile = true # S3-native locking; no DynamoDB table needed
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
      Environment = "dev"
      ManagedBy   = "terraform"
    }
  }
}

# CloudFront-scoped WAF and billing metrics are us-east-1 only.
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
  description = "us-east-1 ACM cert covering api-dev.furlpay.com."
  type        = string
}

variable "alb_certificate_arn" {
  description = "ACM cert in the ALB's region (var.region) covering origin-api-dev.furlpay.com."
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

  env         = "dev"
  region      = var.region
  vpc_cidr    = "10.10.0.0/16"
  domain_name = "api-dev.furlpay.com"
  # CloudFront -> ALB TLS name (see modules/env/variables.tf).
  origin_domain_name = "origin-api-dev.furlpay.com"

  hosted_zone_id      = var.hosted_zone_id
  acm_certificate_arn = var.acm_certificate_arn
  alb_certificate_arn = var.alb_certificate_arn
  container_image     = var.container_image

  task_cpu      = 512
  task_memory   = 1024
  desired_count = 1
  max_count     = 2

  db_min_acu = 0.5
  db_max_acu = 1

  multi_az            = false
  deletion_protection = false
  log_retention_days  = 7

  # WAF on in dev too, deliberately: a rule that only exists in production is a
  # rule first exercised in production. The rate limit is 5x looser so load
  # tests are not fighting it.
  enable_waf  = true
  alarm_email = var.alarm_email
}

output "api_base_url" { value = module.env.api_base_url }
output "ci_deploy_role_arn" { value = module.env.ci_deploy_role_arn }
output "assets_bucket" { value = module.env.assets_bucket }
output "cloudfront_distribution_id" { value = module.env.cloudfront_distribution_id }
output "app_secret_arns" { value = module.env.app_secret_arns }
