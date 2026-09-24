# ---------------------------------------------------------------------------
# Detection and supply chain.
#
# The rest of this module is preventive — least-privilege IAM, isolated
# subnets, a read-only root filesystem, pinned secrets. This file is what
# notices when prevention did not work, plus the controls on what is allowed to
# run in the first place.
# ---------------------------------------------------------------------------

# --- ECR ---------------------------------------------------------------------
# One repository, shared by the three environments, because an image promoted
# dev → staging → prod must be the SAME bytes. Rebuilding per environment means
# production runs an artifact no one tested.

resource "aws_ecr_repository" "web" {
  count = var.env == "prod" ? 1 : 0 # created once, in the prod stack

  name = "furlpay/web"

  # IMMUTABLE. A mutable tag can be moved after a deploy, which means the task
  # definition no longer records what actually ran — and a rollback target that
  # can be silently repointed is not a rollback target.
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.main.arn
  }

  tags = local.common_tags
}

resource "aws_ecr_lifecycle_policy" "web" {
  count = var.env == "prod" ? 1 : 0

  repository = aws_ecr_repository.web[0].name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the last 30 images; older ones are not rollback targets anyone would reach for."
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 30
        }
        action = { type = "expire" }
      },
    ]
  })
}

# --- GuardDuty ---------------------------------------------------------------
# Account-level, enabled from the prod stack so three environments do not fight
# over one detector (the API allows exactly one per region per account).

resource "aws_guardduty_detector" "main" {
  count = var.env == "prod" ? 1 : 0

  enable                       = true
  finding_publishing_frequency = "FIFTEEN_MINUTES"

  datasources {
    s3_logs {
      enable = true
    }
  }

  tags = local.common_tags
}

# Runtime Monitoring for Fargate. Without this GuardDuty sees CloudTrail, VPC
# flow logs and DNS — the network view — but nothing INSIDE a task. This is what
# surfaces a process spawned in a container that should only ever run Node.
resource "aws_guardduty_detector_feature" "runtime_monitoring" {
  count = var.env == "prod" ? 1 : 0

  detector_id = aws_guardduty_detector.main[0].id
  name        = "RUNTIME_MONITORING"
  status      = "ENABLED"

  additional_configuration {
    name   = "ECS_FARGATE_AGENT_MANAGEMENT"
    status = "ENABLED"
  }
}

# GuardDuty findings are useless unread. Route the ones worth waking up for to
# the same topic as the operational alarms.
resource "aws_cloudwatch_event_rule" "guardduty" {
  count = var.env == "prod" ? 1 : 0

  name        = "${local.name}-guardduty-findings"
  description = "GuardDuty findings at severity 7.0+ (High/Critical)"

  event_pattern = jsonencode({
    source        = ["aws.guardduty"]
    "detail-type" = ["GuardDuty Finding"]
    detail = {
      # 7.0+ only. Medium and Low findings on a busy account are a daily feed,
      # and a feed nobody reads is worse than no feed — it teaches the on-call
      # that this topic is noise.
      severity = [{ numeric = [">=", 7.0] }]
    }
  })

  tags = local.common_tags
}

resource "aws_cloudwatch_event_target" "guardduty_sns" {
  count = var.env == "prod" ? 1 : 0

  rule      = aws_cloudwatch_event_rule.guardduty[0].name
  target_id = "sns"
  arn       = aws_sns_topic.alarms.arn
}

# --- Deployment notifications -------------------------------------------------
# A production task definition changing outside a deploy window is either a
# deploy nobody announced or an intrusion. Either is worth a notification.

resource "aws_cloudwatch_event_rule" "ecs_deployment_failure" {
  name        = "${local.name}-deployment-failure"
  description = "ECS rolled a deployment back (circuit breaker tripped)"

  event_pattern = jsonencode({
    source        = ["aws.ecs"]
    "detail-type" = ["ECS Deployment State Change"]
    detail = {
      eventName = ["SERVICE_DEPLOYMENT_FAILED"]
    }
  })

  tags = local.common_tags
}

resource "aws_cloudwatch_event_target" "ecs_deployment_failure_sns" {
  rule      = aws_cloudwatch_event_rule.ecs_deployment_failure.name
  target_id = "sns"
  arn       = aws_sns_topic.alarms.arn
}

# EventBridge needs explicit permission to publish; the topic policy is not
# inherited from anything.
data "aws_iam_policy_document" "alarms_topic" {
  statement {
    sid     = "AllowEventBridgePublish"
    actions = ["SNS:Publish"]
    resources = [aws_sns_topic.alarms.arn]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }

  statement {
    sid     = "AllowCloudWatchAlarmsPublish"
    actions = ["SNS:Publish"]
    resources = [aws_sns_topic.alarms.arn]

    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }
  }
}

resource "aws_sns_topic_policy" "alarms" {
  arn    = aws_sns_topic.alarms.arn
  policy = data.aws_iam_policy_document.alarms_topic.json
}
