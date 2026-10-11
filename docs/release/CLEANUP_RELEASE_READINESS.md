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
| Account-lock link reachable without a session | Opening the link in a security email shows a confirmation page; pressing its button locks the account. Opening alone, by a person or a mail scanner, changes nothing. | Same |
| Three packages removed, five declared | None at runtime; a clean install now resolves the packages the code imports | Same |
| Nine variables removed from `.env.example` | None; nothing read them | None |
| Six components removed | None; nothing imported them | None |

No migration is added. No environment variable becomes required in
production. No route changes its path.

## State on 11 October 2026

| Item | State |
|---|---|
| PR #114 (cleanup) | Merged into `integration/consolidated-oct11`, merge commit `c2d3dbfc` |
| PR #113 (integration → `extension-redesign`) | Open, mergeable; merge blocked by the agent's permission system |
| Production deployment | `dpl_BA3wFtwBWXb68AbRMsmPbM2kmjGk`, commit `d3d7422e`; not changed |
| `FURLPAY_CREDENTIAL_SECRET` | Set in Vercel production as a sensitive variable (64 random characters). Takes effect on the next deployment. |
| GitHub Actions | Billing-locked; no job has executed |
| Upstash store | Over its plan limit; `/api/rails` still 503 |

### Credential key change

Setting `FURLPAY_CREDENTIAL_SECRET` replaces the in-repository key that
production has been using. After the next deployment, any reusable KYC
credential issued before it fails verification with "Signature mismatch".
That is intended: those credentials were signed with a public key and cannot
be trusted. A holder re-issues one with `POST /api/compliance/credential`
`{ "action": "issue" }`; issuing still requires a verified KYC status, so no
attribute changes. No database migration is involved. Do not restore the old
key on rollback: an older deployment reads the new variable too, because it
also takes the configured value first.

## Actions that need you

| # | Action | Why |
|---|---|---|
| 1 | Fix GitHub billing (Settings → Billing & plans) | CI cannot run; the deploy gate needs it |
| 2 | Upgrade `upstash-kv-cinereous-sail` in Vercel → Storage | `/api/rails`, `/api/x402/fx` and Telegram sign-in answer 503 |
| 3 | Run `DATABASE_URL=<read-only> node scripts/db/probe-schema.mjs` against production | Establish which migrations are applied; SELECTs only |
| 4b | Set `PROD_KV_HOSTS` to the production Upstash hostname in every Vercel scope | Lets the preview guard recognise the production Redis even when a preview declares isolation |
| 4 | Remove `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` (and the other `KV_*` / `REDIS_URL` entries) from the Vercel **preview** scope | The code now refuses them, but they should not be there |
| 5 | Optionally: create a preview Supabase project and Redis store, add their credentials to the preview scope, set `FURLPAY_DATA_PLANE=isolated` there | Gives previews working data without touching production |
| 6 | Set `FURLPAY_ALERT_SLACK_WEBHOOK` or `FURLPAY_ALERT_WEBHOOK_URL` in production | Alerts are currently delivered nowhere |
| 7 | Decide on the history rewrite for the 465 commit trailers | Proposal and impact in the audit; not executed |
| 8 | Review the account-lock exposure change (`6a40c440`) | It deliberately makes one route reachable without a session |
| 9 | Merge #113, then deploy | #114 was merged into the integration branch on 11 October (`c2d3dbfc`). Merging #113 was refused twice by the agent session's permission system, so it needs a person or an explicit permission rule. |

## Deployment sequence

Unchanged from the consolidation record, with one addition at the start:

0. Merge the cleanup pull request into `integration/consolidated-oct11`.
1. Probe the production schema (action 3).
2. Apply missing migrations in order, staging first. All are additive.
3. Confirm CI is green on the head of #113; merge #113 into `extension-redesign`.
4. `npm run deploy:prod` from a clean checkout of `extension-redesign`.
5. `npm run smoke:prod`.
6. Re-probe `/api/rails`, `/api/x402/fx`, `/p/<slug>`, `/api/checkout/merchant/<slug>`, Telegram sign-in, and the account-lock link while signed out (expect the handler's "invalid or has expired" page, not "Unauthorized" from the middleware).
7. Update the dated evidence in `apps/web/src/lib/productionStatus.ts`.

Merging into `extension-redesign` does not deploy: Vercel's production branch
is `main`, and production is updated by `npm run deploy:prod`.

## Release checklist

Status against the acceptance criteria raised in review. VERIFIED means a test
or a command on this branch shows it; anything else says what is missing.

| Area | Criterion | Status | Evidence |
|---|---|---|---|
| Isolation | Production credentials in a preview are never used | VERIFIED (code) | `dataPlane.spec.ts`: hostile scope combinations in preview and development |
| Isolation | Missing isolated configuration fails closed | VERIFIED (code) | Withheld credentials resolve to no database and a refusing key-value store |
| Isolation | No direct credential reader bypasses the guard | VERIFIED (code) | Property, bracket and destructured reads checked across `apps/web/src` |
| Isolation | Private PDF signed URLs cannot be minted from a blocked preview | VERIFIED (code) | No request is made |
| Isolation | The remote preview scope holds no production credentials | **NOT DONE** | Needs you: remove them on Vercel |
| Authorization | Cross-account payment listing is denied | VERIFIED | `paymentTenantIsolation.spec.ts` |
| Authorization | Cross-account detail is denied | PARTIAL | Session and key routes scoped; `/api/payments/{id}` is readable by id holders by design, ids verified unguessable |
| Authorization | API-key scope and ownership enforced | VERIFIED | Same suite |
| Authorization | Unauthenticated callers fail safely | VERIFIED | Same suite |
| Lock link | Invalid and expired tokens rejected | VERIFIED | `lockLink.spec.ts` |
| Lock link | Repeated or concurrent requests cannot bypass controls | VERIFIED | Same |
| Lock link | Automated prefetch does not lock | VERIFIED | GETs change nothing |
| Lock link | Rate limit; token not logged | VERIFIED | Rate limit tested; token absent from the audit record |
| Release | Required checks ran on the final commit | **NOT DONE** | GitHub Actions is billing-locked; only local runs exist |
| Release | Clean install and production build succeed | PARTIAL | `next build` passes locally on an existing install; a clean `npm ci` was not run (3 GB free disk) |
| Release | Migrations contiguous and deployment-compatible | PARTIAL | Contiguous and additive; production's applied set is unknown |
| Release | Preview smoke tests target the latest deployment | VERIFIED | Run against the preview built from the PR head |

## Revert safety

Each commit reverts on its own, but not every revert is safe:

| Commit | Safe to revert alone? |
|---|---|
| `77bfa851`, `ea8e4e9e`, `b26505d8` (isolation) | **No.** Reverting lets previews use production data again. Fix the preview configuration instead. |
| `653c69be` (payment listings) | **No.** Reverting restores the cross-account disclosure. |
| `6a40c440` (lock link reachable) | Yes, but it re-breaks the link for signed-out users. Revert `7bcd0cc6` first only together with it. |
| `7bcd0cc6` (confirm then POST) | **No**, unless `6a40c440` is reverted with it: alone it restores a locking GET reachable by scanners. |
| `9a507536`, `50f13f48`, `3bef57f4`, `82990e4a`, docs | Yes. |

The last known-good production deployment is `dpl_BA3wFtwBWXb68AbRMsmPbM2kmjGk`
(`d3d7422e`). Rolling back to it restores the payment-listing disclosure that
already exists there today; it does not make anything worse than the current
production state.

## Rollback

- **Code:** promote the previous production deployment
  `dpl_BA3wFtwBWXb68AbRMsmPbM2kmjGk` (`d3d7422e`) with `vercel rollback`.
- **One change only:** each cleanup change is a single commit and reverts
  cleanly on its own with `git revert <sha>`:
  `77bfa851` isolation, `653c69be` payment listings, `6a40c440` lock link,
  `7bcd0cc6` lock link confirm-then-POST, `ea8e4e9e` and `b26505d8` isolation hardening,
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
