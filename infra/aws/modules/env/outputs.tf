output "api_base_url" {
  description = "What every client's *_API_BASE must be set to for this environment."
  value       = "https://${var.domain_name}/api"
}

output "web_origin" {
  description = "Site origin (no /api). The WebAuthn rpID and asset paths resolve against this."
  value       = "https://${var.domain_name}"
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.main.domain_name
}

output "cloudfront_distribution_id" {
  description = "Needed by CI to invalidate after an asset deploy."
  value       = aws_cloudfront_distribution.main.id
}

output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  value = aws_ecs_service.app.name
}

output "task_definition_family" {
  value = aws_ecs_task_definition.app.family
}

output "assets_bucket" {
  description = "OTA bundles under ota/, static assets under static/."
  value       = aws_s3_bucket.assets.bucket
}

output "ci_deploy_role_arn" {
  description = "Set as AWS_DEPLOY_ROLE_ARN in the matching GitHub environment."
  value       = aws_iam_role.ci_deploy.arn
}

output "database_secret_arn" {
  description = "Null unless var.enable_aws_data_plane."
  value       = one(aws_secretsmanager_secret.database_url[*].arn)
}

output "app_secret_arns" {
  description = "Secrets created empty. Fill each with `aws secretsmanager put-secret-value` before the first deploy — see the runbook."
  value       = { for k, s in aws_secretsmanager_secret.app : k => s.arn }
}

output "alarm_topic_arn" {
  value = aws_sns_topic.alarms.arn
}

# Not marked sensitive because it is not a secret: it is the environment tag the
# mobile build lanes stamp into their artifacts so a tester can tell which
# backend a build on their phone is talking to.
output "environment" {
  value = var.env
}
