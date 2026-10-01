# --- Alarms -------------------------------------------------------------------
# Deliberately few. An alarm nobody acts on trains the on-call to ignore the
# channel, so this covers only conditions that mean "money is not moving" or
# "the environment is about to fall over".

resource "aws_sns_topic" "alarms" {
  name              = "${local.name}-alarms"
  kms_master_key_id = aws_kms_key.main.id
  tags              = local.common_tags
}

resource "aws_sns_topic_subscription" "alarms_email" {
  count = var.alarm_email == "" ? 0 : 1

  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_metric_alarm" "target_5xx" {
  alarm_name          = "${local.name}-target-5xx"
  alarm_description   = "The application is returning server errors — requests are failing, not just slow."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 2
  threshold           = var.env == "prod" ? 10 : 50
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching" # no traffic is not an error

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
  tags          = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "unhealthy_hosts" {
  alarm_name          = "${local.name}-unhealthy-hosts"
  alarm_description   = "Tasks are failing their health check. At zero healthy hosts the API is down."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
    TargetGroup  = aws_lb_target_group.app.arn_suffix
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "latency" {
  alarm_name          = "${local.name}-p99-latency"
  alarm_description   = "p99 above the mobile client's own 20s request deadline means users see timeouts."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  extended_statistic  = "p99"
  period              = 300
  evaluation_periods  = 2
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  count = var.enable_aws_data_plane ? 1 : 0

  alarm_name          = "${local.name}-db-cpu"
  alarm_description   = "Aurora sustained high CPU — usually a missing index reaching production data volumes."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBClusterIdentifier = aws_rds_cluster.main[0].cluster_identifier
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = local.common_tags
}

# Cost guard. Not a reliability alarm — it exists because three full
# environments with NAT gateways and Aurora is the kind of bill that is only
# noticed at the end of the month.
resource "aws_cloudwatch_metric_alarm" "spend" {
  provider = aws.us_east_1 # Billing metrics are published in us-east-1 only

  alarm_name          = "${local.name}-estimated-charges"
  alarm_description   = "Estimated charges for this environment exceeded the expected envelope."
  namespace           = "AWS/Billing"
  metric_name         = "EstimatedCharges"
  statistic           = "Maximum"
  period              = 21600
  evaluation_periods  = 1
  threshold           = var.env == "prod" ? 800 : 200
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "missing"

  dimensions = {
    Currency = "USD"
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  tags          = local.common_tags
}
