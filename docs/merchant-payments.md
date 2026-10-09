# Merchant payments: USDC checkout, ledger and webhooks

Hosted checkout (`/p/[slug]`), payment links, invoices and terminal requests
that collect **native USDC** and credit merchants through the double-entry
ledger. Code: `apps/web/src/lib/payments/merchant/`. Schema: migrations
`0040_stablecoin_payments.sql`, `0041_merchant_webhooks.sql` and
`0042_payroll_and_merchant_extensions.sql`.

## Money flow

1. A merchant creates a link (`POST /api/merchant/payments`). Amounts are exact
   USDC micro-units (6 dp, ≤ 1,000,000 USDC); the fee is the merchant's tier
   rate (starter 95, growth 75, scale 50, enterprise 35 bps; default growth),
   rounded down, paid by the merchant or the customer. The rate is stamped on
   the link, so a later tier change never reprices an open link.
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

## Reconciliation and operations (0042)

`/api/cron/merchant-reconcile` (every 10 min) checks three ways and records
`merchant_reconciliation_alerts`; it never edits an intent or the ledger.

- Intent vs receipts: a credited intent with no receipt, or whose receipts do
  not sum to `received_units`.
- Receipts vs ledger: a missing or unbalanced `mp:<chain>:<tx>:<log>` journal, or
  one whose treasury debit differs from the receipt.
- Receipts vs chain (last 20): EVM receipt still `status=1` in the recorded
  block with the same USDC log and amount; Solana transaction finalized and
  successful. A reader outage is a `medium` `rpc_unavailable`, never a failure.

`/dashboard/operations` (admin or compliance; API `/api/merchant/operations`)
lists held payments and open alerts, records decisions (`note`,
`confirmed_hold`, `escalated`, `refund_requested`) and resolves alerts with a
reason. Admins assign pricing tiers there. There is deliberately no action that
credits, releases or refunds.

## Payroll (0042)

`/dashboard/payroll`; APIs under `/api/payouts/payroll/{contractors,batches,tax-summary}`.
Non-custodial: FurlPay never holds payroll funds and posts nothing to the ledger.

- Roster: contractors with a saved EVM payout address on arbitrum, arc, base
  or polygon. A batch settles through the FurlPayRouter **on its own chain**:
  each intent's EIP-712 domain carries that chain's id and router
  (`FURLPAY_ROUTER_ADDRESS_<CHAIN>`; the bare `FURLPAY_ROUTER_ADDRESS` is
  Arbitrum's only). Batches take roster IDs only, never addresses.
- On-chain fee: 35 bps per line, **on top** — the router debits line + fee and
  the contractor receives exactly the line amount. The batch minimum (1.50) and
  seat fee are not collected on-chain; they stay quotes until billing exists.
- Draft: every recipient screened (OFAC + Circle). Flagged or unscreenable →
  the batch is `blocked` and cannot be submitted.
- Fee quote, computed in `payroll_batch_create`: 35 bps of gross, minimum
  1.50 USDC, plus 19 USDC × active contractors on the first batch of each month.
  **Quotes only: billing is not connected.**
- Submit: compare-and-set `draft → submitting`, one FurlPayRouter intent per
  line (`createPayment`, idempotency key `payroll:<batch>:<line>`), then
  `submitted`. Any failure returns the batch to `draft`. Production without
  `FURLPAY_ROUTER_ADDRESS` answers 503.
- Durable signing: each line stores its EIP-712 payload (`sign_data`,
  `sign_deadline`), so the employer can resume after a refresh. Signatures are
  checked off-chain exactly as `FurlPayRouter._execute` recovers them, and
  refused where OpenZeppelin `ECDSA` would revert (high s, v not 27/28); the
  first signer becomes the batch's `payer_address`. Requests expire after
  15 minutes (`EXPIRY_SECONDS`); `PATCH {action:"reissue"}` mints fresh intents
  (new nonce, idempotency key `payroll:<batch>:<line>:<n>`) for expired lines.
- Execution (employer's wallet, no FurlPay relayer): once every outstanding
  line is signed and unexpired, "Execute batch on-chain" approves **exactly**
  the batch total to the chain's router and calls `batchPay`. The tx hash is
  then sent as `PATCH {action:"record_execution"}`; the server marks a line
  paid only after re-reading the receipt: success, `to` = configured router,
  canonical block at deposit-policy depth, and a `PaymentExecuted` from that
  router matching the line's paymentId, payer, recipient, amount, fee and
  nonce. All lines paid → batch `completed`.
- Proven locally: `payrollRouter.e2e.spec.ts` runs the app's own code against
  the real FurlPayRouter + MockUSDC on a local node with chainId 42161
  (`packages/contracts/hardhat.config.localpayroll.ts`,
  `scripts/deploy-router-local.ts`): exact contractor amounts, exact treasury
  fees, replayed authorizations revert, an unrelated tx is refused.
- 1099-NEC watch: totals of submitted batches per US contractor per year against
  $600 (≤ 2025) / $2,000 (2026); 2027+ shows no threshold until the inflation
  adjustment is published. Nothing is filed.
- Tax forms on file (`POST /api/payouts/payroll/contractors/[id]/tax`): the
  employer records a payee-signed W-9 (US) or W-8BEN (non-US) it holds. TIN,
  legal name and address are sealed (AES-256-GCM, `FURLPAY_TAX_ENCRYPTION_KEY`,
  AAD `tax:<contractor id>`); only the TIN's last 4 are stored in the clear and
  nothing returns the TIN. W-8BEN expiry = 31 Dec of the third year after
  signing. This is **not** an electronic W-9: IRS rules require the payee to
  e-sign under penalties of perjury inside the requester's system, which would
  need a contractor-facing flow.

Not built: e-FIRA (issued by the Indian AD bank, not by FurlPay), bank virtual
accounts (no BaaS partner). No FurlPayRouter is deployed on any mainnet.

## Production requirements

- Migrations `0040`, `0041`, then `0042` applied (link creation reads
  `merchant_pricing`, so `0042` is required by this code) (needs `0009` ledger; not applied in prod
  as of 2026-10-09).
- `FURLPAY_PARTNER_WEBHOOK_KEY` (base64, 32 bytes). Without it, endpoint setup
  and delivery fail closed (503 / `secret_unreadable`).
- `CRON_SECRET` (Vercel) or `FURLPAY_CRON_SECRET` (AWS) for
  `/api/cron/merchant-payments` (every 2 min) and `/api/cron/merchant-reconcile`
  (every 10 min). Unset → the crons refuse.
- RPC URLs per chain (`ETHEREUM_RPC_URL`, `BASE_RPC_URL`, `ARBITRUM_RPC_URL`,
  `POLYGON_RPC_URL`, `SOLANA_RPC_URL`, `ARC_RPC_URL`); unset falls back to the
  public endpoint in `registry.ts`, which is rate limited.
- **Collection addresses**: rows in `merchant_payment_destinations` per merchant
  and chain, controlled by the custody provider (`custody_reference`). Register
  them at `/dashboard/operations` (admin): the custody provider signs the
  displayed message with the address's key (EIP-191 for EVM, Ed25519/base58 for
  Solana) naming merchant, chain, address and reference; without a valid
  signature nothing is inserted. FurlPay never generates collection addresses.
  None exist today → every checkout answers `rail_unavailable`.
- **FurlPayRouter** per chain: an Arc router (`deploy-arc.ts`) goes in
  `FURLPAY_ROUTER_ADDRESS_ARC`, never in the bare `FURLPAY_ROUTER_ADDRESS`
  (Arbitrum). Non-payroll intents (`/api/payments/*`) still settle on Arbitrum.
- Pre-flight: `npm run merchant:check-env` (in `apps/web`) decodes the keys,
  checks each RPC's chainId, and requires each configured router to have
  bytecode, report the chain's native USDC and not be paused.
- Pilot addresses on local/staging only: `PILOT_DESTINATION_MNEMONIC=<yours>
  npm run merchant:seed-destinations -- --merchant=<uuid> --count=5`. Derived
  from a mnemonic you hold (never generated), signed like a console
  registration, refuses the production project. These are MAINNET addresses.
- `FURLPAY_TAX_ENCRYPTION_KEY` (base64, 32 bytes) for tax-form intake.

## Deploy order

1. Apply `0040`, `0041`, then `0042` (additive: new tables/columns/functions only).
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
