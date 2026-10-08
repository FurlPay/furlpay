# Merchant payments: USDC checkout, ledger and webhooks

Hosted checkout (`/p/[slug]`), payment links, invoices and terminal requests
that collect **native USDC** and credit merchants through the double-entry
ledger. Code: `apps/web/src/lib/payments/merchant/`. Schema: migrations
`0040_stablecoin_payments.sql` and `0041_merchant_webhooks.sql`.

## Money flow

1. A merchant creates a link (`POST /api/merchant/payments`). Amounts are exact
   USDC micro-units (6 dp, ≤ 1,000,000 USDC); the fee is 75 bps, rounded down,
   paid by the merchant or the customer.
2. A payer opens `/p/<slug>` and picks a chain. `merchant_checkout_reserve`
   atomically assigns a **pre-provisioned, never-reused** collection address
   for that merchant and chain. No free address → `rail_unavailable` (503); there
   is no fallback to a shared wallet.
3. The verifier (`verifier.ts`) reads the chain independently: Transfer logs to
   that address (EVM) or transfers into its USDC token account / Solana Pay
   reference (Solana); re-reads the receipt; anchors to the canonical block
   before and after screening; waits for the deposit-policy depth
   (`lib/chains/depositConfirmation.ts`); screens payer and recipient (OFAC list
   + Circle `isBlacklisted` on EVM). Anything outside the payment window, or a
   flagged party, goes to `review` and is never credited automatically.
4. `merchant_payment_receive` (one database transaction): claims the
   `(chain, tx, log)` receipt (replay across intents is impossible), posts a
   balanced USDC journal, updates status, and enqueues webhooks.

| Ledger account | Meaning |
|---|---|
| `mp:treasury:<chain>` (asset) | USDC received at collection addresses |
| `mp:hold:<intent>` (liability) | Received but not yet allocated: underpayments, overpayment excess |
| `mp:merchant:<merchant>:<chain>` (liability) | Owed to the merchant (net) |
| `mp:fees:<chain>` (revenue) | FurlPay processing fee |

Statuses: `awaiting_payment → confirming → paid | underpaid | overpaid`,
`expired`, `review`. Underpaid/overpaid funds stay in `mp:hold:*` until an
operator resolves them; **refunds and sweeping are not implemented** (they need
the custody provider that controls the collection addresses).

Chains collected: Ethereum (12 conf), Polygon (128), Solana (finalized, 31),
Base (1), Arbitrum (1), Arc (1, deterministic finality; chain 5042, USDC
`0x3600…0000`). Optimism and Avalanche are in the registry but **not collected**
until a deposit policy is reviewed for them.

## Webhooks

One HTTPS endpoint per merchant (`PUT /api/merchant/webhook {url}`); the
secret (`whsec_…`) is returned once and stored only sealed (AES-256-GCM, key
`FURLPAY_PARTNER_WEBHOOK_KEY`, AAD `merchant:<id>`). Events:
`payment.succeeded`, `invoice.paid`.

```
POST <your url>
Content-Type: application/json
X-FurlPay-Event-Id: <uuid>          stable across retries: dedupe on it
X-FurlPay-Attempt: <n>
X-FurlPay-Signature: t=<unix seconds>,v1=<hex>

{"id":"<uuid>","type":"payment.succeeded","created":"<iso>","data":{...}}
```

Verify: `v1 == hex(HMAC_SHA256(secret, t + "." + rawBody))` with a
constant-time compare, and reject `|now − t| > 300 s`. This is the same scheme
as partner ramp webhooks (`lib/ramp/partnerWebhooks.ts`).

Delivery is at-least-once: 5 attempts at +1 min, +10 min, +1 h, +6 h; 5 s
timeout; https only; the host is resolved, checked against private, loopback,
link-local, CGNAT, metadata and IPv6 ULA/mapped ranges, and the socket is pinned
to that address (no DNS rebinding); redirects are not followed. A webhook
failure never touches the ledger. `GET /api/merchant/webhook` shows the last 20
deliveries; `POST {redeliver:<id>}` re-queues an exhausted one.

## Production requirements

- Migrations `0040` then `0041` applied (needs `0009` ledger; not applied in prod
  as of 2026-10-09).
- `FURLPAY_PARTNER_WEBHOOK_KEY` (base64, 32 bytes). Without it, endpoint setup
  and delivery fail closed (503 / `secret_unreadable`).
- `CRON_SECRET` (Vercel) or `FURLPAY_CRON_SECRET` (AWS) for
  `/api/cron/merchant-payments` (every 2 min). Unset → the cron refuses.
- RPC URLs per chain (`ETHEREUM_RPC_URL`, `BASE_RPC_URL`, `ARBITRUM_RPC_URL`,
  `POLYGON_RPC_URL`, `SOLANA_RPC_URL`, `ARC_RPC_URL`); unset falls back to the
  public endpoint in `registry.ts`, which is rate limited.
- **Collection addresses**: rows in `merchant_payment_destinations` per merchant
  and chain, controlled by the custody provider (`custody_reference`), approved
  by operations. None exist today → every checkout answers `rail_unavailable`.

## Deploy order

1. Apply `0040`, then `0041` (additive: new tables/columns/functions only).
2. Set `FURLPAY_PARTNER_WEBHOOK_KEY`; confirm cron secret and RPC URLs.
3. Deploy the application.
4. Provision and approve collection addresses for a pilot merchant; run one
   small real payment per chain; confirm the trial balance and webhook delivery.

## Rollback

- **Application**: `vercel rollback <previous deployment>`. Nothing else
  references these tables, so older code simply ignores them.
- **Stop collecting without a deploy**: deactivate links
  (`update merchant_payment_links set active=false`) or remove free
  destinations; in-flight intents keep verifying.
- **Do not drop** `merchant_payment_receipts`, `merchant_payment_events` or ledger
  rows: they are append-only financial evidence. To back out 0041 only:
  `drop function merchant_outbox_claim; drop table merchant_webhook_endpoints;`
  and drop its four outbox columns.
