# AWS environments — runbook

Three independent stacks (`dev`, `staging`, `prod`), each with its own VPC,
Aurora cluster, Redis, secrets, domain and deploy role. Nothing is shared but
the Route53 zone, the ECR repository and the Terraform state bucket.

| | dev | staging | prod |
|---|---|---|---|
| API host | `api-dev.furlpay.com` | `api-staging.furlpay.com` | `api.furlpay.com` |
| VPC CIDR | `10.10.0.0/16` | `10.20.0.0/16` | `10.30.0.0/16` |
| Fargate | 1 × 0.5 vCPU | 2 × 1 vCPU | 3–12 × 2 vCPU |
| Aurora | 0.5–1 ACU, single-AZ | 0.5–4 ACU, single-AZ | 2–16 ACU, multi-AZ |
| Backups | 7 days | 7 days | 35 days |
| Logs | 7 days | 30 days | 365 days |
| Delete protection | off | off | **on** |

> **Nothing here has been applied.** Terraform is not installed on the machine
> this was authored on, so the configuration has not been run through
> `terraform validate`, let alone `plan`. Treat the first `plan` as part of the
> work, not as a formality.

---

## 1. One-time account setup

These are prerequisites the environment module takes as inputs; it deliberately
does not create them, because they outlive any single environment.

```bash
# State bucket (versioned — state file corruption is otherwise unrecoverable)
aws s3api create-bucket --bucket furlpay-tfstate \
  --region eu-west-1 --create-bucket-configuration LocationConstraint=eu-west-1
aws s3api put-bucket-versioning --bucket furlpay-tfstate \
  --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket furlpay-tfstate \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# ECR — one repository, images tagged per environment
aws ecr create-repository --repository-name furlpay/web --region eu-west-1 \
  --image-scanning-configuration scanOnPush=true \
  --image-tag-mutability IMMUTABLE

# GitHub OIDC provider (the trust anchor for every deploy role)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com
```

**ACM certificates must be in `us-east-1`** — CloudFront reads them from there
and nowhere else. A cert issued in `eu-west-1` produces a confusing
"certificate not found" at distribution-create time.

```bash
aws acm request-certificate --region us-east-1 \
  --domain-name api.furlpay.com \
  --subject-alternative-names api-staging.furlpay.com api-dev.furlpay.com \
  --validation-method DNS
```

## 2. Apply an environment

```bash
cd infra/aws/envs/dev
terraform init
terraform plan \
  -var hosted_zone_id=Z... \
  -var acm_certificate_arn=arn:aws:acm:us-east-1:...:certificate/... \
  -var container_image=<account>.dkr.ecr.eu-west-1.amazonaws.com/furlpay/web:bootstrap
terraform apply
```

**The service will not start until the app secrets are populated.** Terraform
creates them holding the literal string `REPLACE_ME` and then stops managing
their contents (`ignore_changes`), so a later `apply` will not clobber the real
values. Fill them once:

```bash
for k in SESSION_SECRET STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET RESEND_API_KEY \
         SUPABASE_SERVICE_ROLE_KEY SOLANA_RPC_URL EVM_RPC_URL FCM_SERVICE_ACCOUNT_JSON; do
  echo "== $k"
  aws secretsmanager put-secret-value \
    --secret-id "furlpay/dev/$k" --secret-string "$(read -rs v; echo "$v")"
done
```

`DATABASE_URL`, `REDIS_URL` and `ORIGIN_VERIFY_SECRET` are assembled by
Terraform from the resources it created — no human ever handles them.

For production the image must be pinned **by digest**; the variable has a
validation rule that rejects a plain tag. A tag can be moved after the fact, so
a task definition that records only a tag cannot tell you what it actually ran.

## 3. Origin verification

CloudFront injects `X-Origin-Verify: <secret>` on every request to the ALB, and
the ALB security group only accepts CloudFront's managed prefix list. **The
prefix list alone is not sufficient** — those IPs are shared by every
CloudFront customer, so anyone's distribution can reach the ALB. The header is
what makes the origin private.

The application must reject requests without it. Add to the Next.js
middleware, before any other handling:

```ts
const expected = process.env.ORIGIN_VERIFY_SECRET;
if (expected && req.headers.get("x-origin-verify") !== expected) {
  return new Response("Not found", { status: 404 });
}
```

Until that check exists, the ALB is effectively public and the WAF in front of
CloudFront protects nothing.

## 4. Rotating a secret

Secrets Manager rotation is not wired up. Rotating by hand:

```bash
aws secretsmanager put-secret-value --secret-id furlpay/prod/SESSION_SECRET --secret-string "$NEW"
aws ecs update-service --cluster furlpay-prod --service furlpay-prod --force-new-deployment
```

The second command is not optional — secrets are injected at **task start**, so
a running task keeps the old value indefinitely.

## 5. Teardown

`dev` and `staging` are disposable by design:

```bash
cd infra/aws/envs/dev && terraform destroy
```

`prod` has `deletion_protection = true` on the database and the load balancer.
Destroying it requires flipping that to `false` and applying first — a
deliberate two-step, so no single command can delete production data.

## 6. Cost

Rough monthly order-of-magnitude, eu-west-1, excluding data transfer:

| | dev | staging | prod |
|---|---|---|---|
| Fargate | ~$15 | ~$60 | ~$220 |
| Aurora Serverless v2 | ~$45 | ~$90 | ~$350 |
| NAT gateway | ~$35 | ~$35 | ~$70 |
| ElastiCache | ~$12 | ~$12 | ~$50 |
| ALB + CloudFront + WAF | ~$30 | ~$30 | ~$80 |
| **≈ total** | **~$140** | **~$230** | **~$770** |

A billing alarm per environment fires at $200 / $200 / $800. The single largest
avoidable line outside production is the NAT gateway; if dev's egress needs are
small, replacing it with a NAT instance or VPC endpoints alone would remove
most of that $35.
