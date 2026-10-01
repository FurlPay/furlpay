# Production remediation — final report (checkpoint 2026-09-30)

Companion to `PRODUCTION_REMEDIATION_STATUS.md` (the per-finding tracker). **Nothing has been committed, pushed or deployed.** Every "VERIFIED" below names the environment it was verified in. A real PostgreSQL 18 **scratch harness** is not production.

## A. P0 — before / after

| ID | Before | Fix | Tests | After | Evidence |
|---|---|---|---|---|---|
| P0-1 | Ack failure after a successful handler → event `failed` → redelivery re-claims → effect runs again; only a 24h Redis key in the way; random ledger ids | 0025 `apply_financial_effect` (UNIQUE `external_ref`, postings + deltas + webhook ack in one txn); effect keys from provider facts; ack failure no longer re-arms the event | harness T-W1/T-W2/T-W3 ×100; `effectIdempotency.spec.ts` (7); `financialEffects.spec.ts` (7) | **FIXED; VERIFIED on PostgreSQL 18 harness** | 310/310; 20 concurrent connections → 1 effect, 19 clean no-ops; mutants killed |
| P0-2 | Per-instance snapshots; `save_account_children` deleted + reinserted balances; flush errors swallowed | Snapshot can no longer write money (SQL); row-locked, overdraft-guarded deltas; in-memory copy re-read after each effect; flush errors propagate + page | harness T-L2 ×100; `financialEffects.spec.ts` | **FIXED; VERIFIED on harness** | 100/100 iterations, balance == Σ deltas == ledger |
| P0-3 | Extension Receive QR + `eth_requestAccounts` returned keyless `safeAddress` | verified linked wallet or nothing (4100); type removed | `receiveAddress.test.ts` | **FIXED** | ext 167/167, tsc, `wxt build` |
| P0-4 | Admin fell back to an email on an unregistered domain; admin seed in every prod process | no prod fallback; boot refuses; no prod seed | `adminFallback.spec.ts`, `bootConfig.spec.ts` | **FIXED** | mutants killed |
| P0-5 | Task injected names the app never reads; omitted the ones it needs; Aurora/ElastiCache unused | contract file read by Terraform; data plane gated off; RP ID injected; placeholder secrets refused at boot | T-A1 `check-env-contract.mjs` | **FIXED (code)**; deploy **BLOCKED_EXTERNAL** | contract OK; 13 errors on committed TF; `terraform validate` ×3 envs + org root |

## B. P1

| ID | Before | Fix | Tests | After |
|---|---|---|---|---|
| P1-1 | 0022 edited after commit | restored; `0024`; immutability checker + CI | 3 node tests + tamper check | FIXED |
| P1-2 | prod schema unknown | read-only probe proven on harness | probe proof (empty→1, migrated→0) | BLOCKED_EXTERNAL |
| P1-3 | EventBridge POST → 405 | POST exports; once-per-day guard for external posts | T-A3 9/9 | FIXED |
| P1-4 | CI billing-locked, no protection | `p0-regression` job (real Postgres) + infra job | YAML parses | repo FIXED; billing BLOCKED_EXTERNAL |
| P1-5 | OIDC trusted wrong repo | `var.github_repo` | validate | FIXED; runtime BLOCKED_EXTERNAL |
| P1-6 | prod EAS profile "production staging" | tested script | T-C2 | FIXED |
| P1-7 | Swift CFString errors; AASA 404 | fix already in `a85c71e`; `APPLE_TEAM_ID` in AWS contract | — | code FIXED; build + Team ID BLOCKED_EXTERNAL |
| P1-8 | Play fingerprints | — | — | BLOCKED_EXTERNAL |
| P1-9 | no server-side attestation | Play Integrity verifier, single-use nonces, rollout flag; iOS fail-closed | T-M5 16/16 | FIXED (Android code); credentials BLOCKED_EXTERNAL; App Attest OPEN |
| P1-10 | no alerting on money faults | financial alert catalog wired | T-O1 10/10 | alerts FIXED; error-tracking SDK OPEN |
| P1-11 | self-custody deposit credited internally | activity only | T-L4 | FIXED |
| P1-12 | per-instance recipient scan, 200 on miss | durable PK lookup; 503 on failure | T-W4 | FIXED |
| P1-13 | float amounts, defaulted chain/token | BigInt parser, required fields | T-W5 | FIXED |
| P1-14 | dirty tree | commit plan below | — | OPEN (deliberately, per brief) |

## C. P2

| ID | After |
|---|---|
| P2-1 | FIXED partial: prod `'unsafe-eval'` gone (T-S3); nonce CSP OPEN |
| P2-2 | FIXED: 443-only egress; domain firewall OPEN |
| P2-3 | FIXED (code): `infra/aws/org` validates; apply BLOCKED_EXTERNAL |
| P2-4 | OPEN |
| P2-5 | NOT_APPLICABLE (already done in `9e81051`) |
| P2-6 | OPEN (native) |
| P2-7 | FIXED: refunds/disputes keyed + balanced (T-P3) |
| P2-8 | downgraded to P3 (no deposit effect remains) — OPEN |
| P2-9 | runbook FIXED; drill BLOCKED_EXTERNAL |
| P2-10 | audit + notify FIXED; admin MFA OPEN |
| P2-11 | FIXED server side (T-M7); clients must consume it |

## D. P3 / P4 / P5 / PN
See the status tracker. FIXED: P3-5, P3-7. ACCEPTED: P3-3, P3-4. OPEN: P3-1, P3-2, P3-6, P4-*, P5-*. PN-1…10: BLOCKED_EXTERNAL.

## E. Financial invariants

| Invariant | Mechanism | Proof |
|---|---|---|
| No duplicate financial effects | UNIQUE `ledger_transactions.external_ref`; `ON CONFLICT DO NOTHING` inside `apply_financial_effect`; deterministic keys | harness T-W3 ×100 (20 connections); route T-W3 |
| No lost balance updates | balances written only by row-locked deltas in the DB; snapshot ignores money | harness T-L2 ×100 (two pools, 100 interleaved ops) |
| Ledger always balances | debits = credits checked inside the function; append-only postings trigger | harness "every committed transaction balances" (207+ txns per run); unbalanced input refused with no residue |
| Self-custody not double-counted | deposit-detect creates no balance/ledger entry for linked wallets | T-L4 route + durable specs |
| Webhook retries safe | ack failure → success response, no re-arm; duplicate effect → applied=false, 200 | T-W1 harness + route; mutant (old behaviour) fails the test |
| Provider retries safe | keys are provider facts (`stripe:pi:*`, `stripe:refund:*`, `x402-fund:{from}:{nonce}`, `applepay:{ref}`) | route T-W2 (all KV and claim rows cleared → still one effect) |

Caveat: the route-level tests use an in-memory double of the SQL. The SQL itself is proven separately on real PostgreSQL. No end-to-end run through PostgREST against a real Supabase has been done (no staging credentials here).

## F. Security invariants

| Invariant | Evidence |
|---|---|
| No fallback admin | `adminFallback.spec.ts` + source tripwire; boot guard |
| No keyless wallet address as recipient | extension tripwire; `safeAddressNeverRecipient.spec.ts` (web tripwire + earn); `handleResolution.spec.ts` |
| No server-side user private keys | unchanged; platform gas key KMS-only in prod (`x402Settler.ts`) |
| No unsafe financial retry | section E |
| No secret logging in alerts | `scrubAlertContext` tests |
| No placeholder secrets at runtime | `bootConfig.spec.ts` |
| No unsigned privileged deployment | OIDC pinned to repo + GitHub environment; **not enforceable until billing/branch protection are restored** |

## G. AWS readiness

| Item | Code-ready | Verified | External |
|---|---|---|---|
| Terraform validate (dev/staging/prod/org) | yes | `terraform validate` 1.11.4, fmt clean | apply |
| Env contract | yes | T-A1 | populate secrets |
| OIDC | yes | validate | role assumption test |
| Network / egress | 443-only | validate | T-A4 |
| ALB + origin header | yes (pre-existing, uncommitted) | validate + `originVerify.spec.ts` | — |
| CloudFront / WAF | IP reputation + auth rate rule added | validate | — |
| ECS / Secrets Manager / KMS | yes | validate | apply |
| CloudTrail / Config / Security Hub / GuardDuty | org root | validate | management account |
| Backup | Aurora retention only when enabled; AWS Backup plan **OPEN** | — | — |
| S3 / ECR | pre-existing | validate | — |
| Scheduler / SQS DLQ | POST fixed; DLQ pre-existing | T-A3 | — |
| Data plane | gated off by design | validate | P4-1 |

## H. Mobile readiness (separate, never merged)

| Surface | Status |
|---|---|
| Android code | attestation server side done; kill-switch endpoint available; EAS lane fixed. Native tests **not run** (no `native-app/node_modules` in this checkout) |
| Android Play | BLOCKED_EXTERNAL (App Signing fingerprints, Google OAuth, upload) |
| iOS code | CFString fix present; App Attest server verification OPEN |
| iOS App Store | BLOCKED_EXTERNAL (macOS runner, Apple account, Team ID, APNs) |

## I. Launch decision

- **PUBLIC MONEY-MOVING LAUNCH: BLOCKED.** Needs: 0006–0025 applied to production and probed; CI running with branch protection; a real rail/issuer/custodian (PN-3); error-tracking SDK; admin MFA; KV systems of record moved (P2-4).
- **ANDROID INTERNAL TEST: BLOCKED → READY once:** PN-1 confirmed (or this code deployed), 0025 applied before this code deploys, Play fingerprints added after the first upload.
- **CHROME WEB STORE: code READY; submission BLOCKED_EXTERNAL.** Needs: the CWS developer account, screenshots, and a zip rebuilt from this tree after commit.
- **iOS TESTFLIGHT: BLOCKED.** Needs a macOS build, Apple account, Team ID and APNs.
- **AWS CUTOVER: BLOCKED.** Needs an AWS account, applied org + env roots, populated secrets, and staging soak (phases 1–10 of the migration plan).

## Commit plan (not executed)

1. `fix(admin-bootstrap)`: adminIdentity, bootConfig, instrumentation, authz, roleGrants, store seed gating, guest/webauthn, specs
2. `fix(extension-wallet)`: receiveAddress + extension changes + test
3. `fix(migrations)`: restore 0022, add 0024 + check-migrations (+test)
4. `fix(ledger)`: 0025, ledger.ts, storeDb/store money path, services/account + callers, harness + specs
5. `fix(webhooks)`: withDurableWebhook, stripe (keys, currency, reversals), deposit-detect rewrite + parser + specs; the pre-existing durable-webhook, KYC-binding and origin work
6. `fix(receivers)`: nameResolution, earn verifiedReceiver, T-E2 specs
7. `fix(aws-runtime-contract)`: Terraform env module, env-contract.json, checker, org root, WAF, egress
8. `fix(cron)`, `fix(mobile-ci)`, `feat(attestation)`, `feat(alerts)`, `feat(app-config)`, `fix(csp)`
9. `docs(remediation)`

## Concurrency evidence re-established (2026-09-30)

The earlier harness figures (310/310, "×100") came from a harness whose pooled connections were opened lazily, so calls that were meant to be concurrent could run one after another. A cashback mutant with no `FOR UPDATE` and a random key **survived** that harness, which shows it could not detect a race. Those figures are superseded by the following:

- `scripts/db/verify-financial-effects.mjs` now releases workers from a start barrier: `simultaneously(n, work)`, an advisory-lock gate held on its own `pg.Client` while every worker waits inside an open transaction.
- Result: **317/317 passed at `--repeat 100`** on embedded PostgreSQL 18. T-W3 (20 simultaneous identical deliveries), T-W1 and T-L2 (two pools, 2×50 barrier-released credits/debits) each ran 100 times with 0 failures. Report: `~/.furlpay-verify/pg-harness/report-barrier-100.json`, outside the repo.
- Mutants now killed by the barrier harness:
  - a 0025 lost-update mutant (read-modify-write without the row lock): T-L2 failed 19 of 20;
  - the cashback mutant: the payout is duplicated.
- Scope: this is a local, disposable database. It says nothing about staging or production, where 0025 and 0026 are **not applied**.
