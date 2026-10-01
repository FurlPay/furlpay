# --- KMS ---------------------------------------------------------------------

resource "aws_kms_key" "main" {
  description             = "FurlPay ${var.env} — database, cache, secrets, logs"
  enable_key_rotation     = true
  deletion_window_in_days = var.env == "prod" ? 30 : 7
  tags                    = local.common_tags
}

resource "aws_kms_alias" "main" {
  name          = "alias/furlpay-${var.env}"
  target_key_id = aws_kms_key.main.key_id
}

# --- Secrets -----------------------------------------------------------------
# Connection strings are ASSEMBLED here so no human ever handles them, and the
# application reads them by ARN. Values the app needs but Terraform cannot know
# (Stripe keys, RPC URLs, the session signing secret) get a secret with a
# placeholder and are filled in out-of-band — `ignore_changes` keeps Terraform
# from reverting them on the next apply.

resource "aws_secretsmanager_secret" "database_url" {
  count = var.enable_aws_data_plane ? 1 : 0

  name       = "furlpay/${var.env}/DATABASE_URL"
  kms_key_id = aws_kms_key.main.arn
  tags       = local.common_tags
}

resource "aws_secretsmanager_secret_version" "database_url" {
  count = var.enable_aws_data_plane ? 1 : 0

  secret_id = aws_secretsmanager_secret.database_url[0].id
  secret_string = format(
    "postgresql://%s:%s@%s:5432/%s?sslmode=require",
    aws_rds_cluster.main[0].master_username,
    random_password.db[0].result,
    aws_rds_cluster.main[0].endpoint,
    aws_rds_cluster.main[0].database_name,
  )
}

resource "aws_secretsmanager_secret" "redis_url" {
  count = var.enable_aws_data_plane ? 1 : 0

  name       = "furlpay/${var.env}/REDIS_URL"
  kms_key_id = aws_kms_key.main.arn
  tags       = local.common_tags
}

resource "aws_secretsmanager_secret_version" "redis_url" {
  count = var.enable_aws_data_plane ? 1 : 0

  secret_id = aws_secretsmanager_secret.redis_url[0].id
  # rediss:// — the TLS scheme. Plain redis:// against a transit-encrypted
  # cluster fails to connect, and the failure looks like a network problem.
  secret_string = format(
    "rediss://:%s@%s:6379",
    random_password.redis_auth[0].result,
    aws_elasticache_replication_group.main[0].primary_endpoint_address,
  )
}

# Application secrets Terraform must not invent. Created with a placeholder so
# the task definition can reference a stable ARN from day one.
#
# THE NAMES ARE THE APPLICATION'S (audit P0-5). This list used to inject
# SESSION_SECRET, EVM_RPC_URL and FCM_SERVICE_ACCOUNT_JSON, none of which the
# app reads, while omitting FURLPAY_SESSION_SECRET (without it the app throws
# in production), SUPABASE_URL and the KV REST pair (without them there is no
# data plane at all) and FURLPAY_ADMIN_EMAIL (without it production refuses to
# boot — there is no fallback admin). The source of truth is
# infra/aws/env-contract.json; scripts/aws/check-env-contract.mjs fails CI when
# this list and the code disagree.
#
# A placeholder must never reach a running process as if it were a secret —
# "REPLACE_ME" as STRIPE_WEBHOOK_SECRET would let anyone forge signed events.
# lib/bootConfig.ts refuses to start with any placeholder value present.
resource "aws_secretsmanager_secret" "app" {
  for_each = toset(local.app_secret_names)

  name       = "furlpay/${var.env}/${each.value}"
  kms_key_id = aws_kms_key.main.arn
  tags       = local.common_tags
}

resource "aws_secretsmanager_secret_version" "app_placeholder" {
  for_each = aws_secretsmanager_secret.app

  secret_id     = each.value.id
  secret_string = "REPLACE_ME"

  lifecycle {
    # The real value is set with `aws secretsmanager put-secret-value` (see the
    # runbook). Without this, every apply would overwrite it with REPLACE_ME —
    # a production outage caused by running plan/apply on an unrelated change.
    ignore_changes = [secret_string]
  }
}

# --- ECS ---------------------------------------------------------------------

resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = var.env == "prod" ? "enhanced" : "disabled"
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/furlpay/${var.env}/app"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.main.arn
  tags              = local.common_tags
}

resource "aws_security_group" "service" {
  name        = "${local.name}-service"
  description = "Fargate tasks"
  vpc_id      = aws_vpc.main.id

  # HTTPS ONLY (audit P2-2). Every dependency the task talks to — Supabase
  # (PostgREST), Upstash (REST), Stripe, Resend, Persona/Sumsub, LI.FI, RPC
  # providers, KMS and the other AWS APIs via VPC endpoints — is HTTPS on 443.
  # This was all protocols to anywhere. DNS to the VPC resolver is not subject
  # to security groups. A per-domain allowlist (Network Firewall) is the next
  # step; docs/aws/EGRESS.md lists the destinations it must admit.
  egress {
    description = "HTTPS to dependencies"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  dynamic "egress" {
    for_each = var.enable_aws_data_plane ? { postgres = 5432, redis = 6379 } : {}
    content {
      description = "${egress.key} inside the VPC (data plane only)"
      from_port   = egress.value
      to_port     = egress.value
      protocol    = "tcp"
      cidr_blocks = [var.vpc_cidr]
    }
  }

  tags = merge(local.common_tags, { Name = "${local.name}-service" })
}

# Ingress is a separate resource, not an inline rule: the ALB SG references the
# service SG and vice versa, and inline rules on both sides is a cycle.
resource "aws_security_group_rule" "service_from_alb" {
  type                     = "ingress"
  description              = "App port from the load balancer only"
  from_port                = 3000
  to_port                  = 3000
  protocol                 = "tcp"
  security_group_id        = aws_security_group.service.id
  source_security_group_id = aws_security_group.alb.id
}

resource "aws_ecs_task_definition" "app" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64" # Graviton: ~20% cheaper per task at identical vCPU
  }

  # Writable scratch for a read-only root filesystem. Fargate has no tmpfs
  # support (that is ECS-on-EC2 only), so the writable paths have to be real
  # volumes. Next.js needs /tmp for its own scratch and .next/cache for ISR.
  volume {
    name = "tmp"
  }
  volume {
    name = "next-cache"
  }

  container_definitions = jsonencode([
    {
      name      = "web"
      image     = var.container_image
      essential = true

      # --- container hardening ------------------------------------------------
      # A read-only root filesystem is the single highest-value container
      # control: it turns "write a webshell and execute it" into two problems
      # instead of one. The two mounts below are the ONLY writable paths.
      readonlyRootFilesystem = true
      mountPoints = [
        { sourceVolume = "tmp", containerPath = "/tmp", readOnly = false },
        # apps/web/Dockerfile runs the monorepo standalone server from
        # /app/apps/web, so its cache is /app/apps/web/.next/cache.
        { sourceVolume = "next-cache", containerPath = "/app/apps/web/.next/cache", readOnly = false },
      ]

      # Run as the `node` user baked into the official image, not root. Fargate
      # isolates each task in its own microVM, so a container escape is already
      # bounded — but nothing in this app needs uid 0, and dropping it costs
      # nothing.
      user = "1000:1000"

      linuxParameters = {
        # No setuid binaries can gain privileges. Next.js spawns no helpers
        # that need it.
        initProcessEnabled = true # reaps zombies; a Node app that spawns anything needs this
      }

      portMappings = [{ containerPort = 3000, protocol = "tcp" }]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "FURLPAY_ENV", value = var.env },
        { name = "PORT", value = "3000" },
        { name = "AWS_REGION", value = var.region },
        { name = "ASSETS_BUCKET", value = aws_s3_bucket.assets.bucket },
        { name = "PUBLIC_API_ORIGIN", value = "https://${var.domain_name}" },
        # Tells the app it runs behind CloudFront: without a usable
        # ORIGIN_VERIFY_SECRET it then refuses everything (503, health included)
        # rather than serving an unprotected origin. See lib/originVerify.ts.
        { name = "ORIGIN_VERIFY_REQUIRED", value = "true" },
        # Client IP = 2nd X-Forwarded-For entry from the right (CloudFront, then
        # the ALB, append). Without it every per-IP rate limit trusts a header
        # the client sets. See lib/rateLimit.ts clientIp().
        { name = "FURLPAY_TRUSTED_PROXY_HOPS", value = "2" },
        # Passkeys: off Vercel the RP ID would otherwise resolve to "localhost".
        { name = "FURLPAY_RP_ID", value = var.webauthn_rp_id },
        { name = "FURLPAY_ORIGIN", value = var.webauthn_origins },
        # iOS universal links + passkeys (AASA). Not a secret: the Team ID is public.
        { name = "APPLE_TEAM_ID", value = var.apple_team_id },
      ]

      # Injected by the execution role at task start — never baked into the
      # image, never visible in the task definition, which is world-readable
      # to anyone with ecs:DescribeTaskDefinition.
      secrets = concat(
        # DATABASE_URL / REDIS_URL only when the AWS data plane exists AND the
        # app has been taught to use it (var.enable_aws_data_plane).
        [for s in aws_secretsmanager_secret.database_url : { name = "DATABASE_URL", valueFrom = s.arn }],
        [for s in aws_secretsmanager_secret.redis_url : { name = "REDIS_URL", valueFrom = s.arn }],
        [
          # The other half of the scheduler. EventBridge sends this value as
          # `x-furlpay-cron-key`; without it in the task, lib/cron/auth.ts
          # correctly refuses every scheduled job — including reconciliation.
          { name = "FURLPAY_CRON_SECRET", valueFrom = aws_secretsmanager_secret.cron_secret.arn },
          # The application half of the origin boundary (the ALB listener rule
          # in edge.tf is the other). The execution role could already read it;
          # it was never injected, so the app-side check could not run.
          { name = "ORIGIN_VERIFY_SECRET", valueFrom = aws_secretsmanager_secret.origin_verify.arn },
        ],
        [for k, s in aws_secretsmanager_secret.app : { name = k, valueFrom = s.arn }],
      )

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "web"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = local.common_tags
}

resource "aws_ecs_service" "app" {
  name            = local.name
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.service.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "web"
    container_port   = 3000
  }

  # Rolling deploy with a circuit breaker: a task that fails its health check
  # rolls the service back instead of leaving the deployment half-applied.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = var.env == "prod" ? 100 : 50

  health_check_grace_period_seconds = 90
  enable_execute_command            = var.env != "prod" # `ecs execute-command` is a shell into a task; not in prod

  lifecycle {
    # CI updates the task definition revision directly (see the deploy
    # workflow). Terraform must not fight it back to the last-applied image.
    ignore_changes = [task_definition, desired_count]
  }

  depends_on = [aws_lb_listener.https]

  tags = local.common_tags
}

# --- Autoscaling -------------------------------------------------------------

resource "aws_appautoscaling_target" "app" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.app.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.desired_count
  max_capacity       = var.max_count
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${local.name}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.app.service_namespace
  resource_id        = aws_appautoscaling_target.app.resource_id
  scalable_dimension = aws_appautoscaling_target.app.scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value = 65

    # Scale out fast, scale in slowly: a premature scale-in during a traffic
    # ramp reads to the user as the API going down.
    scale_out_cooldown = 60
    scale_in_cooldown  = 300
  }
}
