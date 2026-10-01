# AWS data plane: why Aurora and ElastiCache are off

`var.enable_aws_data_plane` defaults to **false** (audit P0-5). With it off, Terraform provisions no Aurora cluster and no ElastiCache group, and does not inject `DATABASE_URL`/`REDIS_URL`.

**Why.** The application has no SQL or TCP Redis client:

- Every database call goes through Supabase's PostgREST HTTP API (`lib/supabase.ts`, `sbSelect`/`sbRpc`/…, around 98 call sites across 16 files). It never reads `DATABASE_URL`.
- The KV client (`lib/kv.ts`) speaks the Upstash REST protocol over HTTPS and is called from Edge middleware, which cannot open TCP sockets. `REDIS_URL` is read only by presence reports.

Provisioning Aurora and ElastiCache today buys infrastructure nothing uses.

**Migration path (P4-1), in order:**

1. Introduce a pooled `pg` data layer behind the existing `lib/supabase.ts` function signatures. Money functions are already SQL functions (`apply_financial_effect`, `ledger_post`, `claim_webhook_event`), so they port unchanged.
2. Move Edge-middleware KV use (rate limit, revocation) to a Node middleware path or keep Upstash for Edge only.
3. Replicate Supabase → Aurora with logical replication, then cut over with a short write freeze. **No dual-write for the ledger.**
4. Only then set `enable_aws_data_plane = true` and switch the app to `DATABASE_URL`.

Until step 1 exists, turning the flag on is wasted spend.
