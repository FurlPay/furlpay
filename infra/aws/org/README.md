# AWS Organization guardrails: impact and apply prerequisites

**Status: CODE ONLY. NOT APPLIED.**

`terraform validate` passes. `terraform plan` has not been run: it needs management-account credentials and an explicit decision to read the organization's state. Applying this root is a separate, explicit approval. It is not part of any release or deploy step.

## What applying it does

| Resource | Effect | Reversible? |
|---|---|---|
| `aws_s3_bucket.audit` with Object Lock **COMPLIANCE**, `log_retention_days` = **2,555 days (7 years)** | Every CloudTrail object written is undeletable and unmodifiable by anyone, root included, until its retention expires | **No.** COMPLIANCE retention cannot be shortened or removed. The bucket cannot be deleted while it holds locked objects. Storage cost accrues for 7 years |
| `aws_cloudtrail.org` | Organization trail, all accounts and regions, log-file validation | yes (but see the SCP below) |
| `aws_organizations_policy` + attachment **at the organization root** | SCP applies to **every member account**; the management account is exempt by AWS design | detachable from the management account only |
| GuardDuty / Security Hub delegation, Security Hub FSBP, AWS Config recorder | detection services, with per-resource cost | yes |

## SCP blast radius

The SCP has four statements:

- **NoLeavingTheOrganization.** Denies `organizations:LeaveOrganization`. This is standard.
- **ProtectSecurityServices.** Denies stopping, deleting or updating CloudTrail, GuardDuty, Config and Security Hub, for **every principal in every member account, with no exemption role**.
  - Neither the delegated security account nor a Terraform role in a member account can change these settings.
  - That includes `guardduty:UpdateDetector` (e.g. enabling a protection plan) and `cloudtrail:UpdateTrail`.
  - The only path is detaching or editing the SCP from the management account.
  - **Decide before applying** whether a named break-glass/security role should be exempted (`ArnNotLike aws:PrincipalArn`).
- **NoRootUser.** Denies all actions to the root user of member accounts.
  - Root-only tasks in a member account (some billing and support-plan changes, account closure) then need the SCP detached temporarily.
- **ApprovedRegionsOnly.** Denies everything outside `allowed_regions` (eu-west-1, us-east-1) except global or us-east-1-only control planes.
  - The exemption list was widened on 2026-10-01 to the AWS reference set: `ce`, `cur`, `health`, `trustedadvisor`, `shield`, `account`, `pricing`, billing/payments/tax, `route53domains`, and the S3 / EC2 region-discovery reads.
  - Without them, billing, Cost Explorer and parts of the console fail in member accounts.
  - Any service later adopted in another region needs an SCP change first.

## Other findings

- The audit bucket encrypts with `aws:kms` and no explicit key, i.e. the AWS-managed `aws/s3` key. AWS-managed keys cannot grant cross-account decrypt. If the security account must read these logs directly, use a customer-managed KMS key with a key policy for that account.
- `security_account_id` has no default; the apply needs it.

## Prerequisites before an apply

1. Management-account credentials, run from the management account only.
2. A decision on the SCP exemption role, and on the retention length and mode. COMPLIANCE for 7 years is permanent; GOVERNANCE allows privileged override.
3. An existing security account ID.
4. A `terraform plan` reviewed by a person, with output attached to the approval.
5. A rollback plan for the SCP (detach command prepared). There is **no** rollback for Object Lock COMPLIANCE.
