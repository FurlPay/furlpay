# --- Aurora PostgreSQL --------------------------------------------------------
# NOT PROVISIONED BY DEFAULT (var.enable_aws_data_plane = false, audit P0-5).
# The application reaches Postgres ONLY through Supabase's PostgREST HTTP API
# (lib/supabase.ts reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) and never
# reads DATABASE_URL, so a cluster here would be paid for and never used. Enable
# it only after the data layer speaks SQL (see docs/release/AWS_DATA_PLANE.md).
#
# Serverless v2 in every environment, including prod. The workload is a payment
# API with a diurnal curve, not a steady batch load; provisioned instances
# sized for the peak idle at the trough. Prod simply gets a higher floor and a
# reader, set via db_min_acu / multi_az.

resource "aws_db_subnet_group" "main" {
  count = var.enable_aws_data_plane ? 1 : 0

  name       = "${local.name}-db"
  subnet_ids = aws_subnet.isolated[*].id
  tags       = local.common_tags
}

resource "aws_security_group" "db" {
  count = var.enable_aws_data_plane ? 1 : 0

  name        = "${local.name}-db"
  description = "Aurora — reachable only from the application tier"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from Fargate tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.service.id]
  }

  # No egress rule at all. A database does not initiate connections; the
  # default-deny that Terraform applies when `egress` is omitted is correct and
  # is stated here so a later "add egress for convenience" is a visible change.

  tags = merge(local.common_tags, { Name = "${local.name}-db" })
}

resource "random_password" "db" {
  count = var.enable_aws_data_plane ? 1 : 0

  length  = 32
  special = false # some Postgres drivers mangle URL-unsafe characters in a DSN
}

resource "aws_rds_cluster" "main" {
  count = var.enable_aws_data_plane ? 1 : 0

  cluster_identifier = "${local.name}-pg"
  engine             = "aurora-postgresql"
  engine_mode        = "provisioned"
  engine_version     = "16.4"
  database_name      = "furlpay"
  master_username    = "furlpay_app"
  master_password    = random_password.db[0].result

  db_subnet_group_name   = aws_db_subnet_group.main[0].name
  vpc_security_group_ids = [aws_security_group.db[0].id]

  storage_encrypted = true
  kms_key_id        = aws_kms_key.main.arn

  backup_retention_period      = var.env == "prod" ? 35 : 7
  preferred_backup_window      = "02:00-03:00"
  preferred_maintenance_window = "sun:04:00-sun:05:00"
  copy_tags_to_snapshot        = true

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = !var.deletion_protection
  final_snapshot_identifier = var.deletion_protection ? "${local.name}-pg-final-${formatdate("YYYYMMDDhhmmss", timestamp())}" : null

  # Payment data: a deleted row must stay recoverable to the minute for a
  # dispute window, which point-in-time restore gives and nightly snapshots
  # do not.
  enabled_cloudwatch_logs_exports = ["postgresql"]

  serverlessv2_scaling_configuration {
    min_capacity = var.db_min_acu
    max_capacity = var.db_max_acu
  }

  lifecycle {
    # timestamp() in final_snapshot_identifier would otherwise force a diff on
    # every plan.
    ignore_changes = [final_snapshot_identifier]
  }

  tags = local.common_tags
}

resource "aws_rds_cluster_instance" "writer" {
  count = var.enable_aws_data_plane ? 1 : 0

  identifier         = "${local.name}-pg-writer"
  cluster_identifier = aws_rds_cluster.main[0].id
  instance_class     = var.db_instance_class
  engine             = aws_rds_cluster.main[0].engine
  engine_version     = aws_rds_cluster.main[0].engine_version

  performance_insights_enabled = var.env == "prod"
  monitoring_interval          = var.env == "prod" ? 30 : 0
  monitoring_role_arn          = var.env == "prod" ? aws_iam_role.rds_monitoring[0].arn : null

  tags = local.common_tags
}

resource "aws_rds_cluster_instance" "reader" {
  count = var.enable_aws_data_plane && var.multi_az ? 1 : 0

  identifier         = "${local.name}-pg-reader"
  cluster_identifier = aws_rds_cluster.main[0].id
  instance_class     = var.db_instance_class
  engine             = aws_rds_cluster.main[0].engine
  engine_version     = aws_rds_cluster.main[0].engine_version

  performance_insights_enabled = true
  monitoring_interval          = 30
  monitoring_role_arn          = aws_iam_role.rds_monitoring[0].arn

  tags = local.common_tags
}

# --- ElastiCache Redis --------------------------------------------------------
# NOT PROVISIONED BY DEFAULT (var.enable_aws_data_plane). The app's KV client
# (lib/kv.ts) speaks the Upstash REST protocol over HTTPS and is called from
# Edge middleware, which cannot open a TCP Redis connection; REDIS_URL is read
# only by presence reports. ElastiCache is not a drop-in replacement.
#
# Would replace Upstash. The app uses Redis for idempotency keys, distributed locks
# and rate limits (see apps/web/src/lib/rateLimit.ts) — all three are
# correctness-critical on the money path, so this is not an optional cache.

resource "aws_elasticache_subnet_group" "main" {
  count = var.enable_aws_data_plane ? 1 : 0

  name       = "${local.name}-redis"
  subnet_ids = aws_subnet.isolated[*].id
  tags       = local.common_tags
}

resource "aws_security_group" "redis" {
  count = var.enable_aws_data_plane ? 1 : 0

  name        = "${local.name}-redis"
  description = "ElastiCache — reachable only from the application tier"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Redis from Fargate tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.service.id]
  }

  tags = merge(local.common_tags, { Name = "${local.name}-redis" })
}

resource "random_password" "redis_auth" {
  count = var.enable_aws_data_plane ? 1 : 0

  length  = 64
  special = false # ElastiCache AUTH tokens reject most punctuation
}

resource "aws_elasticache_replication_group" "main" {
  count = var.enable_aws_data_plane ? 1 : 0

  replication_group_id = "${local.name}-redis"
  description          = "FurlPay ${var.env} — locks, idempotency, rate limits"

  engine         = "redis"
  engine_version = "7.1"
  node_type      = var.env == "prod" ? "cache.t4g.small" : "cache.t4g.micro"
  port           = 6379

  num_cache_clusters         = var.multi_az ? 2 : 1
  automatic_failover_enabled = var.multi_az
  multi_az_enabled           = var.multi_az

  subnet_group_name  = aws_elasticache_subnet_group.main[0].name
  security_group_ids = [aws_security_group.redis[0].id]

  # Both are required, and neither is on by default. Without transit encryption
  # the AUTH token crosses the VPC in cleartext, which makes the token pointless.
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis_auth[0].result
  kms_key_id                 = aws_kms_key.main.arn

  snapshot_retention_limit = var.env == "prod" ? 7 : 0
  apply_immediately        = var.env != "prod"

  tags = local.common_tags
}

# --- S3: app assets + Expo OTA updates ---------------------------------------

resource "aws_s3_bucket" "assets" {
  bucket = "${local.name}-assets"
  tags   = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket = aws_s3_bucket.assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id
  versioning_configuration {
    # OTA updates are immutable by convention, but "by convention" has no
    # rollback. Versioning makes a bad bundle a delete-marker away from fixed.
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.main.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    id     = "expire-old-ota-versions"
    status = "Enabled"

    filter {
      prefix = "ota/"
    }

    noncurrent_version_expiration {
      # Long enough to roll back a bad release after a weekend, short enough
      # that superseded bundles do not accumulate forever.
      noncurrent_days = 90
    }
  }
}
