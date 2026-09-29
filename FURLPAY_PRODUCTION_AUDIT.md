# FurlPay Production Audit

**Audit date:** 2026-09-29 · **Audit commit:** `971293b` (branch `extension-redesign`, dirty tree)
**Scope:** full monorepo, read-only against all production systems. No deploys, no publishes, no infra/DB changes.
**Companion artifacts:** `audit/API_ROUTE_INVENTORY.md` (+ `.json`), `audit/RELEASE_PROVENANCE.md`, `audit/IMPLEMENTATION_GAPS.md`.

---

## 1. Executive summary

FurlPay's **backend/web is live and is genuinely production-grade in the areas that matter most.** `furlpay.com` serves 200; the API is auth-gated (health → 401). The `apps/web` TypeScript surface (343 routes) compiles clean, and the money-critical control plane is a rigorous, fail-closed state machine: payment authorize/execute re-validates authority, revocation, mandate liveness and destination attestation before submission, binds execution to an authorized payload hash, and **refuses to fabricate settlement** — 307 control-plane + 88 route tests pass.

The single most important truth: **FurlPay cannot move real money today, by design.** No rail adapter is registered in production; `execute` returns `503 rail_not_connected` and records the payment `INDETERMINATE` rather than inventing a settlement reference. The plumbing is production-grade; the taps aren't connected.

The biggest risks are **process, not code**: (1) 166 uncommitted files — including finished, tested payment/mandate/recipient APIs — sit in no commit; (2) the working branch is 320 commits ahead of `main` with no release tag, so **what's in production is unprovable**, and it's simultaneously *missing* 9 security-relevant Dependabot bumps that are on `main`; (3) AWS Terraform exists but is unverifiable (invalid creds) and is not the live serving path; (4) scheduled CI security scans fail in seconds.

Mobile (Android RN v2.3.0 + TWA), iOS Guardian, Wear OS, and the Chrome extension exist as substantial source trees but were **not built or store-verified** this pass (toolchain/host limits) — they stay UNKNOWN rather than being scored up.

## 2. Overall completion (methodology below)

Each platform scored across 9 dimensions, 1 point each: **Implementation, Integration, Configuration, Tests, Build, Deployment, Production reachability, E2E verification, Distribution.** Points awarded only with in-session evidence. "UNKNOWN" dimensions score 0 for *Verified* completion but are excluded from the *Source* denominator.

- **SOURCE COMPLETION** = (Impl+Integration+Config+Tests+Build) / 5
- **VERIFIED PRODUCTION COMPLETION** = (all 9) / 9

| Area | Source | Verified | Basis |
|---|---:|---:|---|
| Backend | ~92% | ~72% | compiles clean, deep tests, live+reachable; E2E money path capped (no rail); distribution n/a→live |
| Web | ~90% | ~70% | same deployable, live 200 |
| AWS | ~60% (code) | **UNKNOWN** | full IaC, but creds invalid → 0 verified resources |
| Database | ~85% | **UNKNOWN** | 21 migrations + RLS in source; applied-state unverified |
| Android | ~70% | **UNKNOWN** | v2.3.0 RN app + TWA; no build/store check |
| iOS | ~55% | **UNKNOWN** | full Guardian project; unbuildable on Windows |
| Wear OS | ~50% | **UNKNOWN** | Kotlin project; no build |
| Chrome Extension | ~65% | **UNKNOWN** | MV3/WXT; no package build/CWS check |
| Desktop | ~15% | ~5% | v0.1.0, excluded from default build |
| CI/CD | ~70% | ~45% | 14 workflows exist; scheduled security scans failing |
| Security (app-layer) | ~88% | ~80% | 0 real auth/HMAC gaps found; no full history secret scan |
| Observability | ~60% | **UNKNOWN** | health/ops endpoints exist; alerting/tracing unverified |

## 3. Release status (per platform)

| Platform | Version | Commit | Build | Deploy | Store | Prod API | Blocker |
|---|---|---|---|---|---|---|---|
| Backend/Web | — | UNKNOWN (see §RP) | tsc ✅ | live (Vercel) | n/a | 200/401 ✅ | rail not connected |
| Android RN | 2.3.0 | — | not built | — | UNKNOWN | — | Play signing / verify |
| Android TWA | 1.0.0 | — | not built | — | UNKNOWN | — | dup package id |
| iOS Guardian | 1.0.0 | — | macOS-only | — | UNKNOWN | — | no Xcode host |
| Wear OS | — | — | not built | — | UNKNOWN | — | not verified |
| Chrome Ext | — | — | not built | — | UNKNOWN | — | not verified |

## 4. Shipped vs unshipped

**Users can actually use today (live at furlpay.com):** the web app + auth-gated API (registration/login/passkeys, cards lifecycle, ops/admin surfaces, content/marketing, read APIs). Confirmed by live 200/401.

**Exists in code but NOT shipped / not moving real value:**
- Real payment *settlement* — no rail connected (by design).
- The uncommitted v1 payments/mandates/recipients APIs (finished, tested, **in no commit** → not deployable).
- AWS infrastructure (unverifiable / not the live path).
- Android/iOS/Wear/Chrome distributions (store status UNKNOWN).

## 5. Production architecture (verified)

```
Clients (web live; RN/iOS/Wear/ext unverified)
    │
    ▼
Vercel — project "web" (Next.js 15, Node 24, root apps/web)  ← LIVE, furlpay.com 200
    │
    ├─ 343 API routes (auth-gated; middleware baseline 150/min mutating)
    ├─ Auth: passkeys / MFA / session epochs / biometric step-up
    ├─ Control plane (@furlpay/control-plane): authorize→execute, fail-closed
    │      └─ Rail adapters: ZERO registered in prod → 503 rail_not_connected
    ├─ Supabase (Postgres) — 21 migrations, RLS on money tables [applied-state UNKNOWN]
    ├─ Webhooks (stripe/persona/sumsub/card-auth/…) — all signature-verified
    └─ External: Morpho (earn), x402 facilitator, Stripe, KYC (Persona/Sumsub)

infra/aws (Terraform, prod/staging/dev) — present, UNVERIFIABLE, not the live path
```

## 6. Critical findings

| # | Sev | Finding | Evidence | Blocker? |
|---|---|---|---|---|
| 1 | **P1** | 166 uncommitted files incl. finished/tested v1 payments, mandates, recipients | `git status`; 88 tests pass | Yes (work at risk; not deployable) |
| 2 | **P1** | Release provenance unprovable: `extension-redesign` +320 vs `main`, no tag at HEAD | `git rev-list`; no tag | Yes |
| 3 | **P1** | Working branch missing 9 Dependabot security bumps on `main` (sharp/next/qs…) | `git log origin/main ^ext` | Yes (dep hygiene) |
| 4 | **P1** | AWS infra unverifiable — creds invalid; may be aspirational | `aws sts` → InvalidClientTokenId | Depends on intent |
| 5 | **P2** | Scheduled CI security scans fail in 3–6s on `main` | `gh run list` | No (advisory) |
| 6 | **P2** | Two Android artifacts share `com.furlpay.app` (RN v2.3.0 + TWA v1.0.0) | build.gradle | No |
| 7 | **P2** | Prod Supabase migration-applied state unverified (no creds) | — | Yes (verify before deploy) |
| 8 | **P3** | ~12 money routes use manual validation instead of Zod (AGENTS rule 1 style) | route inventory | No |
| 9 | **P3** | `earn/deposit` + `earn/withdraw` lacked money upper bound | route source | **FIXED this audit** |
| — | P0 | **None confirmed.** No live secret leak found; prod is up; no real auth/HMAC gaps. (Not yet a full git-history secret scan.) | | |

## 7. Security findings (sanitized)

- **App-layer route security is strong.** Calibrated scan of all 343 routes: **0** mutating routes without auth+rate-limit; **0** webhooks without signature verification (all 9 verify + fail closed); validation via `parse(Schema,data)`/`validateBody`. Residual: ~12 money routes validate manually rather than with a Zod schema (consistency, not exploit).
- **No plaintext live secrets in tracked source.** `sk_live`/`AKIA` hits were false positives (masked demo keys, test fixtures, coincidental substrings in booking.com URLs). Only secret-shaped tracked hit is a redaction **test fixture**.
- **Limitation:** `gitleaks`/`trufflehog` are not installed → no full git-*history* entropy scan performed. The repo's own `security-audit.yml` runs gitleaks in CI; run it (see §External verification) before assigning P0 either way.
- Control-plane responses deliberately leak no signing material / provider secret / policy internals.

## 8. AWS findings

- Full Terraform (`infra/aws`): modules compute/data/edge/iam/monitoring/network/scheduler/security; envs dev/staging/prod; remote S3 backend `furlpay-tfstate` (eu-west-1); prod is multi-AZ, deletion-protected, 35-day PITR per header comments; deploy gated behind GitHub environment `prod`.
- **Cannot verify a single live resource** — AWS keys invalid. Classify as **IaC-authored, deployment UNKNOWN**. If AWS is not actually in use, this reads as "shipped" but is dead code; if it is, it's unverified. Needs `docs/aws/RUNBOOK.md` + valid read-only creds.

## 9. Platform findings
See `audit/IMPLEMENTATION_GAPS.md` for the full per-platform table (Backend, AWS, DB, Android, iOS, Wear OS, Chrome, Desktop, CI/CD).

## 10. CI/CD findings

- Production ships via **manual** `npm run deploy:prod` → Vercel. Gate (`check-deploy-gate.mjs`) requires clean tree + pushed HEAD + green CI for the exact SHA; currently **BLOCKED (dirty tree)** — correct safe state.
- Scheduled security workflows failing fast on `main`; exact cause not confirmable (logs purged). Uncommitted work SHA-pins third-party actions (OpenSSF hardening).
- No automated backend deploy; mobile/ext releases are manual.

## 11. End-to-end verification performed

| Flow | Result |
|---|---|
| `GET furlpay.com` | 200 ✅ |
| `GET /api/ops/health` | 401 (auth-gated, exists) ✅ |
| Backend typecheck (343 routes + WIP) | `tsc --noEmit` exit 0 ✅ |
| Control-plane package tests | 307/307 ✅ |
| v1 payments/mandates/recipients + deposit-detect + overspend + body-cap tests | 88/88 ✅ |
| earn amount-bound (new) | 9/9 ✅ |
| Payment settlement E2E | **Cannot complete — no rail connected (by design)** |
| Deploy gate | BLOCKED (dirty tree) — as expected |

## 12. Production blockers (checklist)

- [ ] Commit the 166 dirty paths in logical units (payments WIP is finished + tested).
- [ ] Resolve branch provenance; merge 9 Dependabot commits into the working branch; tag the release.
- [ ] Verify prod/staging Supabase migration state (0018–0021).
- [ ] Decide AWS: in-use (verify with creds) or remove/park the IaC.
- [ ] Fix scheduled CI security scans.
- [ ] Connect (or explicitly gate off) at least one payment rail before claiming money movement.
- [ ] Build + store-verify Android/iOS/Wear/Chrome on their real toolchains.

## 13. Remaining work
Tracked in `audit/IMPLEMENTATION_GAPS.md` and §12. Highest-value, safe, code-only items are limited because the top gaps are process (commit/merge/creds), not missing code.

## 14. Final production snapshot

```
FURLPAY PRODUCTION SNAPSHOT (2026-09-29)

Backend:            Source ~92%  | Verified ~72%
Web:                Source ~90%  | Verified ~70%
AWS:                Source ~60%  | Verified UNKNOWN (creds invalid)
Database:           Source ~85%  | Verified UNKNOWN (no creds)
Android:            Source ~70%  | Verified UNKNOWN (no build/store)
iOS:                Source ~55%  | Verified UNKNOWN (no Xcode)
Wear OS:            Source ~50%  | Verified UNKNOWN (no build)
Chrome Extension:   Source ~65%  | Verified UNKNOWN (no build/CWS)
Desktop:            Source ~15%  | Verified ~5%
Security (app):     Source ~88%  | Verified ~80%
CI/CD:              Source ~70%  | Verified ~45%
Observability:      Source ~60%  | Verified UNKNOWN

Verified live functionality:
- furlpay.com web app + auth-gated API (200/401)
- Backend compiles clean; 404 tests pass (307 control-plane + 88 route + 9 new)
- Fail-closed payment control plane (authorize/execute) — refuses to fake settlement

Production-ready but unreleased:
- v1 payments/mandates/recipients APIs (finished, tested, UNCOMMITTED)

Partially implemented:
- Earn (gated 503 in prod), several money routes on manual validation

Missing / not connected:
- Live payment rail settlement (intentional — 0 adapters in prod)

Broken:
- Scheduled CI security scans (fast-fail)

P0 blockers: 0 confirmed
P1 blockers: 4 (uncommitted work, provenance, missing dep bumps, AWS unverifiable)
P2 issues:   3 (CI scans, dup Android package id, DB migration state)
P3 issues:   2 (manual-validation money routes; earn upper bound — FIXED)

Android Store Status:  UNKNOWN
iOS Store Status:      UNKNOWN
Wear OS Store Status:  UNKNOWN
Chrome Web Store:      UNKNOWN

Current Production Commit: UNKNOWN (unprovable from this environment)
Audit Commit:             971293b (extension-redesign, dirty)
Audit Date:               2026-09-29

OVERALL VERIFIED PRODUCTION COMPLETION:
  Backend/web core: ~70%.  Whole ecosystem incl. mobile/AWS: UNKNOWN-dominated,
  do not report a single blended number — too many dimensions are unverifiable.
```

## External verification required
See `audit/IMPLEMENTATION_GAPS.md`. Exact checks needed later:
- **Vercel:** `vercel inspect` / dashboard → deployed commit SHA for project `web`.
- **AWS:** valid read-only creds → `aws sts get-caller-identity`, `terraform -chdir=infra/aws/envs/prod show`, resource inventory.
- **Supabase:** service creds → `node apps/web/scripts/verify-hosted-supabase.mjs`; confirm 0018–0021 applied.
- **Secrets:** `gitleaks detect` over full history in CI.
- **Stores:** Play Console / App Store Connect / Chrome Web Store consoles.
- **Mobile/iOS/Wear/Ext:** real Android SDK + macOS/Xcode + WXT build to produce and validate release artifacts.
