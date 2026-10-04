# FurlPay cross-platform audit and release checkpoint

**Date:** 2026-10-04  
**Audit branch:** `codex/cross-platform-audit`, based on `ddfc37d53a027e166e5b0f94804c5d4508c39ac3`  
**Status:** code fixes are in the audit branch. No Vercel deployment, Supabase migration, or production mutation was performed.

## Scope and confidence

The repository has 920 tracked client-platform files: 464 React Native, 180 Guardian Android/Wear, 134 iOS, 88 Chrome extension, and 54 Android app files. This pass statically inventoried those areas and deeply reviewed the money, session, transport-trust, certificate, wallet-consent, and wearable-message boundaries. It is **not** a statement that every one of those files was individually line-reviewed or built on every target.

The production migration ledger was previously read with the FurlPay Supabase account. It contains only `0001` through `0006`; local migrations continue through `0029`. No backup/PITR verification or migration preflight was executed, so the actual production schema and any migration plan remain unverified.

## P0 — release blockers

| Finding | State | Required next action |
| --- | --- | --- |
| Production database history differs from local migration files (`0001`–`0006` remotely; local files through `0029`). | **Open / do not deploy** | Take/verify a production backup or PITR point, run only the documented read-only schema/preflight comparison, then review the resulting migration plan. Do not repair the ledger by hand. |
| This branch has not passed the release gate: it has no CI result for its final SHA and was not deployed. | **Open / do not deploy** | Resolve checks below, push, obtain green CI, then use `npm run deploy:prod` from a clean exact SHA. |
| iOS verification cannot start because Swift/Xcode tooling is unavailable on this Windows host. | **Open** | Run the iOS test target and archive checks on macOS/Xcode. |

No deployed, actively exploited P0 issue was confirmed in this pass. The blockers above prevent a production-ready assurance.

## P1 — security and money movement

| Finding | State | Change |
| --- | --- | --- |
| A successful transaction receipt with the wrong transfer logs could be promoted from `PENDING` to `CONFIRMED` during recovery. | **Fixed locally; tested** | Persisted the expected token/from/to/value/nonce for every settlement entry. The status endpoint and reconciler now verify receipt logs against those values and abandon/reorg a mismatch rather than confirm it. Legacy pending records without expectations also fail closed. |
| A stale refresh or stale 401 could overwrite or clear a newer mobile session. | **Fixed locally; RN tested** | Added generation/CAS protection to React Native, Android and iOS token stores. A request that observes a session transition stops instead of sending under the wrong account; a 401 clears only the exact request token. |
| The ComplyAdvantage signature parser accepted a valid 64-character HMAC followed by non-hex suffixes. Webhook errors also exposed internal detail. | **Fixed locally; tested** | Require exactly 64 hexadecimal characters before constant-time comparison and return a generic invalid-webhook response. |
| Settlement/integration product rails are marked live only by configuration and provider credentials. | **Open / operational** | Keep the thirteen unsupported product flags disabled until legal, provider, operational, monitoring and rollback evidence is approved. Code must not be used to fabricate partner readiness. |

## P2 — cross-client trust boundaries

| Finding | State | Change |
| --- | --- | --- |
| Chrome extension accepted content-script messages without requiring a valid HTTPS sender URL. Logout retained cached wallet state and allowed origins. | **Fixed locally; tested** | Gate all page-originated message types by extension ID and a parseable HTTPS sender URL. Successful logout now clears cached account data, pending connects, grants, notification state, and badge state. X402 detections are sanitized again in the service worker. |
| Android mobile/Wear listeners trusted non-auth messages from arbitrary paired-device sources. | **Fixed locally; build blocked** | Gate inbound voice, refresh, alarm and acknowledgement messages/data by the currently paired node. Empty auth-revocation signals retain their intended revocation path. |
| Mobile device/app attestation defaults and production enforcement evidence were not established in this pass. | **Open** | Verify production configuration and server-side attestation enforcement with real release builds before enabling sensitive features. |

## P3 — validation and functional integrity

| Finding | State | Change |
| --- | --- | --- |
| Core money schemas had positive-number checks but no common upper bound, enabling impractical values and inconsistent limits. | **Fixed locally; tested** | Added a shared 1,000,000 maximum to transfer, checkout, intent and order money/quantity fields, including a 24-hour bound on settlement duration. |
| `accountApi.uploadAvatar` is a stale client wrapper even though the profile-avatar route exists. Device unlink, secure KYC session management, and session-revocation workflows still need real server contracts. | **Open** | Reconnect or remove stale client APIs only after confirming required data minimization and server-side authorization behavior. |
| P2P/recurring workflows and operational state need durable, transactional backing and restart-safe reconciliation where they still use process-local state. | **Open** | Design and migrate durable storage with idempotency and recovery testing before describing these workflows as production-grade. |
| Android Gradle Plugin 8.7.3 warns that it was tested only through `compileSdk 35`, while this project compiles with SDK 36. | **Open / P3 hygiene** | Upgrade AGP and its required Gradle wrapper together, then re-run mobile and Wear builds. Do not suppress the compatibility warning. |

## P4 — product, documentation, and release hygiene

| Finding | State | Required action |
| --- | --- | --- |
| Regulatory, partner, availability, and incident claims in user-facing material must match verified operations. | **Open** | Legal/compliance review and update factual claims; do not represent disabled rails as available. |
| The report and PDF deployment evidence observed previously applied to the then-production commit, not this audit branch. | **Open** | Regenerate and recheck the published artefacts only after the approved release SHA is deployed. |
| Snyk was previously not scanned because of quota. | **Open** | Restore scan capacity or record an approved compensating review before release. |

## Changes made in this working tree

- Settlement log verification and fail-closed reconciliation: `apps/web/src/lib/x402SettlementStore.ts`, `x402Settler.ts`, `settlementReconcile.ts`, its callers and status route.
- Strict ComplyAdvantage HMAC framing and generic webhook errors.
- Common money bounds in `apps/web/src/lib/schemas.ts`.
- Extension HTTPS sender gate, service-worker X402 sanitization, and complete logout cleanup.
- React Native, Android and iOS session-transition/CAS protections.
- Android/Wear paired-node gates for inbound remote actions.
- Tests covering the money bounds, HMAC framing, settlement mismatch, extension sender gate, and React Native account-switch race.

## Validation evidence

| Check | Result |
| --- | --- |
| Focused web settlement, HMAC, and money-bound suites | **PASS** — 4 files, 53 tests |
| Extension message-gate and X402 trust tests | **PASS** — 46 tests |
| Extension TypeScript check | **PASS** after generated WXT metadata preparation |
| React Native API and token-refresh Jest suites | **PASS** — 12 tests |
| Web full TypeScript check | **FAIL / environment baseline** — root dependency junction has incompatible Node `Buffer` generic types across existing code. No errors are reported for the audited/changed web paths after correcting the HMAC comparison type. Focused Vitest tests pass. |
| Android Guardian network tests | **PASS** — `:core:network:test` with JDK 17 and no configuration cache |
| Android mobile and Wear OS production-debug Kotlin compilation | **PASS** — `:app:mobile:compileProdDebugKotlin` and `:app:wear:compileProdDebugKotlin` |
| iOS tests / Xcode build | **BLOCKED** — macOS Swift/Xcode unavailable |

An isolated dependency install for the worktree was requested to make the platform checks reproducible, but automatic approval review rejected it because the available usage limit was exhausted. It was not run and was not bypassed.

## Deployment and migration checkpoint

Previously observed production deployment: `furlpay.com` was Ready as Vercel deployment `dpl_5behwnngnFKr6hLaJGXfBniptBNo`, built from `ea2ee50`; the then-newest preview was built from `ddfc37d`. That does **not** make the current audit branch live. A fresh Vercel CLI read-only invocation in this environment returned no deployment details, though `.vercel/project.json` links the local checkout to FurlPay team project `web`.

The smallest safe next action is to complete the read-only production migration preflight after a verified backup/PITR point. Do not deploy or apply migrations until that blocker and the release gate are resolved.
