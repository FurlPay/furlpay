# ---------------------------------------------------------------------------
# Scheduled jobs — the AWS replacement for Vercel Cron.
#
# apps/web/vercel.json declares five scheduled jobs. Vercel Cron does not exist
# outside Vercel, so on AWS they simply stop running — silently, because nothing
# errors when a scheduler that was never invoked fails to invoke anything. Two
# of the five (`reconcile`, `health`) are the jobs that would tell you money had
# gone wrong, so losing them is worse than losing a feature.
#
#   15 6  * * *   /api/cron/reconcile
#   45 6  * * *   /api/cron/health
#   30 21 * * *   /api/cron/market-brief
#   5  13 * * *   /api/cron/price-cards
#   20 6  * * *   /api/cron/discord-welcome
#   every 5 min   /api/cron/ramp-maintenance   (AWS only; not in vercel.json)
#
# WHY EVENTBRIDGE RULES AND NOT EVENTBRIDGE SCHEDULER
#
# Scheduler is the newer service and the obvious first choice, but per AWS's own
# documentation it "does not support non-AWS targets directly" — reaching an
# HTTPS endpoint from Scheduler means putting a Lambda in front purely to make
# an HTTP request. A Rule with a `schedule_expression` targeting an API
# Destination calls the endpoint directly, with retries, a DLQ and managed
# credentials, and adds no compute to own.
#
# WHY THE PUBLIC ENDPOINT AND NOT THE ALB
#
# The API Destination calls https://<domain>/api/cron/*, which resolves through
# CloudFront. That is deliberate: CloudFront injects the X-Origin-Verify header
# the application requires (see edge.tf), so a cron invocation passes the same
# WAF rules and origin check as any other request. Pointing this at the ALB
# directly would need a second, private path into the application — a bypass
# around the exact control that makes the origin private.
# ---------------------------------------------------------------------------

locals {
  # Vercel cron -> EventBridge cron.
  #
  # NOT a copy-paste. Vercel uses 5-field UNIX cron; EventBridge uses 6 fields
  # (with a year) and REFUSES `*` in both day-of-month and day-of-week — exactly
  # one of them must be `?`. `15 6 * * *` is therefore `cron(15 6 * * ? *)`, and
  # the naive 6-field translation `cron(15 6 * * * *)` is rejected at apply time.
  # Both are UTC, so the times themselves carry over unchanged.
  cron_jobs = {
    reconcile = {
      schedule    = "cron(15 6 * * ? *)"
      path        = "/api/cron/reconcile"
      description = "Ledger <-> provider reconciliation. The job that detects money having gone wrong."
    }
    health = {
      schedule    = "cron(45 6 * * ? *)"
      path        = "/api/cron/health"
      description = "Scheduled health sweep."
    }
    market-brief = {
      schedule    = "cron(30 21 * * ? *)"
      path        = "/api/cron/market-brief"
      description = "Daily market brief to Discord/Telegram."
    }
    price-cards = {
      schedule    = "cron(5 13 * * ? *)"
      path        = "/api/cron/price-cards"
      description = "Daily price cards."
    }
    discord-welcome = {
      schedule    = "cron(20 6 * * ? *)"
      path        = "/api/cron/discord-welcome"
      description = "Discord welcome sweep."
    }
    # Not in vercel.json (sub-daily Vercel cron depends on the plan). Every 5 min
    # keeps the 30-minute stale-checkout rule and the 1-minute first partner
    # callback retry honest. A run that overlaps the previous one is skipped by
    # the job lock, not doubled.
    ramp-maintenance = {
      schedule    = "rate(5 minutes)"
      path        = "/api/cron/ramp-maintenance"
      description = "Ramp stale-order sweep and partner callback retries."
    }
  }
}

# --- credential --------------------------------------------------------------
# The app already supports an external scheduler: apps/web/src/lib/cron/auth.ts
# accepts `x-furlpay-cron-key: <FURLPAY_CRON_SECRET>` alongside the Vercel
# `Authorization: Bearer <CRON_SECRET>` path, and REFUSES every scheduled job
# when neither secret is configured. That fail-closed default is why this
# secret has to exist before the rules below are of any use — without it the
# invocations arrive and are correctly rejected.
#
# `x-vercel-cron` is explicitly documented there as NOT a credential; do not be
# tempted to have the API Destination send it.

resource "random_password" "cron_secret" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "cron_secret" {
  name       = "furlpay/${var.env}/FURLPAY_CRON_SECRET"
  kms_key_id = aws_kms_key.main.arn
  tags       = local.common_tags
}

resource "aws_secretsmanager_secret_version" "cron_secret" {
  secret_id     = aws_secretsmanager_secret.cron_secret.id
  secret_string = random_password.cron_secret.result
}

# The Connection holds the auth material. EventBridge stores it in a
# Secrets Manager secret it manages itself, so the header value is not read back
# out of this resource at invoke time.
resource "aws_cloudwatch_event_connection" "cron" {
  name               = "${local.name}-cron"
  description        = "Scheduled job authentication for ${var.env}"
  authorization_type = "API_KEY"

  auth_parameters {
    api_key {
      key   = "x-furlpay-cron-key"
      value = random_password.cron_secret.result
    }
  }
}

resource "aws_cloudwatch_event_api_destination" "cron" {
  for_each = local.cron_jobs

  name                = "${local.name}-cron-${each.key}"
  description         = each.value.description
  invocation_endpoint = "https://${var.domain_name}${each.value.path}"
  http_method         = "POST"
  connection_arn      = aws_cloudwatch_event_connection.cron.arn
  # One invocation per second is far above five jobs a day, and low enough that
  # a misconfigured rule cannot become a self-inflicted load test.
  invocation_rate_limit_per_second = 1
}

# --- dead letter -------------------------------------------------------------
# Without this a failed invocation is retried and then discarded. For
# `reconcile` that means the one job that would have told you the ledger and
# the provider disagree fails quietly, and the next signal is a customer.

resource "aws_sqs_queue" "cron_dlq" {
  name                      = "${local.name}-cron-dlq"
  message_retention_seconds = 1209600 # 14 days, the maximum
  kms_master_key_id         = aws_kms_key.main.id
  tags                      = local.common_tags
}

data "aws_iam_policy_document" "cron_dlq" {
  statement {
    sid       = "AllowEventBridgeSendMessage"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.cron_dlq.arn]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [for r in aws_cloudwatch_event_rule.cron : r.arn]
    }
  }
}

resource "aws_sqs_queue_policy" "cron_dlq" {
  queue_url = aws_sqs_queue.cron_dlq.id
  policy    = data.aws_iam_policy_document.cron_dlq.json
}

# A message on this queue means a scheduled job did not run to completion after
# every retry. That is always worth a human; it is never self-healing, because
# the job itself is what would have detected the problem.
resource "aws_cloudwatch_metric_alarm" "cron_dlq" {
  alarm_name          = "${local.name}-cron-dlq"
  alarm_description   = "A scheduled job failed every retry. Reconciliation/health may not have run."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.cron_dlq.name
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = local.common_tags
}

# --- rules -------------------------------------------------------------------

resource "aws_cloudwatch_event_rule" "cron" {
  for_each = local.cron_jobs

  name                = "${local.name}-cron-${each.key}"
  description         = each.value.description
  schedule_expression = each.value.schedule
  tags                = local.common_tags
}

resource "aws_cloudwatch_event_target" "cron" {
  for_each = local.cron_jobs

  rule     = aws_cloudwatch_event_rule.cron[each.key].name
  arn      = aws_cloudwatch_event_api_destination.cron[each.key].arn
  role_arn = aws_iam_role.cron_invoke.arn

  # The jobs take no input. An empty JSON object rather than the matched event,
  # so the endpoint never receives an EventBridge envelope it would have to
  # parse and ignore.
  input = jsonencode({})

  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 3
  }

  dead_letter_config {
    arn = aws_sqs_queue.cron_dlq.arn
  }
}

data "aws_iam_policy_document" "assume_events" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cron_invoke" {
  name               = "${local.name}-cron-invoke"
  assume_role_policy = data.aws_iam_policy_document.assume_events.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "cron_invoke" {
  statement {
    sid       = "InvokeCronDestinations"
    effect    = "Allow"
    actions   = ["events:InvokeApiDestination"]
    resources = [for d in aws_cloudwatch_event_api_destination.cron : d.arn]
  }
}

resource "aws_iam_role_policy" "cron_invoke" {
  name   = "invoke"
  role   = aws_iam_role.cron_invoke.id
  policy = data.aws_iam_policy_document.cron_invoke.json
}
