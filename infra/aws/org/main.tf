# ---------------------------------------------------------------------------
# FurlPay — AWS Organization guardrails (audit P2-3).
#
# Applied ONCE, from the organization MANAGEMENT account, before any workload
# account (dev/staging/prod under envs/) is built. Everything in envs/ assumes
# these exist; nothing in envs/ can switch them off.
#
#   - An organization CloudTrail (all accounts, all regions, log-file
#     validation) delivered to a bucket with Object Lock in COMPLIANCE mode:
#     an attacker with admin in a workload account cannot erase the API record
#     of what they did.
#   - Service control policies: no leaving the organization; no stopping,
#     deleting or re-pointing CloudTrail, GuardDuty or Config; no root-user
#     activity; workloads confined to the approved regions.
#   - AWS Config, Security Hub (AWS Foundational Security Best Practices) and
#     GuardDuty enabled in this account; delegated to the security account
#     for the rest of the org.
#
# NOT APPLIED. There are no AWS credentials in the repository's environment;
# `terraform validate` is the evidence, not deployment. See
# docs/release/PRODUCTION_REMEDIATION_STATUS.md (P2-3: BLOCKED_EXTERNAL).
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.11.0, < 2.0.0"

  backend "s3" {
    bucket       = "furlpay-tfstate"
    key          = "org/terraform.tfstate"
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
  region = var.home_region
}

variable "home_region" {
  type    = string
  default = "eu-west-1"
}

variable "allowed_regions" {
  description = "Regions workloads may use. Global services are exempted in the SCP."
  type        = list(string)
  default     = ["eu-west-1", "us-east-1"] # us-east-1: CloudFront ACM certificates
}

variable "security_account_id" {
  description = "Account that administers GuardDuty / Security Hub for the org."
  type        = string
}

variable "log_retention_days" {
  type    = number
  default = 2555 # 7 years — financial record keeping
}

data "aws_organizations_organization" "this" {}
data "aws_caller_identity" "current" {}

# --- Immutable audit log -------------------------------------------------------

resource "aws_s3_bucket" "audit" {
  bucket              = "furlpay-org-cloudtrail-${data.aws_caller_identity.current.account_id}"
  object_lock_enabled = true
}

resource "aws_s3_bucket_object_lock_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = var.log_retention_days
    }
  }
}

resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "audit" {
  bucket                  = aws_s3_bucket.audit.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

data "aws_iam_policy_document" "audit_bucket" {
  statement {
    sid       = "CloudTrailAclCheck"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.audit.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
  }
  statement {
    sid       = "CloudTrailWrite"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.audit.arn}/AWSLogs/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
  }
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.audit.arn, "${aws_s3_bucket.audit.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "audit" {
  bucket = aws_s3_bucket.audit.id
  policy = data.aws_iam_policy_document.audit_bucket.json
}

resource "aws_cloudtrail" "org" {
  name                          = "furlpay-org"
  s3_bucket_name                = aws_s3_bucket.audit.id
  is_organization_trail         = true
  is_multi_region_trail         = true
  include_global_service_events = true
  enable_log_file_validation    = true
  depends_on                    = [aws_s3_bucket_policy.audit]
}

# --- Service control policies ---------------------------------------------------

data "aws_iam_policy_document" "guardrails" {
  statement {
    sid       = "NoLeavingTheOrganization"
    effect    = "Deny"
    actions   = ["organizations:LeaveOrganization"]
    resources = ["*"]
  }
  statement {
    sid    = "ProtectSecurityServices"
    effect = "Deny"
    actions = [
      "cloudtrail:StopLogging", "cloudtrail:DeleteTrail", "cloudtrail:UpdateTrail", "cloudtrail:PutEventSelectors",
      "guardduty:DeleteDetector", "guardduty:DisassociateFromMasterAccount", "guardduty:UpdateDetector",
      "config:StopConfigurationRecorder", "config:DeleteConfigurationRecorder", "config:DeleteDeliveryChannel",
      "securityhub:DisableSecurityHub",
    ]
    resources = ["*"]
  }
  statement {
    sid       = "NoRootUser"
    effect    = "Deny"
    actions   = ["*"]
    resources = ["*"]
    condition {
      test     = "StringLike"
      variable = "aws:PrincipalArn"
      values   = ["arn:aws:iam::*:root"]
    }
  }
  statement {
    sid    = "ApprovedRegionsOnly"
    effect = "Deny"
    # Global / us-east-1-only control planes. Without these, the region deny
    # also breaks billing, Cost Explorer, Health, Trusted Advisor and S3 bucket
    # listing in every member account (AWS reference region-deny SCP).
    not_actions = [
      "iam:*", "organizations:*", "route53:*", "route53domains:*", "cloudfront:*", "sts:*", "support:*",
      "budgets:*", "waf:*", "wafv2:*", "acm:*", "kms:*", "globalaccelerator:*",
      "ce:*", "cur:*", "health:*", "trustedadvisor:*", "shield:*", "account:*", "pricing:*",
      "aws-portal:*", "billing:*", "payments:*", "tax:*",
      "s3:GetAccountPublicAccessBlock", "s3:ListAllMyBuckets", "s3:GetBucketLocation", "ec2:DescribeRegions",
    ]
    resources = ["*"]
    condition {
      test     = "StringNotEquals"
      variable = "aws:RequestedRegion"
      values   = var.allowed_regions
    }
  }
}

resource "aws_organizations_policy" "guardrails" {
  name        = "furlpay-guardrails"
  description = "No leaving the org, no disabling audit/detection, no root, approved regions only."
  type        = "SERVICE_CONTROL_POLICY"
  content     = data.aws_iam_policy_document.guardrails.json
}

resource "aws_organizations_policy_attachment" "guardrails" {
  policy_id = aws_organizations_policy.guardrails.id
  target_id = data.aws_organizations_organization.this.roots[0].id
}

# --- Detection -------------------------------------------------------------------

resource "aws_guardduty_organization_admin_account" "security" {
  admin_account_id = var.security_account_id
}

resource "aws_securityhub_account" "this" {}

resource "aws_securityhub_organization_admin_account" "security" {
  admin_account_id = var.security_account_id
  depends_on       = [aws_securityhub_account.this]
}

resource "aws_securityhub_standards_subscription" "fsbp" {
  standards_arn = "arn:aws:securityhub:${var.home_region}::standards/aws-foundational-security-best-practices/v/1.0.0"
  depends_on    = [aws_securityhub_account.this]
}

resource "aws_iam_service_linked_role" "config" {
  aws_service_name = "config.amazonaws.com"
}

resource "aws_config_configuration_recorder" "this" {
  name     = "furlpay"
  role_arn = aws_iam_service_linked_role.config.arn
  recording_group {
    all_supported                 = true
    include_global_resource_types = true
  }
}

resource "aws_config_delivery_channel" "this" {
  name           = "furlpay"
  s3_bucket_name = aws_s3_bucket.audit.id
  depends_on     = [aws_config_configuration_recorder.this]
}

resource "aws_config_configuration_recorder_status" "this" {
  name       = aws_config_configuration_recorder.this.name
  is_enabled = true
  depends_on = [aws_config_delivery_channel.this]
}

output "audit_bucket" {
  value = aws_s3_bucket.audit.id
}
