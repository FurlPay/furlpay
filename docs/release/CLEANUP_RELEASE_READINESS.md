# Cleanup release readiness — 11 October 2026

Branch `cleanup/hardening-oct11`, on top of `integration/consolidated-oct11`.
This supplements [`CONSOLIDATION_2026-10-11.md`](CONSOLIDATION_2026-10-11.md),
which stays as the record of the consolidation; nothing in it is withdrawn.
Findings and evidence are in
[`docs/audit/2026-10-11-cleanup/`](../audit/2026-10-11-cleanup/CODEBASE_CLEANUP_AUDIT.md).

## Decision: NO-GO for production; GO to merge into the integration branch

The cleanup branch is safe to merge into `integration/consolidated-oct11`:
every check that could be run passes, and each change is its own commit and
can be reverted on its own. Production release is still blocked by the three
external items in the consolidation record, none of which this branch can
clear:

1. GitHub Actions is locked by a billing problem, so the deploy gate cannot be satisfied.
2. The Redis store `upstash-kv-cinereous-sail` is over its Free-plan limit.
3. Which of migrations `0031`–`0050` production has is unknown.

## What changes for a deployment that takes this branch

| Change | Effect on production | Effect on previews |
|---|---|---|
| Preview isolation (`lib/dataPlane.ts`) | None | Data routes answer 503 until the preview scope has its own database and Redis and sets `FURLPAY_DATA_PLANE=isolated`. Pages still render. **This is intended**, and it will look like breakage on the first preview after merge. |
| Payment listings scoped to the caller | `GET /api/payments/history` now needs a valid session at the handler and returns only the caller's payments; `GET /api/v1/payments` returns only the key owner's. A client that relied on seeing all payments will see fewer. | Same |
| Account-lock link reachable without a session | The link in security emails works for a signed-out user | Same |
| Three packages removed, five declared | None at runtime; a clean install now resolves the packages the code imports | Same |
| Nine variables removed from `.env.example` | None; nothing read them | None |
| Six components removed | None; nothing imported them | None |

No migration is added. No environment variable becomes required in
production. No route changes its path.

## Actions that need you

| # | Action | Why |
|---|---|---|
| 1 | Fix GitHub billing (Settings → Billing & plans) | CI cannot run; the deploy gate needs it |
| 2 | Upgrade `upstash-kv-cinereous-sail` in Vercel → Storage | `/api/rails`, `/api/x402/fx` and Telegram sign-in answer 503 |
| 3 | Run `DATABASE_URL=<read-only> node scripts/db/probe-schema.mjs` against production | Establish which migrations are applied; SELECTs only |
| 4 | Remove `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` (and the other `KV_*` / `REDIS_URL` entries) from the Vercel **preview** scope | The code now refuses them, but they should not be there |
| 5 | Optionally: create a preview Supabase project and Redis store, add their credentials to the preview scope, set `FURLPAY_DATA_PLANE=isolated` there | Gives previews working data without touching production |
| 6 | Set `FURLPAY_ALERT_SLACK_WEBHOOK` or `FURLPAY_ALERT_WEBHOOK_URL` in production | Alerts are currently delivered nowhere |
| 7 | Decide on the history rewrite for the 465 commit trailers | Proposal and impact in the audit; not executed |
| 8 | Review the account-lock exposure change (`6a40c440`) | It deliberately makes one route reachable without a session |
| 9 | Approve merge of the cleanup PR, then of #113, then the production deploy | Nothing was merged or deployed |

## Deployment sequence

Unchanged from the consolidation record, with one addition at the start:

0. Merge the cleanup pull request into `integration/consolidated-oct11`.
1. Probe the production schema (action 3).
2. Apply missing migrations in order, staging first. All are additive.
3. Confirm CI is green on the head of #113; merge #113 into `extension-redesign`.
4. `npm run deploy:prod` from a clean checkout of `extension-redesign`.
5. `npm run smoke:prod`.
6. Re-probe `/api/rails`, `/api/x402/fx`, `/p/<slug>`, `/api/checkout/merchant/<slug>`, Telegram sign-in, and the account-lock link while signed out (expect "Invalid or expired lock link" from the handler, not "Unauthorized" from the middleware).
7. Update the dated evidence in `apps/web/src/lib/productionStatus.ts`.

Merging into `extension-redesign` does not deploy: Vercel's production branch
is `main`, and production is updated by `npm run deploy:prod`.

## Rollback

- **Code:** promote the previous production deployment
  `dpl_BA3wFtwBWXb68AbRMsmPbM2kmjGk` (`d3d7422e`) with `vercel rollback`.
- **One change only:** each cleanup change is a single commit and reverts
  cleanly on its own with `git revert <sha>`:
  `77bfa851` isolation, `653c69be` payment listings, `6a40c440` lock link,
  `9a507536` attribution rules, `50f13f48` environment, `3bef57f4`
  dependencies, `82990e4a` removed components.
- **Database:** nothing to roll back; this branch adds no migration.

## Remaining work

| Priority | Item | Needs |
|---|---|---|
| P0 | Remove production data credentials from the preview scope | You (action 4) |
| P1 | Decide on the commit-history rewrite | You (action 7) |
| P2 | 28 unreachable files kept: the 7-file `lib/chains` adapter layer, `providerMatrix.ts`, `chainBalance.ts` and others | A product decision per group |
| P3 | 42 variables read by the app with no `.env.example` entry | Follow-up; each needs its purpose written from the code |
| P4 | Workspace-wide version-conflict and deprecation review; dependency audit of native apps and SDKs | Follow-up |
| P5 | Consolidate the two alert pipelines, the JSON-RPC clients, the two blocklist reads, the batch-payment entry points, the two Telegram setup scripts | Follow-up; each needs callers migrated |
| P5 | `analytics/costs` visible to any signed-in user; `earn/position` not account-scoped | Product decision |
| P6 | Alert destination; external uptime check on the scheduler; CI | You (actions 1, 6) |
| P6 | Mark older readiness documents as superseded | Follow-up |
| P7 | Production deploy | Actions 1–3, then your approval |
| PN | Dead-code and duplicate analysis of `native-app`, `apps/android`, `apps/extension`, `apps/desktop`, `guardian`, `ios`, the SDKs and `infra` | Not started |
| PN | Custody provider for collection addresses; `FurlPayRouter` audit and deployment; ramp provider contracts; signer and relayer for x402 and gasless | External |
