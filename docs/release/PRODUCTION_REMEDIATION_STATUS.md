# Production remediation status

Baseline: branch `docs/architecture-2026-09-29` @ `26e6543` plus 36 uncommitted paths (audit 2026-09-30). **Nothing is committed or deployed.** A backup of the pre-remediation dirty tree is at `~/.furlpay-verify/remediation-before/` (tar plus staged/unstaged diffs).

Status vocabulary: **FIXED** (code changed, tests pass) · **VERIFIED** (runtime/external evidence) · **BLOCKED_EXTERNAL** (repo ready, needs access we do not have) · **UNVERIFIED** · **ACCEPTED** (risk accepted with a reason) · **OPEN** (not done) · **NOT_APPLICABLE** (finding already fixed before this pass).

## P0

| ID | Component | Status | Files | Fix | Tests | Evidence | External action |
|---|---|---|---|---|---|---|---|
| P0-1 | Webhook financial effects | **FIXED + VERIFIED on real PostgreSQL (harness)** | `supabase/migrations/0025_financial_effects.sql`, `lib/ledger.ts` (`applyFinancialEffect`), `lib/withDurableWebhook.ts`, `app/api/webhooks/stripe/route.ts`, `lib/services/account.ts`, dividend/reorg/order/fund/apple-pay/cashback callers | `ledger_transactions.external_ref` UNIQUE; `apply_financial_effect()` posts, applies balance deltas and acks the webhook in ONE transaction; ack failure after success no longer marks the event failed; every money effect keyed by provider facts | harness T-W1/T-W2/T-W3 (×100); `stripe/__tests__/effectIdempotency.spec.ts`; `financialEffects.spec.ts` | 310/310 on PostgreSQL 18 with 20 concurrent connections; 2 SQL mutants and 2 app mutants killed | apply 0025 to staging → production |
| P0-2 | Balance concurrency | **FIXED + VERIFIED on real PostgreSQL (harness)** | 0025 (`save_account_children` v3), `lib/storeDb.ts`, `lib/store.ts` | the snapshot can no longer write money (SQL ignores balance args); balances change only via row-locked, overdraft-guarded deltas in `apply_financial_effect`; in-memory copy re-read from DB after each effect; flush errors propagate + page | harness T-L2 ×100; `financialEffects.spec.ts` | 100/100 iterations: balance == Σ deltas == ledger | apply 0025 |
| P0-3 | Extension keyless address | **FIXED** | `apps/extension/lib/receiveAddress.ts`, `background.ts`, `WalletTab.tsx`, `SettingsTab.tsx`, `wallet-announce.content.ts`, `lib/types.ts` | only the verified linked wallet; none → "Set up your wallet in the FurlPay app" and EIP-1193 4100; `safeAddress` removed from extension types | `receiveAddress.test.ts` (T-E1 + tripwire) | ext 167/167, tsc, `wxt build`; tripwire mutant killed | CWS submission |
| P0-4 | Admin fallback | **FIXED** | `lib/adminIdentity.ts`, `lib/bootConfig.ts`, `src/instrumentation.ts`, `lib/authz.ts`, `lib/compliance/roleGrants.ts`, `lib/store.ts`, guest/webauthn routes | no fallback in production; boot refuses without `FURLPAY_ADMIN_EMAIL`; demo seed never exists in a production runtime (preview: unprivileged) | `adminFallback.spec.ts` (T-S1), `bootConfig.spec.ts` | 2 mutants killed | confirm `FURLPAY_ADMIN_EMAIL` in Vercel prod (PN-1); register `furlpay.app` |
| P0-5 | AWS env contract | **FIXED** (code) · deploy **BLOCKED_EXTERNAL** | `infra/aws/env-contract.json`, `modules/env/{compute,iam,data,monitoring,outputs,variables}.tf`, `scripts/aws/check-env-contract.mjs` | secrets named as the app reads them, from one contract file Terraform itself reads; Aurora/ElastiCache behind `enable_aws_data_plane=false`; passkey RP ID/origins injected; boot refuses placeholder secrets | T-A1 contract check; `bootConfig.spec.ts` | contract OK (22 vars); the same check reports 13 errors on the committed Terraform; `terraform validate` dev/staging/prod on 1.11.4 | AWS account + apply |

## P1

| ID | Status | Evidence / note |
|---|---|---|
| P1-1 migration immutability | **FIXED** | 0022 restored byte-for-byte; change shipped as `0024`; `scripts/db/check-migrations.mjs` (+3 tests) blocks edits to committed migrations; CI job added |
| P1-2 prod migration state | **BLOCKED_EXTERNAL** | read-only `scripts/db/probe-schema.mjs` proven on real PG (empty → exit 1; migrated → exit 0); runbook in `PRODUCTION_CAPABILITY_MATRIX.md` |
| P1-3 cron method | **FIXED** | every cron route exports `POST`; side-effecting jobs run once per UTC day (`lib/cron/runOnce.ts`); T-A3 9/9 |
| P1-4 CI running / branch protection | **BLOCKED_EXTERNAL** (billing, plan) · repo side **FIXED** | new `p0-regression` job (real Postgres service); infra-validate adds the org root and env contract |
| P1-5 OIDC repo | **FIXED** | `var.github_repo` (default `Ashutosh0x/furlpay`), validated; T-C3 runtime check needs AWS (**BLOCKED_EXTERNAL**) |
| P1-6 EAS profile | **FIXED** | `scripts/ci/eas-profile.sh` + `eas-profile.test.sh` (T-C2, reproduces the old bug) |
| P1-7 iOS build + AASA | code **FIXED** (CFString fix already in `a85c71e`; no other occurrence) · build **BLOCKED_EXTERNAL** (macOS runner + billing) · AASA **BLOCKED_EXTERNAL** (`APPLE_TEAM_ID` in Vercel/AWS; now in the AWS contract) |
| P1-8 Play signing / Google OAuth | **BLOCKED_EXTERNAL** | needs Play App Signing SHA-1/256; `apps/android/verify-assetlinks.sh` exists |
| P1-9 device attestation | **FIXED** (Android; iOS fail-closed) | `lib/attestation`, `POST /api/attestation/challenge`, gated gasless transfer + wallet link; `FURLPAY_ATTESTATION_MODE` off/report/enforce; T-M5 16/16. Needs `PLAY_INTEGRITY_SERVICE_ACCOUNT` + Play cert digests (**BLOCKED_EXTERNAL**); App Attest verification **OPEN** |
| P1-10 alerts / error tracking | alerts **FIXED** · error-tracking SDK **OPEN** | `lib/ops/financialAlerts.ts` wired to ack failure, payload mismatch, flush failure, effect refusal, lookup failure, admin action; T-O1 10/10. No vendor SDK (Sentry etc.) chosen; paging needs `FURLPAY_ALERT_WEBHOOK` (**BLOCKED_EXTERNAL**) |
| P1-11 self-custody double claim | **FIXED** | deposit-detect records activity only for linked wallets; T-L4 (route + durable) |
| P1-12 durable recipient lookup | **FIXED** | `findLinkedWalletOwner` (indexed PK); lookup failure → 503; T-W4 |
| P1-13 exact amounts | **FIXED** | `lib/deposits/parseDeposit.ts` BigInt + required network/token/decimals/logIndex; T-W5 |
| P1-14 clean tree / commits | **OPEN — deliberately** | the continuation brief said "do not commit yet"; logical commit plan in the final report |
| NEW `nameResolution` → keyless address | **FIXED** | handle resolution returns verified wallet or `no_receive_address` (409); `handleResolution.spec.ts` |
| NEW earn live receiver = keyless | **FIXED** | `verifiedReceiver()`; live without wallet → 409, no bundle; T-E2 |
| NEW Stripe non-USD credited as cents | **FIXED** | non-USD acknowledged, never credited; tested |
| NEW Terraform placeholder secrets reach the app | **FIXED** | boot refuses `REPLACE_ME`-class values in production |
| NEW AWS passkeys RP ID = localhost | **FIXED** | `FURLPAY_RP_ID` / `FURLPAY_ORIGIN` injected |

## P2

| ID | Status | Note |
|---|---|---|
| P2-1 CSP | **FIXED (partial)** | `'unsafe-eval'` removed from production (T-S3). `'unsafe-inline'` stays until nonce + `strict-dynamic` — **OPEN** |
| P2-2 egress | **FIXED** (443 only; data-plane ports VPC-internal only) · domain allowlist **OPEN** (`docs/aws/EGRESS.md`) · T-A4 **BLOCKED_EXTERNAL** |
| P2-3 governance | **FIXED (code)** | `infra/aws/org` (org CloudTrail + Object Lock COMPLIANCE, SCPs, Config, Security Hub FSBP, GuardDuty/SecHub delegation) validates; apply **BLOCKED_EXTERNAL** |
| P2-4 KV systems of record | **OPEN** | passkeys/API keys/OAuth clients/x402 still KV-only; plan in DR runbook |
| P2-5 wallet-link step-up | **NOT_APPLICABLE** | already implemented in `9e81051` (`recentStepUp`, tested in `walletLinkRoutes.spec.ts`); the audit was stale |
| P2-6 tx simulation | **OPEN** | native code; `native-app/node_modules` absent here, cannot run native tests |
| P2-7 refunds/chargebacks | **FIXED** | `lib/payments/stripeReversals.ts`; T-P3 7/7; Stripe dashboard must send the new events (**BLOCKED_EXTERNAL**) |
| P2-8 on-chain deposit verification | **DOWNGRADED → P3, OPEN** | deposits no longer create any financial effect (P1-11), so a forged provider event can only create an activity row |
| P2-9 DR | **FIXED (runbook)** · drill **BLOCKED_EXTERNAL** | `docs/aws/DR_RUNBOOK.md`; never rehearsed |
| P2-10 admin model | **FIXED (audit + notify)** · MFA-for-admin **OPEN** | every `requireRole("admin")` success → `admin.action` audit + notify alert |
| P2-11 kill switch | **FIXED** | `GET /api/app/config` + `lib/appConfig.ts` (T-M7); clients must read it (native not changed here) |

## P3–P5, PN

| ID | Status |
|---|---|
| P3-1 content-script reach | OPEN |
| P3-2 data-key wrapping | OPEN (native) |
| P3-3 SQLite at rest | ACCEPTED (token not stored in it; documented) |
| P3-4 JWT biometric binding | ACCEPTED (documented) |
| P3-5 health route | FIXED (liveness-only by design; dependency health is `/api/ops/health`) |
| P3-6 web PreviewBanner parity | OPEN |
| P3-7 WAF | FIXED — IP-reputation list + auth-path rate rule; validates |
| P4-1 data plane | design in `docs/release/AWS_DATA_PLANE.md` |
| P4-2 encrypted backup, P4-3 Step Functions | OPEN (design only) |
| P5-1 hardware signer, P5-2 certifications | OPEN |
| PN-1 … PN-10 | BLOCKED_EXTERNAL (Vercel env, Supabase PITR, partners, Resend DNS, credential rotation, keystore backup, FCM, Guardian audit, DNS lock, npm provenance) |

## Dirty-path classification (baseline 36 → current)

The pre-existing uncommitted work was **kept** and built on: the durable webhook wrapper, origin verification, KYC binding, the health route, the Dockerfile and the Terraform origin rule. The staged deletion of `kycStateMachine.ts` is **intentional**: its rule is now enforced inside `setKycStatus` via `webhookOrdering.kycTransitionAllowed`, and nothing imports it. See `PRODUCTION_REMEDIATION_FINAL.md` for the full list and the commit plan.

## Concurrency evidence re-established (2026-09-30)

The earlier harness figures (310/310, "×100") came from a harness whose pooled connections were opened lazily, so calls that were meant to be concurrent could run one after another. A cashback mutant with no `FOR UPDATE` and a random key **survived** that harness, which shows it could not detect a race. Those figures are superseded by the following:

- `scripts/db/verify-financial-effects.mjs` now releases workers from a start barrier: `simultaneously(n, work)`, an advisory-lock gate held on its own `pg.Client` while every worker waits inside an open transaction.
- Result: **317/317 passed at `--repeat 100`** on embedded PostgreSQL 18. T-W3 (20 simultaneous identical deliveries), T-W1 and T-L2 (two pools, 2×50 barrier-released credits/debits) each ran 100 times with 0 failures. Report: `~/.furlpay-verify/pg-harness/report-barrier-100.json`, outside the repo.
- Mutants now killed by the barrier harness:
  - a 0025 lost-update mutant (read-modify-write without the row lock): T-L2 failed 19 of 20;
  - the cashback mutant: the payout is duplicated.
- Scope: this is a local, disposable database. It says nothing about staging or production, where 0025 and 0026 are **not applied**.
