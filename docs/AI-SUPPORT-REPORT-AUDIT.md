# Audit of the September 2026 support-architecture reports

Two pasted reports — "Comprehensive Architecture & Engineering Report" and
"2026 UI/UX Engineering & Design Report" — checked claim by claim against this
repo and against primary sources before any of it was built.

Verdict: **the external research is largely sound; the repo claims are stale in
both directions.** Several items the reports list as work to do already exist,
and the reports missed the two defects that were actually live.

## External claims — verified

| Claim | Status | Source |
| --- | --- | --- |
| OWASP LLM Top 10 **2026** exists; published Aug 4 2026 | **True** | [OWASP GenAI](https://genai.owasp.org/llm-top-10/) |
| LLM08 is **Hidden Context Exposure**, replacing 2025's System Prompt Leakage | **True** | [Imperva](https://www.imperva.com/blog/owasp-llm-top-10-2026-what-changed/) |
| LLM01 Prompt Injection, LLM02 Sensitive Info Disclosure, LLM03 Excessive Agency, LLM06 Unbounded Consumption | **True** | [Aembit](https://aembit.io/blog/the-owasp-top-10-for-llm-applications-2026-what-changed-and-why-it-matters/) |
| LLM10 name | **Slightly off** — it is *Improper* Output Handling, not "Insecure" | as above |
| EU AI Act Art. 50 requires telling people they're talking to AI | **True** | [EC digital-strategy](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act) |
| Art. 50 applies from **2 August 2026** | **True — in force now** | [artificialintelligenceact.eu](https://artificialintelligenceact.eu/transparency-rules-article-50/) |
| A vague "assistant" reference is not sufficient disclosure | **True** — must be perceivable in the interaction itself | as above |

The OWASP mapping in the report is accurate and was adopted as-is. Art. 50 being
already in force is what promoted the AI-identity work from "nice" to "do now".

## Repo claims — audited

| Report claim | Reality |
| --- | --- |
| Phase 1: "Add `assistant` to `MessageAuthor`" | **Present but uncommitted.** `lib/support.ts:64` had all four values in the working tree; `git diff` shows the fourth was never committed (this branch takes concurrent commits from several sessions). So it is neither "already done" nor missing — it was half-landed, which is exactly how the rendering gap below survived. Committed here. |
| KB has "14 Docs" / "14 corpus entries" | **14 is right.** An earlier note of mine said 15; the array has 14 entries. |
| Target file `SupportChatBubble.tsx` (cited 3×, "High" priority) | **Exists** — `components/marketing/SupportChatBubble.tsx`, 742 lines. I first recorded this as fabricated because I searched only `components/support/`; the report was right and I was wrong. It is the site-wide chat widget and the busiest AI surface in the app. A second surface, `AIAssistant`, lives in `components/support/SupportSidebars.tsx`. |
| `isSource` validator, listed as an existing LLM10 defence | **Did not exist.** Now does, as `lib/support/sources.ts`. |
| "High: 15-Min Rate Lock Countdown Bar" in travel checkout | **Already built** — `app/travel/checkout/page.tsx:174`. |
| "Medium: Non-Destructive Quote Refresh" | **Already built and correct.** At `00:00` the button becomes "Rate expired — refresh rate" and refuses to pay; form state survives. |
| "FurlPay defaults travel settlement to USDC on **Base**" | **False.** `lib/x402.ts:54` defaults to **Arbitrum One**. Base is supported, not default. The report's email and GenUI mockups repeat the wrong network. |
| `lib/push.ts` as a notification target | **Exists.** |
| Tri-pane agent console → `app/support/[id]/page.tsx` | **Wrong file.** That is the *customer's* thread view. Building a Customer-360 agent console there would put an internal support tool on a customer-facing route. |

## What the reports missed

Two live defects, neither mentioned:

1. **`author: "assistant"` rendered as the customer.** `MessageAuthor` had four
   values; `TicketThread` branched on three. The unhandled value didn't throw —
   it fell through to the customer branch and rendered under the customer's own
   name, avatar and "Customer" badge. Identical to the `system` bug fixed
   earlier. The report said "add the type value" (already done) and never asked
   whether anything rendered it.

2. **Cited source hrefs rendered through `next/link` unvalidated.** The report
   *asserted* an `isSource` validator already existed. It didn't. Every href is
   a committed constant today, so nothing was exploitable — but the render is a
   navigation primitive built from data, and `//evil.com` is not blocked by
   React and looks root-relative at a glance.

## Internal contradiction worth flagging

§4.1 lists `card.freeze` and `refund.execute` as **strictly prohibited** tools.
§6.1 then shows the AI rendering a GenUI card with an **`[Update Limit to $200]`**
button, and §3 shows `[Unfreeze Card]` and `[Extend Travel Quote Lock]` as
agent-side actions. A spending-limit change is a financial state change on the
same prohibited list. The prohibition is the right call; the mockups contradict
it.

## The thinking-indicator brief

A third brief specified the three-dot "progressive reasoning" indicator. Built,
with one substantive deviation: **its status labels were replaced.**

The brief supplied *"Verifying Arbitrum deposit…"*, *"Verifying Layer-2 block
times…"*, *"Checking card limits & 3DS rules…"*, *"Analyzing decline reason…"*.
`/api/support/ask` retrieves help articles and writes an answer from them. It
holds no tools and cannot read a balance, a card, a ticket or a chain. Those
labels would invent a capability in front of someone waiting to learn what
happened to their money.

The three phases now describe retrieval, generation, and elapsed time — the only
things a client can truthfully know. The `steps?: string[]` prop from the brief
was also dropped: its own usage example filled it with "Verifying blockchain
status…", and a free-form label slot is how a fabricated step ships later.
Tests assert no label contains `verif`, `chain`, `balance`, `card limit`, `3ds`,
`deposit` or `ticket`.

Also deviated: `Stop` was specified as a UI affordance. It now aborts the real
request on both surfaces.

## Built from these reports

Only where a real gap existed:

- `lib/support/sources.ts` — `isSafeSourceHref` / `safeSources` (LLM10).
  Wired into `answer.ts` server-side and re-applied at the client render.
- `TicketThread.tsx` — fourth author branch with a distinct AI identity:
  Sparkles icon (**not** the FurlPay mark, which identifies a human
  specialist), badge reading "AI — not a human", and a per-message disclosure
  line. Art. 50(2).
- `SupportSidebars.tsx` — per-turn AI disclosure in the live chat, distinct
  panel avatar, validated source links, and a real `AbortController` so Stop
  cancels instead of just hiding the spinner.
- `AIThinkingBubble.tsx` + `.ai-thinking-dot` in `globals.css` — the waiting
  state, shared by both AI surfaces.
- `SupportChatBubble.tsx` (the site-wide widget) — `safeSources` on its **raw
  `<a href>`** citations, explicit "AI assistant / not a human / Automated"
  disclosure in the greeting, home tab and header, the shared thinking bubble,
  and a fix to its `finally` clause (see below).
- Tests: `sources.spec.ts`, `ticketAuthor.spec.tsx`,
  `aiThinkingBubble.spec.tsx`, `supportChatBubbleAbort.spec.ts`.

### Two bugs found by building this

1. **The Stop button was invisible to screen readers.** `aria-hidden` was on the
   whole dots row, which removed the Stop control from the accessibility tree
   along with the decoration — the one control that matters most while waiting.
   Caught by a test, not by review.

2. **A user-initiated Stop would have bricked the widget.**
   `SupportChatBubble.send()` ended with
   `finally { if (!ac.signal.aborted) setThinking(false); }`. That was correct
   while the only abort was a *supersede* (a newer send, which immediately sets
   `thinking` true again and owns it). A Stop has no successor, so `thinking`
   stayed true: dots spinning forever and the composer disabled, since both the
   submit button and the `send()` guard key off it. Now
   `if (inflight.current === ac)`, which distinguishes the two aborts. The old
   rule is kept as an executable regression test.

## Deliberately NOT built

**Level 2 / Level 3 tools** (`support.read_own_ticket`, `support.create_ticket`,
`support.append_own_ticket`). This is the report's centrepiece and it is a real,
well-established architecture. It is also the single change that would dismantle
the guarantee documented in `AI-SUPPORT.md`:

> cross-user leakage is impossible because the module cannot address another
> user's data at all

Tools replace *impossible by construction* with *a check that has to be right
every time*. That is a deliberate, reviewable trade — and the brief that
commissioned the current design said the first production architecture should
not be an autonomous agent, and said not to overbuild. So it needs an explicit
decision, not an inference from a report. The report's own server-authorization
pipeline (§4.3) is the right design **if** that decision is taken.

Also not built, with reasons:

- **Tri-pane agent console** — wrong route (see above), and no agent/admin role
  separation exists yet to gate it.
- **Travel rate lock / non-destructive refresh** — already built and correct.
- **GenUI financial action cards** — contradicts the report's own §4.1.
- **Token-coalescing stream ergonomics** — `/api/support/ask` returns a single
  JSON body, not a token stream. Nothing to smooth until it streams.
- **Struggle-detection telemetry, NBA tiles, Live Activities, 35-case eval
  suite** — each is a feature programme, not a gap; none has a defect behind it.

## Verification

`tsc` clean · full suite green (241 files, 4344 tests) · production build exit 0
· `check-route-security` clean · the new author branch mutation-tested (reverting
it fails 3 tests, including the customer-misattribution one).

One full-suite run aborted a single file with 12 tests skipped and could not be
reproduced across two subsequent clean runs. Recorded, not explained.

**No browser pass** — no Playwright or Puppeteer is installed, so the new
rendering is verified in jsdom only. **GitHub Actions is billing-locked**, so no
CI gates any of this.
