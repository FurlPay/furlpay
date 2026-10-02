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

## 13. Profile settings, usernames, travel checkout (2026-10-01, after 60d75d5; UNCOMMITTED)

| ID | Sev | Finding | Fix | Evidence |
|---|---|---|---|---|
| UI-01 | **P0** | `POST /api/travel/book` had no production gate, but its payment authorization is simulated (`x402_sim_` proof, random card last-4), so it would confirm a non-existent booking | 503 `not_available` in production (`demoOnlyUnavailable`); checkout shows that honestly. Dev unchanged | `demoGates.spec.ts` |
| UI-02 | P1 | Checkout showed invented values: a hardcoded "1,240.50 USDC" balance, a `$540` / 3-night fallback with no amount, and "2 adults" / "1 adult" that no page passes. Activities and cars were labelled "Room rate (N nights)" | Real USDC balance from `/api/overview` (insufficient or signed out → disabled with reason); no amount → "Nothing to check out"; no traveller count; per-kind labels (`kind=activity`/`car` now passed) | `checkout.spec.tsx` (11) |
| UI-03 | P1 | "Visa · Mastercard · Amex" on Credit / Debit Card. Travel checkout has no card processor; that option issued the same simulated virtual Visa as the virtual-card option | Card option shown as "Not connected yet" (disabled, no network marks). The Visa mark (official path, Simple Icons CC0) appears only on the one-time virtual card, which is Visa-issued (`rainAdapter` `network: "Visa"`). No Mastercard or Amex mark anywhere | `checkout.spec.tsx` |
| UI-04 | P1 | "Rate locked for 15:00": a client-only timer; nothing at a provider is held | Reworded as a quote timer: "Quote expires in mm:ss. The total is re-checked by FurlPay when you book"; expiry still requires a refresh | `checkout.spec.tsx`, screenshots |
| UI-05 | P1 | Unsubstantiated claims: checkout "Travel Rule & KYC enforced over $1,000" (no threshold or KYC check exists in the booking path); travel footer "PCI DSS card handling via Stripe", "15-minute rate lock at checkout", "Travel Rule & KYC compliant" | Replaced with statements the code supports (server-side pricing; idempotent booking; a link to the Travel Rule policy) | `check-claims` passes |
| UI-06 | P1 | Username: the UI offered "Set", but no field existed | Migration **0029** (`users.username`, format CHECK, unique index, atomic service-role `set_username()`); `PUT /api/profile/username` (session-bound, Zod `.strict()`, 10 / 10 min); rules shared with wallet handles (`normalizeHandle`, reserved list); someone else's wallet handle cannot be taken; general account saves never write the column | `username.spec.ts` (19); PostgreSQL 18 `run-0029.mjs` 20/20 incl. concurrent race |
| UI-07 | P2 | Profile picture label wrapped every few words: the shared settings `Row` content column was `shrink-0`, so the uploader's requirements line sized it and crushed the label | `Row`: label `sm:min-w-[14rem]`, content may shrink and wrap; uploader text column `min-w-0 flex-1`, measure 46ch, `aria-describedby` on the upload button. Fixes every settings section that uses `Row` | `profileLayout.spec.tsx`; real Chrome at 1440/1280/768/390: label 384px / stacked, no overflow |
| UI-08 | P2 | Header avatar/name did not update after a profile change (session not refreshed) | Profile page refreshes the session after identity changes | code path |
| UI-09 | P3 | "Pro" plan and "pending" KYC pills used the legacy red `accent` (≈ `loss`), so they read as errors | New `brand` pill tone (emerald `neon`) for the plan; pending in neutral | screenshot |
| UI-10 | P2 | **Expired dataset:** `data/google-places.json` expired 2026-10-01 12:05 UTC (30-day Google Places cache window). The hotel layer is correctly empty everywhere since then, and two specs started failing on the calendar | Specs pin `Date` inside the dataset window; **production data needs regeneration** (`apps/web/scripts/enrich-places-details.mts`, Google API key) | travelBook / travelFlow pass |
| DEV-01 | — | Local `/analytics` and `/profile` without the sign-in page | `GET /api/auth/dev-session` + middleware redirect, only when `NODE_ENV !== production` AND `FURLPAY_DEV_AUTO_LOGIN=1`; 404 otherwise | `devAutoLogin.spec.ts` (15) |

**Flagged, not changed** (marketing copy outside the brief, now contradicted by checkout):
- "15-minute rate lock" on `crypto-travel`, `deals`, `destinations/[slug]`, `flights/layout` metadata, `itineraries/[slug]` and the `/travel` help card.
- "Live fares from 300+ airlines" (flights metadata).

**Deployment:**
- Apply **0029** after 0028 (staging, then production). Without it, saving a username answers 503 "not enabled", and existing accounts are unaffected.
- ~~Regenerate the Google Places dataset.~~ Superseded by §14.3: regenerating it as built would recreate a documented Google terms violation.

## 14. Release-readiness pass (2026-10-01, evening; UNCOMMITTED)

### 14.1 Executive summary

Locally, the release is verified and green. Nothing is committed, pushed, deployed, migrated or regenerated against a live service.

This pass found and closed **three more fabricated travel surfaces**, all reachable in production:
- invented demo trips in every user's My Trips;
- a cancellation endpoint that reported "Refunded" while nothing moved;
- an expired hotel snapshot that read as "no hotels in this city".

It also corrected **24 unsupported or compliance-sensitive marketing claims**, and extended the claims linter with 4 new rules and a scope that now includes the travel guides.

**The hotel dataset was deliberately NOT regenerated.** No supported workflow rebuilds it, and its own compliance document says that caching its display fields breaches the Google Places terms.

Travel booking and payment are **not production-capable**: no live payment rail, no booking provider, client-supplied pricing, simulated authorization. They are now refused in production rather than faked.

### 14.2 Changes in this pass

| ID | Sev | Finding | Fix | Evidence |
|---|---|---|---|---|
| RR-01 | **P0** | `lib/travel/store.ts` `bookOf()` seeded three invented bookings (Grand Hyatt Tokyo, Alila Villas Uluwatu, Memmo Alfama Lisbon, with amounts and "Refunded to FurlPay balance") into **every** user's trips **in production**. They fed My Trips, `/api/expenses/summary`, `/api/travel/rewards` and the business report | Seeded only when `NODE_ENV !== "production"` | `productionAuth.spec.ts`: production → `[]`; development → 3 |
| RR-02 | **P0** | `POST /api/travel/cancel/:id` only relabelled the trip and returned "Refunded in USDC to your wallet" / "Refunded to FurlPay balance"; no supplier cancellation, no refund | 503 `not_available` in production (`demoOnlyUnavailable`, after `requireUser`) | `demoGates.spec.ts` (session stubbed: 503, no "Refunded") |
| RR-03 | P1 | Expired Google Places snapshot made city search answer "0 hotels" with no reason | `/api/travel/hotels?city=` now includes `googleDataset` (`fresh`, `expiresAt`), the same signal `/hotels/map` already sent. Additive, so the native app is unaffected | `datasetFreshness.spec.ts` |
| RR-04 | P2 | Freshness rule untested at its edges | Pure `isFresh(expiresAt, now)`. Missing, malformed or past → not fresh; `googlePlacesInBBox` serves nothing from the first millisecond after expiry | `datasetFreshness.spec.ts` (16) |
| RR-05 | P1 | 24 claims, incl. one product line (§14.5) | Reworded or qualified | linter + `claimsLinterRules.spec.ts` |
| RR-06 | P1 | The claims linter could not see these: no rules, and `lib/travel` (the guides) was unscanned | Rules `rate-lock`, `airline-coverage`, `price-match`, `travel-compliance`; `src/lib/travel` scanned (`store.ts` dev seed excluded with reason); `--scan-only` for fixture tests | linter "14 rules"; `claimsLinterRules.spec.ts` (9) |
| RR-07 | P0 | Production authentication, re-verified with every dev switch on (`FURLPAY_DEV_AUTO_LOGIN=1`, `NEXT_PUBLIC_ALLOW_GUEST=1`) | No change needed; regression tests added | `productionAuth.spec.ts` (18): see §14.7 |

### 14.3 Hotel dataset: status and blocker

| Question | Finding |
|---|---|
| Why it expired | `apps/web/src/data/google-places.json` was generated 2026-09-01 with a 30-day `expiresAt` (2026-10-01T12:05:41Z). `datasetFresh()` correctly stops serving it |
| Supported regeneration workflow | **None.** `enrich-places-details.mts` fills fields into the *existing* file and never resets `generatedAt`/`expiresAt`. `crawl-places-index.mjs` writes `places-index.json` (IDs and coordinates only; fresh until 2026-10-21, 12,307 places). The harvester that built `google-places.json` is not in the repo |
| Compliance | `docs/hotels-map-google-places.md` §5 records it as an **open compliance issue**: the snapshot caches `name`, `rating`, `ratingCount`, `address`, `summary`, `website`, `businessStatus`, `typeDisplay`, which Google Maps Platform Terms §3.2.3 do not permit. Regenerating it as built recreates that |
| Credentials | `GOOGLE_PLACES_API_KEY` is present in the repo-root `.env.local` (value not read, not used). No Google call was made |
| Write safety | `scripts/lib/dataset.mts` uses a lock, a modification stamp, a `.tmp` write and an atomic rename. An interrupted run cannot leave a partial file |
| Fail-safe | Expired, malformed or missing expiry → serves nothing (tested) |
| Tracked in git | Yes (`src/data/google-places.json`, about 11 MB). Not produced at deploy |
| **Decision required (owner)** | Either (a) accept the terms risk and rebuild with the harvester (not in the repo); or (b) **recommended:** the remediation already designed in the doc. Serve `placeId` and coordinates from `places-index.json` (compliant, fresh) and resolve display content live via `/api/places/discover`. That needs Places API (New) enabled, plus a ruling on showing Places content on a non-Google map (§6 of that doc) |

### 14.4 Migration 0029: readiness and runbook

**Verified locally on PostgreSQL 18** (`~/.furlpay-verify/pg-harness/run-0029.mjs`): 20/20.
- **Ordering:** follows 0028 (`check-migrations`: 29 contiguous).
- **Rules:** CHECK backstop for the documented rules (3–32 characters, `[a-z0-9-]`, no edge hyphen); the unique index decides concurrent claims (exactly one `ok`).
- **Isolation:** `set_username` is service-role only. Ordinary upserts keep the column. Existing accounts stay NULL. Re-runs are clean.

**Application:**
- The route uses the session subject only (`.strict()` body, so a `userId` is rejected).
- Reserved names come from the wallet-handle list.
- Someone else's wallet handle is refused.
- Errors return a reason and a human detail, never SQL (`unique_violation` / `check_violation` are mapped inside the function).

**Runbook (staging first):**
1. **Precheck:** run `node scripts/db/probe-schema.mjs` against staging (read-only). 0028 must be present. `select count(*) from users;`.
2. **Backup:** take a Supabase point-in-time restore marker or a `pg_dump -t users`.
3. **Apply:** apply `supabase/migrations/0029_usernames.sql` in one transaction (`supabase db push` or the SQL editor). Lock impact: `ADD COLUMN` (no rewrite, nullable), CHECK validation scan and unique index build on `users` (small table, brief).
4. **Validate:**
   - probe: `0029 column users.username`, `index users_username_key`, `function set_username` are `ok`;
   - run `select set_username('<test-user-uuid>', 'probe-x')` on a staging test account, then reset it to NULL;
   - make a `PUT /api/profile/username` smoke call with a staging session (200, then 409 from a second account).
5. **Failure:** the migration is transactional, so a failure leaves nothing applied.
6. **Rollback / forward-fix:** before any user writes a username, roll back with `drop function set_username(uuid,text); drop index users_username_key; alter table users drop constraint users_username_format; alter table users drop column username;`. **After users have written usernames, do not drop the column: forward-fix instead.** The app tolerates a missing function (503) but not a dropped column on read.
7. **Production:** only after staging passes, and with explicit approval.

### 14.5 Marketing claims: classification

| Claim (where) | Class | Action |
|---|---|---|
| "15-minute rate lock" / "rate locks for 15:00" / "15-minute price guarantee" / "Rate locks for 15 minutes" (`travel/crypto-travel` ×4, `travel/deals`, `travel/destinations/[slug]`, `travel/flights/layout` metadata, `travel/itineraries/[slug]`, `travel/page` help card, `lib/travel/guides.ts` ×4) | Unsupported | Replaced with "15-minute checkout quote, re-checked when you book" |
| "Is the price locked? Yes, the exchange rate is locked for 15 minutes" (`travel/help`) | Unsupported | Answer now says no, and why |
| "Live fares from 300+ airlines" (`travel/flights/layout`) | Unsupported (Duffel production holds a test key) | "Fares from our airline partner where available" |
| "300+ airlines" (`docs/payments/travels-mcp` ×2) | Conditionally accurate (Duffel's coverage) | Qualified: production key not configured |
| "Price Match Guarantee", "we refund the difference in USDC" (`travel/price-match`, `travel/page` card, `guides.ts`) | **Unsupported + legally sensitive** (no claim flow, payout or refund path exists) | Labelled "Coming soon / not available yet" with a notice that it is not an active guarantee. **Flag for legal review** before any launch |
| "FurlPay collects Travel Rule originator information at checkout" over $1,000 (`guides.ts`) | Unsupported + compliance-sensitive | Qualified as planned, not yet part of checkout. **Flag for compliance review** |
| "Tap your FurlPay card … onto the subway turnstile" (`lib/travel/data.ts`) | Unsupported (no FurlPay card is issued) | "Tap any contactless card" |
| "PCI DSS card handling via Stripe", "Travel Rule & KYC compliant", "Travel Rule & KYC enforced over $1,000" | Unsupported | Removed earlier (§13); now linter-enforced |
| "Instant confirmation" (`ActivityCard`) | Conditionally accurate (rendered only when the activity record says so) | Retained |
| Auto-book "settles the booking from your USDC balance instantly" (`guides.ts`) | Unsupported (booking not live) | **Not changed this pass; flagged** |
| B2B "instant confirmation" / "no PCI scope" (`solutions/*airlines`, `products/merchant`, `solutions/ecommerce`, `uk/*`, `jp/*`, `ae/*`) | Conditionally accurate (about USDC acceptance by merchants, not travel booking) | Outside travel; flagged for marketing review |
| "Book hotels, flights…" present-tense framing across `/travel` | Product decision: booking is refused in production | **Flagged (P1)**: decide between "preview" framing and gating |

### 14.6 Checkout and payment lifecycle

| Stage | Today | Production |
|---|---|---|
| Search / price | Fares and stays from Duffel (test key) or the indexed snapshot (expired); activities and cars are generated, dev only | Partly empty, honestly |
| Quote | Client computes and displays; **the server re-prices from a client-supplied `subtotalUsd`** (`book/route.ts` path 3a). The `propertyId` path that would price server-side refuses (no live rate) | **Gap:** pricing is not tamper-resistant until offers are held server-side |
| Authorize payment | `authorizeBooking()` returns a simulated `x402_sim_…` proof or a random card last-4. No processor, no x402 settlement, no balance debit | 503 (`/api/travel/book`) |
| Book with provider | None (no Travala/Duffel order creation) | 503 |
| Confirm / email | Confirmation and email only after the (simulated) authorization; dev confirmation is labelled "simulated" | Cannot happen (503) |
| Idempotency | `idempotencyKey` (server dedupe) plus the per-owner lock (`acquireLock`, 15 s); the UI disables double clicks | Verified locally |
| Cancel / refund | Relabel only | 503 (RR-02) |
| Rewards | Claim gated (`REWARDS_LIVE`) | 503 |

**To enable real bookings**, all of these are required:
1. A payment rail: a card processor (for example Stripe, already used for billing) and/or live x402 settlement with balance debit through `apply_financial_effect`.
2. Provider order creation (Duffel orders / Travala) with authoritative confirmation.
3. Server-held priced offers. The client sends an offer id, never an amount.
4. Durable trips (the in-memory `byUser` map loses data on restart).
5. Provider cancellation and a refund ledger.
6. A PII review of booking logs and emails.

None of this was connected or exercised.

### 14.7 Authentication verification

`productionAuth.spec.ts` (18) runs with `NODE_ENV=production`, `FURLPAY_DEV_AUTO_LOGIN=1` and `NEXT_PUBLIC_ALLOW_GUEST=1`, all set together:
- `/analytics`, `/analytics/users`, `/profile` and `/spending` redirect to `/login?next=…`.
- `/api/auth/dev-session` returns 404 with no cookie.
- `GET /api/profile`, `GET /api/overview`, `GET /api/ops/analytics/kpis` and `PUT /api/profile/username` return 401 without a credential.
- Malformed `Bearer` tokens (including `alg: none`) return 401.
- `infra/aws/env-contract.json`, `infra/aws/modules/env/compute.tf` and `apps/web/vercel.json` never set the dev flags.
- The production client bundle (`.next/static`) contains neither `FURLPAY_DEV_AUTO_LOGIN` nor `api/auth/dev-session` (0 files).

### 14.8 Verification (local, this pass)

| Check | Result |
|---|---|
| Web `tsc --noEmit` | exit 0 |
| Web `next lint` | clean, after escaping one apostrophe this pass introduced |
| Web vitest | **6,223 passed, 0 failed, 31 skipped** (opt-in external-service specs) |
| Production build | exit 0; 447/447 pages; 0 warnings (2 `bigint` native-binding fallback notices) |
| Claims linter | 14 rules, no violations |
| `check-migrations` + tests | 29 contiguous; 3/3 |
| `check-env-contract` | OK, after regenerating the operator doc for the new `NODE_ENV` reads (the check caught it) |
| PostgreSQL 18 | 0029: 20/20; money 47/47; analytics 15/15; `probe-schema` exit 0 with the 0029 objects present |
| Secret pattern scan (57 changed files) | 0 hits |
| Extension / native suites | **not run**: no shared code they consume changed (the hotels response change is additive) |

The first 0029 run crashed at start-up because orphaned embedded `postgres.exe` workers from an earlier run held the port. After stopping them it passed.

### 14.9 Release-readiness matrix

| Pri | Area | Status | Evidence | Remaining gap | Required action | Environment |
|---|---|---|---|---|---|---|
| P0 | Payment / booking integrity | Fabrication closed; booking **not capable** | RR-01/02, UI-01; `demoGates`, `productionAuth`, `checkout` specs | No rail, provider, server-held pricing or durable trips | §14.6 build-out; product decision | Local only |
| P0 | Production authentication | Verified (code + tests) | §14.7 | Live deployment untested | Smoke `/analytics` → `/login` on staging | Local only |
| P1 | Migration 0029 | Ready, not applied | 20/20 PostgreSQL 18; probe | Staging and production application | §14.4 runbook, with approval | Local only |
| P1 | Hotel dataset freshness | **Blocked (owner decision + compliance)** | §14.3; `datasetFreshness.spec` | Production map and search empty | Choose (a) or (b); (b) needs Places API (New) | Production affected |
| P1 | Marketing claims | 24 corrected; 4 flagged | §14.5; linter 14 rules | Legal review (price match, Travel Rule); booking framing | Owner, legal and compliance review | Local only |
| P1 | Secrets / config | No secrets in the diff; dev flags absent from deploy config | scan 0; §14.7 | Production env not inspected (no access) | Confirm production env lacks dev flags | Unverified (production) |
| P2 | Test / release automation | Linter and specs extended; date-dependent specs pinned | §14.8 | CI billing lock (GitHub Actions) | Unlock CI; run the pipeline on the commit | Local only |
| P2 | Observability / recovery | 0029 rollback documented | §14.4 | No alert on dataset expiry | Add expiry alert or ops check (`datasetStats().fresh`) | — |
| P3 | UI / UX | Profile and checkout redesigns done (§13) | screenshots, specs | Native app does not yet show `googleDataset.fresh` | Native empty-state copy | Local only |

### 14.10 Files and proposed commits (NOT committed)

**Ordering:** commit 1 must precede commit 3 (both `travel/checkout` and the book gate). Commit 2 is independent. Commit 4 touches only data and copy.

| # | Commit | Files |
|---|---|---|
| 1 | `fix(travel): refuse simulated booking, cancellation and seeded trips in production` | `app/api/travel/book/route.ts`, `app/api/travel/cancel/[id]/route.ts`, `lib/travel/store.ts`, `app/api/travel/__tests__/demoGates.spec.ts` |
| 2 | `feat(profile): usernames (migration 0029) and settings layout` | `supabase/migrations/0029_usernames.sql`, `lib/username.ts`, `app/api/profile/username/**`, `app/api/profile/route.ts`, `lib/store.ts`, `lib/storeDb.ts`, `lib/accountApi.ts`, `lib/audit.ts`, `components/profile/{IdentitySection,VerificationSection,primitives}.tsx`, `components/profile/__tests__/**`, `components/user/ProfileImageUploader.tsx`, `app/profile/page.tsx`, `scripts/db/probe-schema.mjs`, `security/route-manifest.json`* |
| 3 | `feat(travel): checkout redesign and honest claims` | `app/travel/checkout/**`, `components/travel/checkout/**`, `components/travel/{ActivityCard,CarRentalCard}.tsx`, `app/travel/{layout,page,crypto-travel,deals,help,price-match}/…`, `app/travel/destinations/[slug]/page.tsx`, `app/travel/flights/layout.tsx`, `app/travel/itineraries/[slug]/page.tsx`, `app/docs/payments/travels-mcp/page.tsx`, `lib/travel/{data,guides}.ts`, `scripts/check-claims.mjs`, `lib/__tests__/claimsLinterRules.spec.ts` |
| 4 | `fix(hotels): report snapshot expiry; pin date-dependent specs` | `lib/hotels/googlePlacesLayer.ts`, `app/api/travel/hotels/route.ts`, `lib/hotels/__tests__/{datasetFreshness,destinationSummary,spatialSampling}.spec.ts`, `lib/__tests__/{travelBook,travelFlow}.spec.ts` |
| 5 | `feat(dev): local auto sign-in behind FURLPAY_DEV_AUTO_LOGIN` | `lib/devAutoLogin.ts`, `app/api/auth/dev-session/route.ts`, `middleware.ts`, `lib/__tests__/{devAutoLogin,productionAuth,noDemoAccountInProduction}.spec.ts`, `lib/env.ts`, `.env.example`, `security/route-manifest.json`* |
| 6 | `docs: release readiness §13–§14; env contract` | `docs/release/PRODUCTION_READINESS_FINAL.md`, `docs/release/env-contract.json` |

\* `route-manifest.json` holds entries for commits 2 and 5 and carries one `_total`. Either commit 5 first, or hunk-split it.

`productionAuth.spec.ts` also asserts commit-1 behaviour (production trips, cancellation), so commit 5 must come after commit 1.

### 14.11 Explicitly unverified

- Any hosted environment: staging or production database (0024–0029 not applied), Vercel or AWS env values, the live auth chain.
- The Google key's validity and quota (not exercised).
- Duffel, Travala, Stripe and x402 behaviour.
- Whether the production deploy sets `NODE_ENV=production`. Next.js `next build` / `next start` do, but the platform configuration was not inspected.

## 15. Final verification (2026-10-01, night; UNCOMMITTED)

**Verdict: NOT READY FOR RELEASE.**
- The code is locally verified, including a real production build probed over HTTP. Nothing is staging- or production-verified.
- Travel booking, payment, cancellation and gift cards are safely **disabled**, not implemented.
- Hotel data is **unavailable**.
- Migrations 0024–0029 are **unapplied** on any hosted database.

### 15.1 How this was verified

Previous claims were re-checked independently:
- **Production build over HTTP.** `next build`, then `next start -p 8790` with `FURLPAY_DEV_AUTO_LOGIN=1` and `NEXT_PUBLIC_ALLOW_GUEST=1` both **active** (Next loads `.env.local` in production too), probed over HTTP.
- **Boot refuses without secrets.** Without `FURLPAY_ADMIN_EMAIL`, and then without `FURLPAY_SESSION_SECRET` / Supabase / KV, production **refused to boot**: fail-closed, no fallback admin, no in-memory store. It was started with a random throwaway session secret and backends pointed at closed local ports. A database call therefore fails; it never falsely succeeds.

| Probe (`next start`, NODE_ENV=production, dev flags ON) | Result |
|---|---|
| `GET /analytics`, `/analytics/users`, `/profile`, `/spending`, `/dashboard` | 307 → `/login?next=…` |
| `GET /api/auth/dev-session` | 404, no cookie |
| `POST /api/auth/guest` | 403 "Guest login disabled" |
| `GET /api/profile`, `/api/overview`, `/api/ops/analytics/kpis`, `/api/travel/trips`, `/api/ops/readiness` (no credential) | 401 |
| `GET /api/profile` with an `alg:none` JWT | 401 |
| `POST /api/travel/book` (subtotal $1) | 503 `not_available` |
| `POST /api/travel/cancel/:id` (no credential) | 401 (503 with a session: `demoGates.spec`) |
| `POST /api/travel/gift-cards` ($5,000, anonymous) / `…/redeem` (unknown code) | 503 / 503 |
| `POST /api/actions/pay/o1`, `/api/actions/book-car` | 503 / 503 |
| `GET /api/travel/hotels?city=Dubai` | `count=0`, `googleDataset.fresh=false`, `expiresAt=2026-10-01T12:05:41Z` |
| `/travel/price-match`, `/travel/gift-cards`, `/travel/help` | "not available yet" notices present; 0 rate-lock claims |
| Client bundle (`.next/static`) | 0 files contain `FURLPAY_DEV_AUTO_LOGIN` or `api/auth/dev-session` |

### 15.2 Table 1: Previous findings

| Finding | Previous status | Independently verified? | Current status | Test evidence | Remaining gap |
|---|---|---|---|---|---|
| Prod auth on protected pages and APIs | Fixed (tests) | **Yes, over HTTP on the prod build** | Holds | §15.1; `productionAuth.spec` 18 | Hosted deploy untested |
| Dev auto-login dead in prod | Fixed | **Yes** (flags active, 404, bundle clean) | Holds | §15.1; `devAutoLogin.spec` 15 | — |
| Booking simulated → 503 | Fixed | **Yes** (HTTP) | Safely disabled, **not implemented** | §15.1; `demoGates.spec` | §14.6 build-out |
| Cancellation "Refunded" → 503 | Fixed | **Yes** | Safely disabled | `demoGates.spec` | Real refunds |
| Seeded demo trips in prod | Fixed | Yes (unit, prod mode) | Holds | `productionAuth.spec` | — |
| Blinks ($25 any order, generated cars) | Fixed | **Yes** (HTTP 503) | Safely disabled | `fabricatedSurfaces.spec` | Real orders |
| Merchant wallet fallback | Fixed | Yes (unit and mutant) | Holds | `fabricatedSurfaces.spec` | — |
| Username 0029 | Ready | **Yes** (PostgreSQL 18, rerun) | Ready, unapplied | `run-0029.mjs` 20/20; `username.spec` 19 | Staging, then production apply |
| Hotel dataset expired | Blocked | **Yes** (HTTP: `fresh=false`) | **Blocked** | `datasetFreshness.spec` | Owner and compliance decision |
| 24 claim corrections | Done | **Re-grep: yes**, and **found more** (§15.3) | Done + extended | linter 15 rules; native `travelClaims.test` | Legal review |
| Checkout invented values | Fixed | Yes (component tests) | Holds | `checkout.spec` 11 | **Native checkout had the same defects (fixed now)** |
| Settings layout / username UI | Done | Yes (tests, earlier screenshots) | Holds | `profileLayout.spec` | — |

### 15.3 Table 2: Issue register (new this pass)

| Pri | Component | Issue | Impact | Evidence | Fix applied | Verification |
|---|---|---|---|---|---|---|
| **P1** | `api/travel/gift-cards`, `…/redeem` | Anonymous "purchase" of up to $5,000 with no payment, response says "Emailed to …" (nothing sent). Redeem accepted **any** well-formed unknown code as $50 and replied "USDC travel credit added" while crediting no account. Redeem had no Zod | Fabricated money state shown to users | code read; HTTP probe before the fix not run (found by outcome search) | Both 503 in production (`demoOnlyUnavailable`); Zod on redeem; page and hub copy say "not available"; the page shows an honest 503 message (it used to throw unhandled) | `demoGates.spec` (+2); HTTP probe 503/503 |
| **P1** | `lib/hotels/googlePlacesLayer.ts` `STAY_WORDS` | The regex had **literal backspace characters** instead of `\b` since 2026-09-01 (`1c3a092`, a heredoc artifact), so it never matched. **32** real properties named as lodging but typed otherwise by Google (e.g. "Hotel Daffodils" typed Store) were dropped from the map. The existing test passed vacuously | Real hotels hidden | `grep -P '\x08'` | `\b` restored; repo-wide control-character sweep finds no other file | `stayWordsOverride.spec` (3); **mutant with the original bytes fails, naming "Hotel Daffodils"** |
| **P1** | `native-app/app/travel/checkout.tsx`, `property/[id].tsx` | The native checkout still advertised "Visa · Mastercard · Amex" (selectable), "Rate locked for mm:ss", "Travel Rule & KYC enforced over $1,000", "rate locks 15 min", and invented **3 nights / 2 guests** fallbacks | Same misleading claims as the web, on Android/iOS | grep | Card option disabled with reason; quote-timer copy; true security line; no invented counts; honest 503 message | `travelClaims.test` (6, catches all three in the HEAD version); native `tsc` 0; jest 1,835/1,835 |
| **P2** | `lib/rateLimit.ts` | On any Redis error the limiter **failed fully open** (`ok: true`). A Redis outage removed every throttle (OTP, login, payments) | Brute-force window during outages | code read | Degrades to the bounded per-instance window | `rateLimitRedisOutage.spec` (2); the fail-open mutant fails |
| **P2** | `twilio → axios@1.18.1` (web runtime) | 12 axios advisories (high), **not allowlisted**: prototype-pollution gadgets, header injection, redirect SSRF | Dependency risk in the SMS path | `npm audit --omit=dev` | In-range lockfile update to **1.20.0** (only axios changed; integrity matches npm) | audit: 0 unallowlisted high/critical (9 high remain, all allowlisted with reasons) |
| P2 | Observability | Dataset expiry produced no signal (how 2026-10-01 went unnoticed) | Silent outage | — | `GET /api/ops/readiness` gains `travel.places_dataset` (warns 7 days ahead; fails when expired) | `datasetFreshness.spec` (+3) |
| P3 | Claims linter | Gift-card claims not covered | Regression risk | — | Rule `gift-cards` (15 rules) | `claimsLinterRules.spec` (+1) |
| P4 | `lib/demoGate.ts` | Message reads "Travel gift cards **is** not available yet" (grammar) | Cosmetic | HTTP body | Not changed | — |

Re-confirmed sound on code read:
- `api/travel/settle` verifies USDC on-chain and burns the transaction hash single-use.
- `api/x402/settlement/[tx]` checks confirmation depth on-chain before reporting `settled`.
- `api/x402/fx` / `api/mpp/fx` verify payment before serving.
- `api/travel/rewards/claim` is capability-gated.

### 15.4 Table 3: Production-readiness matrix

| Component | Code complete | Tests passing | Staging verified | Production verified | Remaining blockers |
|---|---|---|---|---|---|
| Authentication and authorization | Verified | Verified | Not verified | Not verified | Hosted smoke test; production env inspection |
| Profile and usernames | Verified | Verified | Not verified | Not verified | 0029 not applied |
| Database migrations | Verified (local PostgreSQL 18) | Verified | Not verified | Not verified | 0024–0029 unapplied; probe never run on production |
| Travel search and hotel data | Partial | Verified | Not verified | Not verified (prod empty: verified on prod build) | **Dataset decision + compliance** |
| Booking provider integration | Not implemented | n/a | Not verified | Not verified | Duffel production key; provider order creation |
| Payment processing | Not implemented (travel) | n/a | Not verified | Not verified | Processor or live x402 + ledger debit; server-held prices |
| Cancellation and refunds | Not implemented | n/a | Not verified | Not verified | Provider cancel + refund ledger |
| Analytics and observability | Partial | Verified | Not verified | Not verified | 0027/0028 unapplied; CloudWatch path; alert routing |
| Web application | Verified | Verified | Not verified | Not verified | Uncommitted; CI locked |
| Android application | Partial | Verified (jest, tsc) | Not verified | Not verified | No device or EAS build run; store labels (human) |
| iOS application | Partial | Verified (jest, tsc) | Not verified | Not verified | macOS CI compile not run; privacy label (human) |
| Chrome extension | Verified | Verified (176; `wxt build` OK) | Not verified | Not verified | CWS publish |
| CI/CD and infrastructure | Partial | Static checks verified | Not verified | Not verified | GitHub Actions billing lock; `terraform plan`; ACM |
| Security and compliance | Partial | Verified | Not verified | Not verified | Legal review (price match, Travel Rule); Places terms; org guardrail decisions |

### 15.5 Table 4: Release blockers and decisions

| Blocker | Why it matters | Required action | Who / what | Can release proceed? |
|---|---|---|---|---|
| Hotel dataset + Google Places terms | Hotel search and map empty; rebuilding as-is repeats a terms breach | Choose: (a) accept risk and rebuild (no harvester in repo), or (b) the place-ID index + live Places API | **You** + compliance; Places API (New) enabled; map-display ruling | Yes, **if** travel search is accepted as empty |
| Booking provider | No reservation is ever made | Duffel/Travala order creation with authoritative confirmation | Engineering + production provider credentials | Only with travel booking left disabled |
| Payment processor / live USDC | Nothing is charged | Stripe (cards) and/or live x402 settlement with ledger debit | **You** (processor choice, credentials) | Same |
| Server-authoritative prices | The client sends `subtotalUsd` | Server-held offers; client sends an offer id | Engineering | Same |
| Durable bookings | Trips live in process memory | Persist trips (Supabase) | Engineering + migration | Same |
| Cancellation and refunds | Cancellation refused in production | Provider cancel + refund ledger | Engineering | Same |
| Migration 0029 (and 0024–0028) | Username save answers 503; money/analytics migrations unapplied | Runbook §14.4 / §11, staging first | **Your approval**; Supabase credentials | No for features needing them |
| Legal / compliance review | Price-match promise, Travel Rule wording, B2B "instant confirmation" / "no PCI scope" | Qualified review | Legal / compliance | Yes (copy is qualified) |
| Production config / infra | Env values, `NODE_ENV`, ACM, `terraform plan`, org guardrails unverified | Inspect production env; plan against a named target | **You** + cloud credentials | **No**, not verified |
| CI billing lock | No CI run on these commits; `deploy:prod` requires CI green | Unlock GitHub Actions | **You** (billing) | **No** (the deploy gate refuses) |
| Uncommitted tree | `deploy:prod` refuses a dirty tree | Approve the commit plan (§14.10, plus §15 files) | **Your approval** | **No** |

### 15.6 Verification commands and results (local, this pass)

| Command | Result |
|---|---|
| `cd apps/web && npx tsc --noEmit` | exit 0 |
| `npm run lint` (web) | "No ESLint warnings or errors" |
| `npx vitest run` (web) | **6,234 passed / 0 failed / 31 skipped** (opt-in external-service specs) |
| `FURLPAY_PG_CONCURRENCY=1 npx vitest run …/pgConcurrency.spec.ts` | 13/13 |
| `npm run build` (web, incl. claims linter) | exit 0; 447/447 pages; linter 15 rules, 0 violations |
| `next start` production probes | §15.1, all as expected |
| `node scripts/db/check-migrations.mjs` | 29 contiguous |
| `node scripts/aws/check-env-contract.mjs` / `check-edge-config.mjs` | OK / OK |
| PostgreSQL 18: `run-0029.mjs` / money / analytics + `probe-schema` | 20/20 / 47/47 / 15/15, probe exit 0 |
| `apps/extension`: `tsc`, `vitest`, `wxt build` | 0 / 176 passed / built |
| `native-app`: `tsc`, `jest` | 0 / **1,835 passed** (116 suites) |
| `npm test` (root, 6 packages) | 458 passed, 0 failed |
| `npm audit --omit=dev` | 40 (13 low, 18 moderate, 9 high, 0 critical); **0 high/critical outside `.github/audit-allowlist.json`** |
| Secret pattern scan (69 changed files) | 0 hits |
| Control-character sweep (all tracked sources) | 0 files |

Not run:
- Android device or EAS build.
- iOS compile (needs macOS).
- Any staging or production smoke test (no authorized access).
- CI (billing lock).

### 15.7 Files added or changed in this pass (on top of §14.10)

- **Web:**
  - `lib/rateLimit.ts`, `lib/hotels/googlePlacesLayer.ts`;
  - `app/api/ops/readiness/route.ts`;
  - `app/api/travel/gift-cards/{route,redeem/route}.ts`, `app/travel/gift-cards/{page,layout}.tsx`, `app/travel/page.tsx`;
  - `scripts/check-claims.mjs`.
- **Tests:** `lib/__tests__/{rateLimitRedisOutage,claimsLinterRules}.spec.ts`, `lib/hotels/__tests__/{stayWordsOverride,datasetFreshness}.spec.ts`, `app/api/travel/__tests__/demoGates.spec.ts`.
- **Native:** `app/travel/checkout.tsx`, `app/travel/property/[id].tsx`, `lib/__tests__/travelClaims.test.ts`.
- **Root:** `package-lock.json` (axios 1.18.1 → 1.20.0 only).

**Commit plan:** extends §14.10.
- Gift cards, rate limiter and readiness go in commit 1 (travel/production integrity).
- `STAY_WORDS` goes in commit 4 (hotels).
- The native files form a new commit 7: `fix(native): honest travel checkout`.
- The lockfile goes in a separate commit 8: `chore(deps): axios 1.20.0`.

## 16. Remediation pass (2026-10-02; UNCOMMITTED)

**Verdict: NOT READY FOR RELEASE.**

This pass adds:
- **Fixes:** one payment-integrity fix and an image-hardening fix.
- **Claims:** unsupported product claims corrected in 21 more web files (14 B2B pages, 7 travel files).
- **Readiness:** a richer hotel-data readiness check.
- **Checklist:** a legal-review checklist (`docs/release/LEGAL_REVIEW_CHECKLIST.md`).

It also adds the first **production observations**: read-only public GETs and DNS lookups against the live site.

### 16.1 Fixed this session

| Pri | Area | Verified finding | Fix | Test evidence |
|---|---|---|---|---|
| **P1** (latent P0) | `/api/travel/settle` + `lib/travel/settlementProof.ts` | **Payment front-running.** The proof checked token, recipient, amount, status and depth but **not the sender**. Anyone could submit a stranger's public USDC transfer to `PAY_TO` against their own trip first; the single-use claim then rejected the real payer. Not exploitable today (booking is 503, production has no trips) | `verifyUsdcPayment` takes `expectedFrom` (EVM topic[1] / Arc `from`; distinct `payer_mismatch`; a malformed payer is refused, never "no check"). The route requires the caller's verified EIP-191-linked wallet (`verifiedReceiver`); none linked → 409 `payer_wallet_not_linked` | `travelSettlementProof.spec` (+5), `travelSettleRoute.spec` (+3, 26/26); **mutant without the payer condition fails** |
| P2 | `packages/furlpay-openbb-plugin/Dockerfile` | The scheduled Container Scan (GitHub Actions, 2026-10-01, run 36878195718) **failed**: msgpack GHSA-6v7p-g79w-8964 (HIGH), urllib3 CVE-2026-97687, setuptools CVE-2025-47273. These came from pip/setuptools inside the venv copied into the runtime image (pip vendors msgpack and urllib3) | `pip uninstall -y pip setuptools wheel` in the builder venv; the app imports none of them; nothing installs at runtime | **Not verified locally** (no Docker). The next Container Scan run must confirm |
| P1 | B2B marketing | "instant confirmation", "Payment finalises on Arbitrum in about a second", "tickets confirm immediately", "settles in about a second, is final" (solutions/airlines ×4 locales, compare/stripe ×4, hotels/[city], solutions/enterprise); "no PCI scope", "lowest PCI bracket (SAQ-A)" (products/merchant, solutions/ecommerce, docs/stripe-crypto, uk/products/payments) | Sequencer-confirmation wording, noting that Ethereum settlement takes longer; "no card form or card data in the flow"; the PCI level is left to formal assessment | linter rules `finality`, `pci-scope` |
| P1 | Travel marketing | "cashback auto-deposited" ×8 (crypto-travel, destinations, help, itineraries, travel hub, rewards ×2, guides). Travel rewards are not live | "credited once travel rewards launch (not live yet)" | linter rule `cashback-auto`; native `travelClaims.test` 9/9 |
| P2 | Ops readiness | Hotel readiness was pass/fail only | `placesDatasetReadiness` returns a `state` (`missing` / `stale` / `expiring` / `healthy`); new `travel.places_live` check (key configured; reachability is explicitly not claimed) | `datasetFreshness.spec` 21/21 |
| P3 | Claims linter | — | 18 rules (+`pci-scope`, `finality`, `cashback-auto`) | `claimsLinterRules.spec` 14/14 |

### 16.2 Production observations (read-only, 2026-10-02)

Only public `GET`s against `https://furlpay.com`, plus DNS-over-HTTPS lookups. No credentials were used and nothing was mutated.

| Observation | Evidence | Meaning |
|---|---|---|
| Hotel search is **empty in production now** | `GET /api/travel/hotels?city=Dubai` → `{"count":0,…}`, **no `googleDataset` field** | Live impact confirmed; production runs code older than this branch |
| **iOS Universal Links / passkey association broken in production** | `GET /.well-known/apple-app-site-association` → 404 (HTML page, i.e. no route in the deployed build) | Must be fixed by deploying the route **and** setting `APPLE_TEAM_ID` |
| Android App Links file served | `GET /.well-known/assetlinks.json` → 200, `com.furlpay.app`, **1** fingerprint | Whether that is the **Play App Signing** key is unverifiable here (memory: links break without it) |
| `/api/health` → 401 in production | live | Deployed version predates `60d75d5` (which serves it publicly) |
| `/analytics` → 307 `/login` | live | Sign-in protection holds |
| **`api.furlpay.com` does not exist** | Cloudflare DoH: `Status=3 (NXDOMAIN)`; `furlpay.com` → 76.76.21.21 (Vercel) | `native-app/app.config.js` points **production** builds at `https://api.furlpay.com/api`: a production mobile build today **cannot reach its API**. **P1 blocker** (§16.4) |

### 16.3 Client release checks (static)

| Client | Verified | Not verifiable here |
|---|---|---|
| **Android** | `EAS_BUILD_PROFILE=production npx expo config`: package `com.furlpay.app`, version 2.3.0 (versionCode 7), `allowBackup: false`, dangerous storage/overlay permissions blocked, App Links `autoVerify` on `furlpay.com/l/`; jest 1,838/1,838, tsc 0 | Signing (EAS credentials), device install, Play App Signing fingerprint in `assetlinks.json` |
| **iOS** | Bundle `com.furlpay.app`; `applinks:` and `webcredentials:furlpay.com` associated domains | Build and signing (needs macOS and an Apple account); AASA is **404 in production** (above); privacy manifest is not set in the config (`privacyManifests: false`) |
| **Extension** | MV3; permissions `storage, notifications, sidePanel, alarms, activeTab`; host permissions furlpay.com / api.furlpay.com only; `externally_connectable` furlpay.com only; CSP `script-src 'self'`. Content scripts on all pages: the `http://*` ones (`blink-detector`, `fee-scanner`) make **no** background or privileged calls; vitest 176/176; `wxt build` OK | Install smoke test (no browser automation this session); CWS review will flag the all-sites content scripts |

### 16.4 Release matrix (P0–P5)

| Pri | Area | Verified finding | Fix implemented | Test evidence | External dependency | Release status |
|---|---|---|---|---|---|---|
| P0 | Payment / booking integrity | Booking, payment, cancellation and gift cards are simulated, so they are refused in production; settlement front-running is closed | Gates (§13–15); payer binding (§16.1) | `demoGates`, `travelSettle*`, production probes (§15.1) | Provider, processor and refund rail | **Safely disabled; not implemented** |
| P1 | Mobile API host | `api.furlpay.com` NXDOMAIN, yet production builds target it | — (deployment decision) | DoH lookup | **You:** set the production `EXPO_PUBLIC_API_BASE` to `https://furlpay.com/api`, **or** deploy the AWS edge + DNS first | **Blocker** for mobile release |
| P1 | iOS associations | AASA 404 live | — | live GET | Deploy, plus `APPLE_TEAM_ID` | **Blocker** for iOS links and passkeys |
| P1 | Hotel data | Empty in production (live) | Readiness states | `datasetFreshness` | Compliance decision; Places API (New) | **Blocked** |
| P1 | Migrations 0024–0029 | Source reviewed; tested locally (§15: 20/20, 47/47, 15/15) | — | PostgreSQL 18 | **Your approval**; target confirmation | **Not applied** (staging: no; production: no) |
| P1 | Claims | 21 more files corrected; legal checklist written | Copy + 3 linter rules | linter 18 rules, native test | Counsel (`LEGAL_REVIEW_CHECKLIST.md`) | Copy safe; review pending |
| P1 | Production config / AWS | Fail-closed boot verified locally (§15.1) | — | — | Credentials; `terraform plan` target; ACM | **Not verified** |
| P2 | CI | **Actions are running again** (Dependabot success, Container Scan ran 2026-10-01): the billing lock appears lifted. This branch has never been pushed, so CI has never run on it | Image fix (§16.1) | `gh run list` (read-only) | Push approval | Pending push |
| P2 | Rate limiting / observability | Redis-outage fallback (§15); dataset readiness states | — | specs | Alert routing | Done locally |
| P3 | Extension store review | All-sites content scripts | — | manifest | CWS | Note |
| P4 | `demoGate` message grammar | "gift cards is not available" | — | — | — | Open (cosmetic) |
| P5 | — | None identified | — | — | — | — |

### 16.5 Verification (local, this pass)

| Command | Result |
|---|---|
| `npx vitest run` (web, alone) | **6,253 passed, 0 failed, 31 skipped** (opt-in external-service specs) |
| ↳ first run in parallel with native, extension and build | 1 file failed: `discordSignature.spec` setup **timed out under CPU load** (key generation); alone it passes 12/12 in 3.5 s. Spec untouched |
| `npx tsc --noEmit` (web / native / extension) | 0 / 0 / 0 |
| `npm run lint` (web) | clean, after escaping one apostrophe introduced this pass |
| `npm run build` (web) | exit 0; 447/447; claims linter 18 rules, 0 violations |
| `npx jest` (native) | 1,838 passed (116 suites) |
| extension `vitest` / `wxt build` | 176 passed / built |
| `npm test` (root) | 458 passed, 0 failed |
| `check-migrations` / `check-env-contract` / `check-edge-config` / `eas-profile.test.sh` | all OK (29 migrations) |
| `npm audit --omit=dev` | 40 (0 critical, 9 high, all allowlisted) |
| Secret scan (90 changed files) / control-character sweep | 0 / 0 |

PostgreSQL harnesses were **not re-run**: no migration or SQL changed since §15, which recorded 20/20, 47/47 and 15/15 plus the probe and 13/13.

**Not run:** Docker image build, Android or iOS builds, extension install smoke, any staging test, any CI run of this branch.

### 16.6 From local to production (exact steps)

1. **Approve commits** (§14.10 + §15.7, plus these files):
   - `settlementProof` and `settle` → commit 1;
   - claim copy, linter and the legal checklist → commit 3;
   - readiness → commit 4;
   - openbb Dockerfile → new commit 9.
2. **Push** the branch; confirm CI and the Container Scan are green on that SHA.
3. **Staging:** apply 0024 → 0029 using the runbook (§11, §14.4). Run the probe. Smoke-test sign-in, username, analytics and the cashback claim gate.
4. **Production config:**
   - set `APPLE_TEAM_ID` and confirm `NODE_ENV`, `FURLPAY_ADMIN_EMAIL` and the session/Supabase/KV secrets;
   - check that `FURLPAY_DEV_AUTO_LOGIN` and the guest flags are **absent**;
   - add the Play App Signing fingerprint to `assetlinks.json`.
5. **Mobile:** choose the API host (§16.4, P1), then build production with EAS.
6. **Deploy web:** `npm run deploy:prod` (the gate enforces a clean tree, a pushed HEAD and green CI). Then re-run the §15.1 probes against production.
7. **Decisions:** hotel data (§14.3); travel launch framing; counsel's sign-off (`LEGAL_REVIEW_CHECKLIST.md`); org guardrails (`infra/aws/org/README.md`).

## 17. On/off-ramp takeover, internal partner names, ramp clients (2026-10-02; UNCOMMITTED)

Another session left a ramp implementation in the working tree: adapters, capability rows, beneficiary storage, webhooks and route wiring. It had removed the `unimplemented` guards from `ONRAMP_LIVE` and `OFFRAMP_LIVE`, and it had never run the test suite (`router.spec` and `routeManifest.spec` both failed against it). The owner chose to take it over. This section records what was wrong, what changed and what still blocks real money.

### 17.1 Defects found in the inherited code (all fixed)

| # | Defect | Fix |
|---|---|---|
| 1 | Both ramp flags un-guarded. Penny-drop was a `TODO`, yet the off-ramp guard had been deleted. | `unimplemented` restored on both, with accurate reasons. A test proves an env value cannot switch either flag on. |
| 2 | Three Coinbase capability rows were marked `"live"`, with a product-page URL as "evidence". "Live" means a live transaction was observed end to end. | Demoted to `in_discussion`. Transak rows now set `vdaMerchantAccepted: false` (unconfirmed). Test: no row is live. |
| 3 | The off-ramp execute path paid `beneficiaryRef: "default"`, debited the ledger after the provider call, and returned `executed: true` for an order still waiting on a deposit. | Execute now requires a verified `beneficiaryId` owned by the caller, debits nothing, and returns `202 awaiting_deposit` with `executed: false`. |
| 4 | Bank account numbers were "encrypted" as base64 and kept 7 years in KV. | Real AES-256-GCM, keyed by `FURLPAY_BENEFICIARY_ENCRYPTION_KEY`, with the record id as AAD. With no key, nothing is stored. |
| 5 | Name match used `includes()`. An empty KYC name matched everything, "Al" matched "Alice Smith", and "no name returned" counted as verified. | Token-based match; a match needs ≥2 tokens. A mismatch or a missing name goes to manual review. |
| 6 | Beneficiary eligibility did not check ownership. | `checkBeneficiaryEligibility(id, userId)`. Another user's id answers "not found". |
| 7 | `POST /api/offramp/beneficiary` collected account numbers that nothing could ever verify. | Returns 503 `beneficiary_verification_unavailable` before reading the body. `GET` returns `available: false`. |
| 8 | Transak webhook verification used an `x-transak-signature` HMAC header that Transak never sends. | Rewritten to Transak's documented scheme: an HS256 JWT in the body's `data` field, keyed with the Partner Access Token. `alg` is pinned, there is a 24h replay window, KV de-duplication, and it fails closed. |
| 9 | The Echo webhook and request signing were invented. `docs.echo.money` renders client-side and states nothing, and `api.echo.money/echo/api/v1` returned 404. | Echo webhook route deleted. The adapter is marked UNVERIFIED, has no default URL, its `verifyWebhook` refuses, and it is never registered. |
| 10 | Every registered adapter was declared "healthy" just for having an API key. | Removed. Health stays `unknown` until a probe sets it. |
| 11 | Step-up endpoints were listed but never enforced. | `enforceActionStepUp` is now called on onramp/session (`create_payment`), offramp execute (`withdraw`) and beneficiary (`add_payee`, always). `stepUpProofId` was added to the schemas, which otherwise strip it. |
| 12 | `cf-ipcountry` (client-settable; there is no Cloudflare in front) was trusted for the embargo check. Unknown country defaulted to "US". | `trustedClientCountry()` is used. Live paths refuse a null country. |
| 13 | The provider failure path fell back silently to the demo session. | Now returns 502 `provider_error`. |
| 14 | A client-supplied `x-furlpay-redirect` header was forwarded to the provider. | Removed. Off-ramp `redirectUrl` is https-only again (the inherited schema had dropped that). |
| 15 | Raw `x-forwarded-for` was read in five routes (policy test failure). | Uses `trustedClientIp()`. |

### 17.2 Pre-existing problem surfaced: fabricated on-ramp quotes

`quoteOnramp()` hard-codes FX for USD, EUR and GBP and prices every other fiat 1:1 with USD, so ₹1,000 was quoted as about 970 USDC. Changes:

- `POST /api/onramp/quote` now calls **Coinbase's Buy Quote API** (`POST /onramp/v1/buy/quote`, checked 2026-10-02) when FurlGateway credentials are set, and labels the result `source: "coinbase"`.
- With no provider, production returns **503**. Development returns `source: "demo_schedule"`.
- `/api/onramp/session` also returns 503 in production when no provider can take the payment.
- The "0% Coinbase fees on USDC" note is gone; Coinbase states its own fees.

### 17.3 Internal partner names (owner's choice: internal only)

- `lib/providers/rampEnv.ts` maps FurlGateway → Coinbase, FurlBridge → Transak and FurlPayout → Echo Money.
- Adapters, provider ids, capability rows, audit rows and the webhook route (`/api/webhooks/furlbridge`) use the internal names.
- Users always see the real company (`rampAttribution()`; the clients say "processed by Coinbase").
- Env vars:
  - `FURLGATEWAY_*`, `FURLBRIDGE_*` and `FURLPAYOUT_*` are read first.
  - `CDP_*`, `TRANSAK_*` and `ECHO_*` remain as fallbacks, so existing deployments need no secret rename.
  - All are registered in `env.ts` and `.env.example`.
- New required name for webhooks: `FURLBRIDGE_ACCESS_TOKEN` (fallback `TRANSAK_ACCESS_TOKEN`).

### 17.4 Clients (existing apps)

**Native, Expo** — `app/ramp.tsx` plus `lib/ramp.ts`, reached from Settings → "Buy & sell crypto" or the `furlpay://ramp` deep link:

- 500 ms debounced, abortable quote with a source label;
- `authenticateDeviceOwner` before any session is created;
- Coinbase checkout in the system browser (Custom Tabs or SFSafariViewController);
- India TDS note on sell;
- uses the existing ramp analytics events.

**Extension** — a "Buy" quick action opens `RampPanel`:

- it replaces "Card", because the grid is 6 columns and card issuing has no issuer;
- the background opens the checkout in a new tab only if the URL is https on `pay.coinbase.com` (`isTrustedCheckoutUrl`).

**Wear OS** — a "Buy USDC" action with $25 / $50 / $100 presets:

- `RemoteActivityHelper` opens `furlpay://ramp?mode=buy&amount=N` on the phone (new dependency `androidx.wear:wear-remote-interactions:1.1.0`, verified on Google Maven);
- the watch never opens a checkout.

**Deliberately not built: status polling.** FurlPay receives no completion event from Coinbase, and `/api/onramp/session/:id` is an in-memory record nothing updates, so polling it would show "requires payment" forever. The clients say the USDC appears in the wallet when it lands.

### 17.5 Behaviour changes for the owner to decide

- `/api/onramp/session` and `/api/offramp/session` now require a signed-in user. Route manifest: `AUTHENTICATED_USER`, total 358.
  - `@furlpay/elements/onramp` partners calling `createSession` with only a publishable key will get 401.
  - Decision: keep this, or add a partner-key auth path.
- On-ramp requires FurlPay KYC tier ≥ 1, and the off-ramp session tier ≥ 2 (from the inherited `rampGuard`). New users at tier 0 cannot reach the Coinbase checkout until verified. Coinbase also runs its own KYC.
  - Decision: keep both layers or rely on Coinbase's.

### 17.6 Verification (2026-10-02)

| Check | Result |
|---|---|
| Web vitest | 6,282 passed / 0 failed / 31 skipped (new: `lib/ramp/__tests__/rampControls.spec.ts`, 28) |
| Web tsc / lint / claims (18 rules) / `next build` | 0 / clean / clean / OK (new routes built) |
| Env registry spec / `check-env-contract` | pass / OK |
| Native jest / tsc | 1,858 passed / 0 |
| Extension vitest / tsc / build | 189 passed / 0 / OK |
| Root `npm test` | 458 passed, 0 failed |
| Guardian `:core:domain` `RampHandoffTest` / `:app:wear:compileDevDebugKotlin` | 3/3 / OK |
| Live Coinbase quote, live Transak webhook | **UNVERIFIED**: no credentials used. The request shapes are from the providers' docs. |

### 17.7 What still blocks real ramp money

1. A signed agreement, plus one observed live transaction, before any capability row becomes `live`.
2. A beneficiary verification partner (penny-drop / name lookup) wired into `beneficiaryVerifier()`.
3. A durable ramp order table, with the FurlBridge webhook driving the lifecycle FSM. Until then the webhook verifies, de-duplicates and audits only.
4. Echo's real API and webhook documentation, from a contract.
5. A native and extension step-up ceremony for amounts ≥ $5,000. Today the server refuses those amounts with `stepUpRequired`, and the clients say so.

## 18. Ramp completion pass (2026-10-02, committed locally; NOT pushed)

The owner approved committing (baseline first), the partner-key path, and KYC split by flow type. History on `docs/architecture-2026-09-29`, unpushed:

- **Baseline:** `8d664c5`..`b1a5a18` (§13–§17 work), then `97c5728` (CRLF restore).
- **Workstreams:**

| Commit | Workstream |
|---|---|
| `a333db0` | 6d: adapters declare `hasHostedCheckout` |
| `b7871a5` | 1: persistent ramp orders + FurlBridge webhook drives them |
| `b25693b` | 3: guard by flow type (hosted vs server-initiated) |
| `3426aa8` | 2: partner publishable-key path + partner callbacks |
| `c8d3e96` | 5: beneficiary micro-deposit state machine + verifier interface |
| `ebdb992` | 6a–c: order reads, stale-order resolution, server-initiated off-ramp orders |
| `dfda25a` | 4: step-up screens (phone app, extension) |

### 18.1 Where the brief and the repo differed (built to the repo)

| Brief said | Repo reality | What was built |
|---|---|---|
| Webhooks at `/api/webhooks/furlbridge` **and** `/furlpayout`; HMAC SHA-256 / SHA-512 | FurlBridge is Transak's HS256 JWT body; Echo's scheme is undocumented | FurlBridge only. No FurlPayout webhook (would be an invented scheme). |
| "Lifecycle FSM with 18 states", expire to `EXPIRED` | No `EXPIRED` state | Stale unpaid checkouts → `ABANDONED` ("no longer waited on; funds may have moved"). |
| Hosted orders reach `COMPLETED` | `COMPLETED` required a ledger id, which a hosted flow never has | New flow `hosted_checkout`: completion evidence is the delivery tx, verified on-chain by FurlPay (`deliveryProof.ts`). A provider's "COMPLETED" alone stops at `CRYPTO_PENDING`. |
| `partner:key:{pk}` Redis store | `lib/apiKeys.ts` already implements pk keys + Origin allowlists | Reused `requireApiKey`. Ramp access is an ops-only per-partner switch, because publishable scopes must stay `:read` (enforced by a test). |
| `POST /api/security/step-up` setting `stepUpVerifiedAt` after PIN/biometric | A client biometric is unverifiable; session-bound OTP/passkey step-up already exists (`lib/stepup.ts`) | Ramp guard requires `recentStepUp(user, jti, 15 min)`; clients complete OTP/passkey. No PIN (FurlPay has none). |
| `idempotencyGuard.check/mark` | `lib/webhooks/idempotencyGuard.ts` is in-memory only | KV `SET NX` claim, released on processing failure (tested). |
| Selfie liveness | No IdP | Not built (a screen that verifies nothing). |

### 18.2 Behaviour now

- **Hosted flows** (Coinbase checkout, Transak widget):
  - no FurlPay KYC;
  - $5,000+ is flagged only (`provider_enhanced_verification`);
  - embargo, velocity and the destination check apply.
- **Server-initiated flows** (FurlPay-funded payouts):
  - KYC on-ramp T1 / off-ramp T2;
  - no partner keys;
  - session step-up at $5,000+, single-use;
  - a verified beneficiary (micro-deposits + name match + 24h hold), otherwise 400 `verify_beneficiary`.
- **Partners** (`@furlpay/elements`):
  - live pk/sk key, non-empty Origin allowlist, ops-enabled;
  - 60 quotes/min and 10 sessions/min per key;
  - orders carry `partnerId`;
  - the callback `ramp.order.updated` is signed `t=..,v1=HMAC-SHA256(t.body)` and sent through the SSRF-pinned fetch, one attempt.
- **Orders:**
  - `GET /api/ramp/orders[/:id]` serves the owner only (404 otherwise);
  - stale orders are resolved on read.

### 18.3 Verification

| Check | Result |
|---|---|
| Web vitest | 6,338 passed / 0 failed / 31 skipped |
| Web tsc / lint / claims / `next build` | clean / clean / 18 rules clean / OK |
| Phone app jest / tsc | 1,868 / clean |
| Extension vitest / tsc / build | 193 / clean / OK |
| Root `npm test` | all 6 packages, 0 failures |

**UNVERIFIED:**
- the extension step-up cookie swap in a real MV3 browser;
- live Coinbase / Transak calls (no credentials used);
- partner callbacks to a real endpoint.

### 18.4 Still blocked (unchanged by design)

1. Signed provider contracts and one observed live transaction before any capability row is `live`. `ONRAMP_LIVE` and `OFFRAMP_LIVE` stay `unimplemented`.
2. A micro-deposit partner wired into `activeVerifier()`, plus a confirm-amounts route once it exists.
3. Echo's real API/webhook documentation.
4. A retry queue for partner callbacks (one attempt today).
5. Push, plus CI on the pushed SHA, before any deploy (`npm run deploy:prod` gate).

## 19. Verification of the pasted 40-finding audit (2026-10-02)

A pasted report from another session listed 5 critical, 11 high, 14 medium and 10 low findings. Each finding was checked against the code before anything changed. Several cite paths that do not exist in this repo (`apps/phone/…`, `apps/watch/…`, `CheckoutWebView.tsx`, `authStorage.ts`). They also quote code that is not here, such as `redis.set(beneficiary:…)` and a Solana `connection.getTransaction`.

Fixes are in commit `1c458af`, with tests in `lib/ramp/__tests__/auditFixes.spec.ts` (8 tests).

### 19.1 Real, fixed

| Finding | What was actually wrong | Fix |
|---|---|---|
| C4 late payment after ABANDONED | A Transak event after a stale order was abandoned matched no transition and was dropped. The order record stayed wrong. Hosted funds go straight from the provider to the customer, so the "fund loss" framing is overstated, but the record was wrong. | `hosted_checkout`: `ABANDONED → MANUAL_REVIEW`. The webhook routes late progress there, then walks forward, with each step still FSM- and evidence-checked. |
| H2 idempotency poison pill | The 7-day `SET NX` claim outlived a crash mid-processing, so every retry was answered "duplicate". | Two stages: a 2-min `processing` claim (a concurrent retry gets 503 + Retry-After), replaced by a 90-day `done` marker after success. This also covers M1. |
| C3 velocity TOCTOU | `checkVelocity` read the counters and `commitVelocity` incremented them after the order, so concurrent requests all passed. | `reserveVelocity`: INCR/INCRBY first, judged on post-increment values. A blocked request returns its amount. Test: 10 concurrent requests → exactly 5 pass. |
| *(not in report)* velocity "review" ignored | `rampGuard` blocked only on `block`. Daily volume over $5,000 or an impossible country change passed silently. | Server-initiated: session step-up. Hosted: `velocity_review` flag. |
| H5 key injection (partly) | Ids came from a signed payload, so the risk is low, but they became KV key parts unchecked. | Transak id `^[A-Za-z0-9_-]{1,128}$`, `partnerOrderId` must be a UUID. |
| M4 GET side effect | Order reads can resolve stale orders (by design, documented) but had no cache directive. | `Cache-Control: no-store` on both order reads. |
| H10 watch tile shows balance | The Wallet and Portfolio tiles rendered figures on a locked watch. The complications already redacted. | Same `ComplicationPrivacy` gate (fails closed); tiles refresh on unlock. |

### 19.2 Not real (already implemented, or describes code that is not here)

| Finding | Evidence |
|---|---|
| C1 plaintext bank details | `beneficiary.ts` is AES-256-GCM, record id as AAD, refuses without a key (since §17). |
| C2 no CSRF | `middleware.ts` Origin check for cookie-authenticated mutations, plus `SameSite=Lax` cookies. |
| C5 tokens in AsyncStorage | `native-app/lib/api.ts` stores the token in `expo-secure-store` (Keystore/Keychain). AsyncStorage holds only the analytics queue. |
| H1 non-atomic order updates | `rampOrder.ts` updates under a per-order `SET NX` lock (tested: concurrent transition + provider-id write both persist). |
| H3 single Solana RPC | No Solana path. Delivery proof is the EVM `verifyUsdcPayment`, with a confirmation-depth check. |
| H4 missing per-route limits | `offramp/session` 10/10 min, `onramp/session` 10/10 min, order reads 60–120/min, partner 10 sessions/min per key. |
| H6 SSRF unverified | `safeFetch` resolve-check-pin, https only, no redirects. Tested against `169.254.169.254`. |
| H7 WebView without allowlist | No WebView. Checkout opens in the system browser; a test forbids `<WebView`. The extension allowlists `pay.coinbase.com`. |
| H11 token in `chrome.storage.local` | The extension authenticates with the furlpay.com cookie. Its local storage holds deposits, x402 logs and an install id. |
| M6 uncontracted provider selectable | `evaluateCapability` hard-fails `contract_not_live`. Tested. |
| M9 cookie attributes | `httpOnly`, `sameSite: "lax"`, `secure` in production (`lib/session.ts`). |
| M10 Android backup | `app.json` `allowBackup: false`. |
| M11 no certificate pinning | `plugins/withNetworkSecurityConfig.js` and `withIosCertificatePinning.js`, with tests. |
| M8 error detail | Ramp routes return codes (`provider_error`, `not_quotable`). Provider messages stay in server logs. |
| L7 docs say HMAC | §17/§18 and the code headers describe the HS256 JWT. |

### 19.3 Real but by design or out of scope (no change)

- **H8 custom scheme:** `furlpay://ramp` carries only a prefilled amount. Nothing is charged without the phone's device-owner prompt and the provider's checkout. Verified App Links and associated domains exist for the https routes.
- **H9 watch app home shows balance:** the app opens only on an unlocked watch.
- **Extension content scripts on all sites:** wallet discovery (EIP-6963), Blink and x402 detection must run everywhere. Reviewed earlier; they make no privileged calls.
- **M5 partner callback retry:** one attempt (§18.4, still open).
- **M12 Data Layer token:** documented in `SyncProtocol.DATA_AUTH_TOKEN`; the Data Layer channel is encrypted between paired devices.
- **L5:** delivery-proof cases are covered in `rampOrder.spec`/`staleOrders.spec`: verified, short confirmations, mismatch, not found.

### 19.4 Verification

| Check | Result |
|---|---|
| Web vitest | 6,346 passed / 0 failed |
| Web tsc / lint | clean / clean |
| Root `npm test` | 0 failures |
| `:app:wear:compileDevDebugKotlin` | OK |

The audit session left two untracked files (`apps/web/findings.json`, `apps/web/script.js`). They are not committed.

## 20. The "fix all 40 findings" brief (2026-10-02)

The brief re-stated the §19 audit as drop-in code. Applied where it matched a real gap (commit `0a38413`):
- **M4:** a background stale-order sweep (on-read resolution is kept, with `no-store`).
- **M5:** partner callback retries via a KV queue (1 min → 6 h, five attempts) instead of sleeping inside a request.
- **Cron:** `/api/cron/ramp-maintenance`, scheduled every 5 min in the EventBridge module (code only).
- **M2:** removed the unreferenced in-memory `idempotencyGuard.ts`.

Not applied, because the brief's code would replace something working or target files that do not exist:
- **C1:** its hex-key `fieldEncrypt.ts` would make data sealed under the existing base64 `FURLPAY_BENEFICIARY_ENCRYPTION_KEY` unreadable.
- **C2:** its CSRF check admits requests with no Origin header; the existing `middleware.ts` check is stricter.
- **H1:** a Lua update would duplicate the per-order lock (Upstash REST `EVAL` is untested here).
- **H3:** a Solana verifier; there is no Solana delivery path.
- **H6:** a second SSRF fetch weaker than `safeFetch`; it re-resolves DNS, so it can be rebound.
- **M10:** `allowBackup="true"`, where today it is `false`.
- **M11:** placeholder pins `REPLACE_WITH_ACTUAL_PIN` over the real pinning plugins, which would hard-fail every connection.
- **C5 / H7 / H9 / H11 / M12–M14 / L9:** they target `apps/phone`, `apps/watch` and `CheckoutWebView.tsx`, none of which exist (see §19.2).
- **M3:** amounts are at most 50,000 with ≤6 decimals, so `Number()` round-trips exactly.
- **`Math.random`:** the remaining uses are avatar colours, jitter and run ids, none security-relevant.

Verification: web 6,354 passed / 0 failed, tsc and lint clean, root `npm test` 0 failures. Terraform was not run (not installed; no apply in any case).
