# Deployment runbook — merchant payments, payroll, Sui, refunds

Every step below needs the owner's explicit approval at the time it is run.

## 0. Preconditions
1. Branch reviewed and merged through a PR with a green CI run on the exact SHA.
2. `npm run merchant:check-env` (apps/web) passes against the target environment:
   `FURLPAY_PARTNER_WEBHOOK_KEY`, `FURLPAY_TAX_ENCRYPTION_KEY` (distinct, 32-byte
   base64), cron secret, Supabase URL/key, RPC URLs answering the right chain ids,
   and every configured `FURLPAY_ROUTER_ADDRESS_<CHAIN>` deployed, on native USDC,
   not paused.
3. Migration `0009` (ledger) present in the target database.

## 1. Staging
1. Apply, in order, in one maintenance window: `0040` → `0041` → `0042` → `0043`
   → `0044` → `0045` → `0046`. All are additive (new tables, columns, functions,
   widened checks). Note: untracked files named `0042_payroll_and_banking_workspace.sql`
   and `0043_payroll_provider_and_wallets.sql` exist in the shared main checkout;
   they must not be applied alongside these.
2. Deploy the application as a preview, then `npm run deploy:prod` only for production.
3. Seed pilot addresses with `PILOT_DESTINATION_MNEMONIC=<yours> npm run merchant:seed-destinations -- --merchant=<uuid>`
   (refuses the production project). These are mainnet addresses you control.
4. Run one small real payment per enabled chain; confirm: intent `paid`, journal
   balanced, webhook delivered, PDF receipt downloads, reconciliation reports 0 alerts.
5. Refund it: request → approve (admin) → send from the address's key → record the
   tx → `completed`; trial balance unchanged.

## 2. Production
Same order as staging, with collection addresses registered by operations from
the custody provider (signature proof required) instead of seeding.

## 3. Rollback
- Application: `vercel rollback <previous deployment>`. Older code ignores the new tables.
- Stop collecting without a deploy: `update merchant_payment_links set active=false`
  or remove unassigned destinations; in-flight checkouts keep verifying.
- Never drop `merchant_payment_receipts`, `merchant_payment_events`,
  `merchant_refunds` or ledger rows: they are financial evidence. Undo money with
  compensating journals (`ledger_transactions.reverses`), never by deletion.
- Functions can be dropped/replaced; widened checks (0043, 0046) can stay.

## 4. Operations
- Crons: `/api/cron/merchant-payments` every 2 min, `/api/cron/merchant-reconcile`
  every 10 min (reconciliation + liveness alerts).
- Watch `/dashboard/operations`: held payments, alerts (incl. `verification_stale`
  = scanner or RPC down), refunds awaiting approval or recording.
- RPC health: `rpcHealth(chain)` in `lib/payments/merchant/rpc.ts`.
