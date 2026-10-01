#!/usr/bin/env node
// Static checks of the CloudFront → ALB → ECS edge in infra/aws (no AWS calls).
// Pins the facts the application's trust model depends on, so a Terraform edit
// that silently breaks one fails CI instead of production:
//
//   1. CloudFront's origin is the origin_domain_name record, not the ALB DNS name
//      (the viewer Host is not forwarded, so the origin cert must match it).
//   2. The ALB listener uses alb_certificate_arn; CloudFront uses acm_certificate_arn
//      (validated to us-east-1). They are never the same variable.
//   3. Every env root sets origin_domain_name = origin-<domain_name> and wires both certs.
//   4. The ALB security group admits only the CloudFront origin-facing prefix list,
//      the listener's default action is a fixed 404, and forwarding requires the
//      X-Origin-Verify header; CloudFront sends that header.
//   5. ALB XFF mode is "append" and the task sets FURLPAY_TRUSTED_PROXY_HOPS = "2".
//   6. The default behaviour is CachingDisabled; the origin policy forwards no Host.
//   7. The region the runbook tells operators to issue the ALB certificate in is
//      the env roots' region.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const AWS = join(ROOT, "infra", "aws");
const read = (...p) => readFileSync(join(...p), "utf8");
const edge = read(AWS, "modules", "env", "edge.tf");
const compute = read(AWS, "modules", "env", "compute.tf");
const vars = read(AWS, "modules", "env", "variables.tf");
const runbook = read(ROOT, "docs", "aws", "RUNBOOK.md");

const failures = [];
const must = (cond, msg) => cond || failures.push(msg);
const block = (src, header) => {
  const i = src.indexOf(header);
  if (i < 0) return "";
  let depth = 0;
  for (let j = src.indexOf("{", i); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(i, j + 1);
  }
  return "";
};

const cf = block(edge, 'resource "aws_cloudfront_distribution" "main"');
const listener = block(edge, 'resource "aws_lb_listener" "https"');
const rule = block(edge, 'resource "aws_lb_listener_rule" "origin_verified"');
const sgRule = block(edge, 'resource "aws_security_group_rule" "alb_from_cloudfront"');
const alb = block(edge, 'resource "aws_lb" "main"');
const originRec = block(edge, 'resource "aws_route53_record" "origin"');

must(/origin\s*\{[^}]*domain_name\s*=\s*aws_route53_record\.origin\.fqdn/s.test(cf), "1: CloudFront origin must be aws_route53_record.origin.fqdn");
must(!/domain_name\s*=\s*aws_lb\.main\.dns_name/.test(cf), "1: CloudFront origin must not be the ALB DNS name");
must(/name\s*=\s*var\.origin_domain_name/.test(originRec) && /aws_lb\.main\.dns_name/.test(originRec), "1: origin record must alias origin_domain_name to the ALB");
must(/certificate_arn\s*=\s*var\.alb_certificate_arn/.test(listener), "2: ALB listener must use var.alb_certificate_arn");
must(/acm_certificate_arn\s*=\s*var\.acm_certificate_arn/.test(cf), "2: CloudFront viewer certificate must be var.acm_certificate_arn");
must(/arn:aws:acm:us-east-1:/.test(block(vars, 'variable "acm_certificate_arn"')), "2: acm_certificate_arn must be validated to us-east-1");
must(/default_action\s*\{[^}]*type\s*=\s*"fixed-response"[\s\S]*?status_code\s*=\s*"404"/.test(listener), "4: listener default action must be a fixed 404");
must(/http_header_name\s*=\s*"X-Origin-Verify"/.test(rule) && /random_password\.origin_verify\.result/.test(rule), "4: forward rule must require X-Origin-Verify = the generated secret");
must(/custom_header\s*\{[^}]*name\s*=\s*"X-Origin-Verify"[^}]*random_password\.origin_verify\.result/s.test(cf), "4: CloudFront must send X-Origin-Verify");
must(/prefix_list_ids\s*=\s*\[data\.aws_ec2_managed_prefix_list\.cloudfront\.id\]/.test(sgRule) && !/cidr_blocks/.test(sgRule), "4: ALB ingress must be the CloudFront prefix list only");
must(!/0\.0\.0\.0\/0/.test(block(edge, 'resource "aws_security_group" "alb"')), "4: ALB security group must not admit 0.0.0.0/0");
must(/xff_header_processing_mode\s*=\s*"append"/.test(alb), '5: ALB xff_header_processing_mode must be "append"');
must(/name\s*=\s*"FURLPAY_TRUSTED_PROXY_HOPS",\s*value\s*=\s*"2"/.test(compute), "5: task must set FURLPAY_TRUSTED_PROXY_HOPS = 2");
must(/name\s*=\s*"PUBLIC_API_ORIGIN",\s*value\s*=\s*"https:\/\/\$\{var\.domain_name\}"/.test(compute), "5: task must set PUBLIC_API_ORIGIN = https://${var.domain_name}");
must(/cache_policy_id\s*=\s*"4135ea2d-6df8-44a3-9df3-4b5a84be39ad"/.test(cf), "6: default behaviour must be Managed-CachingDisabled");
must(/origin_request_policy_id\s*=\s*"b689b0a8-53d0-40ab-baf2-68738e2966ac"/.test(cf), "6: origin request policy must be AllViewerExceptHostHeader");

const regions = new Set();
for (const env of readdirSync(join(AWS, "envs"))) {
  let main;
  try {
    main = read(AWS, "envs", env, "main.tf");
  } catch {
    continue;
  }
  const domain = /domain_name\s*=\s*"([^"]+)"/.exec(main)?.[1];
  const origin = /origin_domain_name\s*=\s*"([^"]+)"/.exec(main)?.[1];
  must(domain && origin === `origin-${domain}`, `3: ${env}: origin_domain_name must be origin-${domain} (got ${origin})`);
  must(/alb_certificate_arn\s*=\s*var\.alb_certificate_arn/.test(main), `3: ${env}: alb_certificate_arn not wired`);
  must(runbook.includes(origin ?? "∅"), `7: runbook does not list ${origin} for the ALB certificate`);
  const region = /variable "region"[\s\S]*?default\s*=\s*"([^"]+)"/.exec(main)?.[1] ?? /default\s*=\s*"([a-z]{2}-[a-z]+-\d)"/.exec(read(AWS, "modules", "env", "variables.tf"))?.[1];
  if (region) regions.add(region);
}
for (const r of regions) must(runbook.includes(`--region ${r}`), `7: runbook must request the ALB certificate in ${r}`);
must(regions.size === 1, `7: env roots disagree on region: ${[...regions].join(", ")}`);

if (failures.length) {
  console.error(`Edge config check FAILED (${failures.length}):\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log(`Edge config OK: CloudFront→ALB TLS name, certificate regions, origin lock, XFF hop model, caching (region ${[...regions].join(",")}).`);
