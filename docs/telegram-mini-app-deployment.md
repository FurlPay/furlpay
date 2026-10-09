# FurlPay Telegram Mini App — deployment guide

Branch `feat/telegram-mini-app` (from the production line `release/partners-on-prod`). Nothing here is deployed to production or configured in BotFather yet.

## A. Architecture

One Next.js app (`apps/web`, Vercel project `web`, `https://furlpay.com`) with two entry points:

- **Website** — unchanged. The homepage hero has an *Open in Telegram* pill (`components/telegram/OpenInTelegram.tsx`) shown only when the bot username is configured, plus a *Preview* link to `/telegram` that always works in a browser.
- **Mini App** — `https://furlpay.com/telegram` (`app/telegram/*`), opened by @FurlpayBot. Screens: `/telegram` (discover), `/telegram/{home,cards,pay,activity,wallet,profile,travel}`.

Shared backend, nothing duplicated: the Mini App signs into the **existing** FurlPay session (`signSession` cookie, revocation epoch, account lock/deletion checks) and reads the account through `GET /api/miniapp/account`, a narrow whitelisted view of the same account the website uses. The only new table is `telegram_account_links` (identity link only, migration `0050`).

```
Telegram client ──initData──▶ POST /api/auth/telegram ──HMAC verify──▶ linked? ──▶ FurlPay session cookie
                                                           │ no
                                                           ▼
                        user signs in to FurlPay (fresh login) ──▶ POST /api/miniapp/telegram-link
```

## B. Prerequisites

- Bot **@FurlpayBot** (exists: public profile "Furlpay — Stablecoin payments, travel & investing"; already served by `POST /api/telegram/webhook`).
- Its token in Vercel production as `TELEGRAM_BOT_TOKEN` (already used by the market-brief bot). Telegram signs Mini App launch data with the token of the bot that launched it, so the Main Mini App must be configured on this same bot.
- Migration `supabase/migrations/0050_telegram_account_links.sql` applied to production (needs authorization).
- A working rate-limit/KV store: in production the auth route refuses (503) without Redis, and a launch can mint only one session (`kvSetNx` replay guard).

## C. Local development

```bash
cd apps/web
npm run dev            # then open http://localhost:3000/telegram
```

In a normal browser the app runs in **browser mode**: no Telegram identity, the account screens ask you to sign in with FurlPay. That is the real behaviour for a browser, not a simulation of Telegram. A real Telegram launch needs an HTTPS URL Telegram can reach (a Vercel preview, or a tunnel) set as a test bot's Mini App URL, with that test bot's token in `TELEGRAM_BOT_TOKEN`. Never point a test bot at production.

## D. Environment variables

| Variable | Class | Purpose | Local | Production | Where |
|---|---|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | server secret | Verifies launch data (HMAC key derivation); existing bot features | for a real launch only | **yes** | Vercel env (Production) |
| `TELEGRAM_WEBHOOK_SECRET` | server secret | Existing webhook header check (unchanged) | no | yes (existing) | Vercel env |
| `TELEGRAM_AUTH_MAX_AGE_SECONDS` | server config | Launch-data freshness, 30–600 s, default 300 | no | optional | Vercel env |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | public | Builds `https://t.me/<bot>?startapp=…`; validated (`…bot`, 5–32 chars) | no | yes, `FurlpayBot` | Vercel env (build-time) |
| `NEXT_PUBLIC_TELEGRAM_APP_SHORT_NAME` | public | Only for a *named* Mini App (`t.me/<bot>/<short>`); blank for the Main Mini App | no | no | Vercel env |
| `FURLPAY_SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_REST_*` | server secret | Existing session, database and KV — reused | as today | existing | Vercel env |

Verify without printing values: `npx vercel env ls production | grep -E "TELEGRAM|SUPABASE|UPSTASH"` (lists names and environments only). Never prefix a secret with `NEXT_PUBLIC_`.

## E. BotFather configuration (manual)

1. `/mybots` → @FurlpayBot → **Bot Settings → Configure Mini App → Enable Mini App**, URL `https://furlpay.com/telegram`. This is the Main Mini App: launch link `https://t.me/FurlpayBot?startapp`.
2. **Menu Button** → set URL `https://furlpay.com/telegram`, title `Open FurlPay`.
3. Profile: name *FurlPay*, description and about text, profile photo (brand mark). Keep the existing commands.
4. Then set `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=FurlpayBot` in Vercel production and redeploy, so the website shows *Open in Telegram*.

Deep links use only fixed routing hints: `https://t.me/FurlpayBot?startapp=<route>`, where `<route>` is one of `home, cards, pay, activity, profile, wallet, travel, discover` (`lib/telegram-mini-app/config.ts`). Anything else is ignored. Never put a token, account or payment detail in a start parameter.

## F. Deployment

Unchanged workflow (see `docs/production/ROLLBACK_RUNBOOK.md`): a Vercel build of the branch, promoted by the owner. `/telegram/*` gets its own headers (`next.config.js`): CSP allowing `https://telegram.org` scripts and framing only by `web.telegram.org` / `webk` / `webz`, `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`. Every other route keeps `frame-ancestors 'none'`.

**Behaviour change:** `furlpay.com/telegram` used to be a 307 to `t.me/FurlpayBot`. It is now the Mini App; the short link moved to `furlpay.com/telegram/bot`. Old shared links now open the browser preview, which links to Telegram once the username is set.

## G. Website integration

`OpenInTelegram` reads the link from `telegramLaunchUrl()` (one place). No link is rendered until the username is configured, so no placeholder URL is ever published. The browser preview never requires Telegram.

## H. Authentication and account linking

- `POST /api/auth/telegram` (public, 10/min/IP): same-origin check; raw `initData` only (never `initDataUnsafe`); Telegram's HMAC-SHA256 (`WebAppData` key) with a timing-safe compare; duplicate/unknown keys rejected; `auth_date` within `TELEGRAM_AUTH_MAX_AGE_SECONDS` (≤30 s clock skew); bots rejected; each launch hash usable once.
- Linked → existing account checks (locked, deleted) → normal FurlPay session cookie (`amr: ["telegram"]`). A different signed-in account → 409, never silently switched.
- Not linked → `link_required`. Linking (`POST /api/miniapp/telegram-link`) needs a signed-in FurlPay session **and** a login within 5 minutes or a recent step-up; plain INSERT with unique constraints on both ids, so one Telegram account can never claim a second FurlPay account or vice versa. No matching by username, email or display name.
- Money: `capabilities.transfers` is always `false`; the Pay screen only reviews a draft and the native MainButton only opens that review. Cards are listed only when `cardIssuingLive()`.

## I. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Mini App opens a blank/blocked frame in Telegram Web | `frame-ancestors` header missing — check `curl -I https://furlpay.com/telegram` |
| "Telegram sign-in is temporarily unavailable" (503) | `TELEGRAM_BOT_TOKEN` unset, Supabase not configured, or KV not Redis/down |
| "Invalid or expired Telegram session" (401) | Token belongs to a different bot than the launcher, launch older than the max age, or tampered data |
| "This launch was already used" | Replay guard: close and reopen the Mini App |
| Website shows no *Open in Telegram* | `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` unset or invalid; it is read at build time, so redeploy |
| Webhook updates rejected | `TELEGRAM_WEBHOOK_SECRET` differs from the `secret_token` given to `setWebhook` |

## J. Release checklist

- [ ] Migration 0050 applied to production (authorized)
- [ ] Rate-limit store healthy (`npm run smoke:prod` readiness PASS)
- [ ] BotFather: Main Mini App + menu button → `https://furlpay.com/telegram`
- [ ] `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=FurlpayBot` set; redeployed
- [ ] On a real phone: open @FurlpayBot → menu button → app loads, theme and safe areas correct, Back button works
- [ ] New user sees *link required*; after FurlPay sign-in, linking succeeds; reopening signs straight in
- [ ] A second FurlPay account cannot link the same Telegram account (409)
- [ ] `furlpay.com/telegram/bot` still reaches the bot chat
