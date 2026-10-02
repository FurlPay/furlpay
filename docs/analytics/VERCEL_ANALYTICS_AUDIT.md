# Vercel Web Analytics — audit, threat model and operations

Date: 2026-10-02. Scope: `apps/web` on Vercel project `web` (`prj_GfsErb6LCHB1pbJPuLsSTeiagiOQ`).
Every statement is tagged **VERIFIED** (direct output or observed behaviour), **DOCS** (official documentation, read on this date) or **INFERRED/RECOMMENDED**.

## 1. Executive summary

- Web Analytics is **enabled on the project** but **production collects nothing** (VERIFIED): the live deployment (Sep 8, `dpl_E3CRNRPdYGaxPwrJvggf3xVwvGgq`) predates the client. The client exists in commits `214ede2` and later, built and verified on preview only.
- The SDK applies `beforeSend` **before** it builds the request, and `null` sends nothing (VERIFIED from `/_vercel/insights/script.js`). URL minimisation is therefore a transport control.
- Transport test on preview `web-6qh5mx6e0` (commit `c0a08b9`): 6 intercepted requests, **no query strings, fragments, emails or record ids** (VERIFIED). Nothing was forwarded to Vercel.
- Real exposures the filter now prevents (VERIFIED in source): Stripe checkout session id in `/pricing?…&session_id=`, email in `/ambassadors/dashboard?email=` (linked from `lib/email.ts`), ticket/booking ids in `/support/[id]`, `/travel/booking/[id]`.
- FurlPay already has a first-party, server-side, idempotent analytics pipeline (`lib/analytics/events.ts`, migration 0027). Vercel custom events are deliberately limited to two browser-only events and do **not** duplicate it.
- No legal conclusion is drawn here. Technical facts relevant to a consent decision are in §10.

## 2. Official documentation reviewed (accessed 2026-10-02)

| Page | Used for |
|---|---|
| https://vercel.com/docs/analytics/package | `beforeSend` (returning `null` sends nothing), `mode`, `debug`, endpoints, v2 dynamic config |
| https://vercel.com/docs/analytics/custom-events | `track()` client and `@vercel/analytics/server`; Pro and Enterprise only; no nesting; string/number/boolean/null values; name, key and value ≤ 255 characters |
| https://vercel.com/docs/analytics/privacy-policy | Data points (URL, dynamic path, referrer, filtered query params, geo, OS, browser, device); cookieless request hash; sessions discarded after 24 h; Resilient Intake |
| https://vercel.com/docs/analytics/limits-and-pricing | Pro: **no included events, $0.03 per 1K** (against the Pro usage credit), 12-month window, custom events included, **2 properties per event**; Web Analytics Plus $10/month (8 properties, 24 months, UTM) |
| https://vercel.com/docs/deployments/promote-preview-to-production | `vercel list/inspect/curl/httpstat/logs/promote/rollback`; promote rebuilds with production env |
| https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation | `x-vercel-protection-bypass` header, available on all plans |
| https://vercel.com/docs/git | Production branch = Branch Tracking on the Production environment |

**Not found:** `https://vercel.com/docs/cli/analytics`. CLI 54.18.7 has no `analytics` subcommand (`vercel analytics --help` → "not a valid … subcommand"). Programmatic reporting goes through the Web Analytics REST API (e.g. `GET /v1/query/web-analytics/events/aggregate`, linked from the custom-events page). That API was not exercised in this audit.

**Speed Insights** is separate from Web Analytics. On Pro it is a paid add-on, and it is **disabled** on this project (VERIFIED: project config `speedInsights.enabledAt` unset). It is not enabled by this work.

## 3. Public implementations

Evidence is thin, and no recognisable company documents its Web Analytics redaction publicly. The results found are small open-source projects (GitHub PRs, unverified maintainers), which show that the same pattern (strip query/hash in `beforeSend`, sometimes keep `utm_*` only) is in common use:

| Project | Documented implementation | Source | Status |
|---|---|---|---|
| couranr-os | Customer access tokens redacted from URLs | https://github.com/kkoly10/couranr-os/pull/80 | PR exists; contents not reviewed in depth |
| sueldo.ai | "privacy-safe Vercel Web Analytics" | https://github.com/jsuarezgg/sueldo.ai/pull/2 | as above |
| simstudioai/sim | Conversion fired on Cal.com booking success | https://github.com/simstudioai/sim/pull/7497 | as above; same provider-confirmation pattern as `founder_call_booked` |

No claim is made that any company uses a particular implementation because its site runs on Vercel.

## 4. Existing FurlPay analytics architecture (VERIFIED in source)

| Layer | What | Where |
|---|---|---|
| Server pageview counter | Cookieless daily counter in middleware/KV | `lib/analytics/track.ts` (`ops:analytics:pageview:<date>`) |
| First-party product events | signup_started/completed, login, logout, kyc_started/completed, cashback_claimed. Server-side, `after()`, idempotent `event_id`, HMAC subject, no PII | `lib/analytics/events.ts`, table `analytics_events` (0027/0028) |
| Browser product moments | Sparse client events, tab-scoped sessionStorage id | `lib/analytics/client.ts`, `contract.ts` |
| Google Analytics | Only when `GA_ID` set; Consent Mode v2 banner | `components/ConsentManager.tsx`, `app/layout.tsx` |
| **Vercel Web Analytics** | Pageviews + 2 custom events, URL-minimised | `components/VercelAnalytics.tsx`, `lib/analytics/sanitize.ts`, `lib/analytics/vercelEvents.ts` |

Vercel and first-party pageview counts **will differ**. Vercel skips headless/webdriver browsers (VERIFIED in its script) and counts in the browser, while the middleware counter counts requests. Treat each as its own series, and never treat either one, or a CDN or function request count, as unique users.

## 5. Findings

| # | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| F1 | High | Production records nothing despite Web Analytics being enabled | Project config `webAnalytics.enabledAt` set; live bundle has no client; live deployment is Sep 8 | Fixed in code (`214ede2`+); **not deployed** |
| F2 | High (prevented, never shipped) | Without minimisation, page URLs would send a Stripe session id, an email address and record ids | `api/billing/checkout/route.ts:71` success_url; `lib/email.ts:266`; routes `support/[id]`, `travel/booking/[id]` | Fixed: `sanitize.ts`; transport-verified |
| F3 | Medium | First version parsed with `new URL()` unguarded. A throw inside `beforeSend` is undefined behaviour | previous `VercelAnalytics.tsx` | Fixed: invalid, non-http(s) or oversized → `null` |
| F4 | Low | External referrer is sent outside `beforeSend` | script: `withReferrer && !referrer.includes(location.host) ? {r: referrer}` | Accepted. It is the other site's URL as its policy exposes it, and own-host referrers are never sent. Documented |
| F5 | Low | `identify()` would make the script write localStorage | script: `userId\|\|groupId ? localStorage.setItem(...)` | Prevented by rule in `vercelEvents.ts`; never called |
| F6 | Info | `www.furlpay.com` serves 200 rather than redirecting to the apex | `curl -I` both return 200 from the same deployment | Recommendation (§16) |

Not an analytics finding, noted for follow-up: `/api/ambassadors?email=&viewerEmail=` returns a reduced public view for non-owners. Its authorisation model was not audited here.

## 6. Threat model (analytics data path)

| Data | Where it could enter | Control | Residual |
|---|---|---|---|
| OAuth `code`/`state`, handoff `code` | Query string | Query dropped. `/auth/handoff` and `/api/auth/*` are route handlers (redirects) and never render a page | none known |
| Reset/verification tokens | Query or path | Query dropped; token-shaped path segments redacted | a short (<20 char) token in a path would pass — none exists today |
| Stripe `session_id`, payment refs | `/pricing` return URL | Query dropped | none |
| Email | `?email=`, path segment | Query dropped; `@`/`%40` segments redacted | none |
| Ticket/booking ids | Path | Explicit route redaction + id-shape rule | new id routes need the explicit list (§11) |
| Fragments (`#access_token=`) | Hash | Dropped | none |
| Custom event properties | `track()` | Allowlisted names; 0 properties used; primitives ≤ 64 chars; max 2 | future events must keep closed enums |
| Referrer | Script, outside `beforeSend` | External-only by SDK design | F4 |
| Device storage | Script | No `identify()` → nothing written | F5 |
| Client errors | Not collected by Web Analytics | — | — |

URL redaction is **not** a complete privacy programme. It removes what is in URLs, not what the request itself reveals (IP-derived geo, user agent), which Vercel processes under its own privacy terms.

## 7. Vercel CLI commands (VERIFIED against CLI 54.18.7)

```bash
vercel project inspect web                     # root dir, framework, Node
vercel api /v9/projects/<projectId>            # production branch, protection, webAnalytics/speedInsights flags
vercel ls web [--prod]                         # deployments and status
vercel inspect <url|domain> [--logs]           # deployment id, target, build logs; works on furlpay.com
vercel env ls production                       # NAMES only; never pull values to read them
vercel domains inspect furlpay.com             # nameservers / config
vercel curl --deployment <url> --yes /path     # protected previews; on Git Bash set MSYS_NO_PATHCONV=1
vercel promote <url> --yes ; vercel promote status
vercel rollback <deployment-id>
vercel logs --environment production --level error --since 5m
```

Notes:
- **`vercel curl` path handling.** Vercel options go before the path; trailing arguments pass straight to curl. Git Bash rewrites `/path` to `C:/Program Files/Git/path` unless `MSYS_NO_PATHCONV=1` is set.
- **Never use `--debug` with `vercel curl`.** It prints the protection-bypass secret.

## 8. Production verification (2026-10-02)

| Check | Result |
|---|---|
| DNS apex | `A 76.76.21.21` (Vercel), identical from Google, Cloudflare and the local resolver — VERIFIED |
| DNS www | `CNAME cname.vercel-dns.com` — VERIFIED |
| Nameservers | Namecheap (`registrar-servers.com`); records point at Vercel (supported external-DNS setup) — VERIFIED |
| TLS | Let's Encrypt, CN furlpay.com, valid to 2026-11-30 — VERIFIED |
| Serving deployment | apex and www both serve `dpl_E3CRNRPdYGaxPwrJvggf3xVwvGgq` (Sep 8, `extension-redesign@b8394a3`) — VERIFIED |
| Edge cache | homepage `Age: 2055777` s (~24 days), `X-Vercel-Cache: HIT` — consistent with that deployment |
| Web Analytics on furlpay.com | **not collecting** (client not in live code) — VERIFIED |
| Re-check 2026-10-02 evening | production is now `dpl_2EDVoAYPUKsiehge88RFcqQKDr5B` (redeploy 12:22 UTC, `hotfix/token2049-public@30b613c`). That commit has no `@vercel/analytics` dependency and `vercelEvents.ts` is a no-op stub; 0 of the homepage's 12 JS chunks contain the insights loader. The analytics commit `36d4a2f` (preview `dpl_AoeTFLyxf8Mmj7K3JzockK6jJ7Jz`, 1 of 12 chunks carries the loader) is built but **not promoted**. A dashboard showing 1 visitor means preview traffic or the period filter, not a production session — VERIFIED (bundle scan) |

**UTM attribution (added 2026-10-02):** `sanitize.ts` previously dropped every query parameter, which also discarded `utm_*` tags, so campaign links would have arrived as direct traffic even with Web Analytics Plus. The five `utm_*` keys are now kept when their value is a campaign label (`[A-Za-z0-9][A-Za-z0-9._+-]{0,63}`, not identifier-shaped); every other parameter is still dropped. The dashboard's UTM report needs Web Analytics Plus — a billing decision, not a code change.

Domains are in sync with each other and with the production deployment. **The production deployment itself is stale** (see `docs/release/PRODUCTION_READINESS_FINAL.md` and the release blockers below).

## 9. Event taxonomy

| Event | Fires when | Question it answers | Props |
|---|---|---|---|
| `scheduler_opened` | Founder-call modal opens | How many visitors intend to book? | none |
| `founder_call_booked` | Cal.com `bookingSuccessfulV2` (provider confirmation), deduped by booking uid, listener registered once per page | How many confirmed bookings, and at what rate from opens? | none |

**Deliberately not sent to Vercel:**
- signup, login and KYC: already recorded server-side as facts in `analytics_events`.
- checkout and payment events: production money movement is a fail-closed simulation, so such an event would count transactions that did not happen.

A future `payment_completed` must be emitted only on a ledger-confirmed settlement, with the settlement's effect key as the dedupe key, preferably server-side.

## 10. Consent and environments

Technical facts, not legal advice:
- No cookies are set.
- Nothing is written to the device without `identify()`, which is never used.
- Visitors are identified by a request hash discarded after 24 h (DOCS).
- Query strings and fragments never leave the browser.

Whether a consent banner is still required depends on jurisdiction and counsel. The GA banner (`ConsentManager`) governs GA cookies only.

Environments:
- **Development.** The SDK auto-detects it and logs instead of sending (DOCS).
- **Preview.** Previews do collect. Filter by environment in the dashboard.
- **Headless and test traffic.** Skipped by the script (VERIFIED).

## 11. Implementation (commits `214ede2`, `c0a08b9`)

| File | Change |
|---|---|
| `components/VercelAnalytics.tsx` | `beforeSend` → `sanitizeAnalyticsUrl`, null on failure |
| `lib/analytics/sanitize.ts` | Drop query and hash; redact `/support/[id]`, `/travel/booking/[id]`, UUID/email/hex/long-digit/token-shaped segments; fail closed |
| `lib/analytics/vercelEvents.ts` | Typed allowlist, ≤ 2 primitive props, in-memory dedupe, never throws |
| `components/marketing/ScheduleCallButton.tsx` | `scheduler_opened`; `founder_call_booked` on `bookingSuccessfulV2` |
| `app/layout.tsx` | Renders `<VercelAnalytics />` |

When adding a route with a personal record id in its path, add it to `RECORD_ROUTES` in `sanitize.ts` and add a test.

## 12. Tests (actual exit codes)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` (apps/web) | exit 0, 375 files passed, 6455 tests passed, 31 skipped |
| `npx eslint` on modified files | exit 0 |
| `check-claims.mjs`, `check-route-security.mjs` | pass |
| Preview build `c0a08b9` | Ready |
| Transport test (Playwright, preview, intercepted) | 6 requests, 0 leaks |
| Cal.com booker (Playwright, preview, desktop + mobile) | calendar renders, 6 slots, 0 CSP errors |

A local `next build` was not run: it disrupts the running dev server, and disk C: had about 2 GB free. Vercel's preview build of the same commits stands in for it.

## 13. Dashboard verification (after a production release)

1. Vercel → project `web` → Analytics: switch the environment to Production and confirm pageviews appear within minutes.
2. In the Pages panel, no URL may contain `?`, `#`, `@` or a numeric id under `/support/` or `/travel/booking/`.
3. Events panel: `scheduler_opened`, and `founder_call_booked` after a test booking (cancel it in Cal.com).
4. Usage → Observability: check event volume against spend (no included events on Pro).

## 14. Deployment and rollback

Release via the repo gate (`npm run deploy:prod`) or `vercel promote` of a verified preview. Roll back with `vercel rollback dpl_E3CRNRPdYGaxPwrJvggf3xVwvGgq`. Analytics needs no data migration, and rollback simply stops collection.

## 15. Outstanding / unavailable evidence

- **Production release blocked** (outside this audit):
  - Vercel's production branch is `main` (stale; its last build failed), while the repo gate requires `extension-redesign`.
  - The push to `extension-redesign` was refused by the session's permission policy.
  - Migrations 0024–0029 are unverified on the production database.
- **Not observed:** Web Analytics dashboard contents and REST API data were not retrieved.
- **Not tested end to end:** `founder_call_booked` would need a real booking to fire.
- **Secret to rotate:** a CLI debug run printed the protection-bypass secret into an agent session transcript. Regenerate it (Project Settings → Deployment Protection).

## 16. Follow-up plan (prioritised)

1. Resolve the release blockers, deploy, then run §13.
2. Rotate the protection-bypass secret.
3. Redirect `www.furlpay.com` → `furlpay.com` (Project → Domains) so each page has one canonical URL.
4. Set Spend Management alerts for Observability usage.
5. Decide on Speed Insights (paid) only after Web Analytics data exists.
6. Audit `/api/ambassadors` authorisation (noted in §5).

## Quick-start checklist

- [ ] New page with an id in its path → add to `RECORD_ROUTES` + test
- [ ] New custom event → add to the `Schema` in `vercelEvents.ts`; outcome events fire on provider/ledger confirmation; ≤ 2 closed-enum props; dedupe key for outcomes
- [ ] Never call `identify()`; never put emails, ids, amounts or tokens in event props
- [ ] Lifecycle facts (signup/login/KYC) → `recordProductEvent`, not Vercel
- [ ] After release: §13 dashboard checks
