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

> **Terraform version: `>= 1.11.0, < 2.0.0`** (pinned to 1.11.4 in
> `infra/aws/.terraform-version` and `.github/workflows/infra-validate.yml`).
> 1.11 is the floor because every backend uses `use_lockfile` — S3-native state
> locking, experimental in 1.10 and generally available from 1.11.

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

**Two certificates, two regions.**

- **Viewer certificate (`acm_certificate_arn`), in `us-east-1`.** CloudFront reads certificates from there and nowhere else. A certificate issued in `eu-west-1` produces a confusing "certificate not found" at distribution-create time.
- **Origin certificate (`alb_certificate_arn`), in the ALB's region (`eu-west-1`).** An ALB cannot use a certificate from another region. It must cover `origin-*.furlpay.com`, because the origin request policy does not forward the viewer `Host`, so CloudFront validates the ALB's certificate against the **origin** hostname. No certificate can be issued for `*.elb.amazonaws.com`. Without this, every request 502s.

```bash
aws acm request-certificate --region us-east-1 \
  --domain-name api.furlpay.com \
  --subject-alternative-names api-staging.furlpay.com api-dev.furlpay.com \
  --validation-method DNS

aws acm request-certificate --region eu-west-1 \
  --domain-name origin-api.furlpay.com \
  --subject-alternative-names origin-api-staging.furlpay.com origin-api-dev.furlpay.com \
  --validation-method DNS
```

The names are explicit SANs, not a `*.furlpay.com` wildcard, so each certificate covers exactly the hostnames Terraform uses:

| Environment | `domain_name` | `origin_domain_name` |
|---|---|---|
| dev | api-dev.furlpay.com | origin-api-dev.furlpay.com |
| staging | api-staging.furlpay.com | origin-api-staging.furlpay.com |
| prod | api.furlpay.com | origin-api.furlpay.com |

`node scripts/aws/check-edge-config.mjs` (CI) fails if Terraform, this table and the regions disagree.

### Certificate procedure (operator)

None of this is automated, and none of it has been run.

1. **Request** both certificates with the commands above, using the AWS account and profile that will own the stack.
2. **DNS validation.**
   - `aws acm describe-certificate --region <r> --certificate-arn <arn> --query 'Certificate.DomainValidationOptions[].ResourceRecord'` lists the records to create.
   - Create those CNAMEs in the hosted zone.
   - Run it once per certificate: the two regions produce different validation records.
3. **Wait for issuance.**
   - `aws acm wait certificate-validated --region <r> --certificate-arn <arn>`
   - `describe-certificate` must report `Status: ISSUED`. Do not apply before both certificates are issued.
4. **Attach.**
   - Pass `acm_certificate_arn` (us-east-1) and `alb_certificate_arn` (eu-west-1) to `terraform plan` / `apply` (section 2).
   - Variable validation refuses a viewer certificate that is not in us-east-1.
5. **Verify CloudFront → ALB TLS.**
   - `openssl s_client -connect origin-api.furlpay.com:443 -servername origin-api.furlpay.com </dev/null 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName` must show the origin name.
   - From your own IP this TCP connection is EXPECTED to be refused: the security group admits only CloudFront. Run it from a host inside the VPC, or temporarily verify through CloudFront in step 7 instead.
6. **Deploy** the application image (section 2 and the release process). Production boot refuses to start without `FURLPAY_TRUSTED_PROXY_HOPS`, `PUBLIC_API_ORIGIN`, `FURLPAY_RP_ID` and `FURLPAY_ORIGIN` (`lib/bootConfig.ts`).
7. **Test through CloudFront.** Expected results:

   | Request | Expected |
   |---|---|
   | `curl -sI https://api.furlpay.com/api/health` | 200 |
   | `curl -sI https://api.furlpay.com/analytics` | 307 to `/login` (anonymous) |
   | `curl -s https://api.furlpay.com/api/ops/analytics/dashboard` | 401 |
   | `curl -sI https://api.furlpay.com/dashboard` | 307 whose `Location` names `https://api.furlpay.com`, never `0.0.0.0` |

8. **Verify direct-origin protection.**
   - `curl -m 10 https://<alb-dns-name>/api/health` must time out (security group).
   - `curl -m 10 --resolve origin-api.furlpay.com:443:<alb-ip> https://origin-api.furlpay.com/api/health -H 'X-Origin-Verify: guess'` must time out from outside CloudFront ranges.
   - From inside the VPC, the same request without the real secret must return 404 (listener default action).
   - Record each result in the release evidence. These are the only proofs of the edge that cannot be produced from the repository.

## 2. Apply an environment

```bash
cd infra/aws/envs/dev
terraform init
terraform plan \
  -var hosted_zone_id=Z... \
  -var acm_certificate_arn=arn:aws:acm:us-east-1:...:certificate/... \
  -var alb_certificate_arn=arn:aws:acm:eu-west-1:...:certificate/... \
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

It is enforced in two places:

1. **The ALB** (`edge.tf`): the HTTPS listener's default action is a fixed 404;
   a single listener rule forwards to the app only when `X-Origin-Verify`
   matches. This is the boundary for every path, including `/_next/static/*`
   and `public/` files, which the Next.js middleware matcher never runs on.
2. **The application** (`apps/web/src/lib/originVerify.ts`, first thing in
   `middleware.ts`): the same header, compared case-sensitively in constant
   time. The task sets `ORIGIN_VERIFY_REQUIRED=true`; if the secret is then
   missing or shorter than 32 characters, every request — `/api/health`
   included — gets a 503, so ECS fails the deployment rather than serving an
   unprotected origin.

`/api/health` (GET/HEAD) is the only path the application lets through
without the header: ALB target health checks connect to the task directly and
cannot carry it. It returns a constant and touches no data.

**Rotating the origin secret** needs both ends to overlap: add the new value
to the listener rule's `values` (up to five), apply, update CloudFront's
custom header and the Secrets Manager value, force a new ECS deployment, then
remove the old value. Changing one end alone 404s every request.

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
