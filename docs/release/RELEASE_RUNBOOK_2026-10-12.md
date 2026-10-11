# Release runbook — PRs #115, #116, #117, #118 and release identity

Prepared 12 October 2026. Nothing in this runbook has been executed. Every step
that changes GitHub, Vercel or a database needs the owner's approval and runs
from the owner's terminal (`! …` in the agent session, or directly).

## Where production is

| Item | State | Evidence |
|---|---|---|
| PR #113 (`0dce509b`) | **Deployed** | `dpl_31mdtjFARgnr16CqtpxFVfhL6po9`, Ready, aliased to furlpay.com. No git metadata (CLI deploy). Content fingerprint: `/llms.txt` byte-identical to `0dce509b`; lock-link page and AP2 validation message match `0dce509b`. |
| PR #115 (security) | Open, not deployed | AP2 still answers with the pre-#115 validation message. |
| PR #116 (payroll schedules + analytics) | Open, not deployed | Migration 0051 unapplied anywhere. |
| PR #117 / #118 (BVNK) | Open, stacked on #116 | Migration 0052 unapplied anywhere. No BVNK credentials. |
| This PR (release identity) | Open | `deploy:prod` stamps commit identity. |
| Rollback target | `dpl_31mdtjFARgnr16CqtpxFVfhL6po9` (current); before it `dpl_BA3wFtwBWXb68AbRMsmPbM2kmjGk` | Both Ready. |
| GitHub Actions | Billing-locked | Every deploy needs `FURLPAY_DEPLOY_FORCE=1` and a written reason. |

## Order and why

1. **Release identity** (this PR) first, so every later deploy is provable
   from metadata, not fingerprints. No runtime behaviour change.
2. **#115** next. No migration. Independent of #116–#118.
3. **#116**, then migration **0051**, then the payroll cron.
4. **#117 + #118** (merge #118 into #117, then #117), then migration **0052**.
   BVNK stays inert: without `BVNK_*` variables the webhook answers 503 and
   the client calls nothing.

Each step is its own deploy, verified before the next.

## For every step

### 0. Before
- Supabase: confirm a recent backup / point-in-time recovery exists for the
  production project (dashboard → Database → Backups). Record its timestamp.
- Note the current production deployment id: `vercel inspect furlpay.com`.
- Pull the merged branch into a clean checkout; `git status` must be empty;
  `git rev-parse HEAD` equals `origin/extension-redesign`.

### 1. Merge (owner)
```
! gh pr merge <N> --repo Ashutosh0x/furlpay --merge
! gh pr view <N> --repo Ashutosh0x/furlpay --json state,mergeCommit
```

### 2. Migration (owner; only for #116 → 0051 and #117 → 0052)
Preflight, read-only, against production:
```sql
-- 0051 needs the payroll tables from 0042/0044/0048
select to_regclass('public.payroll_batches'), to_regclass('public.payroll_contractors'),
       to_regclass('public.payroll_batch_exclusions'), to_regclass('public.payroll_schedules');
-- 0052 needs webhook_events (0022) for de-duplication
select to_regclass('public.webhook_events'), to_regclass('public.bvnk_records');
```
The first three must be non-null and `payroll_schedules` null before 0051; the
same pattern for 0052. Both migrations are additive (new tables, functions and
grants inside `begin … commit`); neither alters or drops an existing object,
so the running application is unaffected by applying them before the deploy.
Apply with the project's usual migration path, then re-run the preflight to
confirm the new objects exist. If one fails, the transaction rolls back and
nothing partial remains.

### 3. Deploy (owner)
```
! cd <clean checkout> && FURLPAY_DEPLOY_FORCE=1 FURLPAY_DEPLOY_FORCE_REASON="<PR>, merged as <sha>; Actions billing-locked; local typecheck, lint, unit, build verified" npm run deploy:prod
```

### 4. Verify identity
```
vercel inspect furlpay.com --json   # meta.gitCommitSha == merged sha (after the identity PR)
```
and, signed in as admin, `/api/ops/health` → `build.commitSha` equals it.

### 5. Smoke (read-only)
| Release | Check | Expect |
|---|---|---|
| all | `GET /`, `/docs`, `/api/health` | 200 |
| #115 | `POST /api/agents/ap2` with body `{not json` | 400 `Invalid JSON body` |
| #115 | `/api/x402/price` without `X402_XSGD_USD_RATE` | 402s offer USDC only |
| #116 | `GET /api/payouts/payroll/schedules` signed out | 401 |
| #116 | same, signed in | 200 `{ schedules: [] }` (proves 0051 is applied) |
| #117 | `POST /api/webhooks/bvnk` | 503 `bvnk_webhook_not_configured` (BVNK unset) |

### 6. Cron activation (#116 only, after 4 and 5 pass)
`/api/cron/payroll-schedules` is in `vercel.json` and starts with the deploy.
It only prepares DRAFT batches for due schedules; with no schedules it does
nothing. First-run check: the cron run record shows `created: 0, failed: 0`,
or for a test schedule, one draft batch and no signature or payment.
`/api/cron/bvnk-reconcile` is **not** scheduled; leave it so until BVNK
credentials and sandbox verification exist.

### 7. Rollback
- Application: `vercel promote <previous deployment id>` (or `vercel rollback`),
  then step 4 against the previous id.
- Database: do **not** drop 0051/0052 objects on rollback. They are additive
  and unused by the previous build; dropping them would lose schedules or
  provider records. Roll forward with a fix instead.
- Rolling back the app never reverses money: payroll drafts were never paid,
  and BVNK records are records.

### 8. Accept
Identity matches, smoke passes, `/api/ops/health` has no new failing check,
and no new 5xx in `vercel logs furlpay.com --since 30m`.
