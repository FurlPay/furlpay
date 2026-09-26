# Browser QA

Playwright coverage for the support surface. This closes a gap that had stood
open through several passes: every previous verification round ended with "no
browser pass — no Playwright installed", so hydration, client-side runtime
errors and real navigation were unverified.

## Setup

| | |
| --- | --- |
| Runner | `@playwright/test` **1.63.0**, dev dependency of `apps/web` |
| Browser | Chromium only — Chrome Headless Shell **153.0.8010.12** (`chromium_headless_shell-1243`) |
| Config | `apps/web/playwright.config.ts` |
| Specs | `apps/web/tests/e2e/` |
| Tests | **35 per project × 2 projects = 70** |
| Projects | `desktop` 1440×900 · `mobile` Pixel 7 profile at 390×844 (touch + device scale, not just a narrow window) |

Artifacts (`test-results/`, `playwright-report/`, `blob-report/`, `.playwright/`)
are gitignored: a screenshot or trace can contain a session cookie and whatever
was on screen.

## Authentication — no production guard was relaxed

Authenticated tests need **two distinct identities** (cross-user isolation is the
point). They are created through the app's own sign-in flow:

```
POST /api/auth/otp/start   -> in mock mode, echoes devCode
POST /api/auth/otp/check   -> findOrCreateUserByIdentityDurable + session
```

That is the real production path — the same one Google, Apple and passkey
sign-in use. Mock mode only generates the code locally instead of calling
Twilio, and `assertLiveInProduction()` in `lib/auth/otp.ts` **refuses to run
mock OTP when `NODE_ENV=production`**.

So the suite runs against a dev server, and **the guards moved not at all**:

- no production backdoor, no hidden admin, no hardcoded credential
- `ALLOW_GUEST_LOGIN` is not used
- `requireRole` is not bypassed
- no test-only route was added
- rate limits were not raised

The alternative — making mock OTP or guest login reachable under
`NODE_ENV=production` — is exactly what must not happen. The tests moved
instead.

`E2E_BASE_URL` points the suite at an already-running server, so the
non-authenticated specs can also be run against the real production bundle:

```bash
npm run build && npx next start -p 8792
E2E_BASE_URL=http://127.0.0.1:8792 npx playwright test --grep-invert @auth
```

## What is covered

| Spec | Covers |
| --- | --- |
| `support-routing.spec.ts` | Route precedence in a browser; `/support/new` and `/support/tickets` render their own pages; no request is ever made for a ticket called `new` or `tickets`; client-side navigation does not reintroduce the bug; no horizontal overflow |
| `support-auth.spec.ts` | Signed-out ticket links say "Sign in to view this ticket", never "Could not load"; the `next=` round-trip; no ticket payload in the DOM before authorization; malformed/oversized/script-injected ids |
| `support-ticket.spec.ts` | Authenticated lifecycle: create → detail → list → reopen → reply → reload → navigate away → back; author attribution; empty reply refused; every message carries a known author badge |
| `support-security.spec.ts` | Two real identities; user B cannot open, list, message, PATCH, or `/agent` user A's ticket; author impersonation via request body; unauthenticated 401s |

Each spec also asserts no hydration errors, no page exceptions, and no 5xx.

## Status codes, read off the routes rather than assumed

| Probe | Result | Why |
| --- | --- | --- |
| Non-owner reads a ticket | **404** | Not 403 — a 403 confirms existence and turns ids into an oracle |
| Non-owner posts a message | **404** | Same reason |
| Non-owner PATCHes status | **404** | Same reason |
| Non-admin calls `/agent` | **403** | A different question ("may you act as support"), so answering plainly leaks nothing |
| Unauthenticated | **401** | |
| Customer reply created | **201** | Not 200 — it creates a resource |

## Defects found by browser testing

1. **The ticket page said the same thing twice.** On a 404 the detail page set
   `error` *and* fell through to its not-found branch, so "That ticket could not
   be found." rendered in the `role="alert"` paragraph **and** in the card below
   it. A strict-mode locator matched two elements where a reader just sees the
   app stammer. The card is now suppressed when the alert already carries the
   message, rather than rendering an empty bordered panel.

2. **Client components were not executing at all** under a stale `.next`
   directory: CSS and JS were served as `text/plain`, `nosniff` refused them, and
   every page rendered as a bare `alert` role. SSR HTML was valid and a curl check
   passed — this is precisely the class of failure only a browser catches. An
   environment artifact rather than an app defect, and the reason the repo's own
   note about `next build` clobbering `next dev` exists.

## Known interactions that are not defects

- **`POST /api/support/tickets` allows 5 per 10 minutes per IP.** A spec that
  creates a ticket per test exhausts it, and the later tests then fail at a
  navigation assertion and look like broken ticket creation. The suites create
  **one** ticket and assert against it in `serial` mode. The limit was not raised.
- **Serial tests must share a browser context.** The default `page` fixture builds
  a fresh context per test, which drops the session cookie; follow-up tests then
  land on the sign-in state. Both authenticated specs create one context in
  `beforeAll`.
- **`net::ERR_NO_BUFFER_SPACE`** appeared once after ~54 orphaned Chromium
  processes accumulated across runs. Windows socket exhaustion, not the app.

## Not verified

- **No external Zendesk tenant.** The dormant SSO route's generated HTML and its
  conditional CSP are verified locally; external Zendesk acceptance of the JWT is
  not tested, and no customer JWT was sent anywhere.
- **GitHub Actions is billing-locked.** The config is CI-compatible — headless,
  deterministic base URL, explicit timeouts, `forbidOnly` and one retry under
  `CI`, no local-only paths, no production credentials — but **no CI run has
  executed these tests.** Running them in CI would need a workflow step for
  `npx playwright install --with-deps chromium`; no secrets are required, because
  the suite mints its own identities.
- **AI assistant browser coverage is not in this suite yet.** The AI surfaces are
  covered by unit tests (`aiThinkingBubble.spec.tsx`, `ticketAuthor.spec.tsx`,
  `sources.spec.ts`) but not yet driven through a browser.
