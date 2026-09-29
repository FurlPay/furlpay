# FurlPay — Security Boundaries

_2026-09-29. The two deliberately separated trust domains and the invariants that keep them apart._

```
                         DEVICE TRUST DOMAIN (self-custody)
  ┌─────────────────────────────────────────────────────────────┐
  │  Mnemonic (BIP-39)  ── expo-secure-store, requireAuthentication│
  │        │                (Android Keystore / iOS Keychain)      │
  │        ▼                                                        │
  │  Derive key on demand ── secp256k1 (EVM) / ed25519 (Solana)    │
  │        │                 keys fill(0) after use                 │
  │        ▼                                                        │
  │  Local signing ── EIP-3009 / EIP-712 / EIP-191, client-pinned  │
  │        │           USDC contracts, no blind-signing            │
  └────────┼──────────────────────────────────────────────────────┘
           │  ONLY signatures + public addresses cross ▼
  ┌────────┼──────────────────────────────────────────────────────┐
  │        ▼          SERVER TRUST DOMAIN (regulated)              │
  │  Auth (passkey/MFA/step-up) · KYC · Cards · Control plane      │
  │  Double-entry ledger (Postgres, RLS) · Idempotency · Webhooks  │
  │  Redis (cache/locks/rate-limits — NON-authoritative)          │
  └───────────────────────────────────────────────────────────────┘
```

## Hard invariant #1 — private keys never cross into the server domain

**Status: HOLDS (verified).**
- Keys are generated on-device, stored biometric-gated, and only signatures leave (`native-app/lib/wallet.ts`, `lib/solana/wallet.ts`).
- No server route accepts a key/seed: `grep '(body|req)\.(privateKey|mnemonic|seed…)'` over `apps/web/src` → **0 matches**.
- The device **pins USDC contracts** per network — a spoofed backend cannot make the device sign against an attacker's contract (`USDC_BY_NETWORK`, `UntrustedQuoteError`).
- **Consequence:** a full server/database compromise does not expose or move self-custody funds.

## Hard invariant #2 — money moves only through a balanced ledger

**Status: HOLDS (verified).**
- `ledger_post` refuses unbalanced postings (Σdebits = Σcredits) and rolls back; postings are immutable; balances are derived, not stored mutably.
- Integer minor units (`bigint`); on-chain amounts `NUMERIC(38,18)`; **no float**.

## Hard invariant #3 — real settlement cannot be fabricated

**Status: HOLDS (verified).**
- No rail adapter is registered in production; `execute` returns `503 rail_not_connected` and marks `INDETERMINATE`. A test asserts registering a test-only adapter in production throws.

## Hard invariant #4 — replayed/duplicated inbound events cannot double-move money

**Status: HOLDS (verified, with a hardening candidate).**
- All 9 webhooks verify signatures + fail closed; event-id dedupe via `webhookGuard` + KV; money-moving routes use `withIdempotency`.
- **Candidate (P2):** dedupe is Redis/KV-backed; a durable Postgres `webhook_events(provider, provider_event_id UNIQUE, …)` audit table would make the dedupe survive cache loss and give a permanent audit trail. See MIGRATION_PLAN.md.

## What legitimately lives server-side (and must)
Identity, KYC documents/state, card references (processor tokens — no PAN/CVV), payment authorization decisions, the ledger, settlement/reconciliation state, compliance/risk controls, audit events. These require durable server state by nature and are correctly outside the device domain.

## Redis boundary
Redis (Upstash) is cache/locks/rate-limits/idempotency acceleration only. Postgres is authoritative for all money. Every Redis-dependent money path must fail closed when Redis is unavailable (`withIdempotency`, webhook guards already do).
