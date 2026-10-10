# Telegram database review — 10 October 2026

Source: `feat/telegram-mini-app`, reviewed base `ffe1da36e49f17b8b64c228ee0687bb69375b73e`. All changes for this review are in that worktree. No production deployment or remote migration was performed.

## Inventory and the 80 / 93 discrepancy

The branch defines **92 public application tables in 41 migrations**, plus 11 application views. The requested approximately 80 is not the current repository count. The [complete inventory](../../supabase/schema/README.md) lists every table, its defining migration and foreign-key dependencies. All 92 have a generated definition file in `supabase/schema/tables/`; these preserve the original CREATE TABLE SQL and link subsequent constraints, indexes, policies, grants, functions and application references by source line and statement hash. They are documentation/code-review artifacts, not a duplicate migration chain.

The stated staging count of 93 is **not independently verified in this session**. A plausible explanation is 92 application tables plus PostGIS's `spatial_ref_sys`, which must not be recreated as an application table. This remains a hypothesis until the catalog probe identifies extension ownership. Views, Supabase internal schemas, and the separate SQLite schema in `chaintracker/src/db/schema.ts` are distinct inventories, not missing Supabase tables.

No statically resolved application database reference lacks a defining table or view. Five dynamic adapter calls need manual tracing; they resolve to existing tables: the dashboard's `one()` helper reads `ops_tx_events`, `ops_security_events`, and `onchain_events`; USDC series chooses `usdc_hourly` or `usdc_daily`; `storeDb`'s `sync()`/`prune()` helpers operate on the account-child tables already defined by the migration chain. The generator preserves these unresolved call sites instead of inventing definitions.

Versions **0040–0048 are absent from this branch**. Their existing repository definitions are on `feat/sui-collection`, captured at commit `63ea251ec284826bf83a56b31690b0dda25db338` in [the provenance inventory](../../supabase/schema/missing-branch-migrations.json). They introduce 16 merchant/payroll tables and alter related functions. They were not imported blindly, renumbered, replaced with no-ops, or applied. Combining the branch inventories would exceed 93; it would not explain the count by itself. Review and reconcile the actual applied history before integration. The existing contiguous-migration gate correctly remains red.

## Staging and production evidence

- Staging project supplied by the owner: `tvdyfwceiecxwgqhcsge`.
- Production project supplied by the owner: `iyarllmcednkbekweucd`.
- The authenticated Supabase CLI's project list contained only unrelated projects.
- The targeted read-only staging query was attempted with `supabase db query --linked --project-ref tvdyfwceiecxwgqhcsge --file scripts/db/schema-catalog.sql`. It failed: **“IPv6 is not supported on your current network”**, followed by the CLI's instruction to link the project for an IPv4 connection. No linking, credentials changes or remote SQL writes were performed.
- No `STAGING_DATABASE_URL` was configured. Staging table count, applied migrations, privileges, and staging/production differences remain unknown. A healthy production database probe does not establish schema parity.

Configure an IPv4 session-pooler connection for a read-only staging role in the local `STAGING_DATABASE_URL` environment variable, outside source control, then run:

```sh
node scripts/db/probe-inventory.mjs --output staging-catalog.log
```

The probe refuses the production project and unknown connection targets. It requires verified TLS (`sslmode=verify-full`, set automatically when absent), rejects query parameters that override the checked host/user or read-only options, and limits statement duration to ten seconds. It uses read-only transactions and only reads schema metadata and migration versions, never application rows. It distinguishes extension tables, checks columns, constraints, indexes, policies and privileges, and reports public SECURITY DEFINER functions and readable views. Imported snapshots are explicitly labeled unverified offline data. Use the catalog and applied history to settle the count and branch integration before any remote DDL.

## Changes and security findings

1. Missing Redis credentials now produce **503 on sensitive production buckets**, including Telegram authentication/link changes and money movement. Configured Redis outages remain fail closed; ordinary reads and development retain bounded fallback limits.
2. Telegram's server-verified identity limit now matches migration 0050's 52-bit bound. Invalid, stale, spoofed, bot and replayed identities remain rejected. Request bodies accept only signed `initData`; unsigned `user`, `userId`, and `initDataUnsafe` never prove identity.
3. Added route and database regressions for limit refusal, expired data, missing production replay storage, identity uniqueness, FK ownership, account deletion, RLS and anonymous/authenticated denial.
4. Corrected extension imports that treated `IconName`, `SessionState`, `Tab`, `Range`, and `AmountCandidate` as runtime exports. Explicit type imports let the pinned bundler build the extension.
5. Added deterministic inventory generation/drift checking and a CI step for the inventory/probe tests.

The local full-schema audit applies 38 migrations to **89 tables** in an ephemeral PGlite database. It supplies a minimal Supabase Storage prerequisite; it does not simulate PostGIS. Migrations 0012, 0013 and 0015 (three geographic tables) are explicitly unverified locally. All tested application tables have RLS, no public row policies, valid constraints and primary keys. No application SECURITY DEFINER function remains executable by public roles after the canonical migration chain.

**Ten financial/control-plane views still inherit public SELECT access under Supabase-style default grants.** RLS on underlying tables does not protect owner-executed views. The canonical audit intentionally fails on this finding. A synthetic ledger balance was readable by `anon` before the proposed permissions patch.

[restrict_sensitive_views.sql](../../supabase/proposed/restrict_sensitive_views.sql) is a **proposed, unapplied patch**, kept outside the active migration directory until staging history and version allocation are reconciled. It revokes PUBLIC/anon/authenticated access to the ten views and retains service-role SELECT, without changing table definitions or data. After applying it only in the disposable database, all 11 application views rejected both public roles (22 refusals), all 11 remained readable to the service role, and the synthetic balance was unchanged. Reapplication also passed.

The audit lists 18 foreign keys without an unconditional leading index. These are review candidates, not proof that 18 new indexes are needed: partial indexes and actual workload must be evaluated on staging first. No speculative indexes were added to a live database.

Reproduce locally:

```sh
node scripts/db/inventory.mjs --check
node --test scripts/db/inventory.test.mjs scripts/db/check-migrations.test.mjs scripts/db/probe-schema.test.mjs
node scripts/db/verify-local-catalog.mjs
# Expected to fail until the public view grants are fixed in the active chain.
node scripts/db/verify-local-catalog.mjs --with-proposed-view-fix
# Applies the proposal only to fresh in-memory PostgreSQL; no network credentials.
```

## Validation results

| Check | Actual result |
| --- | --- |
| `cd apps/web && npx tsc --noEmit` | PASS, exit 0, pinned TypeScript 5.5.3 |
| `npm run lint --workspace @furlpay/web` | PASS, no ESLint warnings/errors |
| `npm run build` | PASS, all 18 tasks; root script excludes the desktop app |
| `npm test --workspace @furlpay/web -- --maxWorkers=4` | PASS, 492 files, 7,679 tests; 9 files / 51 tests skipped; exit 0 |
| Telegram, limiter and readiness targeted suite | PASS, 91 tests in 10 files |
| Inventory, migration-check and probe Node tests | PASS, 12 tests |
| Generated inventory drift | PASS, 92 tables, zero missing static definitions and zero drift |
| Route security invariants | PASS, 235 routes, zero failures/warnings |
| Synthetic travel check | PASS, no new synthetic data; existing baseline remains |
| Canonical migration hygiene | **FAIL**: expected 0040, found 0049; expected 0041, found 0050 |
| Disposable canonical schema audit | **FAIL**: ten publicly readable sensitive views; 38 migrations applied, three PostGIS migrations unverified |
| Disposable schema with proposed permissions patch | PASS for the tested 89 tables / 11 views; 22 public-role refusals; service reads and synthetic data preserved |
| Real staging / production schema parity | **NOT VERIFIED**: staging connection unavailable; no remote migrations applied |

The first complete-suite attempt had a worker startup timeout while the production build was running. The standalone rerun completed without worker errors or test failures; no test was skipped or disabled to obtain that result. Existing Vite configuration/dynamic-import notices, Next.js workspace-root inference and a Turbo extension-output warning remain nonfatal tooling warnings. Dependency lockfiles and canonical migrations are unchanged. A limited secret-pattern scan of the 120 changed/new files found no Telegram tokens, GitHub tokens, JWT secrets or private keys; this is not a credential-rotation verification.

Local checks do not establish a green GitHub CI run. The CI workflow triggers on release/main pushes or pull requests, not this feature-branch push, and the existing migration gap must be resolved before release. The complete required real-PostgreSQL CI suite has not been represented as passing locally.

## Production baseline (read-only, before any release)

Vercel project `web`, ID `prj_GfsErb6LCHB1pbJPuLsSTeiagiOQ`, root `apps/web`, was verified. `furlpay.com` points to existing deployment `dpl_SGe8rNfYsDUrVt1jrK14cjhi8U2K`, status **READY**, deployment URL `https://web-49pzbab24-ashutoshs-projects-754ff406.vercel.app`. Vercel metadata identifies its commit as `eca878c0b3912747ea12ae055ffb8fec3645b3de`, branch `release/partners-on-prod`. This is not the reviewed Telegram release.

| Production path | HTTP | Actual response summary |
| --- | --- | --- |
| `/telegram` | 307 | Redirects to `https://t.me/FurlpayBot`; Mini App not live |
| `/telegram/home` | 404 | HTML not found |
| `/telegram/cards` | 404 | HTML not found |
| `/telegram/pay` | 404 | HTML not found |
| `/telegram/activity` | 404 | HTML not found |
| `/telegram/wallet` | 404 | HTML not found |
| `/telegram/profile` | 404 | HTML not found |
| `/telegram/travel` | 404 | HTML not found |
| `/telegram/bot` | 404 | HTML not found; bot redirect not deployed |
| `/api/miniapp/account` (no authentication) | 401 | `Unauthorized` |
| `/api/health/ready` | 503 | `ready:false`, KV `down`, category `plan_limit`; database `ok` |

The repeated health response was timestamped `2026-10-10T09:37:21.767Z` (15:07:21 IST), with the same failures as the earlier check. These are baseline checks, not a successful post-deployment verification. The 401 demonstrates rejection at the existing authentication boundary; it does not prove the undeployed Mini App route is installed.

## Release blockers and exact next actions

1. **Staging access/schema reconciliation:** connect the authorized staging account over an IPv4 session pooler; run the catalog and migration-history probe. Confirm whether the 93rd table is extension-owned and reconcile versions 0040–0048. Then assign an additive migration version to the reviewed view-permission patch and test the complete chain on real PostgreSQL/PostGIS. Production migrations require the owner's explicit approval.
2. **Rate limiter health:** the production dependency returns `plan_limit`. The owner must resolve the provider quota/billing issue, then verify readiness returns 200 with both KV and database `ok`. Do not disable rate limiting.
3. **Environment isolation:** Vercel metadata shows the same Redis variable records scoped to Production, Preview and Development. Isolation is therefore not satisfied. Configure separate nonproduction Redis resources/credentials through the approved operator process. Supabase and session secret entries are separately scoped, but their underlying values were not exposed or compared; complete isolation is not proven.
4. **Token rotation:** commit `b3300675` records removal of a previously committed live Telegram token. Removing a fixture is not rotation. Vercel token metadata predates that incident, so rotation is unverified. The owner must revoke the exposed token using BotFather, update the production secret through a secure channel, and verify bot identity. Never place the token in a PR, report or command output.
5. **Release branch/CI:** no CI run was found for reviewed base `ffe1da36`. The gate says: **“production deploys only from extension-redesign, and HEAD is on feat/telegram-mini-app”**. Review and integrate the necessary fixes into `extension-redesign`, resolve the migration gap without weakening the gate, push, and obtain a successful CI run for the exact release SHA.
6. Only after all above checks pass, reconfirm the project/domain and run **`npm run deploy:prod` from the release repository root**. Verify Vercel READY, exact commit provenance, production alias and all 11 requested URLs. No force flag or alternative deployment path is authorized.

Pushing this feature branch publishes reviewable code; it is not approval to change production, apply the proposed SQL, or bypass the release gate.
