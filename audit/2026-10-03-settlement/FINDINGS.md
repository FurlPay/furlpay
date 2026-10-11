# Settlement security review: 2026-10-03 (rounds 1–3)

Machine-readable register: [`findings.json`](findings.json). Architecture, procedures and limits: [`docs/SETTLEMENT-CIRCUIT-BREAKER-RUNBOOK.md`](../../docs/SETTLEMENT-CIRCUIT-BREAKER-RUNBOOK.md).

**Sources.** Manual code review, on-chain reads and production configuration checks (variable names only). There is no Savant or CertiK report on FurlPay in the repository. **This is not a clean audit.** It covers the EVM settlement paths, ops emergency controls, the extension message boundary, and Elements exposure.

**Production state (verified 2026-10-03).**
- Production runs `dpl_5behwnn…`, which is commit `ea2ee50`. None of this work is deployed.
- Production env has no `ONCHAIN_SETTLEMENT_LIVE`, no KMS or facilitator config, no Arbitrum RPC, no relayer key or wrapper addresses, and **no `FURLPAY_ADMIN_EMAIL`**.
- EVM settlement can't run in production, so no settlement finding is production-exposed. The exception is FP-SET-09: the emergency controls themselves are unavailable.

## Round 3 decision (adversarial double-settlement and race audit)

**No confirmed P0 or P1 on the audited settlement paths.** Every concurrency defect found in round 3 is unreachable in production today, because those paths return 503 there:
- FP-SET-15: travel proof replay (P2).
- FP-SET-16: legacy payments double-posting, reproduced by a test that fails on the original code (P3).
- FP-SET-17: `x402-guard` release mis-reporting (P3).
- FP-SET-18: dividend lease-overlap, suspected (P3).

The strongest evidence:
- `/api/v1/payments` claims execution with a PostgREST conditional-update compare-and-set, CI-tested on real PostgreSQL with 10, 100 and 500 workers.
- Settler paths use a single-use EIP-3009 nonce claim, which USDC also enforces on-chain.
- Ledger reversals are protected by a partial unique index, and the durable write happens before the in-memory mirror.

**Not tested:**
- real-chain reorg and replacement (mocks only)
- cross-instance races on the in-memory stores (non-production)
- the smart contracts in `packages/contracts`
- external providers

This is not a claim that the system is secure in general.

## Severity matrix

| Severity | Confirmed | Suspected | Fixed and verified (pending deploy) | Unverified |
|---|--:|--:|--:|--:|
| P0 | 0 | 0 | 0 | 0 |
| P1 | 0 | 0 | 0 | 0 |
| P2 | 4 | 0 | 3 | 0 |
| P3 | 13 | 1 | 11 | 0 |
| P4 | 4 | 0 | 1 | 0 |
| PN | 0 | 0 | 0 | 1 |

That's 23 findings in total. The open P2 is FP-SET-09 (no production admin), a founder decision.

## Register

| ID | Sev | Title | Status |
|---|---|---|---|
| FP-SET-01 | **P2** | Ops pause not enforced at the settlement boundary | fixed, pending deploy |
| FP-SET-11 | **P2** | Compliance-guard wrapper/escrow writes bypassed every settlement control (raw relayer key) | fixed, pending deploy |
| FP-SET-09 | **P2** | No production admin; one admin can't satisfy dual approval | approver mechanism fixed (pending deploy); **production config required** |
| FP-SET-15 | **P2** | Travel payment proof not bound to the booking (payment replay after claim TTL) | fixed, pending deploy |
| FP-SET-16 | P3 | Legacy payments: concurrent execute double-posts; concurrent refund double-reverses (non-prod) | fixed, pending deploy (reproduced) |
| FP-SET-17 | P3 | `x402-guard` `releaseProvenUnsettled()` reported success when the script refused | fixed in source; never published (npm has 0.2.0 without this module) |
| FP-AUTH-01 | P3 | OTP start stored the code under the email as typed; check canonicalised (e2e login failure; per-case rate-limit budget) | fixed, pending deploy (reproduced) |
| FP-SET-18 | P3 | Dividend credit key covers the action set; lease-expiry overlap could double-pay | open (suspected) |
| FP-WEB-01 | P3 | Swag redemption: unauthenticated, no points check, HTML injection into the inbox | open |
| FP-SET-02 | P3 | Control state fails open on store errors (settlement path) | fixed, pending deploy |
| FP-SET-03 | P3 | RPC chain id not verified before signing | fixed, pending deploy |
| FP-SET-04 | P3 | Success relied on receipt status alone | fixed, pending deploy |
| FP-SET-05 | P3 | Reconciler unscheduled; no unresolved index | fixed, pending deploy (daily backstop) |
| FP-SET-06 | P3 | Single RPC provider (confirmed: production has none configured) | open: configuration |
| FP-SET-08 | P3 | Gasless pending transfers invisible to reconciliation; status path 404'd | fixed, pending deploy |
| FP-SET-10 | P3 | Rail-pause resume had no step-up | fixed, pending deploy |
| FP-SET-12 | P3 | One step-up could authorize concurrent privileged actions | fixed, pending deploy |
| FP-EXT-01 | P3 | Extension trusted content scripts for privileged messages | fixed (d138658), not published |
| FP-SET-07 | P4 | USDC/XSGD proxy-upgrade and authority monitoring | fixed, pending deploy |
| FP-SET-13 | P4 | User-signed relays outside the breaker | accepted (by design) |
| FP-SET-14 | P4 | Paywall mock path returns generated hash | accepted (unreachable in production) |
| FP-ELM-01 | P4 | Elements consensus bug: not in FurlPay's settlement path | not affected; partner check pending |
| FP-REV-01 | PN | Review notes on another session's uncommitted `payouts/batch` | awaiting owner |

## Money paths

| Path | Signer | Breaker gate | Chain/RPC checks | Receipt verified | Recorded + reconciled |
|---|---|---|---|---|---|
| x402 facilitator (`/api/x402/facilitator/settle`) | settler (KMS) | yes | yes | yes | yes |
| Account funding (`/api/account/fund` → `settle()`) | settler | yes | yes | yes | yes |
| x402 paywall (`lib/x402.ts`) | settler | yes | yes | yes | yes |
| MPP (`lib/mpp.ts`) | settler | yes | yes | yes | yes |
| Gasless (`/api/transfers/gasless`) | settler | yes | yes | yes | **yes (round 2)** |
| PolicyWrapper / escrow (`complianceGuard`) | relayer key (refused in prod) | **yes (round 2)** | yes | no (different events; residual) | no |
| User relays (`/api/chain/rpc`, `/api/mpc/sign`) | user's key | no, by design | n/a | n/a | n/a |

## Test failures in the working tree (round 2)

On a clean checkout of `88ddff0`, the four specs pass 35/35. The working tree fails 6 tests, and all 6 come from another session's **uncommitted** changes:
- `adminFallback.spec` (×2): the modified spec calls `adminConfigStatus` without importing it.
- `bootConfig.spec` (×1): the uncommitted `adminIdentity`/`bootConfig` change makes a missing admin non-fatal at boot, and the committed spec still expects a throw.
- `routeManifest.spec` (×3): the untracked `payouts/batch` route is unclassified (correct class: USER).

The seventh failure (`envRegistry`) was this work's and was fixed in `88ddff0`. None of the other session's files were modified.

## Retest (round 2, clean worktree on `fix/settlement-hardening`)
- `vitest run src/lib/__tests__`: exit 0, 186 files, 2777 passed, 15 skipped.
- `vitest run` (rest of web): 3750 passed. One file (`geo/nativeParity.spec`) fails to transform only in the worktree because `native-app/node_modules` is absent there. It passes 72/72 in the main checkout.
- `tsc --noEmit` (apps/web TypeScript 5.5.3): exit 0, 0 errors.
- ESLint on changed files: exit 0. Note: the config does not flag `eval` or unused variables, so this is a weak gate.
- Route-security scanner: clean.
- Mutation checks:
  - removing the gasless pending record fails a test;
  - removing the compliance-guard gate fails a test;
  - removing the step-up NX claim fails a test;
  - (round 1) disabling the epoch fence fails a test.

## Round 3 retest
- Legacy payments race: `paymentsConcurrency.spec`. On the original `payments.ts`, 2 of 4 fail (the second request reaches the ledger). With the fix, 4/4 pass.
- Travel proof binding: 67/67 travel proof and route specs pass.
- `x402-guard`: `node --test` gives 114 pass, 0 fail, 5 skipped. The mutant (old `return true`) fails both new interleaving tests.
- `vitest run src/lib/__tests__`: exit 0, 2785 passed. `tsc` (TypeScript 5.5.3): 0 errors. ESLint: 0. Route scan: clean.
- Rest of web: 3750 passed. `geo/nativeParity.spec` fails only because `native-app/node_modules` is absent, which is also the case in CI's `web-and-node`.

## CI on PR #93 (separately verified)
- **Pass:** secret scans (GitGuardian and Actions), Semgrep, dependency audit, license, CLA, Go/Python/Rust SDKs, Vercel preview, and `p0-regression` (after the env-contract regeneration in `4a41dfc`).
- **`web-and-node`:** now gets past `tsc` (the TS2307 fixed in `4a41dfc`). It still fails on `nativeParity` for the environment reason above. Fixing that means installing Expo in the web job, a CI design decision.
- **`mobile`:** fails on `native-app/lib/__tests__/releaseConfig.test.ts` (2 tests). The same failure appears on unrelated branches from 2026-10-02, so it predates this work.
- **`e2e`:** most failures are the Vercel Analytics debug script being blocked by the CSP (from the analytics hotfix on the base branch). Separately, the support-security fixture's OTP login fails. Neither is settlement code.
- **Snyk:** private-test quota exhausted.

## Residual risk
Everything open, PN, accepted or pending deploy above. Production protection isn't claimed: nothing here is deployed, and automatic halts default to shadow mode.
