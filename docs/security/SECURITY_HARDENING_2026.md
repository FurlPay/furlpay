# Security hardening — 2026

**No independent security audit has been performed.** This document is an internal review plus the fixes made from it, written so an external firm can start from evidence rather than from claims. Prior internal reviews: `docs/MOBILE_SECURITY_AUDIT.md` (Sep 6 — note its "there is no iOS app" section is now stale: `native-app/ios` exists but has never been built), `docs/TRANSACTION_SECURITY.md`, `docs/architecture/SECURITY_BOUNDARIES.md`, `docs/architecture/WEBHOOK_SECURITY.md`, `docs/audit/2026-09-24-client-audit.md`.

## 1. Fixed in this pass

All with regression tests; details and evidence in `docs/audit/PRODUCTION_GAP_AUDIT.md`.

| ID | Class | Issue | Test |
|---|---|---|---|
| PGA-001/002/003/010 | Broken object-level authorisation (reads) | Routes computed from the seeded demo account (`db`) instead of the caller: copilot, analytics graph, receipt matching, compliance routing, jurisdiction resolver | `apps/web/src/lib/__tests__/productionFabricationGates.spec.ts` |
| PGA-003 | Cross-tenant data exposure | One global receipt-match map shared by all users | same |
| PGA-005 | Unauthenticated state mutation | Anonymous `POST /api/travel/referral/track` minted referral earnings | same |
| PGA-007 | Unsafe default in a money path | Payroll fell back to placeholder recipient addresses | same (mutation-checked) |
| PGA-008 | Missing authentication + gate bypass | Travel virtual card | same |
| PGA-011 | Race condition (TOCTOU across `await`) | Unfunded P2P order releasable during rollback | `p2pEscrowInvariants.spec.ts` (mutation-checked) |
| PGA-012 | Business-logic abuse | P2P seller-cancel while buyer paying | same |
| PGA-013 | Sensitive-data handling | Mobile rendered device-constructed PAN/CVV | — (UI) |
| PGA-014 | Platform configuration | iOS passkey association, App Attest entitlement, APNs sandbox in store builds | `apnsMode.test.ts`, `aasa.spec.ts` |
| PGA-003/006/007 | Input validation (AGENTS rule 1) | `receipts/match`, `bills`, `travel/referral/track` bodies unvalidated | same |

Route manifest (`apps/web/security/route-manifest.json`): 5 routes moved from `PUBLIC_INTENTIONAL` to `AUTHENTICATED_USER`.

## 2. Review by area

Status: **OK** = reviewed, controls present, no defect found in this pass · **GAP** = known defect or missing control · **N/R** = not reviewed in this pass.

| Area | Status | Evidence / note |
|---|---|---|
| Authentication, sessions | OK | `lib/session.ts`, `lib/sessionEpoch.ts` (epoch revocation), `lib/authz.ts` (`optionalUser` rejects bad credentials rather than downgrading) |
| Passkeys (web) | OK | `api/auth/passkey/*` on `@simplewebauthn/server`; the unverified demo route `api/auth/webauthn` 404s under `NODE_ENV=production` |
| Passkeys (iOS) | GAP → partly fixed | association added (PGA-014); AASA serves only once `APPLE_TEAM_ID` is set |
| Wallet creation / recovery phrase | OK | `native-app/lib/wallet.ts`: device entropy, SecureStore with biometric gate, `DEVICE_ONLY` options, never transmitted |
| Private-key handling | OK | Key read only inside a signing call; `lib/signing/*` |
| MPC / Turnkey | OK (design) | App holds no MPC credential; server proxies (`lib/signing/remoteMpcBackend.ts`) |
| Agent authorisation, spend policy | OK | Server authoritative (`apps/web/src/lib/agentPolicy.ts`); client mirror explicitly never authorises (`native-app/lib/agents/policy.ts`) |
| Transaction simulation | OK | Two layers, worst verdict wins, neither may lower the other (`native-app/lib/txscan/index.ts`) |
| WalletConnect | OK | Closed method list, hostile-input decoding, namespace policy (`lib/walletconnect/policy.ts`, `requests.ts`) |
| Deep links / QR | OK | `lib/deepLinks.ts` + tests; `lib/qr.ts`, `lib/upi.ts`, `lib/sgqr.ts` |
| Screenshots | OK | `FLAG_SECURE` scoped per screen (`lib/secureScreen.ts`) |
| Logs / analytics / crash reports | OK | Web `lib/redact.ts` (Luhn PANs, seed-phrase lines, tokens); mobile `lib/observability/scrub.ts`; release R8 strips `Log.v/d/i` |
| Certificate pinning | OK | `plugins/withIosCertificatePinning.js`, `withNetworkSecurityConfig.js` (+ tests). Pins need rotation before expiry — see the plugin headers |
| **Device attestation (server)** | **GAP (P1)** | `apps/web/src/lib/integrity/providers.ts`: App Attest and Play Integrity **cryptographic verification is not implemented**; both report `not_configured` (never `passed`) and act as a risk weight. Needs Apple/Google credentials and real device tokens to implement and test |
| Webhooks | OK | HMAC over raw body, constant-time, timestamp window, fail closed without secret (AGENTS rule 3); durable dedupe in the uncommitted `withDurableWebhook` change set |
| Replay / idempotency | OK | `lib/idempotency.ts` on money routes (`moneyRouteIdempotency.spec.ts`) |
| Rate limits | OK | Middleware baseline + per-route limits; `check-route-security.mjs` clean |
| CORS / CSRF | OK | CSRF backstop (see `docs/architecture/SECURITY_BOUNDARIES.md`) |
| SSRF | N/R | Not re-reviewed in this pass |
| Injection / XSS | OK | No `eval`/`new Function`; JSON-LD escaped (`components/JsonLd.tsx`); DOM-sink inventory test |
| IDOR / BOLA | GAP → fixed | Class A findings above; remaining latent defaults listed as PGA-R05 |
| Secrets | OK | `git grep` over tracked files for private keys, `sk_live_`, AWS keys, Slack/GitHub tokens, Supabase JWTs: only test fixtures (`rk_live_…notarealsecret`). No `.env*` file is tracked (only `.env.example`) |
| Dependency vulnerabilities | Tracked | `.github/audit-allowlist.json` with reasons; Dependabot; `security-audit.yml` |
| CI/CD | OK | Deploy gate requires CI success for the exact SHA (`apps/web/scripts/check-deploy-gate.mjs`) |

## 3. Fail-closed verification

Every capability that cannot be real returns 503 in production with the flag's reason (`lib/capabilityGate.ts`, `lib/cardIssuer.ts`, `lib/brokerage`), and no flag can be forced on while its `unimplemented` reason exists — tested per flag (`flags.spec.ts`, `productionFabricationGates.spec.ts`).

## 4. For the external auditor

1. Start from `docs/audit/PRODUCTION_GAP_AUDIT.md` §1 (root-cause classes) — class A (`db` imports) is the pattern most worth hunting for further.
2. Attestation (§2 GAP) is the largest unimplemented control.
3. P2P is in-memory (PGA-R01); do not assess it as a production escrow.
4. Test harnesses: `apps/web` `npx vitest run`; `native-app` `npx jest`. Supabase-backed specs run against an in-process harness (`http://pglite.local`), never a live project.
