# --- ALB ---------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Public load balancer"
  vpc_id      = aws_vpc.main.id

  egress {
    description     = "To the application tier"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.service.id]
  }

  tags = merge(local.common_tags, { Name = "${local.name}-alb" })
}

# The ALB accepts traffic only from CloudFront's managed prefix list, not from
# 0.0.0.0/0. Without this the ALB's own DNS name is a public origin that
# bypasses WAF, the CDN cache and the custom hostname entirely — which is the
# usual way a carefully-configured CloudFront WAF turns out to protect nothing.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group_rule" "alb_from_cloudfront" {
  type              = "ingress"
  description       = "HTTPS from CloudFront edge locations only"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  security_group_id = aws_security_group.alb.id
  prefix_list_ids   = [data.aws_ec2_managed_prefix_list.cloudfront.id]
}

resource "aws_lb" "main" {
  name               = "${local.name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  enable_deletion_protection = var.deletion_protection
  drop_invalid_header_fields = true # request smuggling via malformed headers
  idle_timeout               = 60
  # The app derives the client IP by counting appended X-Forwarded-For hops
  # (FURLPAY_TRUSTED_PROXY_HOPS = 2: CloudFront appends the viewer, this ALB
  # appends the CloudFront edge). "append" is the default; pinned because
  # "preserve" or "remove" would silently break that count.
  xff_header_processing_mode = "append"

  access_logs {
    bucket  = aws_s3_bucket.logs.id
    prefix  = "alb"
    enabled = true
  }

  tags = local.common_tags
}

resource "aws_lb_target_group" "app" {
  name        = "${local.name}-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/api/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200"
  }

  # Long enough for an in-flight payment request to finish, short enough that a
  # deploy does not stall. The app's own request deadline is 20s (see
  # native-app/lib/api.ts DEFAULT_TIMEOUT_MS).
  deregistration_delay = 30

  tags = local.common_tags
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  # Regional certificate for origin_domain_name: CloudFront validates it
  # against that name (see the origin block below). The viewer certificate
  # (acm_certificate_arn) lives in us-east-1 and cannot be attached here.
  certificate_arn = var.alb_certificate_arn

  # ORIGIN BOUNDARY. The default action REFUSES; only the rule below forwards,
  # and only for requests carrying the CloudFront origin secret. This is the
  # layer that covers every path — /_next/static, public/* files and anything
  # else the Next.js middleware matcher skips never reach the app to be checked
  # there. The prefix-list security group admits every CloudFront distribution
  # in AWS, not just ours; this rule is what makes the ALB private to OURS.
  #
  # Same status and body for "missing" and "wrong", so a probe learns nothing
  # about the secret. ALB target health checks do not traverse listener rules,
  # so they are unaffected by this (they hit /api/health on the target directly).
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "origin_verified" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 1

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }

  # Exact match is safe for this value: ALB treats `*` and `?` in condition
  # values as wildcards, and random_password.origin_verify is generated with
  # special = false (alphanumeric only, 48 chars — within ALB's 128-char limit).
  # ALB compares header VALUES case-insensitively, which still leaves ~2^248
  # combinations; the application re-checks the value case-sensitively
  # (apps/web/src/lib/originVerify.ts).
  #
  # ROTATION: `values` accepts up to five entries. Add the new secret here,
  # apply, switch CloudFront + the task secret, then remove the old one — never
  # change both ends in one step or every request 404s in between.
  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [random_password.origin_verify.result]
    }
  }

  tags = local.common_tags
}

# --- WAF ---------------------------------------------------------------------
# Scoped to CLOUDFRONT, so it must be created in us-east-1 — the provider alias
# is passed in from the root module.

resource "aws_wafv2_web_acl" "main" {
  count = var.enable_waf ? 1 : 0

  provider = aws.us_east_1
  name     = "${local.name}-waf"
  scope    = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "common"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"

        # The API accepts JSON bodies well over the 8KB this rule inspects
        # (travel itineraries, signed transaction payloads). Left on, it
        # flags legitimate money-path requests as oversized-body attacks.
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "bad-inputs"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  # Backstop only. The application's own per-route limits (rateLimitOr429) are
  # the real control — they know which endpoint is money-moving and this does
  # not. This catches volumetric abuse before it reaches compute.
  rule {
    name     = "rate-limit"
    priority = 3

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.env == "prod" ? 2000 : 10000
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  # Known-malicious sources (botnets, scanners) — AWS-maintained, no per-request
  # charge beyond the rule group (audit P3-7). Credential stuffing against
  # /api/auth/* is the traffic this is for.
  rule {
    name     = "ip-reputation"
    priority = 4

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  # A tighter per-IP budget on the authentication surface than the global
  # backstop above: OTP send/check and passkey ceremonies are where password-
  # spray-style abuse concentrates.
  rule {
    name     = "auth-rate-limit"
    priority = 5

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.env == "prod" ? 300 : 3000
        aggregate_key_type = "IP"

        scope_down_statement {
          byte_match_statement {
            search_string         = "/api/auth/"
            positional_constraint = "STARTS_WITH"

            field_to_match {
              uri_path {}
            }

            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-auth-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-waf"
    sampled_requests_enabled   = true
  }

  tags = local.common_tags
}

# --- CloudFront ---------------------------------------------------------------

resource "aws_cloudfront_distribution" "main" {
  enabled         = true
  is_ipv6_enabled = true
  aliases         = [var.domain_name]
  price_class     = var.env == "prod" ? "PriceClass_All" : "PriceClass_100"
  web_acl_id      = var.enable_waf ? aws_wafv2_web_acl.main[0].arn : null
  comment         = "FurlPay ${var.env} API"

  origin {
    # NOT aws_lb.main.dns_name: the viewer Host is not forwarded, so CloudFront
    # checks the origin certificate against THIS name, and no certificate can
    # cover *.elb.amazonaws.com; every request would be a 502.
    domain_name = aws_route53_record.origin.fqdn
    origin_id   = "alb"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    # Shared secret proving a request came through CloudFront. The prefix list
    # above restricts to CloudFront's IPs, but those are shared by every
    # CloudFront customer — without this header, anyone's distribution can
    # reach this ALB. The application rejects requests missing it.
    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }
  }

  default_cache_behavior {
    target_origin_id       = "alb"
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # CachingDisabled + AllViewerExceptHostHeader: this is an authenticated API.
    # Caching a response keyed on anything less than the full Authorization
    # header risks serving one user's balance to another.
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # Managed-AllViewerExceptHostHeader
  }

  # Static assets and OTA bundles ARE cacheable and are the reason this sits in
  # front of an API at all — the wear/watch clients fetch logos on every render.
  ordered_cache_behavior {
    path_pattern           = "/static/*"
    target_origin_id       = "alb"
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized
  }

  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  logging_config {
    bucket          = aws_s3_bucket.logs.bucket_domain_name
    prefix          = "cloudfront/"
    include_cookies = false # cookies here carry session material
  }

  tags = local.common_tags
}

resource "random_password" "origin_verify" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "origin_verify" {
  name       = "furlpay/${var.env}/ORIGIN_VERIFY_SECRET"
  kms_key_id = aws_kms_key.main.arn
  tags       = local.common_tags
}

resource "aws_secretsmanager_secret_version" "origin_verify" {
  secret_id     = aws_secretsmanager_secret.origin_verify.id
  secret_string = random_password.origin_verify.result
}

# --- DNS ----------------------------------------------------------------------

# Origin hostname for CloudFront -> ALB TLS (variables.tf origin_domain_name).
# Public DNS, but the ALB it names is already publicly resolvable under its AWS
# name; what keeps it private is the prefix-list security group plus the
# X-Origin-Verify listener rule, not the obscurity of the hostname.
resource "aws_route53_record" "origin" {
  zone_id = var.hosted_zone_id
  name    = var.origin_domain_name
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "api" {
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.main.domain_name
    zone_id                = aws_cloudfront_distribution.main.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "api_v6" {
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.main.domain_name
    zone_id                = aws_cloudfront_distribution.main.hosted_zone_id
    evaluate_target_health = false
  }
}

# --- Log bucket ---------------------------------------------------------------

resource "aws_s3_bucket" "logs" {
  bucket        = "${local.name}-logs"
  force_destroy = !var.deletion_protection
  tags          = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket = aws_s3_bucket.logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    # CloudFront standard logging still writes with ACLs.
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    id     = "expire"
    status = "Enabled"

    filter {}

    expiration {
      days = var.env == "prod" ? 365 : 30
    }
  }
}

# ALB access logs are written by the ELB service account, not by a role.
data "aws_elb_service_account" "main" {}

data "aws_iam_policy_document" "logs" {
  statement {
    sid       = "ALBAccessLogs"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.logs.arn}/alb/*"]

    principals {
      type        = "AWS"
      identifiers = [data.aws_elb_service_account.main.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "logs" {
  bucket = aws_s3_bucket.logs.id
  policy = data.aws_iam_policy_document.logs.json
}
