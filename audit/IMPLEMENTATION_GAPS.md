# FurlPay Implementation Gaps

_Audit date: 2026-09-29. Evidence-based. "UNKNOWN" means not verifiable in this environment, not "missing."_

## Classification key
IMPLEMENTED · PARTIAL · BROKEN · DISCONNECTED · PLACEHOLDER · MISSING · STALE · INTENTIONAL (deliberately not done) · UNKNOWN

## Backend (apps/web)

| Capability | State | Evidence |
|---|---|---|
| Control-plane payments (authorize → execute) | **IMPLEMENTED, fail-closed** | `api/v1/payments/*`; strict Zod, idempotency, payload-hash binding, re-validation of authority/revocation/attestation at execute; 307 control-plane + 88 route tests green |
| **Live money movement (rail settlement)** | **INTENTIONAL not-connected** | `railAdapter.ts`: zero adapters registered in production; execute returns `503 rail_not_connected` and records `INDETERMINATE` rather than fabricating a settlement ref. FurlPay cannot move real value today by design. |
| Mandates / recipients / evidence | **IMPLEMENTED (uncommitted)** | `api/v1/mandates/*`, `recipients/*`, `evidence/[id]`; backed by migrations 0020/0021; attestation reads real rows |
| Auth (passkeys, MFA, step-up, session epochs) | **IMPLEMENTED** | recent commits `f1024aa`, `cf23350`, `4a3546f`; biometric payment binding |
| Card lifecycle / spend | **IMPLEMENTED** | `api/cards/*` (17 routes); reveal-gate hardened (`395c5a0`, `dbfc6e0`) |
| Earn (Morpho) | **PARTIAL / gated** | non-custodial calldata in live mode; MOCK in dev; **503 in prod when not live**. Amount upper-bound was missing → **fixed this audit** |
| P2P, swaps, investing, travel, onramp | **IMPLEMENTED (var's maturity)** | 98 money routes total; several use manual validation vs Zod (see API_ROUTE_INVENTORY.md) |
| Webhooks (stripe, persona, sumsub, card-auth, …) | **IMPLEMENTED** | all 9 verify a signature/secret and fail closed |

## AWS infrastructure (infra/aws)

- **State: UNKNOWN / likely aspirational.** Full Terraform module set (compute/data/edge/iam/monitoring/network/scheduler/security), dev/staging/prod envs, remote S3 backend `furlpay-tfstate` (eu-west-1), added 2026-09-24/25. `.terraform/` present (init'd).
- **AWS credentials in this environment are INVALID** (`InvalidClientTokenId`) → cannot confirm the tfstate bucket or any resource exists.
- The **live app runs on Vercel + Supabase**, not AWS. AWS presence in the repo ≠ AWS in production. Requires `docs/aws/RUNBOOK.md` review + valid creds to classify.

## Database (supabase/migrations)

- **21 migrations** `0001`→`0021`. Latest: RLS on money tables (0016), schema assertions (0017), revenue events (0018), content leads (0019), control-plane (0020), recipient attestation (0021).
- **Applied-state in prod/staging: UNKNOWN** (no Supabase creds this pass). Prior memory: earlier migrations applied to staging; some prod migrations were pending — must re-verify with `verify-hosted-supabase.mjs` (untracked script exists).

## Android

- **TWO artifacts share `com.furlpay.app`:** `native-app/` (Expo RN, **v2.3.0**, canonical) and `apps/android/` (Bubblewrap TWA, v1.0.0, wrapper). The TWA header comments acknowledge the shared applicationId + upload key.
- **Gap/risk:** two production Android artifacts on one package id is a release-management hazard. Confirm only one is published; the TWA appears to be a legacy/secondary wrapper.
- Deep feature-vs-backend trace, release signing, ProGuard, deep links: **UNKNOWN this pass** (no Android SDK build run).

## iOS (ios/FurlPayGuardian)

- XcodeGen (`project.yml`), targets: app + Watch + Widgets + Live Activities. `MARKETING_VERSION 1.0.0`. Bundle id via env (`FURLPAY_BUNDLE_ID_BASE`).
- **Cannot build on this Windows host** — macOS/Xcode required. Networking/auth/persistence trace: **UNKNOWN this pass**.

## Wear OS (guardian/)

- Kotlin phone + watch Gradle project (`app`, `core`, `wear`). `build/` present (built before).
- Watch↔phone Data Layer, sync, backend reach: **UNKNOWN this pass** (no build run).

## Chrome Extension (apps/extension)

- WXT, MV3. Permissions: storage, notifications, sidePanel, alarms, activeTab (least-privilege — no broad host permissions in the base). Branch name `extension-redesign` = large in-flight work.
- Typecheck/lint/package build: **not run this pass**. Whether the 320-commit branch is a clean extension release or an accumulation of unrelated work: the commit categories (109 feat / 62 fix across markets, travel, price, discord…) indicate **accumulation, not a single extension release**.

## Desktop (apps/desktop)

- Electron `@furlpay/desktop` v0.1.0. **STALE/early** — v0.1.0, excluded from the default `build` filter (`--filter=!@furlpay/desktop`). Not a production target.

## CI/CD

- 14 workflows. **Scheduled security workflows fail in 3–6s on `main`** (Container Scan, Deep Security Scan, Security Audit, Security Auto-Fix). Exact logs purged; most consistent with a runner/billing or fail-fast setup issue. Uncommitted work SHA-pins third-party actions (good hardening) but does not obviously address the fast-fail.
- Real ship path is **manual** `npm run deploy:prod` (gate: clean tree + pushed HEAD + green CI for SHA) → Vercel. No automated backend deploy.
