# Production readiness: analytics, AWS edge, admin

**Date:** 2026-10-01.

**Scope:** this covers the working tree. Nothing is committed, deployed, applied or migrated.

**Status vocabulary** (only these words are used here):
- **FIXED**: implemented and proven by an executable test in this repository.
- **PARTIALLY_FIXED**
- **BLOCKED**: needs something outside the repository.
- **UNVERIFIED**: can only be proven against a live system we did not touch.
- **NOT_APPLICABLE**

Local evidence is never reported as a production result.

**Evidence sources** (paths relative to the repository):

| Evidence | Command | Result |
|---|---|---|
| **H1:** real PostgreSQL 18 (throwaway) | `scripts/db/verify-analytics.mjs` | 10/10 |
| **H2:** read-only production probe, run against a freshly migrated PostgreSQL 18 | `scripts/db/probe-schema.mjs` | every 0026/0027 object present; 10/10 privilege checks; exit 0 |
| **T:** web unit, integration and route tests | vitest | — |
| **E:** static edge-config checker, also run in CI | `scripts/aws/check-edge-config.mjs` | — |
| **TF:** Terraform 1.11.4 | `fmt -check` and `validate` in dev, staging, prod | — |
| **R:** local runtime | Next dev server, live HTTP and Playwright captures | — |

## 1. Findings

| ID | Severity | Area | Finding | Current state | Fix | Test | External dependency | Status |
|---|---|---|---|---|---|---|---|---|
| PR-01 | P1 | Analytics data | `trackAnalyticsEvent`, `trackPageView` and `UTMTracker` had no callers, so the original dashboard read keys nothing wrote | Real sources only; durable lifecycle events recorded at 10 real call sites | Migration 0027 `analytics_events`; `lib/analytics/events.ts`; instrumented OTP start/check, Google, Apple, passkey, logout, KYC start, Persona/Sumsub approval, cashback | `semantics.spec.ts`, H1 | Apply 0027 (staging, then prod) | FIXED (code), BLOCKED (prod migration) |
| PR-02 | P2 | Analytics perf | Metrics pulled up to 20,000 rows per query into memory every 15 s; geography made ~1,440 sequential Redis calls | Aggregation in Postgres; geography is 1 range read plus parallel `PFCOUNT` | 0027 functions; dashboard SQL-first with labelled row fallback | H1 benchmark (table below); `dashboard.spec.ts` both modes | Apply 0027 | FIXED (code), BLOCKED (prod migration) |
| PR-03 | P2 | Active users | Counted every audited actor, including admins | Non-admin audited actions only; definition displayed | `analytics_active_users` and the fallback filter `action not like admin.%` | H1; `dashboard.spec.ts` (mutant killed) | — | FIXED |
| PR-04 | P2 | Visitors | "Visited website" was untracked; nothing separated requests, visitors and accounts | Page views plus cookieless daily unique visitors; sessions explicitly not tracked | `classifyRequest`, `recordPageView`, Traffic panel | `semantics.spec.ts` | Deploy | FIXED (code), UNVERIFIED (prod traffic) |
| PR-05 | P2 | Funnel | Funnel steps had no source | Visitors and signup-starts shown as context; completed signup → KYC → wallet → first transaction is a real cohort. Starts before the first recorded event are "unavailable", not 0 | `funnelFrom`, `analytics_signup_cohort`, `analytics_signup_starts` | H1; `dashboard.spec.ts` | Apply 0027 | FIXED (code), BLOCKED (prod migration) |
| PR-06 | P3 | API metric | The request counter counted health checks, cron and admin polling | Customer `/api` only; definition displayed | `classifyRequest` | `semantics.spec.ts` | — | FIXED |
| PR-07 | P3 | Error rate | Numerator and denominator could cover different routes; 0% could appear with no observations | Same scope both sides; N/A when requests = 0 | `countsTowardApiErrorRate` | `semantics.spec.ts`, `analyticsRoutes.spec.ts` | — | FIXED |
| PR-08 | P2 | Admin page | A non-admin got HTTP 200 with a message | Real 403 (`forbidden()`, `experimental.authInterrupts`) | `app/forbidden.tsx`, `app/analytics/layout.tsx` | `units.spec.ts` (gate mapping); R | — | FIXED |
| PR-09 | P2 | Admin alerts | Every admin GET raised a high-severity "privileged action" alert | Categories `ADMIN_READ` / `ADMIN_MUTATION` / `ADMIN_AUTHORIZATION` / `ADMIN_SECURITY_EVENT` | `lib/adminAudit.ts`, `requireRole` | `semantics.spec.ts` (2 mutants killed) | — | FIXED |
| PR-10 | P3 | Privacy | Feed and alerts fetched `select=*` (payer and recipient addresses) | Explicit columns; pseudonymous ids; no PII column selected by any analytics query | `latestTx`, `latestSecurity` | `dashboard.spec.ts` (query-column assertions) | — | FIXED |
| PR-11 | P3 | Range bug | Events in the same millisecond as the query were excluded | Rolling ranges include "now" | `range.ts` | `analyticsRoutes.spec.ts`, `units.spec.ts` | — | FIXED |
| PR-12 | P2 | Public URLs | A production process could boot handing out loopback or bind-address URLs, or passkey rpID `localhost` | Boot refuses | `bootConfig.edgeTrustProblems` | `clientIpTrust.spec.ts` | — | FIXED |
| PR-13 | P3 | SSRF | Redirect, chain, rebinding and mixed-DNS behaviour was untested | Tested through a controllable transport | `safeFetch` transport hook (tests only) | `safeFetchRedirects.spec.ts` (19) | — | FIXED |
| PR-14 | P3 | Infra drift | Nothing stopped Terraform edits from re-breaking the edge | Static checker in CI | `check-edge-config.mjs` | E (mutant caught) | — | FIXED |
| PR-15 | — | Native parity | `native-app/node_modules` was empty | Installed exactly from its lockfile (`npm ci --ignore-scripts`); no test changed | — | `nativeParity.spec.ts` 72/72 | — | FIXED |
| PR-16 | P1 | Supabase schema | Production schema and migration history are unknown | Read-only probe ready | `probe-schema.mjs` (0026/0027 + privileges) | H2 | Production DB credentials | BLOCKED |
| PR-17 | P1 | AWS edge live | No deployment exists | Static proof only | Runbook steps 1–8 | E, TF | AWS account, ACM certificates | UNVERIFIED |
| PR-18 | P3 | Function invocations / latency | No source in the application | Shown as N/A with the reason | — | `analyticsRoutes.spec.ts` | Vercel / CloudWatch API | NOT_APPLICABLE (in-app) |
| PR-19 | P3 | Geography on AWS | No trustworthy country header behind CloudFront | N/A on AWS; Vercel only | `trustedClientCountry` | `units.spec.ts` | Add `CloudFront-Viewer-Country` via a custom origin request policy (would also need the viewer-supplied header stripped) | PARTIALLY_FIXED |

## 2. Metric definitions

Every number on `/analytics`, and nothing else:

| Metric | Source table / store | Column(s) | Filter | Range | Aggregation |
|---|---|---|---|---|---|
| Total users | `users` | `id` | — | all time | exact count (PostgREST `count=exact`) |
| New signups | `users` | `created_at` | `created_at` in range | range | count per bucket (`analytics_signup_cohort`) |
| KYC completed | `users` | `kyc_status` | `= 'verified'` | all time (trend: cohort) | count; no verification timestamp exists |
| Active users | `audit_log` | `user_id`, `action` | `user_id is not null`, `action not like 'admin.%'` | range | `count(distinct user_id)`, whole range and per bucket |
| Transactions | `ops_tx_events` | `state` | `state = 'settled'` (+ `rail` filter) | range | count |
| Volume | `ops_tx_events` | `amount_usd` | settled | range | sum; never from analytics events, page views or request logs |
| Fees / revenue | `ops_tx_events` | `fee_usd` | settled | range | sum |
| Failed | `ops_tx_events` | `state` | `failed`, `rejected` | range | count |
| Volume by token | `ops_tx_events` | `token`, `amount_usd` | settled | range | sum per bucket per token (top 4 + Other) |
| Product usage | `ops_tx_events` | `rail`, `user_id` | settled, `user_id` not null | range | `count(distinct user_id)` per rail and overall |
| Funnel: signup started | `analytics_events` | `subject` | `signup_started` | range | `count(distinct subject)`; OTP signups only; unavailable before the first recorded event |
| Funnel: KYC started / done | `users` (cohort) | `kyc_status` | `in (pending, verified)` / `verified` | signup cohort | count |
| Funnel: wallet linked | `linked_wallets` | `user_id` | exists for a cohort user | signup cohort | count |
| Funnel: first transaction | `ops_tx_events` | `user_id`, `state` | settled, after signup | signup cohort | count |
| Page views | Redis `ops:web:pv:<hour>` | — | GET app routes; not bots, prefetches, assets or admin pages | range | sum |
| Unique visitors | Redis HLL `ops:web:visitors:<day>` | HMAC(daily salt, trusted IP + UA) | as page views; needs a trusted IP | per UTC day | `PFCOUNT` per day; never summed across days |
| Sessions | — | — | — | — | not tracked (would need a consented cookie) |
| Geography | Redis HLL per country per day | pseudonymous user id | signed-in, Vercel only | range | `PFCOUNT` union over days |
| Customer API requests | Redis `ops:obs:req:<hour>` | — | `/api/*` except health, cron, ops; not HEAD/OPTIONS | range | sum |
| Error rate | Redis `ops:obs:err:<hour>` ÷ requests | — | unhandled exceptions in the same routes | range | ratio; N/A when requests = 0 |
| Alerts | `ops_security_events` + Redis error list | `kind, rail, severity, detail` | in range | newest 50 | — |
| Live feed | `ops_tx_events` (60), `users` (20), `ops_security_events` (20) | explicit display columns | newest | — | merged, sorted, top 60 |

**Failure handling:** every source failure becomes "No data / Unavailable" with the reason. There is no `|| 0` on any source result. A displayed 0 is always a measured 0.

## 3. Lifecycle event inventory

| Event | Decision | Where |
|---|---|---|
| Website visit / page view | Implemented (cookieless) | middleware → `recordPageView` |
| Signup started | Implemented: OTP code requested for an identity with no account (checked after the response) | `auth/otp/start` |
| Signup completed | Implemented | `auth/otp/check`, `auth/google`, `auth/apple` |
| Email verified | NOT_APPLICABLE: verification is the signup itself (OTP, or a provider-verified email) | — |
| Login | Implemented | OTP, Google, Apple, passkey |
| Logout | Implemented | `auth/logout` |
| KYC started / completed | Implemented | `compliance/verify`; Persona / Sumsub approval webhooks |
| Wallet linked | From `linked_wallets.linked_at` (already durable) | — |
| Wallet connected | NOT_APPLICABLE: browser-only, never reaches the server | — |
| Deposit / payment / swap started and completed | Financial: read from the ledger (`ops_tx_events` prepared/settled), never duplicated as analytics | — |
| Travel search / booking, card created / transaction | NOT_APPLICABLE until those rails are live (capability-gated) | — |
| Cashback claimed | Implemented (the money itself is in `claim_cashback`, 0026) | `membership/cashback/claim` |
| Investment / trading action | Not instrumented: brokerage is gated; add when live | — |
| API usage | Telemetry counter (customer API requests) | middleware |

Event properties:
- **Idempotent:** deterministic `event_id` with ignore-duplicates; a retried or redelivered event is a no-op.
- **Asynchronous:** written in `after()` with a 2 s bound and one retry, never on the request path. A dead analytics store cannot fail a login, payment, KYC callback or claim.
- **Never financial idempotency:** analytics IDs are not used to deduplicate money.

## 4. Performance (H1, PostgreSQL 18, local)

| Query | Data | Time |
|---|---|---|
| `analytics_signup_cohort` 90 days | 1K / 10K / 100K users | 12 / 24 / 156 ms |
| `analytics_tx_buckets` 90 days, daily | 1,000,000 ledger events | 419 ms (543 rows returned) |
| `analytics_tx_buckets` 24 h, hourly | 1,000,000 events | 13 ms |
| `analytics_rail_users` 30 days | 1,000,000 events | 642 ms |
| `analytics_active_users` 30 days | 100K audit rows | 85 ms |

The dashboard additionally caches one build per range and product for 15 s per instance, and polls one endpoint per 15 s with the polling paused while the tab is hidden. Production latency depends on Supabase sizing and is **UNVERIFIED**.

**Indexes added (0027), each backing one query above:**
- `users(created_at)`
- `audit_log(created_at)`
- `analytics_events(event_name, created_at)`

`ops_tx_events` already has `(created_at desc)` and `(rail, state, created_at desc)` from 0003.

## 5. Retention

| Data | Store | Retention | Mechanism |
|---|---|---|---|
| Page views, API requests, errors (counters) | Redis | 100 days | key TTL |
| Unique visitors, geography (HLL) | Redis | 100 days | key TTL |
| Error detail list | Redis | last 200 entries | `LTRIM` |
| Product lifecycle events | `analytics_events` | 400 days | `purge_analytics_events(now() - interval '400 days')`; needs a scheduled job (REMAINING) |
| Audit log | `audit_log` | compliance retention, set by policy, not by analytics | untouched |
| Security events, ledger | `ops_*`, `ledger_*` | financial/regulatory retention | untouched |

## 6. Privacy

**Stored:**
- Pseudonymous `user_id` (uuid). The UI shows `usr_ab12…ef34`.
- `subject`: HMAC of the canonical email or phone, so it can't be reversed without the server secret.
- Event name, route, and allowlisted metadata (`provider`, `channel`, `tier`, `method`).
- Country (aggregate HLL), daily-rotating visitor hashes, counters.

**Never stored or selected by analytics:**
- email, phone, name, IP address (only hashed, daily-salted);
- wallet addresses, tokens, cookies, OTPs, passwords, private keys, KYC documents or fields;
- URL query strings: routes are stored as path patterns only.

UTM capture was **not** added. `UTMTracker` remains unmounted. Attribution needs a consented first-party cookie (the repository's own consent model), and that is a product decision.

## 7. Operator procedures (not executed)

### Production schema verification (read-only)

```bash
# Supabase SESSION pooler or a read-only role. Runs only SELECTs.
DATABASE_URL='postgres://<ro-user>:<pw>@<host>:5432/postgres' \
  node scripts/db/probe-schema.mjs --json probe-prod.json
```

The probe reports:
- repository vs recorded migration history;
- every critical object, including 0026 and 0027;
- the RLS and privilege matrix;
- missing uniqueness guards.

Exit 1 means a money-path object is missing.

### Migration rollout

0027 must go to staging first, then production. Historical migrations are never edited.

```bash
# staging (tvdyfwceiecxwgqhcsge)
supabase link --project-ref tvdyfwceiecxwgqhcsge && supabase db push --dry-run && supabase db push
DATABASE_URL=<staging> node scripts/db/probe-schema.mjs          # expect 0027 objects ok + privileges ok
# production (iyarllmcednkbekweucd) only after staging verification and 0025/0026 are in
supabase link --project-ref iyarllmcednkbekweucd && supabase db push --dry-run && supabase db push
DATABASE_URL=<prod-ro> node scripts/db/probe-schema.mjs --json probe-prod.json
```

### AWS edge

See `docs/aws/RUNBOOK.md` §"Certificate procedure (operator)", steps 1–8.

## 8. Readiness table

| Area | Status | Evidence | Remaining action |
|---|---|---|---|
| Analytics data collection | FIXED (code) | 10 instrumented call sites; `semantics.spec.ts`; H1 | apply 0027; deploy |
| Visitor tracking | FIXED (code) | `semantics.spec.ts` | deploy; observe |
| Signup funnel | FIXED (code), BLOCKED (prod) | H1, `dashboard.spec.ts` | apply 0027; starts accrue from deploy |
| Active users | FIXED (code), BLOCKED (prod) | H1, mutant killed | prod `audit_log` durability (auditDb configured) |
| Transaction analytics | FIXED (code) | H1, `dashboard.spec.ts` | prod `ops_tx_events` verification |
| API metrics | FIXED | `semantics.spec.ts` | — |
| Error rate | FIXED | `semantics.spec.ts` | — |
| Geography | PARTIALLY_FIXED | `units.spec.ts` | AWS country source (PR-19) |
| Admin authorization | FIXED | `analyticsRoutes.spec.ts` (mutant killed); R (401/307/403/200) | — |
| Admin audit noise | FIXED | `semantics.spec.ts` (mutants killed) | — |
| Analytics privacy | FIXED | `dashboard.spec.ts` column assertions | — |
| Analytics performance | FIXED (local) | H1 benchmark | prod sizing UNVERIFIED |
| Client IP | FIXED (code) | `clientIpTrust.spec.ts` | live chain UNVERIFIED |
| CloudFront | UNVERIFIED | E, TF | deploy (runbook) |
| ALB | UNVERIFIED | E, TF | deploy |
| Origin protection | UNVERIFIED | E (prefix list, 404 default, secret rule) | runbook step 8 |
| ACM | BLOCKED | E, TF variable validation | request and issue both certificates |
| Public origin URLs | FIXED | `publicOrigin.spec.ts`, boot guard tests | — |
| SSRF | FIXED | `safeFetchPinning`, `safeFetchRedirects` | — |
| Supabase schema | BLOCKED | H2 (procedure proven) | run the probe with production credentials |
| Migration state | BLOCKED | `check-migrations` (28, contiguous) | compare with remote history |
| AWS Terraform | PARTIALLY_FIXED | fmt + validate (3 envs); plan not run | `terraform plan` with real inputs |
| Native parity | FIXED | 72/72 | — |
| Web tests | see checkpoint | — | — |
| Extension tests | see checkpoint | — | — |
| Production build | see checkpoint | — | — |

## 9. Top 10 remaining production blockers

1. **Production schema unknown.** `scripts/db/probe-schema.mjs` has never run against `iyarllmcednkbekweucd`. Needs production database credentials.
2. **0025 / 0026 / 0027 not applied anywhere hosted.** Money-path 0025/0026 come first; analytics 0027 after. See the rollout above.
3. **ACM certificates do not exist.**
   - `acm_certificate_arn` in us-east-1: `api*.furlpay.com`.
   - `alb_certificate_arn` in eu-west-1: `origin-api*.furlpay.com`.
   - Without both, the apply fails or CloudFront returns 502.
4. **No AWS deployment.** CloudFront → ALB → ECS, origin lock and the XFF hop model are proven statically only (`check-edge-config.mjs`). Runbook steps 7–8 are the live proof.
5. **`terraform plan` never run.** It needs the real hosted zone, certificate ARNs, image digest and state access.
6. **`audit_log` durability in production.** Active users depend on `auditDb` flushing to Supabase. Confirm rows exist with the probe, or with `select count(*) from audit_log where created_at > now() - interval '1 day'`.
7. **Analytics retention job.** `purge_analytics_events` exists but no cron calls it.
8. **Geography on AWS.** No trustworthy country source behind CloudFront (PR-19). The dashboard shows N/A there.
9. **CI billing lock.** GitHub Actions jobs have not started since 2026-09-28 (memory: `furlpay-actions-billing-lock`), so the new CI steps have not run on GitHub.
10. **Uncommitted tree.** About 100 files changed plus the staged rename and deletions. They need review and commit before any deploy gate (`npm run deploy:prod` refuses a dirty tree).

## 10. Round 2026-10-01: cross-platform analytics and zero-mock hardening

Architecture, contract, identity model and store-label inputs: `CROSS_PLATFORM_ANALYTICS_ARCHITECTURE.md`.

| ID | Sev | Finding | Fix | Test | Status |
|---|---|---|---|---|---|
| ZM-01 | P1 | `/status` hardcoded "All systems operational" and seven green rows regardless of reality | Rendered per request from `publicRailStatuses()` (pause state plus freshness-bounded health). If nothing recent is known, the page says so instead of guessing | `statusHeadline.spec.ts` | FIXED |
| ZM-02 | P1 | `/api/travel/alerts` was an ownerless global store under the public `/api/travel` prefix. Anyone could list or delete every alert anonymously | 503 `not_available` in production (`demoOnlyUnavailable`) | `demoGates.spec.ts` | FIXED (feature unavailable until owner-scoped) |
| ZM-03 | P2 | `/api/travel/restaurants` served generated venues | 503 in production | `demoGates.spec.ts` | FIXED |
| ZM-04 | P2 | `/api/travel/destinations/[slug]` attached invented prices for stays, flights and activities | Production returns curated facts only, with `listings: "unavailable"` | `demoGates.spec.ts` | FIXED |
| ZM-05 | P2 | `/api/wallets` constructed `AccountKit({ mock: true })` only to read a constant | Constant used directly | typecheck, web suite | FIXED |
| ZM-06 | P3 | `ledger.nextTxId` used a `Math.random` suffix (AGENTS rule 6) | `crypto.randomUUID()` | ledger specs | FIXED |
| ZM-07 | P3 | EVM and Solana adapters reported a fake healthy status when not live | Now report `healthy: false` with an error. The adapters are dead code: no importers, and a ratchet test forbids importing them | adapter specs | FIXED |
| ZM-08 | P3 | The flights page source state defaulted to `"demo"` | Defaults to `null` | build | FIXED |
| XP-01 | P1 | No cross-platform event path. The native analytics sink was never registered, so mobile events went nowhere | Built: one contract, ingestion API, 0028, `user_devices`, and sinks for web, extension and mobile | 28 + 6 + 9 + 9 tests, PostgreSQL 15/15 | FIXED (code), UNVERIFIED (deployed) |

Verification for this round (local):

| Check | Result |
|---|---|
| Web typecheck / lint | 0 errors / clean |
| Web vitest | 6,115 passed, 0 failed, 31 skipped (opt-in PostgreSQL / EDGAR / FIGI specs; PostgreSQL concurrency run separately: 13/13) |
| Web production build | OK |
| Extension | typecheck 0; 176/176 |
| Native | typecheck 0; jest 115 suites / 1,829 tests |
| PostgreSQL 18 (fresh, 28 migrations) | analytics 15/15; money 26/26; `probe-schema` exit 0 |
| Migrations | `check-migrations`: 28, contiguous |
| Env and edge | env contract 24 variables; `check-edge-config` OK |

Not exhaustively audited: about 250 remaining files that mention "mock" or "demo". Most are tests, dev-only fixtures or capability-gated routes. They were triaged by grep, not read line by line. Native `demoSignature()` (`native-app/lib/api.ts`) was inspected: its only caller posts to `/api/wallets/transfer`, which returns 503 in production before auth, pinned by `durability.test.ts`. It is not a production path.

Blockers added to §9:
- Apply **0028** after 0027 (staging, then production).
- Update the App Store privacy label and the Play Data Safety form for product interaction, versions and the app-scoped installation ID. BLOCKED (human).

Note on the money harness count: §10 quoted 26/26. The same harness, extended, reports **47/47** on 2026-10-01 (§11).

## 11. Commit-readiness pass (2026-10-01, later the same day)

This pass reviewed the diff, re-tested and partitioned the work. Nothing is committed, pushed, deployed or migrated. The staged `/analytics → /spending` rename and the two `kycStateMachine` deletions were not touched.

### Defects found and fixed in this pass

| ID | Sev | Finding | Fix | Test | Status |
|---|---|---|---|---|---|
| CR-01 | **P0** | `merchantWallet()` fell back to the System Program address (`1111…1111`) when `MERCHANT_SOLANA_WALLET` was unset, in every environment. Blink payments are mainnet USDC/SOL transfers that a real wallet signs; nobody holds a key for that address, so funds sent there are unrecoverable | Fails closed (`MerchantWalletNotConfiguredError`), including a treasury set *to* the System Program; both Blinks map it to 503 | `fabricatedSurfaces.spec.ts`; a mutant restoring the fallback is caught | FIXED |
| CR-02 | **P0** | `/api/actions/pay/[orderId]`: `getOrder()` returns `$25` for **any** order id because there is no order store. Production would build a real payment for an order nobody created | 503 `not_available` in production for GET and POST, with the Action CORS headers | same; a mutant removing the gate is caught | FIXED (unavailable until orders are real) |
| CR-03 | **P0** | `/api/actions/book-car`: the Blink charged USDC for a car generated from a hash of the city name; no rental provider exists | 503 in production for GET and POST | same | FIXED (unavailable) |
| CR-04 | P1 | The `/travel/destinations/[slug]` **page** (statically generated) rendered generated stays, flights and activities with invented prices. Only the API twin had been gated (ZM-04) | The production build renders no generated listings and links to the live searches | built HTML: 15/15 destination pages carry the note, with no price markup | FIXED |
| CR-05 | P1 | Discord and Telegram `/flights` posted generated fares publicly as FurlPay | Production replies with a link to the live flight search and no price | `fabricatedSurfaces.spec.ts` | FIXED |
| CR-06 | P1 | Business travel routes | 503 in production for all three; Zod bodies and tighter rate limits (AGENTS rule 1) | `fabricatedSurfaces.spec.ts` | FIXED (unavailable until teams are owned) |
| CR-07 | P2 | Analytics `hasCredential` treated **any** `Authorization` header or an empty cookie as signed in. `Authorization: Basic x` bought 4× the anonymous budget while being stored anonymously | Uses the same test as `optionalUser` (`tokenFromRequest`) | `ingestion.spec.ts` (failed before the fix) | FIXED |
| CR-08 | P2 | Analytics privacy gaps | Personal-data values dropped; such segments become `:id`; identity keys compared case- and separator-insensitively | `ingestion.spec.ts` | FIXED |
| CR-09 | P2 | Migration 0028 was not re-runnable | Drops every constraint it adds; the backfill touches only rows the default made inconsistent | PostgreSQL 18: applied twice on a populated table; rows unchanged; client completions still refused | FIXED |
| CR-10 | P3 | `docs/release/env-contract.json` (the generated operator view) was stale by 41 lines and nothing checked it | Regenerated; `check-env-contract.mjs` now fails on a stale doc (CI already runs it) | stale copy → exit 1, fresh → exit 0 | FIXED |
| CR-11 | P3 | `trip-match` labelled a deterministic catalogue match `source: "demo"`, and the `travel/search` 400 response carried `source: "demo"` | Relabelled `catalogue`; the label was removed from the 400. No client reads it | web suite | FIXED |

CR-06 covers three routes:
- `/api/travel/business/team`:
  - an anonymous POST created teams with a self-declared `walletUsdc` and arbitrary member emails, with no Zod and an unbounded in-memory Map;
  - GET exposed members' emails.
- `/policies`: an anonymous PATCH could rewrite any team's approval threshold and MCC locks, with no Zod.
- `/reports`: assigned the caller's trips to "employees" by position (`members[i % n]`).

CR-08 closed three gaps:
- Allowlisted metadata keys accepted any string, including an email, a wallet address, or a card or phone number.
- Short route segments containing an email were kept.
- Identity-claim keys were case-sensitive, so `UserId` and `EMAIL` passed.

CR-09 had two parts:
- 0028 dropped only 2 of the 8 CHECK constraints it adds.
- Its backfill would reclassify `system` rows on a re-run.

### Second mock/demo audit (targeted)

The audit covered 395 non-test web files that mention mock/demo/fake/simulated/placeholder, plus the native app, the extension and `packages/*`.

**API routes (90):**
- 37 carry an explicit gate (`capabilityMode`/`capabilityUnavailable`, `cardIssuerOr503`, `liveOr503`, `mockAllowed`, `demoOnlyUnavailable` or 503).
- 37 mention mock/demo only in comments.
- The 16 with in-code mentions were read individually:

| Category | Items |
|---|---|
| SAFE | `transactions/prepare` + `transactions/authorize`: pre-flight tx simulation, a real feature. `hackathon/submissions`: the `demoUrl` field. `webhooks/persona` and `webhooks/sumsub`: the word "demotion". `cards/*`: comments only. `ops/readiness`: text saying brokerage refuses simulated fills. `security/scan`: provider status |
| GATED | `agents/keys` anonymous "demo key": resolves only through `getDevelopmentDemoAccount()`, which is `undefined` in production, so escrow returns 401 |
| UNAVAILABLE (prod 503) | travel alerts, restaurants and destinations API (ZM-02..04); business team, policies and reports (CR-06); the pay and book-car Blinks (CR-02/03) |
| REVIEW | `security/simulate` and the catalogue average prices (below) |
| BLOCKER | none remaining after CR-01..06 |

The two REVIEW items:
- **`security/simulate`:** advisory screening, but the body is parsed without Zod (AGENTS rule 1) and the risk signals are client-asserted.
- **Catalogue average prices:** `avgHotelUsd`/`avgFlightUsd` are hardcoded editorial numbers in the curated destination catalogue. The destinations API and `trip-match` expose them; the page deliberately hides them. This is a product/content decision.

**Other surfaces:**
- **`simulated: true` routes (10):** account/spend, bills, investing/schedule, rewards/claim, referral/track, card provisioning, travel cards, apple-pay, gasless and offramp (offramp returns an error, not a fill). All sit behind a capability, issuer, `liveOr503` or `mockAllowed` gate.
- **Synthetic travel generators:** the 10 call sites known to the `check-no-synthetic-travel` CI ratchet are now all production-gated: the destinations API and page, book-car, Discord, Telegram and alerts.
- **`packages/*` mock modes** (account-kit, agent, auto-invest, mastra): SDK demo modes that no app imports. SAFE.
- **Native:**
  - `demoSignature()` posts only to `/api/wallets/transfer`, which returns 503 in production before auth (pinned by `durability.test.ts`).
  - Card provisioning is labelled `simulated` and gated on the server.

**Not read line by line:** about 300 non-route files that mention mock/demo (UI copy, comments, gated service internals). They were triaged by pattern only.

### Migration safety (0024–0028)

All five are uncommitted and applied nowhere hosted. That includes 0024, which re-ships the 0022 hash guard forward-only.

| Migration | Destructive? | Locking / risk | Re-runnable | Notes |
|---|---|---|---|---|
| 0024 | no | `create or replace function` only | yes | same signature as 0022 |
| 0025 | The `delete from holdings/cards/bills/contacts` statements live **inside** `save_account_children` (replace-children semantics, unchanged behaviour), not at top level | `create unique index ledger_tx_external_ref_uniq` is not `CONCURRENTLY` (migrations run in a transaction), so it takes a SHARE lock on `ledger_transactions` for the build. The column is new and all-NULL, so the build is fast and cannot fail on duplicates | `if not exists` / `or replace` | money path; apply before 0026 |
| 0026 | no | new table plus functions | yes | |
| 0027 | no | `users_created_at_idx` is built non-concurrently (small table). **`audit_log_created_at_idx` is now guarded** (§12): built in the migration only when `audit_log` is under 256 MB; otherwise skipped with a NOTICE, for the operator to build `CONCURRENTLY` | yes | if the NOTICE appears: `create index concurrently if not exists audit_log_created_at_idx on audit_log (created_at);` |
| 0028 | Drops and re-adds CHECKs on `analytics_events` (created by 0027); full-table `update` backfill | `analytics_events` is new, so the cost is tiny when 0027 and 0028 ship together | **yes** (CR-09) | Adding columns with constant defaults does not rewrite the table on PG ≥ 11 |

**Rollback:** there are no down-migrations; the repo is forward-only.
- 0026–0028 are additive. Rolling them back means dropping the new objects; only the new code depends on them.
- 0025 stops `save_account_children` from writing a balance. Rolling it back without the code would reopen that hole.

**Staging procedure (prepared, NOT executed; this session has no staging credentials):**
1. Take a snapshot.
2. Run `probe-schema.mjs` read-only.
3. Apply 0024, 0025, 0026, 0027 and 0028 in order to `tvdyfwceiecxwgqhcsge`.
4. Re-run the probe.
5. Run `select furlpay_missing_constraints()`.
6. Smoke-test signup, login, an analytics event and a cashback claim.

Production (`iyarllmcednkbekweucd`) comes only after staging passes, and only with explicit authorization.

### AWS / edge readiness

Static only. No AWS account, state or credentials were touched.

| Item | Status | Evidence |
|---|---|---|
| Terraform syntax + provider locks | STATIC-ONLY, pass | v1.11.4 (`.terraform-version`). `fmt -check` is clean. `init -backend=false -lockfile=readonly` plus `validate` pass for dev, staging, prod and org |
| CloudFront → ALB TLS name, certificate regions, origin lock, XFF hop model, caching | STATIC-ONLY, pass | `check-edge-config.mjs` |
| ALB ingress | STATIC-ONLY, pass | CloudFront managed prefix list only; TLS 1.3 policy; deletion protection set by variable |
| WAF | STATIC-ONLY | `enable_waf` toggle; not deployed |
| ECS | STATIC-ONLY, pass | `assign_public_ip = false`; non-root 1000:1000; read-only root filesystem; image health check |
| Aurora / ElastiCache | STATIC-ONLY, gated off | `enable_aws_data_plane = false`. Encrypted at rest (KMS) and in transit. `final_snapshot_identifier` drift is handled by `ignore_changes` |
| IAM | STATIC-ONLY | two documented `"*"` resources: actions with no resource scope, one of them tag-conditioned |
| Egress | STATIC-ONLY | tasks egress to `0.0.0.0/0` by design (Supabase, Upstash, providers); see `docs/aws/EGRESS.md` |
| Env contract | STATIC-ONLY, pass | 24 variables; the task definition and the application agree; the operator doc is fresh (CR-10) |
| Dockerfile | STATIC-ONLY | reviewed; **not built** (no Docker run in this session) |
| ACM certificates | BLOCKED | do not exist; need issuance in us-east-1 and eu-west-1 |
| `terraform plan` / apply | BLOCKED / UNVERIFIED | needs S3 backend state, the hosted zone, certificate ARNs and the image digest |
| CloudWatch alarms / dashboards | UNVERIFIED | defined in `monitoring.tf`; never deployed |
| Live CloudFront / ALB / origin-verify chain | UNVERIFIED | runbook steps 7–8 |

Nothing here is VERIFIED live.

### Verification (this pass, local, after all fixes)

| Suite | Result |
|---|---|
| Web typecheck / lint | exit 0 / "No ESLint warnings or errors" |
| Web vitest | **6,127 passed, 0 failed, 31 skipped** (opt-in specs that need external services: PostgreSQL concurrency, EDGAR, FIGI) |
| Web production build (`npm run build`, including prebuild `check-claims`) | exit 0. 8 warnings, all `bigint: Failed to load bindings, pure JS will be used` (a native-addon fallback, not from this work) |
| Extension | typecheck 0; vitest 176/176 |
| Native | typecheck 0; jest 115 suites / 1,829 tests |
| Root workspace tests (`npm test`, 6 packages) | 458 passed, 0 failed |
| PostgreSQL 18, fresh, 25/28 migrations (3 PostGIS skipped) | money harness **47/47**; analytics 15/15; `probe-schema` exit 0; 0028 double-apply PASS |
| `check-migrations` + its tests | 28 contiguous, none modified since HEAD; 3/3 |
| `check-env-contract`, `check-edge-config`, `eas-profile.test.sh`, `check-no-synthetic-travel` | all pass |
| Terraform `fmt` / `validate` | pass, 4 roots |

The analytics PostgreSQL run's process exited 1 because embedded-postgres hit Windows `EBUSY` deleting its temporary data directory after the checks. The report (15/15, 0 failed) and the probe (exit 0) had already been written.

### Commit structure (proposed; NOT committed)

**Groups A (analytics) and B (hardening) cannot build as separate commits.**
- A uses new exports from 7 B files: `supabase.ts`, `kv.ts`, `store.ts`, `authz.ts`, `clientIp.ts`, `adminAudit.ts`, `financialAlerts.ts`.
- 13 B files import `@/lib/analytics/*`.

**Options:**
- (a) commit A and B together;
- (b) two commits, where only the second builds;
- (c) hunk-split patches.

The staged rename and deletions will land with whichever commit is made first. That should be A, because the rename is part of the `/analytics` move.

## 12. Integrated commit (2026-10-01): Option A approved

The owner approved one integrated commit, including `infra/aws/org/` (as **code only**) and `docs/release/env-contract.json`. The pre-commit state is backed up outside the repo at `~/.furlpay-verify/precommit-oct1/`: the status, staged diff, unstaged diff and an untracked tarball.

### Changes in this pass

| ID | Sev | Change | Evidence |
|---|---|---|---|
| IC-01 | P3 | `security/simulate` validates its body with Zod (AGENTS rule 1). Before this, a non-numeric `valueUsd` became `NaN` and reached the classifier. No client calls the route | `simulate.spec.ts` (5) |
| IC-02 | P2 | 0027 `audit_log_created_at_idx` is guarded: built in-migration only when `audit_log` is < 256 MB, otherwise skipped with a NOTICE for an operator `CREATE INDEX CONCURRENTLY`. This removes the risk of blocking writes on a large production `audit_log`. 0027 was never committed or applied, so no history changes | PostgreSQL 18: small-table build, large-table skip with NOTICE (threshold forced to 0), re-run no-op |
| IC-03 | P2 | Org SCP region deny now exempts the AWS reference set of global / us-east-1-only services (billing, Cost Explorer, Health, Trusted Advisor, Shield, account, pricing, S3/EC2 discovery reads). Before, these would have broken in every member account | `terraform fmt` / `validate` |
| IC-04 | P4 | `infra/aws/org/README.md`: blast radius, irreversibility (Object Lock COMPLIANCE, 7 years), SCP without an exemption role, `aws/s3` key limitation, apply prerequisites | — |
| IC-05 | P3 | `env-contract.json` drift caught by the new staleness check after CR-04/05 added `NODE_ENV` reads; regenerated | check exit 1 → 0 |

### Not run, and why

`terraform plan` was not run. AWS credentials exist on the workstation (`~/.aws`; contents not read), but no target was named as safe, and a plan against `envs/*` or `org` reads the real account and state. It stays BLOCKED pending an explicit target.

### Verification for the commit (local)

| Suite | Passed | Failed | Skipped | Warnings |
|---|---|---|---|---|
| Web `tsc --noEmit` / `next lint` | exit 0 / exit 0 | 0 | — | 0 |
| Web vitest | 6,132 | 0 | 31 (opt-in external-service specs) | 1 vite dynamic-import warning (`schedulerContract.spec.ts`) |
| PostgreSQL concurrency spec (opt-in, `FURLPAY_PG_CONCURRENCY=1`) | 13 | 0 | 0 | first attempt failed at startup: an orphaned test `postgres.exe` from earlier in the session held port 55433. Stopped; re-run passed |
| Web `npm run build` (incl. `check-claims`) | exit 0, 447/447 pages | 0 | — | 6 `bigint` native-binding fallback |
| Extension tsc / vitest | exit 0 / 176 | 0 | 0 | 0 |
| Native tsc / jest | exit 0 / 1,829 (115 suites) | 0 | 0 | 10 `console.warn` emitted by tests on purpose |
| Root `npm test` (6 packages) | 458 | 0 | 0 | — |
| PostgreSQL 18 money harness | 47/47 | 0 | 3 PostGIS migrations not applied | — |
| PostgreSQL 18 analytics harness + `probe-schema` | 15/15, probe exit 0 | 0 | — | — |
| 0027 guard + 0028 double-apply | PASS | 0 | — | — |
| `check-migrations` (+3 tests), `check-env-contract`, `check-edge-config`, `eas-profile.test.sh`, `check-no-synthetic-travel` | all pass | 0 | — | — |
| Terraform 1.11.4 `fmt -check`, `validate` (dev, staging, prod, org) | pass | 0 | — | — |
| Secret pattern scan, 272 changed files | 0 secrets; 2 test-fixture constants | — | — | — |
| `git diff --check` with `cr-at-eol` | clean | — | — | CRLF lines match the repository's existing CRLF files |

**Analytics boundary re-confirmed.** Only `lib/analytics/{ingest,events,dashboard}` and the admin panel read or write `analytics_events` / `user_devices`. No money, KYC, settlement or reward code (TypeScript or SQL 0025/0026) references them.
