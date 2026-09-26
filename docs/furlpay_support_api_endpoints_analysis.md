# FurlPay support: the system we run, and the help desks we could integrate

> **FurlPay's support backend is FurlPay.** Tickets, messages, the knowledge base
> and the AI assistant all run on our own endpoints and our own kv layer; that
> registry *is* the help desk and the system of record.
>
> This document has two halves. **Part A** is what exists and is reachable today.
> **Part B** is a vendor comparison kept for a future Phase 2 decision — Zendesk,
> Chatwoot and DevRev are evaluated there as *candidates*, none is integrated,
> and nothing in Part B describes running infrastructure.
>
> The one external integration that exists in code at all is a **dormant Zendesk
> SSO handoff**, documented in Part A.4 with its audit. It returns 404 in every
> environment today and no part of the UI links to it.

Verified against the code on `extension-redesign`, September 2026. Vendor claims
verified against vendor documentation, July 2026.

---

# Part A — What FurlPay runs today

## A.1 The native support portal

```
Native FurlPay support  (the system of record)
│
├── Pages
│   ├── /support               static   centre, categories, help articles
│   ├── /support/new           static   create a ticket
│   ├── /support/tickets       static   your tickets — search, filter, status
│   └── /support/[id]          dynamic  the conversation
│
├── Ticket API
│   ├── POST   /api/support/tickets                  create
│   ├── GET    /api/support/tickets                  list (caller's own)
│   ├── GET    /api/support/tickets/[id]             read one
│   ├── PATCH  /api/support/tickets/[id]             status change
│   ├── POST   /api/support/tickets/[id]/messages    customer reply
│   └── POST   /api/support/tickets/[id]/agent       agent reply (admin only)
│
├── AI + knowledge
│   ├── POST   /api/support/ask                      grounded answers (RAG)
│   └── GET    /api/support/kb                       help-centre index + search
│
├── Email bridge
│   └── POST   /api/support/message                  chat bubble → SUPPORT_INBOX
│
└── Optional / dormant
    └── GET    /api/support/sso                      Zendesk JWT handoff (404 today)
```

## A.2 Endpoint reference

| Endpoint | Method | Auth | Notes |
| :--- | :--- | :--- | :--- |
| `/api/support/tickets` | POST | Session | Zod-validated (category, subject, body). Owner comes from the session; a `userId` or `status` in the body is ignored. Stored in our kv layer — transaction hashes and account data never leave the vault. KYC-category tickets also land in the `ops:security` compliance feed. |
| `/api/support/tickets` | GET | Session | Lists only the caller's tickets via `listTickets(auth.account.user.id)`. The client never sends a user id. 60/min. |
| `/api/support/tickets/[id]` | GET | Session | `getTicketForUser(userId, id)`. A non-owner gets **404, not 403**, so ticket ids cannot be used as an existence oracle. |
| `/api/support/tickets/[id]` | PATCH | Session | Status transitions, enum-validated. |
| `/api/support/tickets/[id]/messages` | POST | Session | `author` is hardcoded server-side, so a client cannot post as FurlPay Support. 20/10min. |
| `/api/support/tickets/[id]/agent` | POST | **Admin only** | `requireRole` against the single `FURLPAY_ADMIN_EMAIL`. The only route that writes `author: "agent"`. |
| `/api/support/ask` | POST | Public (IP-limited) | See A.3. |
| `/api/support/kb` | GET | Public | Publishes only what `/docs/help/*` already shows anyone. |
| `/api/support/message` | POST | Public (IP-limited) | Anonymous chat-bubble message forwarded to `SUPPORT_INBOX`. 5/10min. |
| `/api/support/sso` | GET | Session | **Dormant.** See A.4. |

Authorization is enforced at the query layer, not in the UI. Details and the
probe results are in [SUPPORT-PORTAL.md](SUPPORT-PORTAL.md).

## A.3 The AI support API

`POST /api/support/ask` — retrieval-augmented answers over the published help
centre. Public, IP rate-limited at 15/min.

| Property | Value |
| :--- | :--- |
| Corpus | `lib/support/kb.ts` — **14 articles**, shipped in the repo, changed only by commit |
| Retrieval | `retrieveKb()`, capped at 3 articles |
| Model | `claude-haiku-4-5-20251001`, 400 max tokens, 12s timeout |
| No key | Falls back to an extractive answer from the same articles |
| Writes | **None.** No ticket creation, no message append, no kv write |
| Tools | **None.** No `tools`, no `tool_choice` — the model can emit text and nothing else |
| Private data | None in reach: the route takes no ticket id and imports no ticket store, no auth, no kv |

**Capability level.** Only Level 1 (answer from public knowledge) is
implemented. **Level 2 (scoped authenticated context) and Level 3 (gated action
proposals) are an open architecture decision and are NOT built** — see
[AI-SUPPORT-REPORT-AUDIT.md](AI-SUPPORT-REPORT-AUDIT.md). Adding tools would
replace *cross-user leakage is impossible by construction* with *correct if the
check is right*, which needs an explicit decision rather than an inference.

Trust boundaries, prompt fencing, citation validation and the AI-disclosure
implementation are documented in [AI-SUPPORT.md](AI-SUPPORT.md).

### Not the same surface: the AI co-pilot

`POST /api/chat` is a **separate product**, not the support assistant. It is
session-gated by middleware, rate-limited 10/min, and routes to `lib/copilot`
with a deterministic tool set (`transaction_status`, `kyc_status`,
`card_control`, `create_support_ticket`). Money movement returns a
`requiresConfirmation` descriptor the client must confirm against a guarded
route — the co-pilot never moves money itself.

Do not conflate the two. The support assistant has no tools; the co-pilot has
tools and its own human-in-the-loop gate.

The "LangGraph Support Agent" from earlier drafts of this analysis does not exist
and is not planned. The co-pilot is a deterministic tool router with optional LLM
phrasing over grounded facts, which is the property that makes it safe to run
against a money API.

## A.4 Zendesk SSO — dormant, optional, not wired to the UI

**Status: dormant in every environment. Not part of any support flow.**

`GET /api/support/sso[?return_to=/hc/...]` — a JWT single-sign-on handoff, so a
signed-in FurlPay user would land authenticated in a Zendesk help centre *if one
were ever configured*.

### What makes it dormant

```ts
if (!subdomain || !secret || !/^[a-z0-9-]+$/.test(subdomain)) {
  return NextResponse.json({ error: "Support SSO is not configured" }, { status: 404 });
}
```

It returns **404 unless both `ZENDESK_SUBDOMAIN` and `ZENDESK_SHARED_SECRET` are
set** *and* the subdomain matches `^[a-z0-9-]+$`. Both are registered as optional
in `lib/env.ts`. Whether they are set in a deployed environment cannot be read
from this repository — but no code path, page, component or link references the
route, so **nothing in the product can reach it even when configured.** The only
mentions anywhere are the route itself, the env registration, the middleware
allowlist entry, and a comment in `lib/support.ts`.

### What it does and does not do

| | |
| :--- | :--- |
| Creates or modifies tickets | **No.** It makes no Zendesk API call of any kind. |
| Reads FurlPay tickets | **No.** |
| Acts as the ticket database | **No.** Our kv layer is the system of record. |
| Acts as the AI or human support backend | **No.** |
| Sends customer data to Zendesk | **Yes** — `name`, `email` and `external_id` (our user id) inside the signed JWT. That is inherent to SSO and is the whole payload. |
| Is it merely an identity handoff | **Yes.** That is all it is. |

### Audit

| Check | Result |
| :--- | :--- |
| Methods | `GET` only |
| Authentication | `requireUser()` — session verify, cross-instance revocation denylist, MCP scope gating, deleted-account tombstone |
| Signed-out behaviour | Redirects to `/login?next=/api/support/sso…` and returns, rather than failing |
| Authorization | Any authenticated user may initiate. Correct for a help-centre handoff: there is no narrower right to hold. |
| Rate limit | **20/min (`support.sso`) — added in this pass.** See below. |
| Open redirect | **None.** `return_to` must start with `/` and not `//`, then is prefixed with the *configured* host. Every tested vector (`//evil.com`, `///evil.com`, `https://evil.com`, `javascript:`, `data:`, `/\evil.com`, `/%2f%2fevil.com`, `/..//evil.com`) either drops or resolves to the configured Zendesk host. The destination origin is never caller-controlled. |
| Credential in URL | **No.** The JWT is a form field in a POST body, never a query parameter — so it stays out of browser history, proxy logs and `Referer`. |
| Caching | `Cache-Control: no-store`; the page embeds a live credential |
| HTML injection | Both interpolated values pass `escapeAttr` (`& " < >`) |
| Secret handling | HMAC-SHA256 signed server-side. The shared secret can mint a session for *any* user, so it is never sent to a client and has no `NEXT_PUBLIC_` form. |
| Replay | `iat` + random `jti` per mint — Zendesk's own replay protection |
| State/nonce | Not applicable. This is not OAuth: no authorization code, no callback route, no state round-trip to validate. |
| Clickjacking | `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`, applied to every path from `next.config.js` |
| CSRF | A GET that mints a credential and auto-POSTs it to Zendesk. Worst case is login-CSRF into the victim's *own* Zendesk session; the JWT is unreadable cross-origin and the page cannot be framed. |

### Two findings fixed in this pass

**1. The CSP would have blocked the handoff on day one.**

The global policy set `form-action 'self'`. This route works by rendering a
self-submitting form that POSTs to `https://<subdomain>.zendesk.com/access/jwt`
— cross-origin, because Zendesk's endpoint accepts only a form POST and CORS
blocks XHR. The inline script would run (`script-src` permits `'unsafe-inline'`)
and the browser would then **block the submission**: the visitor sits on
"Opening FurlPay Support…" indefinitely.

Nothing would have caught this. The route 404s while dormant and no UI links to
it, so the failure would first appear on the day the integration was switched on,
in production, with no local reproduction.

`form-action` now names the Zendesk origin **only when `ZENDESK_SUBDOMAIN` is
set**, and only that exact subdomain — no wildcard. While it is unset, the policy
is byte-for-byte unchanged (verified: 13 directives, `form-action 'self'`). The
value is charset-validated before interpolation, because an env var reaching a
security header could otherwise rewrite the policy rather than extend it
(verified: a value of `evil.com; script-src *` is rejected and leaves the policy
intact).

**2. Nothing rate-limited a credential-minting endpoint.**

Two safety nets skip this route for the same reason — it is a `GET`:

- the middleware baseline (150/min) applies to `MUTATING_METHODS` only;
- `check-route-security.mjs` audits only mutating handlers.

So a clean route-security run has never said anything about this file. It now
calls `rateLimitOr429(req, "support.sso", { limit: 20, windowMs: 60_000 })`.

Regression coverage for all of the above is in
`src/app/api/support/sso/__tests__/sso.spec.ts` (26 tests).

## A.5 External support integrations

### Zendesk

**Status: dormant · optional · disabled by default · not referenced by any UI.**

The repository contains a Zendesk **SSO** integration only. It activates when
`ZENDESK_SUBDOMAIN` and `ZENDESK_SHARED_SECRET` are both configured, and returns
404 otherwise. It is an identity handoff — it creates no tickets, reads no
tickets, and is not part of the ticket create / list / detail / reply flow.

The native FurlPay support portal remains the primary and only support
interface, and our kv registry remains the system of record.

### Chatwoot, DevRev

**Status: not integrated.** Evaluated in Part B as candidates. No code, no
environment variables, no routes.

---

# Part B — Vendor comparison for a future Phase 2 decision

Nothing in this part is integrated. It exists so the decision can be made
quickly if a partner requirement forces it.

## B.1 API architecture comparison

| System | Base API Endpoint | API Specification | Auth Protocol | Developer Testing Tools |
| :--- | :--- | :--- | :--- | :--- |
| **Zendesk** | `https://{subdomain}.zendesk.com/api/v2` | Custom REST / JSON | OAuth 2.0 Bearer, or Basic auth with `{email}/token:{api_token}` (see deprecation note) | Zendesk Public Postman Workspace |
| **Chatwoot** | `https://{domain}/api/v1` | Swagger / OpenAPI (self-hosted: `/swagger`) | `api_access_token` request header (NOT `Authorization: Bearer`) | Local Swagger UI on self-hosted instances |
| **DevRev** | `https://api.devrev.ai` | OpenAPI Specification 3.0 | `Authorization: Bearer {PAT}` (Personal Access Token) | DevRev REST Postman Collection + downloadable OpenAPI specs |

**Verified corrections to the original draft (July 2026):**

1. **Zendesk API tokens are being retired** — permanently deactivated on
   **April 30, 2027**. Any new integration must use OAuth 2.0 access tokens from
   day one; Basic auth with an API token is a dead end. This materially changes
   the integration cost comparison: an OAuth app registration is required, not a
   pasted token. *(Note: this concerns the Zendesk **REST API**, which we do not
   call. The dormant SSO route uses JWT shared-secret signing and is unaffected.)*
2. **Chatwoot does not use Bearer auth for its Application APIs.** The user
   access token (Profile Settings → Access Token) is sent as an
   `api_access_token` header. Platform API keys can only access objects they
   created or were explicitly granted — a real constraint when provisioning
   accounts programmatically.
3. **DevRev `works.create` requires a `part`.** Tickets cannot be created without
   associating them to a product part, so a FurlPay part taxonomy (rails, cards,
   KYC, travel, gateway) must exist there before the first ticket API call works.

## B.2 Endpoint layouts

### Zendesk (modular suite)

- **Ticketing & Core (Support API):** `GET/POST /api/v2/tickets.json`,
  `GET /api/v2/tickets/count.json`, users, groups, macros, triggers.
- **Knowledge Base (Help Center API):** `GET /api/v2/help_center/articles.json` —
  relevant only if the 14-article FurlPay help centre were ever mirrored there.
- **Messaging (Conversations API):** web widget and social channels.
- **Custom Data (Custom Objects API):** could mirror FurlPay ticket categories and
  transaction references into ticket views without exporting ledger data.
- No single static endpoint count exists; the Public Postman Workspace is the
  practical index.

### Chatwoot (3-tier partitioning)

1. **Application APIs** — agent/admin actions:
   `GET /api/v1/accounts/{account_id}/conversations`,
   `POST /api/v1/accounts/{account_id}/contacts`.
2. **Client APIs** — build custom chat UIs using `inbox_identifier` +
   `contact_identifier`, no user password involved. This is the tier a native
   in-app support chat would use.
3. **Platform APIs** — instance administration on self-hosted installs, with the
   created-by-this-key access restriction noted above.

Self-hosted instances expose the full schema at `http://localhost:3000/swagger`.

### DevRev (OpenAPI 3.0, unified graph)

- **Works API:** `POST /works.create`, `GET /works.get` — tickets, issues and
  incidents are all "works", distinguished by type. Creation requires a `part`.
- **Core objects:** Accounts, Artifacts, Parts, Rev Users (customer identities —
  the natural mapping target for FurlPay `userId`).
- **Timeline API:** comments, internal notes, event history per work item.
- Auth: PAT from Settings → Account → Personal Access Token, sent as
  `Authorization: Bearer`. Shown once at creation.

## B.3 If Phase 2 ever happens

Phase 1 — everything in Part A — is shipped and has no external dependency.

| Trigger | Candidate | First integration steps |
| :--- | :--- | :--- |
| Enterprise partner mandates a SOC 2 help desk | **Zendesk** | (1) Set `ZENDESK_SUBDOMAIN` + `ZENDESK_SHARED_SECRET` — the SSO route goes live with no code change, and the CSP now widens to match automatically. (2) Build a UI entry point: **nothing links to the route today**. (3) Register an OAuth app (API tokens die April 2027). (4) Mirror tickets with `POST /api/v2/tickets.json`, mapping FurlPay `user.id` to `external_id` — the identifier the SSO JWT already sends, so support identity survives an email change. |
| Support volume needs multi-agent inboxes + Telegram | **Chatwoot (self-hosted)** | (1) Provision the instance (Rails + Postgres + Redis — a real ops commitment). (2) Create contacts via `POST /api/v1/accounts/{id}/contacts` keyed on FurlPay `userId`. (3) Point a webhook (`conversation_created`, `message_created`) at a new authenticated `POST /api/webhooks/support`, which must verify a shared-secret HMAC over the raw body per FurlPay's webhook rules before touching state. |
| Support must unify with the product backlog | **DevRev** | (1) Model FurlPay parts (rails, cards, KYC, travel, gateway). (2) Create tickets via `works.create` with `type: ticket` and the mapped part. (3) Sync FurlPay users as Rev Users. |

Ticket-sync mapping, whichever candidate wins:

| FurlPay field | Zendesk | Chatwoot | DevRev |
| :--- | :--- | :--- | :--- |
| `user.id` | `external_id` | contact `identifier` | Rev User external ref |
| `ticket.category` | ticket field / custom object | conversation label | `part` |
| `ticket.id` | external ref custom field | conversation `additional_attributes` | works display id |

**Compliance rule that survives any platform choice:** ticket bodies may
reference transaction hashes, but ledger data itself is never exported — an
external platform gets pointers, FurlPay's kv/ops feeds remain the system of
record, and any support action that mutates user state (card limits, MFA resets)
is executed through FurlPay's own authenticated APIs so it lands in the
`ops:security` event feed.

---

Sources: [Zendesk security and authentication](https://developer.zendesk.com/api-reference/introduction/security-and-auth/), [Zendesk API token → OAuth migration](https://developer.zendesk.com/documentation/api-basics/authentication/oauth-migration/), [Chatwoot APIs](https://developers.chatwoot.com/contributing-guide/chatwoot-apis), [Chatwoot personal access token](https://www.chatwoot.com/hc/user-guide/articles/1757445004-how-to-find-your-personal-access-token-in-chatwoot), [DevRev getting started](https://developer.devrev.ai/api-reference/getting-started), [DevRev works.create](https://developer.devrev.ai/public/api-reference/works/create).
