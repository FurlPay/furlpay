# 09 — Remaining risks and decisions that need a person

Nothing on `security/certik-remediation-oct11` is deployed. Each item below is
open, says who can close it, and what closing it takes.

## Needs an owner's action (no code change)

| Item | Finding | Action | Who |
|---|---|---|---|
| Raw Solana fee-payer key in the production environment | F-24 | Remove `SOLANA_PAYER_SECRET` (and `CNFT_MERKLE_TREE`) from the Vercel **production** scope: no production-reachable code uses them. Keep the key's balance at the minimum wherever it does live. | Owner (Vercel) |
| XSGD will disappear from production 402s once this branch ships | F-32 | Set `X402_XSGD_USD_RATE` (0.5–1.0) if XSGD should stay offered, and keep it current. | Owner |
| Router owner, escrow oracle, compliance owners | F-1, F-3, F-6 | Deploy every EVM contract with a multisig owner, and the escrow `checkInOracle` as a multisig. No FurlPay EVM contract is deployed today. | Owner, at deployment |
| Card policy limits and MCC list | F-20, F-40 | Compliance to approve the blocked MCC set and per-account limits before the card program goes live. | Compliance |

## Needs external infrastructure

| Item | Finding | Blocker |
|---|---|---|
| Server-side device attestation | F-17, F-33 | Play Integrity needs a Google Cloud project and service account; App Attest verification needs Apple configuration and physical devices to test. The app reports `not_configured` honestly in the meantime. |
| Managed signing for Solana and MPC | F-21, F-24 | A signing provider (Turnkey or KMS with Ed25519) and its credentials. The mock MPC now refuses to run in production. |
| CI | all | GitHub Actions is billing-locked; every result in 08 is a local run. |
| Smart-contract tooling | F-1…F-6 | Slither / fuzzing / formal verification were not run. |

## Remaining code work

### F-10: Zod coverage (AGENTS rule 1)

Every body is now size-bounded, but these mutating route files still validate
by hand, or take no body at all. Each needs reviewing and, where it reads a
body, a strict schema:

- `account/fund/route.ts`
- `agents/route.ts`
- `ambassadors/follow/route.ts`
- `ambassadors/route.ts`
- `auth/guest/route.ts`
- `auth/handoff/route.ts`
- `auth/logout/route.ts`
- `auth/refresh/route.ts`
- `auth/telegram/route.ts`
- `auth/watch-token/route.ts`
- `auth/webauthn/route.ts`
- `cards/challenges/options/route.ts`
- `cards/challenges/verify/route.ts`
- `cards/lifecycle/[id]/report-lost/route.ts`
- `cards/lifecycle/[id]/reveal/route.ts`
- `careers/route.ts`
- `chat/route.ts`
- `compliance/attestation/source-of-funds/route.ts`
- `contact/route.ts`
- `earn/deposit/route.ts`
- `earn/withdraw/route.ts`
- `investing/corporate-actions/settle/route.ts`
- `markets/watchlist/route.ts`
- `mcp/route.ts`
- `membership/cashback/claim/route.ts`
- `miniapp/telegram-link/route.ts`
- `notifications/read-all/route.ts`
- `oauth/revoke/route.ts`
- `oauth/token/route.ts`
- `p2p/heartbeat/route.ts`
- `p2p/orders/[id]/pay/route.ts`
- `p2p/orders/[id]/release/route.ts`
- `payments/review/route.ts`
- `reports/[slug]/download/route.ts`
- `telegram/webhook/route.ts`
- `travel/alerts/route.ts`
- `travel/cancel/[id]/route.ts`
- `webhooks/card-auth/route.ts`
- `webhooks/complyadvantage/route.ts`
- `webhooks/furlbridge/route.ts`
- `webhooks/rain-rewards/route.ts`
- `webhooks/stripe/route.ts`
- `webinars/[slug]/register/route.ts`
- `x402/facilitator/settle/route.ts`
- `x402/facilitator/verify/route.ts`

### Adjacent, development-only

- `mintTicketCnft` returns a fabricated "mock" asset id when a live mint fails,
  and `/api/travel/book` derives a `txHash` from proof digits. Both run only
  where booking is allowed (not production). Fix before booking is enabled.
