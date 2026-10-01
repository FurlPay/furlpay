# Disaster recovery runbook

Status: **prepared, not rehearsed.** No restore drill has been run. Nothing below is verified until the drill in §5 has been executed and its evidence recorded.

## 1. Targets

| Data | RPO | RTO | Source of truth |
|---|---|---|---|
| Ledger, webhook_events, balances, payments (Supabase Postgres) | ≤ 5 min | ≤ 1 h | Supabase PITR |
| Accounts, linked wallets, trade lots | ≤ 5 min | ≤ 1 h | Supabase PITR |
| KV systems of record (passkeys, API keys, OAuth clients, x402 settlements; Upstash) | ≤ 1 h | ≤ 2 h | Upstash backups — **gap**: see audit P2-4 |
| KV caches (rate limits, dedupe fast path, OTPs) | none (rebuildable) | n/a | — |
| Infrastructure | n/a | ≤ 4 h | Terraform in `infra/aws` |
| Secrets | n/a | ≤ 1 h | Secrets Manager / Vercel; offline inventory required |

## 2. Prerequisites (external — must be verified by an operator)

- [ ] Supabase production project is on a plan with **Point-in-Time Recovery** enabled, and the retention window is recorded here: `____`.
- [ ] Upstash database has daily backups enabled, and restore has been tested once.
- [ ] An offline, encrypted inventory of every production secret name and its owner exists (values in a password manager, not in this repository).
- [ ] The Android upload keystore has an offline encrypted backup (loss = Play upload-key reset procedure).
- [ ] The registrar lock and DNSSEC for `furlpay.com` are enabled.

## 3. Scenarios

**Supabase project lost or corrupted**
1. Freeze writes: set `FURLPAY_APP_DISABLED_FEATURES=send,swap,earn,cards,wallet_link`, then redeploy config. Money routes also fail closed when the DB is unreachable.
2. Restore PITR to a **new** project at the last good timestamp.
3. Run `DATABASE_URL=<restored> node scripts/db/probe-schema.mjs`. It must exit 0: every migration object present, zero missing guards.
4. Run reconciliation (`/api/cron/reconcile` with the cron key). The ledger must balance and agree with provider statements.
5. Repoint `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` and redeploy.
6. Replay provider webhooks from the restore point. This is safe by construction: every financial effect is keyed (migration 0025), so a replay of an effect that survived the restore is a no-op.

**Upstash flushed or lost**
- Dedupe keys are gone. That is **safe for money since 0025**, because the database effect key is the authority (proven: harness T-W2).
- Passkeys, API keys and OAuth clients are lost until P2-4 moves them to Postgres. Users re-enrol passkeys, and integrators rotate keys.

**Vercel/AWS compute lost**: redeploy from the last green SHA (`npm run deploy:prod` or ECS with the previous task definition). The app has no local state that matters, since balances live in the DB.

**Region loss (ap-northeast-2 DB)**: no secondary exists. Recovery is PITR into another region, and RTO is unbounded until a cross-region replica exists. This is an accepted gap for launch.

## 4. Communications

Status page first; then an email to affected users if any money state was restored to an earlier point; then provider notifications (Stripe, KYC) if webhooks will be replayed.

## 5. Restore drill (T-DR1) — to be run quarterly

1. Restore production PITR to a scratch project (never overwrite production).
2. `DATABASE_URL=<scratch> node scripts/db/probe-schema.mjs --json drill.json` → exit 0.
3. Run the ledger balance query (`scripts/db/verify-financial-effects.mjs` includes the "every transaction balances" check; run it against a *copy* only, since it writes).
4. Record the wall-clock time from the start of step 1 to the end of step 3 against the 1-hour RTO.
5. Delete the scratch project.

Evidence log:

| Date | Operator | Restore point | Duration | Probe | Result |
|---|---|---|---|---|---|
| — | — | — | — | — | **never run** |
