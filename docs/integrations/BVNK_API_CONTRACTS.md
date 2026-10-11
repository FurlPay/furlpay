# BVNK API contracts used by FurlPay

Source: BVNK's published API definitions at https://docs.bvnk.com
(api-explorer), read on 11 October 2026. The documentation site embeds each
operation's OpenAPI definition; the request and response shapes below, and the
example payloads in `apps/web/src/lib/bvnk/__tests__/fixtures/`, are taken
from those definitions. The fixtures are documentation examples, not captured
production or sandbox traffic.

## Base URLs and authentication

| Item | Value | Source |
|---|---|---|
| Sandbox | `https://api.sandbox.bvnk.com` | api-overview/authentication |
| Production | `https://api.bvnk.com` | api-overview/authentication |
| Request auth | Hawk, HMAC-SHA256; payload and response validation not used | api-overview/authentication |
| Idempotency | `Idempotency-Key` (v2+/v3) or `X-Idempotency-Key` (v1), UUID; a repeat after success returns 400, failed requests are not cached | api-overview/idempotency |
| Pagination | `page`/`size` (max 100) on v1 lists; Wallets v2 uses `pageNumber`/`pageSize` | api-overview/pagination, ledger-wallet-list-v-2 |
| Errors | `{ code, status, message, details }`, e.g. `bvnk:payment:0006` (payout idempotency key exists) | api-overview/errors |

## Operations implemented

| Operation | Method and path | FurlPay | Money moves |
|---|---|---|---|
| List wallets (v2) | `GET /ledger/v2/wallets?q&pageNumber&pageSize` | `listWallets` | No |
| Get wallet (v2) | `GET /ledger/v2/wallets/{id}` (includes fiat `paymentInstruments`) | `getWallet` | No |
| Transfer dry-run (v3) | `POST /payment/v3/transfers/dry-run` | `transferDryRun` | No (estimate) |
| Get transfer (v3) | `GET /payment/v3/transfers/{transferId}` | `getTransfer` | No |
| Get payout (v2) | `GET /payment/v2/payouts/{transactionId}` | `getPayout` | No |
| Create transfer (v3) | `POST /payment/v3/transfers`, header `Idempotency-Key` required | `createTransfer`, gated | Yes |
| Transfer action (v3) | `POST /payment/v3/transfers/{transferId}/actions` `{ type: ACCEPT_QUOTE, digest }` or `{ type: REFRESH_QUOTE }` | `acceptQuote`, `refreshQuote`, gated | Yes |

Transfers v3 request: `reference` (required), `originator { walletId, currency, amount? }`,
`beneficiary { walletId, currency, amount? }` (exactly one amount),
`conversion { type: QUOTE | AUTO_CONVERSION, validityDuration?: PT20S | PT60M }`,
`metadata`. Statuses: `PROCESSING`, `PENDING_QUOTE_ACCEPTANCE`, `EXPIRED`,
`COMPLETED`, `FAILED`. Quote fields: `conversion.allInRate`, `baseRate`,
`spread`, `digest`, `expiresAt`.

Payout v2 statuses: `PENDING`, `PROCESSING`, `PENDING_APPROVAL`, `ON_HOLD`,
`COMPLETED`, `CANCELLED`, `FAILED`, `RETURNED` (the status-change webhook
adds `EXPIRED`).

## Documented but not implemented

| Operation | Path | Why not |
|---|---|---|
| Create customer (v2) | `POST /platform/v2/customers` | Onboarding customers to BVNK makes BVNK hold their money; needs an agreement and a regulatory decision |
| Create fiat wallet (virtual account) | `POST /ledger/v1/wallets` | Same |
| Create payout (v2) | `POST /payment/v2/payouts` | Needs beneficiary verification, approval flow and sandbox testing |
| Simulate pay-in (v2) | `POST /payment/v2/payins/simulation` | Sandbox-only; for the sandbox plan |
| Cards API | `/cards/...` | Separate eligibility programme |

## Discrepancies with the research reports

- The reports describe "Mastercard Move access" and "Marqeta card issuance via
  BVNK". Neither appears as an API in BVNK's documentation; the Cards API is a
  separate product with its own eligibility.
- The reports cite "HMAC-SHA256 with timestamp" webhooks. BVNK's current
  webhooks sign the raw body only, with no timestamp header; a legacy scheme
  over URL + content type + body is documented as being discontinued.
- "Quote API" is legacy; Transfers v3 replaces it (migration guide).
- Volumes, fees and the $500K/month minimum in the reports are not API
  contracts and were not used.
