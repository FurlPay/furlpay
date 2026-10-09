# Payment security verification

Each control, where it is enforced, and the test that proves it. "SQL" means the
rule holds even if application code is bypassed.

## Money correctness

| Control | Enforced in | Test |
|---|---|---|
| Integer micro-units only | `money.ts`, bigint columns | `financialTripwires.spec` (forbids `/ 10 ** decimals`) |
| Balanced journals | `ledger_post` (SQL) | `refunds-0045.spec` trial balance = 0 |
| Credit only after independent chain reads | `verifier.ts` (EVM receipt + canonical block + depth; Solana finalized balances; Sui balance changes re-read by digest) | `verifier-fixes.spec`, `sui.spec`, `sui.live.spec` |
| Wrong chain / wrong token / wrong recipient | per-endpoint chain proof (`rpc.ts`, `sui.ts`); exact token contract / coin type; recipient match | `rpcFailover.spec`, `reconcile.spec`, `sui.spec` |
| Receipt replay, cross-intent replay | receipt PK `(chain, tx, log)` (SQL) | `database.spec`, harness 0040 |
| Refund cannot exceed refundable or repeat | `merchant_refund_request` locks the intent (SQL) | `refunds-0045.spec` |
| A payment cannot be passed off as a refund | `transfer_is_a_payment` (SQL) | `refunds-0045.spec` |
| Refunds only to a wallet that paid | `refund_address_not_payer` (SQL) | `refunds-0045.spec` |
| Payroll pays only roster addresses | batch schema accepts contractor ids only | `payrollBatches.spec` |
| Payroll execution recorded only from the chain | `execution.ts` (status, router, depth, canonical block, event fields) | `payrollExecution.spec`, `payrollRouter.e2e.spec` |
| Router-compatible signatures | low-s, v 27/28, EIP-712 recovery | `payrollSigning.spec` |

## Access and data

| Control | Enforced in | Test |
|---|---|---|
| Merchant isolation | every query filters `merchant_id = session user` | route + repository specs |
| Service-role-only tables | RLS enabled, grants revoked from anon/authenticated (SQL) | `payrollDatabase.spec`, harness |
| Admin-only money operations (tiers, addresses, refund approval/completion) | `requireRole("admin")` | `operations.spec` |
| Publishable keys cannot read payments; test keys cannot create mainnet links | `/api/v1/payment-links` | `payment-links/__tests__/route.spec` |
| Secrets sealed | AES-256-GCM with per-owner AAD (webhook secrets, tax data) | `webhooks.spec`, `taxForms.spec` |
| Webhooks: HMAC t.body, SSRF-pinned, no redirects | `webhooks.ts` + `safeFetch` | `webhooks.spec` |
| Fail-closed screening (payouts, refunds, payroll addresses) | `screenAddressRisk` callers | `selfService.spec`, `refunds.spec`, `payrollBatches.spec` |

## Defects found and fixed in this work

1. Public prefix `"/pay"` matched `/payroll/*`, `/payments`, `/paynow`: pages were reachable without login (APIs still authenticated). Fixed to `"/pay/"`; `publicCheckoutRoute.spec`.
2. Invite links built from the request Host header (spoofable). Now `publicOrigin()`; `clientIpTrust.spec` tripwire.
3. Payroll intents signed for Arbitrum while the UI offered Base/Polygon (funds would land on another chain than shown). Per-chain domains; `payrollBatches.spec`.
4. Payroll fee deducted from the contractor's pay. Fee now on top; e2e proves exact amounts.
5. Concurrent retries of one payroll batch returned a duplicate-key error. `on conflict`; harness 0042.
6. Float division of token amounts in `payments.ts`. Exact conversion; `financialTripwires.spec`.
7. Failover could have read from a wrong-chain endpoint after one successful chain check. Per-endpoint proof; `rpcFailover.spec`.
8. Fabricated Sui USDC coin type in the pasted specs (no on-chain metadata). Circle's verified type only.

## Open risks

- FurlPayRouter is unaudited and undeployed.
- In-memory circuit-breaker and payment-intent stores are per serverless instance.
- `releaseBranchGate` defect (forced-deploy warning) awaiting owner decision.
- No organization model: one account = one merchant; no dual control.
