# BVNK integration

Status on 11 October 2026: **foundation implemented and locally tested; nothing
sandbox-verified; nothing enabled in production.** FurlPay has no BVNK
account, sandbox credentials or partner agreement yet.

Code: `apps/web/src/lib/bvnk/`, `apps/web/src/app/api/webhooks/bvnk/`,
`apps/web/src/app/api/cron/bvnk-reconcile/`, migration
`supabase/migrations/0052_bvnk_records.sql`. Contracts:
[BVNK_API_CONTRACTS.md](BVNK_API_CONTRACTS.md). Webhooks:
[BVNK_WEBHOOKS.md](BVNK_WEBHOOKS.md).

## What is built

| Piece | What it does | Evidence |
|---|---|---|
| Hawk signing (`hawk.ts`) | Signs every request as BVNK specifies: HMAC-SHA256, no payload hash, no `ext`, six-character CSPRNG nonce. | Reproduces the reference vector from the Hawk specification, and BVNK's documented normalised-string format. |
| Webhook verification (`webhook.ts`) | Base64 HMAC-SHA256 over the raw body with the secret's UTF-8 bytes; constant-time; length and encoding checked first. | Reproduces the vector published in BVNK's "Configure webhooks" guide. |
| Event contracts (`schemas.ts`) | Pay-in v2, payout v2, transfer v3, wallet v2 and customer status events, transcribed from BVNK's published definitions. | Every documented example payload parses. |
| Webhook route | Bounded body → signature → contract → durable claim on `eventId` → newer-wins record. Records only. | 12 route tests: duplicates, concurrent duplicates, reused id with a different body, store outage, transient failure retry, stale reports. |
| Provider records (0052) | Latest BVNK-reported state per object; numeric amounts; an older report never overwrites a newer one. | Runs on PGlite; out-of-order delivery tested. |
| API client (`client.ts`) | Wallets v2 list/read, Transfers v3 read and dry-run, payout v2 read; transfer creation and quote accept/refresh behind a flag. | Documented response examples parse; retry, gating and idempotency tests. |
| Reconciliation | Re-reads open transfers and payouts from the API and records the answer. | Tested with documented responses. Not scheduled. |

## Capability matrix

"Contract verified" means the endpoint or event is taken from BVNK's
published definitions. Nothing is sandbox-verified: there are no credentials.

| Capability | Contract verified | Implemented | Tested locally | Sandbox verified | Production enabled | Blocker |
|---|---|---|---|---|---|---|
| Hawk authentication | Yes | Yes | Yes | No | No | Credentials |
| Webhook verification and intake | Yes | Yes | Yes | No | No | Webhook secret; migrations 0051-0052 |
| Wallets v2 list / read (incl. virtual-account instruments) | Yes | Yes (read) | Yes | No | No | Credentials |
| Transfers v3 read and dry-run | Yes | Yes | Yes | No | No | Credentials |
| Transfers v3 create, accept and refresh quote | Yes | Yes, behind `BVNK_MONEY_MOVEMENT_ENABLED` | Yes | No | No | Credentials, sandbox run, compliance review, approval, and a caller that persists the idempotency key and has explicit authorisation |
| Payout v2 read and status events | Yes | Yes (read, record) | Yes | No | No | Credentials |
| **P0 Fiat on-ramp** (customer virtual accounts, pay-ins) | Partly: pay-in events, wallet read with payment instruments | Records pay-ins; reads instruments | Yes | No | No | Customer onboarding (`/platform/v2/customers`) and fiat wallet creation (`POST /ledger/v1/wallets`) not built: they create BVNK-managed accounts holding customer money, which needs a partner agreement and a regulatory decision; no ledger credit is posted from a pay-in |
| **P0 Fiat-funded payroll** | No product contract exists for funding FurlPayRouter from BVNK | No | — | — | — | Payroll is non-custodial: the employer's own wallet signs each line. Funding it from a BVNK-held balance means BVNK, not the employer, holds the money first. That is a custody-model change, not an integration; it needs a design decision. A confirmed deposit must never authorise payroll by itself. |
| **P1 Fiat off-ramp** (payouts to banks) | Payout read/status yes; creation (`POST /payment/v2/payouts`) not transcribed | Read and record only | Yes | No | No | Payout creation, beneficiary verification and approval flow need sandbox access and compliance sign-off |
| **P1 Embedded contractor wallets** | Wallet read yes; creation not built | No | — | — | — | BVNK-managed wallets are custodial. They must never be shown as the contractor's or employer's self-custody, and offering them needs the same agreement as P0 |
| **P1 Stablecoin cards** (BVNK Cards API, Marqeta, Mastercard) | Cards API exists in BVNK docs; not transcribed | No | — | — | — | Card issuing is a separate eligibility programme; BVNK API access does not grant it. The Marqeta and Mastercard Move claims in the research reports are not API facts |
| **P2 Multi-currency settlement** | Transfers v3 conversion (QUOTE / AUTO_CONVERSION) yes | Client only | Yes | No | No | Same as transfer creation |
| **P2 Travel stablecoin payments** | No | No | — | — | — | Travel booking is refused in production (no live rail or provider); nothing to settle yet |
| **P2 x402 fiat settlement** | No | No | — | — | — | Needs a decision on who holds the converted funds; x402 settles on-chain to FurlPay's address today |

## Security and financial integrity

- **No balance is ever changed by a webhook.** `bvnk_records` is a record of
  what BVNK reported; nothing posts to the ledger or authorises a payment.
- **Order:** an older or equal `updatedAt` never overwrites a newer one (SQL
  compare in `bvnk_record_upsert`).
- **Replay:** durable claim on `eventId` (0022) with a payload hash, so a
  reused id with a different body is refused (409) and alerted. Events older
  than seven days or dated in the future are refused.
- **Retry semantics:** 401 bad signature and 422 invalid event (BVNK does not
  retry 4xx); 503 only for our own transient failures (BVNK retries 5xx).
- **Money movement** is refused unless `BVNK_MONEY_MOVEMENT_ENABLED=1`, needs a
  caller-supplied UUID `Idempotency-Key`, and is never retried: BVNK answers a
  repeated key with 400, so a lost response becomes `BvnkOutcomeUnknown`, to be
  resolved from the transfer's webhook or a read keyed by our `reference`.
- **Quotes:** acceptance needs the digest of the current quote, the transfer in
  `PENDING_QUOTE_ACCEPTANCE`, and an unexpired quote (`quoteAcceptable`).
  `EXPIRED` and `FAILED` are distinct; `PROCESSING` is never completion.
- **Precision:** amounts arrive as JSON numbers and are converted once, exactly,
  to decimal strings; anything not exactly representable is refused.
- **Secrets:** Hawk key and webhook secret are server-only env vars, never
  logged. Error logs carry the BVNK error code, not its free-text message
  (which can echo beneficiary data).
- **Custody:** every BVNK-held balance is custodial. Self-custody (the
  employer's and contractors' own wallets) and BVNK-managed balances stay
  separate types; nothing here presents one as the other.

## Sandbox plan (when credentials exist)

1. Set `BVNK_ENVIRONMENT=sandbox`, Hawk ID and key, and the webhook secret in
   a preview deployment only. Leave `BVNK_MONEY_MOVEMENT_ENABLED` unset.
2. `GET /ledger/v2/wallets` through `bvnkClient().listWallets()`; confirm a
   200 and that the documented schema parses.
3. Point a sandbox webhook at `/api/webhooks/bvnk`; trigger a simulated pay-in
   (`POST /payment/v2/payins/simulation`, documented) and confirm a
   `recorded` outcome and a row in `bvnk_records`.
4. Dry-run a conversion; compare fees and rates with the portal.
5. Only after review: enable money movement in sandbox, create one transfer
   with a persisted key, accept its quote, and reconcile.

## Production readiness

Not ready. Required: a BVNK partner agreement and production credentials;
migrations 0051 and 0052 applied; a compliance decision on custodial
balances; the sandbox plan above completed; and explicit approval before
`BVNK_MONEY_MOVEMENT_ENABLED` is set anywhere.
