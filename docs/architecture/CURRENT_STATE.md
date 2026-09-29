# FurlPay — Current Architecture (evidence-based)

_Audited 2026-09-29 by direct source inspection. Every claim cites a file. This documents what FurlPay **actually has**, not the reference report's inferences._

## TL;DR

FurlPay **already implements the two-domain hybrid architecture** the target spec describes:
1. **Self-custody crypto domain** — keys generated and held on-device, never transmitted.
2. **Regulated/server domain** — identity, KYC, cards, a double-entry ledger, fail-closed payments.

The target spec is therefore ~90% realized in code. The real work is verification/ops (prod DB state, CI billing) and a few hardening deltas — not a rewrite.

## Applications

| App | Path | Stack | State |
|---|---|---|---|
| Web + API | `apps/web` | Next.js 15 App Router, 343 routes, Node 24 | LIVE (furlpay.com) |
| Mobile (canonical) | `native-app` | Expo React Native, v2.3.0 | source complete |
| Android TWA | `apps/android` | Bubblewrap | **deprecated in-repo** |
| iOS Guardian | `ios/FurlPayGuardian` | Swift/XcodeGen (app+watch+widgets+activities) | build needs macOS |
| Wear OS | `guardian` | Kotlin | build needs JDK 17 |
| Chrome extension | `apps/extension` | WXT MV3 | builds + packages |
| Desktop | `apps/desktop` | Electron v0.1.0 | early, not a prod target |

## Backend

- **Framework:** Next.js App Router route handlers (`apps/web/src/app/api/**/route.ts`).
- **Auth:** passkeys/WebAuthn, MFA/TOTP, session epochs, biometric step-up (`lib/authz`, `lib/biometrics`, `packages/security`). `requireUser`/`requireRole`/`requireTenant`/`requireOpsAdmin`.
- **DB:** Supabase Postgres, 21 migrations (`supabase/migrations/0001…0021`), RLS on money tables (0016), schema assertions (0017).
- **Cache/locks:** Upstash Redis, used widely (`lib/idempotency`, rate limits, locks, alerts) — **not** authoritative for money.
- **Rate limiting:** middleware baseline 150 mutating req/min/IP + per-route `rateLimitOr429`.
- **AWS:** `infra/aws` Terraform exists but **zero AWS SDK in runtime**; RUNBOOK says "nothing applied." Not the live path. See MIGRATION_PLAN.md.

## Wallet architecture (self-custody) — VERIFIED

Traced `native-app/lib/wallet.ts` + `lib/solana/wallet.ts`:

- **Key generation:** on-device from device entropy (`Crypto.getRandomBytes` → BIP-39). EVM (secp256k1, `m/44'/60'/…`) + Solana (ed25519 SLIP-0010, `m/44'/501'/…`) from one mnemonic.
- **Storage:** mnemonic in `expo-secure-store` with `requireAuthentication` (Android Keystore / iOS Keychain, biometric-gated). Only **public addresses** cached un-gated.
- **Signing:** on-device; keys derived on demand, used, then `fill(0)` in `finally`.
- **Transmission:** **NONE.** Only signed EIP-3009 / EIP-712 / EIP-191 authorizations leave the device. Client **pins USDC contracts** so a compromised backend cannot induce a malicious signature. No blind-signing (structured payloads only).
- **Linking:** challenge → device signs → server recovers address (`/wallet/link/verify`). Server never trusts an address without proof.

> **Critical question — "Can FurlPay servers reconstruct or use a user's private key?" → NO.** No server route accepts `privateKey`/`mnemonic`/`seed` (grep of `apps/web/src` = 0 matches). Server compromise does not compromise self-custody wallets. This satisfies success criteria #1 and #6.

## Payment architecture (server domain) — VERIFIED

- **Control plane** (`@furlpay/control-plane` + `apps/web/src/lib/controlPlane`): `authorize` → `execute` two-phase, fail-closed. Re-validates authority chain, revocation, mandate liveness, and destination attestation at execute; binds execution to a payload hash; idempotency derived from the authorization (double-spend safe).
- **Rail:** **zero adapters registered in production** → `execute` returns `503 rail_not_connected` and records `INDETERMINATE` rather than fabricating settlement. Real money movement is intentionally gated. (`lib/controlPlane/railAdapter.ts`.)
- **Ledger** (`packages/ledger` + `lib/ledger.ts` + migration 0009): **double-entry** — `ledger_accounts` (asset/liability/equity/revenue/expense), `ledger_transactions`, immutable `ledger_postings` (debit/credit, `bigint` integer minor units, `amount > 0`). `ledger_post` **raises + rolls back on unbalanced** (Σdebits ≠ Σcredits). No float; on-chain amounts use `NUMERIC(38,18)` exact decimal.
- **Idempotency:** `withIdempotency` on money-moving routes (`lib/idempotency.ts`).
- **Webhooks:** all 9 verify a signature/secret and fail closed; event-id dedupe via `webhookGuard` + KV; replay + ordering handling (e.g. `webhooks/deposit-detect`).
- **KYC/compliance:** `packages/compliance`, Persona/Sumsub/ComplyAdvantage webhooks, tiered limits (`lib/kycTiers`).

## Observability & CI

- Structured logging (`lib/log`), ops/health endpoints, ops dashboards.
- 14 GitHub Actions workflows; **currently account-billing-blocked** (all jobs 0 steps, fail 3–6s). Deploy is manual via `deploy:prod` gate → Vercel.

## Test posture (measured 2026-09-29)
- `apps/web`: **5,596 passed / 0 failed** (300 files).
- `@furlpay/control-plane`: **307 passed**.
- Root package suites (gateway/security/ledger/compliance): green.
- `tsc --noEmit` clean; `next build` exit 0.
