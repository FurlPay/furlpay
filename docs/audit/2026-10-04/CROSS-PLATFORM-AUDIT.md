# FurlPay cross-platform audit and release checkpoint

**Date:** 2026-10-04  
**Audit branch:** `codex/cross-platform-audit`, based on `ddfc37d53a027e166e5b0f94804c5d4508c39ac3`  
**Status:** code fixes are pushed to the audit branch in [draft PR #94](https://github.com/Ashutosh0x/furlpay/pull/94). Additional validation fixes are included with this checkpoint. Production release remains blocked; no Supabase migration or production mutation was performed.

## Scope and confidence

The repository has 920 tracked client-platform files: 464 React Native, 180 Guardian Android/Wear, 134 iOS, 88 Chrome extension, and 54 Android app files. This pass statically inventoried those areas and deeply reviewed the money, session, transport-trust, certificate, wallet-consent, and wearable-message boundaries. It is **not** a statement that every one of those files was individually line-reviewed or built on every target.

Historical evidence reported production migrations `0001` through `0006`, while local migrations continue through `0029`. This is NOT a fresh production query. On October 4, `supabase whoami` identified `authera.founder@gmail.com`; `projects list` did not expose FurlPay production (`iyarllmcednkbekweucd`). The requested FurlPay account therefore needs restoring before the ledger, schema, backup/PITR point, and migration preflight can be checked. No migration history was repaired.

## P0 — release blockers

| Finding | State | Required next action |
| --- | --- | --- |
| Production database access is under the wrong account; the historical migration mismatch remains unresolved. | **Open / do not deploy** | Authenticate as `furlpayofficial@gmail.com`, verify production visibility and read-only access, then inspect history and schema. Verify backup/PITR before any separately reviewed migration execution. |
| The final release must pass CI and come from the configured release branch, `extension-redesign`. | **Open / do not deploy** | Review PR #94 and its parent PR #93, resolve all required checks, then use `npm run deploy:prod` from a clean, pushed release SHA. Do not override the release gate. |
| macOS CI exposed an iOS Foundation Models compile error; the native PR workflow had silently skipped compilation without a generated project. | **Fixed in code; CI confirmation required** | Preserve `[any Tool]` in the model tool factory; generate the Xcode project in native PR checks and fail if absent. Run iPhone/watch builds and tests; signed archives/device tests remain separate. |

No deployed, actively exploited P0 issue was confirmed in this pass. The blockers above prevent a production-ready assurance.

## P1 — security and money movement

| Finding | State | Change |
| --- | --- | --- |
| A successful transaction receipt with the wrong transfer logs could be promoted from `PENDING` to `CONFIRMED` during recovery. | **Fixed locally; tested** | Persisted the expected token/from/to/value/nonce for every settlement entry. The status endpoint and reconciler now verify receipt logs against those values and abandon/reorg a mismatch rather than confirm it. Legacy pending records without expectations also fail closed. |
| RPC outages were treated as missing receipts, which could abandon pending payments or report false reorgs. | **Fixed; tested** | Only an explicit receipt-not-found error means absent. Provider failures propagate; status returns 503 with the payment still pending. Confirmation requires `receiptVerified === true`. |
| A stale refresh or stale 401 could overwrite or clear a newer mobile session. iOS could dispatch an old operation under a new login after refreshing. | **Fixed in code; RN/Android tested, iOS CI required** | Token updates use generation/CAS protection. iOS binds requests and responses to a session generation; refresh can rotate its token without changing the generation. Added tests for switching accounts during refresh, stale success/401 responses, and signing in again with identical token bytes. |
| The ComplyAdvantage signature parser accepted a valid 64-character HMAC followed by non-hex suffixes. Webhook errors also exposed internal detail. | **Fixed locally; tested** | Require exactly 64 hexadecimal characters before constant-time comparison and return a generic invalid-webhook response. |
| Settlement/integration product rails are marked live only by configuration and provider credentials. | **Open / operational** | Keep the thirteen unsupported product flags disabled until legal, provider, operational, monitoring and rollback evidence is approved. Code must not be used to fabricate partner readiness. |

## P2 — cross-client trust boundaries

| Finding | State | Change |
| --- | --- | --- |
| Chrome extension accepted content-script messages without requiring a valid HTTPS sender URL. Logout retained cached wallet state and allowed origins. | **Fixed locally; tested** | Gate all page-originated message types by extension ID and a parseable HTTPS sender URL. Successful logout now clears cached account data, pending connects, grants, notification state, and badge state. X402 detections are sanitized again in the service worker. |
| Android mobile/Wear listeners trusted non-auth messages from arbitrary paired-device sources. | **Fixed; phone/Wear Kotlin compilation passed** | Gate inbound voice, refresh, alarm and acknowledgement messages/data by the currently paired node. Empty auth-revocation signals retain their intended revocation path. |
| Mobile device/app attestation defaults and production enforcement evidence were not established in this pass. | **Open** | Verify production configuration and server-side attestation enforcement with real release builds before enabling sensitive features. |

## P3 — validation and functional integrity

| Finding | State | Change |
| --- | --- | --- |
| Core money schemas had positive-number checks but no common upper bound, enabling impractical values and inconsistent limits. | **Fixed locally; tested** | Added a shared 1,000,000 maximum to transfer, checkout, intent and order money/quantity fields, including a 24-hour bound on settlement duration. |
| `accountApi.uploadAvatar` was an unused throwing stub despite an existing profile uploader. | **Fixed; profile tests passed** | Removed the unused wrapper and corrected documentation. `ProfileImageUploader` already crops and re-encodes images before PUT to the profile-avatar endpoint. |
| Device unlink, secure KYC session management, and session-revocation workflows need real server contracts. | **Open** | Implement and verify ownership, data minimization, and revocation semantics before presenting these features as supported. |
| P2P/recurring workflows and operational state need durable, transactional backing and restart-safe reconciliation where they still use process-local state. | **Open** | Design and migrate durable storage with idempotency and recovery testing before describing these workflows as production-grade. |
| Android Gradle Plugin 8.7.3 was tested through SDK 35 while this project compiles with SDK 36. | **Fixed; network tests and phone/Wear Kotlin compilation passed** | Paired AGP 8.11.1 with Gradle 8.13 and the officially published wrapper SHA-256. CI release assembly remains separate. |
| Ticket lifecycle E2E fixtures sometimes looked like card numbers. | **Fixed in tests; CI confirmation required** | Decimal timestamps could pass Luhn and correctly be redacted; use short base-36 identifiers for subjects and replies. Preserve production redaction and rate limits. |

## P4 — product, documentation, and release hygiene

| Finding | State | Required action |
| --- | --- | --- |
| Regulatory, partner, availability, and incident claims in user-facing material must match verified operations. | **Open** | Legal/compliance review and update factual claims; do not represent disabled rails as available. |
| The report and PDF deployment evidence observed previously applied to the then-production commit, not this audit branch. | **Open** | Regenerate and recheck the published artefacts only after the approved release SHA is deployed. |
| Snyk reports exhausted private-test quota on PR #94. | **Open / external service** | Restore scan capacity or record an approved compensating review before release. The passing npm dependency audit is separately identified and does not imply a Snyk scan occurred. |

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
| Web full TypeScript check | **PASS** with the web package's pinned TypeScript 5.5.3, and **PASS** in GitHub CI on `c5368eb`. The earlier Buffer errors came from invoking the root's TypeScript 5.9.3 through a dependency junction; they were not an accepted code failure. |
| Settlement recovery and profile editing/avatar suites after follow-up fixes | **PASS** — 5 files, 73 tests |
| Android Guardian network tests | **PASS** — `:core:network:test` with JDK 17 and no configuration cache |
| Android mobile and Wear OS production-debug Kotlin compilation | **PASS** — `:app:mobile:compileProdDebugKotlin` and `:app:wear:compileProdDebugKotlin` |
| iOS tests / Xcode build | **CI reached the compiler and failed on `c5368eb`** — Foundation Models tool type fixed in this follow-up; fresh build/test confirmation pending. Windows remains unable to run Xcode locally. |
| GitHub CI on `c5368eb` | **PASS** web lint/typecheck/unit/build, P0 PostgreSQL regressions, full React Native checks, and Go/Python/Rust SDK checks. **FAIL** E2E ticket fixture described above. |
| Security checks on `c5368eb` | **PASS** npm production dependency audit, secret scan, Semgrep, GitGuardian and license check. **Snyk ERROR** due to quota. |

The prior isolated-install request was rejected by automatic approval review. This follow-up used the existing pinned web compiler and GitHub's clean installations; it did not bypass that rejection. Native PR checks now generate their Xcode project instead of reporting success after skipping the build.

## Deployment and migration checkpoint

Fresh `vercel inspect furlpay.com` confirmed production is still Ready at deployment `dpl_5behwnngnFKr6hLaJGXfBniptBNo` (`web-inl5bnilb`), created October 3 at 12:28 IST. The earlier source attribution was `ea2ee50`; the CLI deployment metadata itself has no Git SHA, so that attribution is not newly proven. This is not the audit branch. Vercel has separately built a successful preview for `c5368eb`.

GitHub CLI verified active account `Ashutosh0x`, ADMIN access to private repository `Ashutosh0x/furlpay`, and successfully pushed `codex/cross-platform-audit`. PR #94 targets its parent `fix/settlement-hardening`; the configured production release branch is `extension-redesign`. Follow the PR's current checks for results on commits after `c5368eb`.

The smallest external next action is to restore Supabase CLI authentication to `furlpayofficial@gmail.com` and confirm project `iyarllmcednkbekweucd` is visible. Then repeat read-only connectivity, migration-history and schema checks. Do not infer database state from the local files or repair history. Product/provider approvals, attestation evidence, signed device testing and Snyk capacity remain open; this report does not claim that every product gap is closed.
