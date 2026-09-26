# Support portal

The customer-facing support surface in `apps/web`: a help centre, ticket
creation, a ticket list, the ticket conversation, and a grounded AI assistant.

Written after a build/audit pass on `extension-redesign`. Where a claim here is
unverified it says so.

## Routes

| Route | Rendering | Purpose |
| --- | --- | --- |
| `/support` | static | Support centre, categories, help articles |
| `/support/new` | static | Create a ticket |
| `/support/tickets` | static | Your tickets — search, filters, status |
| `/support/<id>` | dynamic | The conversation |

**The detail route is `/support/<id>`, not `/support/tickets/<id>`.** Anything
linking a ticket must use `ticketHref()` in
`app/support/tickets/ticketList.ts` — one helper, so the page and its tests
cannot disagree.

### The routing bug this layout fixes

`/support/new` and `/support/tickets` were linked from the navbar before either
route existed. Next.js matched `/support/new` against the dynamic `[id]`
segment, so the detail page fetched `GET /api/support/tickets/new`, that 404'd,
and the create page rendered **"Could not load this ticket."** — an error
accurate about what happened and useless about why.

Both are now static segments, and a static segment always beats a dynamic
sibling. The build manifest is the proof: `/support/new` and `/support/tickets`
appear as their own `○ (Static)` entries alongside `ƒ /support/[id]`. A dev
server returning 200 would not have shown this.

## Data model

`lib/support.ts`. The stored record is:

```
SupportTicket   id, userId, email, category, subject, body, status, refs,
                createdAt, updatedAt
SupportMessage  id, ticketId, author ("user" | "agent" | "system"), body, createdAt
```

Categories are a six-value enum: `stablecoins`, `cards`, `kyc`, `travel`,
`developers`, `other`. The UI labels `stablecoins` as "Wallet & Payments" — the
label may differ from the key, the key may not, because `PATCH` validates
against the enum and an invented key is a 400 the user experiences as a button
that silently does nothing.

**There is no `priority`, `issueType`, `network`, `channel` or attachment
field.** The create form collects issue type and network because they help a
human triage, and folds them into the body text rather than posting fields the
API would drop. Priority is deliberately not collected: a control that cannot
affect anything is a promise nothing keeps, and "Urgent" is the one people would
lean on.

## Authorization

Enforced server-side at the query layer, not in the UI.

```ts
const ticket = await getTicketForUser(auth.account.user.id, params.id);
if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });
```

`getTicketForUser` checks an owner index *and* scopes to the caller's own list.
A non-owner receives **404, not 403** — deliberately, so ticket ids cannot be
used as an existence oracle.

Other properties, probed against a running server rather than assumed:

- Anonymous `GET`/`POST` on ticket routes → 401.
- A `userId` in a request body is ignored; the owner comes from the session.
- A `status` in a create body is ignored.
- `author` is hardcoded server-side on message creation, so a client cannot post
  as FurlPay Support.
- Rate limits: tickets read 60/min, message 20/10min, ask 15/min.

### Data minimisation in the list

`GET /api/support/tickets` returns the **full** stored record — `userId`,
`email` and `body` included. `toRows()` narrows to the six fields a row renders
before anything reaches the DOM, so the row component is never handed the
private fields at all. Tests assert both the absent properties and that
`JSON.stringify` of a row contains none of the private values — the realistic
leak is a debug attribute, not someone reading `row.email`.

## AI assistant

Posts to `POST /api/support/ask`, which is RAG over the published help-centre
articles.

The contract is `{ message, history }` and the schema is `.strip()`; it returns
`{ answer, sources, grounded, escalate }`. Sending `{ question, context }` —
which an earlier version of the sidebar did — is rejected outright, so every
question 400'd silently.

Ticket context is prepended to `message` as a labelled line, because there is no
`context` field. **Only the subject and status go in.** A ticket body can hold a
transaction hash, an email or an amount, and none of that helps answer a help
question.

Security posture — **[docs/AI-SUPPORT.md](AI-SUPPORT.md) is the full account**,
including the trust levels, the prompt fence, and what the tests do and do not
prove. In short:

- The route takes no ticket id, imports no ticket store or auth, and exposes no
  tools, so cross-user leakage is impossible by construction rather than by the
  model cooperating.
- Retrieved articles are fenced with a per-request random nonce, so a question
  cannot forge a corpus entry.
- Input passes `redactSecrets()` — visitors paste seed phrases regardless of
  what the form says.

An earlier version of this section claimed two prompt-injection probes "refused".
**That was wrong**: with no `ANTHROPIC_API_KEY` set locally, those replies came
from the extractive fallback, not from the model resisting injection. Model
robustness is untested.

`escalate` is the server's judgement, not a keyword match in the client.

## Components

`components/support/`:

- `SupportChrome` — navbar, hero, globe, breadcrumb, and `AccountMenu`, which
  reads the real user from `GET /api/profile`. A signed-out visitor gets a sign
  in link rather than a fabricated identity.
- `TicketThread` — alert, header, status pill, actions, message, composer.
  Messages branch on three authors; branching only on `agent` renders the
  `system` note as the customer, putting words in the user's mouth.
- `SupportSidebars` — ticket details, related articles, AI assistant, contact
  options.

### Colour

The palette is near-black, white/grey, and `neon` (#00E599). That costs one
distinction: the older page used amber and sky to separate `waiting` from
`in progress`, and hue can no longer carry it. The **label** does instead
("Awaiting your reply" vs "In progress"), and the status dot is neon only for
live states so a closed ticket still reads as finished at a glance.

## Verification status

Local, on `extension-redesign`. **GitHub Actions is billing-locked**, so no CI
run gates any of this.

Done:

- Production build exits 0; support routes confirmed distinct in the manifest.
- `vitest` 4294 passed / 0 failed. `tsc` clean. `check-route-security` clean.
- SSR/HTTP pass on `next start`: every support route 200, real content, no
  broken chunks, no error markers.
- Authorization probes above, run against a live server.

Not done:

- **No browser pass.** No Playwright or Puppeteer is installed. Hydration,
  client-side runtime errors, console output, layout and responsive behaviour
  are unverified on every page in this portal.
- **No authenticated end-to-end run** of create → list → detail → reply.
- Attachments and internal support notes do not exist in the model. Nothing to
  secure yet, and nothing to claim is secured.
- No agent/admin role separation; `/api/support/tickets/<id>/agent` exists and
  has not been audited here.
