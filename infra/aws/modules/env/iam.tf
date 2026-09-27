# --- Task execution role -------------------------------------------------------
# Used by the ECS AGENT (pull the image, fetch secrets, write logs) — not by the
# application. Keeping the two roles separate means a code-execution bug in the
# app cannot read every secret in the account, only the ones its own task role
# grants.

data "aws_iam_policy_document" "assume_ecs_tasks" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task_execution" {
  name               = "${local.name}-task-execution"
  assume_role_policy = data.aws_iam_policy_document.assume_ecs_tasks.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "task_execution_managed" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "task_execution_secrets" {
  statement {
    sid    = "ReadThisEnvironmentsSecretsOnly"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
    ]
    # Scoped to this environment's prefix. A wildcard here is how a staging
    # task ends up able to read production credentials.
    resources = concat(
      [
        aws_secretsmanager_secret.database_url.arn,
        aws_secretsmanager_secret.redis_url.arn,
        aws_secretsmanager_secret.origin_verify.arn,
        aws_secretsmanager_secret.cron_secret.arn,
      ],
      [for s in aws_secretsmanager_secret.app : s.arn],
    )
  }

  statement {
    sid       = "DecryptWithEnvironmentKey"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.main.arn]
  }
}

resource "aws_iam_role_policy" "task_execution_secrets" {
  name   = "secrets"
  role   = aws_iam_role.task_execution.id
  policy = data.aws_iam_policy_document.task_execution_secrets.json
}

# --- Task role -----------------------------------------------------------------
# The application's OWN identity. Everything it is allowed to do at runtime.

resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.assume_ecs_tasks.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "task" {
  statement {
    sid    = "AssetsBucket"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.assets.arn}/*"]
  }

  statement {
    sid       = "AssetsBucketList"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.assets.arn]
  }

  statement {
    sid    = "EncryptAssetUploads"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey",
    ]
    resources = [aws_kms_key.main.arn]
  }

  # Push notifications go out through the app's existing FCM/APNs path, not SNS.
  # No SNS grant here on purpose — an unused permission is a permission that
  # gets used by the next thing that needs somewhere to write.
}

resource "aws_iam_role_policy" "task" {
  name   = "app"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

# --- Supporting roles ----------------------------------------------------------

data "aws_iam_policy_document" "assume_flow_logs" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "flow_log" {
  name               = "${local.name}-flow-log"
  assume_role_policy = data.aws_iam_policy_document.assume_flow_logs.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "flow_log" {
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
    ]
    resources = ["${aws_cloudwatch_log_group.flow.arn}:*"]
  }
}

resource "aws_iam_role_policy" "flow_log" {
  name   = "write"
  role   = aws_iam_role.flow_log.id
  policy = data.aws_iam_policy_document.flow_log.json
}

data "aws_iam_policy_document" "assume_rds_monitoring" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "rds_monitoring" {
  count              = var.env == "prod" ? 1 : 0
  name               = "${local.name}-rds-monitoring"
  assume_role_policy = data.aws_iam_policy_document.assume_rds_monitoring.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  count      = var.env == "prod" ? 1 : 0
  role       = aws_iam_role.rds_monitoring[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# --- CI deploy role (GitHub OIDC) ----------------------------------------------
# No long-lived access keys in GitHub secrets. GitHub Actions presents an OIDC
# token; the trust policy below pins it to this repository AND — for prod — to
# a specific environment, so a workflow on a feature branch cannot deploy to
# production even if it can run.

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "assume_github" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = var.env == "prod" ? [
        # Production deploys only from the GitHub environment named "prod",
        # which carries a required-reviewers protection rule.
        "repo:FurlPay/Payment-App:environment:prod",
        ] : [
        "repo:FurlPay/Payment-App:environment:${var.env}",
      ]
    }
  }
}

resource "aws_iam_role" "ci_deploy" {
  name               = "${local.name}-ci-deploy"
  assume_role_policy = data.aws_iam_policy_document.assume_github.json
  tags               = local.common_tags
}

# The shared image repository, as an ARN rather than a resource reference.
#
# `aws_ecr_repository.web` has `count = var.env == "prod" ? 1 : 0` — it is created
# once in the prod stack and shared, because an image promoted dev → staging →
# prod must be the same bytes. So the dev and staging stacks cannot reference the
# resource; they have to name it. Composed from the caller's own account and
# region so it stays correct across partitions and never hardcodes an account id.
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_partition" "current" {}

locals {
  ecr_web_repository_arn = join("", [
    "arn:", data.aws_partition.current.partition,
    ":ecr:", data.aws_region.current.name,
    ":", data.aws_caller_identity.current.account_id,
    ":repository/furlpay/web",
  ])
}

data "aws_iam_policy_document" "ci_deploy" {
  # SPLIT INTO TWO STATEMENTS, deliberately.
  #
  # These were one statement with `resources = ["*"]` and a comment explaining
  # that `ecr:GetAuthorizationToken` has no resource scope. That is true of
  # GetAuthorizationToken and of nothing else in the list — so the wildcard it
  # justified also granted `ecr:PutImage` and `ecr:UploadLayerPart` on EVERY
  # repository in the account.
  #
  # The practical consequence: a compromised CI run, or any workflow able to
  # assume this role, could push an arbitrary image to any other service's
  # repository in the same account. With `IMMUTABLE` tags it could not overwrite
  # an existing tag on this repo, but nothing stopped it creating a new tag on a
  # neighbour's — and an image in a trusted registry is a supply-chain foothold.
  #
  # One statement for the token (genuinely account-scoped), one for the layer and
  # manifest operations (scoped to the single repository this project deploys).
  statement {
    sid       = "EcrAuthToken"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"] # No resource scope exists for this action.
  }

  statement {
    sid    = "PushImagesToThisRepositoryOnly"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
      "ecr:BatchGetImage",
    ]
    resources = [local.ecr_web_repository_arn]
  }

  statement {
    sid    = "DeployThisServiceOnly"
    effect = "Allow"
    actions = [
      "ecs:RegisterTaskDefinition",
      "ecs:DescribeTaskDefinition",
      "ecs:DescribeServices",
      "ecs:UpdateService",
    ]
    # Wildcard NARROWED BY CONDITION, not unscoped. ecs:RegisterTaskDefinition
    # has no resource to attach to (the definition does not exist yet), so AWS
    # requires "*" here; the Environment tag condition below is what confines the
    # whole statement to this environment's cluster and services.
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Environment"
      values   = [var.env]
    }
  }

  statement {
    sid       = "PassTaskRoles"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.task.arn, aws_iam_role.task_execution.arn]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  statement {
    sid    = "PublishMobileArtifacts"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:ListBucket",
    ]
    resources = [aws_s3_bucket.assets.arn, "${aws_s3_bucket.assets.arn}/*"]
  }
}

resource "aws_iam_role_policy" "ci_deploy" {
  name   = "deploy"
  role   = aws_iam_role.ci_deploy.id
  policy = data.aws_iam_policy_document.ci_deploy.json
}
