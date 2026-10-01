# Cross-platform analytics architecture

**Status:** implemented in the working tree on 2026-10-01. Nothing is committed, deployed or migrated.

**Covers:** web (`apps/web`), the Chrome extension (`apps/extension`), Android and iOS (`native-app`, a single Expo codebase), and the API itself.

**Out of scope:**
- The separate Guardian apps (`guardian/` Kotlin, `ios/FurlPayGuardian` Swift). They do not send analytics.
- The desktop app. No analytics.

```text
                         FURLPAY
                            │
        ┌───────────────────┼────────────────────┐
        │                   │                    │
       Web              Chrome Extension      Mobile (native-app, Expo)
  lib/analytics/        lib/analytics.ts        /    \
  client.ts             (background only)   Android   iOS
                                            lib/analytics/furlpaySink.ts
        │ cookie            │ cookie             │ Bearer (SecureStore)
        └───────────────────┼────────────────────┘
                            │  HTTPS, one API origin (configured per environment)
                            ▼
        POST /api/analytics/events   ·   POST /api/analytics/events/batch
        contract.ts (validate) → rate limit → identity FROM SESSION →
        ownership check (transactionId) → idempotent insert (service role)
                            │
                ┌───────────┼───────────────┐
                │           │               │
           Auth / API   analytics_events   Transactions
           (server      (+ user_devices)   ops_tx_events / ledger  ← financial truth
            lifecycle     source=client      │
            events,       = informational    ▼
            source=       source=server   Ledger / Settlement
            server)       = authoritative     │
                                ┌──────────────┼──────────────┐
                                │              │              │
                              Solana        Arbitrum      Providers
                               USDC           USDC      (cards: not live)
                                └──────────────┼──────────────┘
                                               │
                                         Reconciliation
```

**Rule 1:** no client holds database, Redis, CloudWatch or AWS credentials. Every client is a client of the FurlPay API only, and the API writes with the service role.

**Rule 2:** client events describe behaviour. Only server, provider and blockchain-derived records establish financial state. The database enforces this: migration 0028's CHECK makes `payment_completed`, `transaction_settled`, `kyc_completed`, `cashback_claimed` and every other completion **impossible** to insert with `source = 'client'`.

## 1. The contract

The single authority is `apps/web/src/lib/analytics/contract.ts` (schema version 1).

| Field | Rule |
|---|---|
| `eventId` | `[A-Za-z0-9_-]{8,64}`, client-generated. Stored as `c:` + sha256(identity \| eventId), so it is idempotent per identity and cannot pre-empt another identity's events |
| `eventName` | Closed list of 23 client events. 23 server-only names are refused with `server_only_event` |
| `platform` | `web` \| `chrome_extension` \| `android` \| `ios`. `api` is reserved for the server |
| `timestamp` | ISO; refused if older than 7 days or more than 5 minutes in the future. Stored as `client_ts`; metrics use the server receipt time |
| `appVersion` / `buildNumber` / `osVersion` | strict formats |
| `sessionId` / `installationId` / `anonId` | UUID only. Random, app-scoped; never IMEI, serial, phone or advertising ID |
| `route` | path only. Query and fragment are stripped; long opaque segments (ids, tokens, addresses) and any segment holding an email, wallet address or long digit run become `:id` |
| `screen` | `[A-Za-z0-9_./-]{1,64}` |
| `transactionId` | kept only if `ops_tx_events` says the caller owns it; otherwise `transaction_not_owned` |
| `metadata` | ≤ 10 allowlisted keys, primitive values, ≤ 64 characters. A value that looks like personal data (email, EVM or Solana address, 9+ digit run such as a card or phone number) is dropped even under an allowlisted key; everything else is dropped too |
| `userId`, `email`, `sub`… | **any identity field → `identity_claim` rejection**, compared case- and separator-insensitively (`UserId`, `user-id`, `EMAIL` are the same claim) |
| Batch | ≤ 50 events, ≤ 64 KB |

**Drift protection:** the database CHECK (0028), the extension list and the mobile mapping are each pinned to the contract by `contractParity.spec.ts`. Any drift fails CI.

## 2. Identity model

These are four distinct concepts:

| Concept | Source | Note |
|---|---|---|
| **User** | the authenticated session subject (cookie or Bearer), derived server-side | the only cross-platform identity. One person on web, extension, Android and iOS is one `user_id` |
| **Anonymous id** | random per tab (web `sessionStorage`), never persisted beyond the session | dropped server-side when the request is signed in, so pre- and post-login traffic are not stitched |
| **Session** | random per app run | grouping only |
| **Installation** | random per install (extension storage / AsyncStorage) | `user_devices` row for signed-in users. It cannot be moved to another user or platform (`analytics_touch_device` refuses; proven on PostgreSQL) |

A credential that is offered but revoked, expired or locked is **refused (401)**, never downgraded to anonymous (`optionalUser`).

**Rate-limit budgets** follow the same test (`tokenFromRequest`). Only a session cookie or a `Bearer` token gets the signed-in budget (120/min single, 30/min batch). Any other header, such as `Authorization: Basic …`, is anonymous and gets 30/min single and 6/min batch. Before 2026-10-01 any `Authorization` header bought the wider budget.

## 3. What each client sends

| Client | Events | Transport | Failure behaviour |
|---|---|---|---|
| Web | `travel_search` (flights), `wallet_disconnected`. Page views are counted server-side (cookieless) | `fetch` keepalive, same-origin cookie | fire-and-forget |
| Extension | `extension_installed`, `extension_started`, `extension_connected` (dapp consent granted; the dapp origin is **not** sent), `travel_search`, `transaction_rejected` (card challenge declined) | background only, session cookie, batch on the existing 1-minute alarm | queue of 100, 3-day expiry, 5 attempts |
| Android / iOS | `app_opened`, `screen_viewed`, `login_started`, `swap_started`, `payment_started`, `deposit_started` (explicit map from the in-app catalogue; completions are never sent) | Bearer from SecureStore, batch every 60 s in the foreground and on backgrounding | AsyncStorage queue of 200, 3-day expiry, 5 attempts |
| API | `signup_started` / `signup_completed` / `login` / `logout` / `kyc_started` / `kyc_completed` / `cashback_claimed` (0027), `source = 'server'` | in-process, `after()` the response | 2 s bound, one retry; never fails the request |

**Extension message security (audited):**
- Every privileged message requires `sender.id === runtime.id`.
- Dapp origins come from the browser-set `sender`, never from the page.
- There is **no** message type that submits analytics, so a page or content script cannot inject events.

**Never collected:** page contents, visited URLs, form data, cookies, keys, seed phrases, recipient addresses, exact amounts (mobile uses buckets) or device fingerprints.

**Kill switch:** `FURLPAY_ANALYTICS_INGEST=off` returns 503. Every client continues to work: queues retry, then drop.

## 4. Server-side financial and provider events

| Domain | Authoritative source today | Status |
|---|---|---|
| Ledger effects (funding, refunds, disputes, cashback) | `apply_financial_effect` (0025) / `ledger_*` | implemented |
| Rail settlement (x402, MPP, LI.FI, CCTP, gasless transfers) | `ops_tx_events` written by the routes at prepared / settled / failed | implemented. Note: x402/MPP "settled" means facilitator-settled. Finality reconciliation against the chain is `lib/chains/chainReconciliation.ts`; whether it is scheduled is listed in readiness §Background jobs |
| Solana / Arbitrum confirmation and finality | chain reconciliation | **not wired to analytics.** Requires a scheduled reconciler (REMAINING) |
| Visa / Mastercard (authorize / clear / settle / refund / dispute) | card issuer webhooks | **not live** (`CARD_ISSUING_LIVE` unimplemented). Routes answer 503 in production |
| Travala / Duffel bookings | booking provider state | **not live.** Production Duffel credentials are test credentials (`travel/book`) |

**Nothing here is derived from client analytics.** The dashboard's transaction, volume and fee figures come only from `ops_tx_events`.

## 5. Dashboard

`/analytics/users` → **Platforms & Versions:**
- Distinct signed-in users per platform, plus the distinct total across platforms (computed, not summed).
- Anonymous sessions, labelled separately and never added to users.
- Events and errors per platform.
- Version adoption, only where clients reported a version.

Platform filters on the other panels are not implemented (REMAINING). Those panels are ledger and user-store figures that carry no platform today.

## 6. AWS migration

Clients address one configured API origin. Nothing in a client knows about the database, Redis or the load balancer.

| | Current | Target |
|---|---|---|
| Web | Vercel → Next.js → Supabase / Upstash | CloudFront / WAF → ALB → ECS → Supabase / Upstash (Architecture A; Aurora is gated off, `enable_aws_data_plane = false`) |
| Extension | `https://furlpay.com` (allow-listed) | `https://api.furlpay.com` is already in `ALLOWED_ORIGINS` and `host_permissions` |
| Mobile | `EXPO_PUBLIC_API_BASE` (default `https://furlpay.com/api`) | set per EAS profile; production must never point at staging (`scripts/ci/eas-profile.sh` + test) |

The database is Supabase PostgreSQL. A later Aurora move is invisible to clients. CloudWatch / ALB / CloudFront / WAF metrics belong to AWS observability, not to `/api/analytics/events`. The dashboard's latency and invocation cards stay N/A until a CloudWatch read path exists (REMAINING; needs credentials).

**Staging verification** (operator, not executed):
1. Point a dev build of each client at `https://api-staging.furlpay.com`.
2. Apply 0027 and 0028 to staging.
3. Sign in on web, extension and mobile.
4. Confirm one `user_id` across `analytics_events.platform` values: `select platform, count(distinct user_id) from analytics_events group by 1`.
5. Confirm `user_devices` rows.
6. Confirm the dashboard Platforms panel.

## 7. Store privacy declarations (inputs for the human-owned labels)

What the apps now actually send:

| Data | Linked to the user? |
|---|---|
| Product interaction (screens opened, flows started) | yes, when signed in |
| App version / build / OS version | yes |
| Random app installation ID | yes |
| Diagnostics (`error_occurred`) | not sent yet |

The data is not used for tracking across other companies' apps or sites, not sold, and has no third-party SDK. The App Store label and Play Data Safety form must declare **"Product interaction", "Other diagnostic data" (version) and "Device or other IDs" (app-scoped random ID)**, linked to identity, purpose "Analytics". These were previously BLOCKED (human) in `IOS_RELEASE_READINESS.md` and still are.

## 8. Evidence

| Evidence | Result |
|---|---|
| PostgreSQL 18, `scripts/db/verify-analytics.mjs` (0027 + 0028) | 15/15; 0028 also applied twice on a populated table with rows unchanged (re-runnable). Client completions refused by CHECK; actor/identity pairing; closed formats; installation ID cannot move; web + extension + android = one user; privileges service-role only |
| `ingestion.spec.ts` | 30: identity from session (including case/spelling variants), personal-data values dropped, non-credential headers get the anonymous budget, A-claims-B rejected, server-only events refused, closed formats, metadata filtering, idempotency, namespacing, transaction ownership, batch bounds, anonymous flood → 429, storage down → 503, kill switch. Mutants killed: identity-claim check removed, namespacing removed |
| `contractParity.spec.ts` | 6 |
| Extension `analytics.test.ts` | 9 |
| Native `furlpaySink.test.ts` | 9 |
| Not verified | any client against a deployed backend; store submissions; real card, Travala or chain-finality events |
