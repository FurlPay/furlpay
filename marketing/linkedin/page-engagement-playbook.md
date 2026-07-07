# FurlPay Company-Page Engagement Playbook

Goal: generate pilot-customer leads **as the FurlPay Page** (not the personal
profile) via comments and messages — done professionally and inside LinkedIn's
rules. Companion to `outreach-templates.md` (personal-profile sequences) and
`watering-holes-travala-tripcom-visa.md` (where prospects gather).

---

## 1. What a Company Page can and cannot do (read first)

| Action | As FurlPay Page | Notes |
| :-- | :-- | :-- |
| Comment on any post | Yes — manual, in the UI | Click your avatar under the comment box → switch identity to **FurlPay**. This is the core Page-voice tactic. |
| React to posts / follow Pages | Yes — manual | Builds the Page's visible activity trail. |
| Reply to messages in the **Page Inbox** | Yes | Only after the member messages the Page first. Enable Pages messaging in Page settings → allow "Messages". |
| **Send a cold DM to a member** | No — impossible | LinkedIn does not allow Pages to initiate DMs — no setting, no Premium tier, no API changes this. |
| InMail / connection requests | No — Pages can't | Outbound DMs only exist from personal profiles (InMail needs Premium/Sales Nav). |
| Comment/post via API | Blocked for now | Needs Community Management API approval (`w_organization_social`). Until then everything Page-voice is manual in the UI. |

**The strategy that follows from this:** the Page *comments* (visible, public,
compounding); the Page *replies* in its inbox; the human (Ashutosh) carries any
outbound DM. Every Page comment must therefore do two jobs — add value to the
thread AND give the prospect a reason to message the Page or visit it.

## 2. The funnel

```
Prospect posts / comments on a watering-hole post
        │
FurlPay Page leaves a value-adding comment  (public, seen by whole thread)
        │
Prospect visits Page → follows / clicks furlpay.com → messages Page Inbox
        │                                                    │
Page replies in inbox (templates §6)            No inbound after ~1 week?
        │                                                    │
Qualified → sandbox key / 15-min call      Personal-profile connect (outreach-templates.md)
```

## 3. Where to comment (post-finding checklist — run 3×/week, ~20 min)

Work through these in order; target **3–5 quality comments per day** as the Page.
LinkedIn actively deprioritizes Pages that spray generic comments — fewer, sharper.

1. **Visa / Mastercard / Circle / Coinbase stablecoin-settlement posts** — every
   post about USDC settlement, stablecoin rails, or agentic payments. The
   commenters on these posts are self-identified prospects; the thread audience
   is exactly FurlPay's ICP.
2. **Lead-company announcement posts** (from `leads.csv`): funding news from
   Together AI, Talp, Payslip; product launches from Groq, Fireworks, Alternative
   Airlines, CheapAir. Comment as the Page with a congratulation + one
   substantive observation. Never pitch in the comment.
3. **Hashtag feeds**: `#x402`, `#stablecoins`, `#agenticpayments`,
   `#crossborderpayments`, `#travelpayments`. Engage original posters —
   mid-market founders posting here have zero comments and remember every one.
4. **OUSD news-cycle posts** (time-sensitive, July 2026): anything about Open
   Standard / OUSD. FurlPay has a published adoption post to reference — few
   companies our size have taken a public position.
5. **Trip.com affiliate & travel-tech posts** complaining about payout delays /
   FX — direct Segment B pain, comment with empathy + the 0.5% fact.

## 4. What each segment wants (requirements analysis)

### Segment A — AI agent & API providers (Together AI, Fireworks, Groq, inference.net, Talp)
**Their world:** per-call/per-token billing at massive volume; margins measured
in fractions of a cent; agents (not humans) increasingly the paying customer.
**What they need and ask for publicly:**
- Billing infra that works at **machine speed and machine volume** (thousands of
  $0.001–$0.01 calls) — card rails can't price this.
- **Security guarantees** for autonomous payments — replay/binding attacks are
  their nightmare (an exploited agent = drained budget + PR disaster).
- **No integration drag** — they ship weekly; anything that takes a quarter to
  integrate is dead on arrival.
- Proof it works: a live endpoint beats a deck. (`curl https://furlpay.com/api/x402/fx` returns a real 402 quote.)
**Page comment angle:** technical credibility. Cite the four x402 attack classes,
the $0.01/call FX API, the live 402 endpoint. Never "we should talk."

### Segment B — Cross-border platforms & travel (Payslip, Papaya, Playroll, Travorio, CheapAir, Alternative Airlines)
**Their world:** finance leaders moving money to suppliers/employees in 100+
countries; every transfer loses 2.5–4% to interchange/SWIFT plus 2–60 days of
settlement float.
**What they need and ask for publicly:**
- **Predictable, lower settlement cost** — a flat rate they can model (0.5%)
  beats a variable one they can't.
- **Local-currency bank deposit** — their suppliers don't want crypto; the
  stablecoin must be invisible.
- **Compliance cover** — MiCA/Travel-Rule handled by the rail, not by their team.
- **One integration**, because their eng resources belong to the core product.
**Page comment angle:** CFO empathy + one hard number (fee % or settlement days).
Travel subset: reference the Travala/x402 architecture as proof the model works.

## 5. Page comment templates (adapt, never paste verbatim)

**A. On a Visa/Circle/Coinbase stablecoin-settlement post:**
> Visa settling on 9 chains makes the thesis official: stablecoin settlement is
> infrastructure now, not an experiment. The open question is who serves the
> mid-market platforms below the Visa-partner tier — settlement at a flat 0.5%
> with local-currency deposit is what we build for exactly that gap.

**B. On a lead company's funding announcement (Segment A):**
> Congrats to the team — [specific: open-model inference at this scale] is
> exactly the workload where per-call billing gets interesting. Once agents are
> the customers, the billing rail has to survive replay and binding attacks; we
> published a breakdown of the four x402 attack classes if useful to your team.

**C. On a travel/payout-pain post (Segment B):**
> The 40–60 day affiliate settlement window is the quiet killer here — the FX
> spread gets taken twice before the money lands. This is solvable today:
> stablecoin rail in the middle, local-currency deposit at the end, flat fee.
> Happy to share how the math works out for mid-market platforms.

**D. On OUSD / stablecoin-news posts:**
> The consortium structure is the story — free mint/redeem with reserve revenue
> distributed to partners changes the economics for every platform routing
> volume through it. We took a position on this early: FurlPay settles on both
> USDC and OUSD so users aren't locked to one issuer's risk.

Rules: one idea per comment · a number or fact in every comment · no links in
the comment itself (kills reach; the Page name IS the link) · never pitch a
meeting in public · **NO emojis, ever, in anything sent as FurlPay** — comments,
inbox replies, posts, InMails. Plain professional prose only (brand rule).

## 6. Page Inbox reply templates (when prospects message the Page)

**First reply (within 4 business hours — Pages display response time):**
> Thanks for reaching out to FurlPay. Quick context so we point you right:
> are you looking at (1) pay-per-call billing for AI agents/APIs, or
> (2) cross-border settlement for a platform or travel business?
> Either way — live docs at furlpay.com/docs and the x402 endpoint is public if
> you want to test before we talk.

**Segment A follow-up:**
> The fastest way to evaluate us is the live endpoint:
> `curl https://furlpay.com/api/x402/fx` returns a real 402 quote — $0.01
> USDC/call, hardened against the four documented x402 attack classes.
> If it fits, we'll issue a sandbox key — no call required. What's your
> agent/API stack?

**Segment B follow-up:**
> Short version: Furlpay Connect settles cross-border at a flat 0.5% with
> local-currency deposit into the recipient's bank — one integration.
> For a platform moving $1M/month that's ~$20–35K/year saved vs interchange.
> Happy to walk your finance lead through the dashboard in 15 minutes, or send
> the integration doc first — whichever is lighter for you.

**Not-a-fit / vendor spam:**
> Thanks for the note — not a fit for us right now, but appreciate you thinking
> of FurlPay.

## 7. Cadence & tracking

- **Daily (15 min):** 3–5 Page comments from §3 sources. Log each in
  `leads.csv` → `warmed_comment_date` when the target is a named lead.
- **Daily:** check Page Inbox; reply within 4 hours using §6.
- **Weekly:** 100–250 "Invite to follow" credits → spend on commenters from
  watering-hole threads (they've self-identified as interested).
- **Metric that matters:** Page-comment → profile-visit → inbox-message
  conversion. Follower count is the vanity metric; inbox messages are the lead
  metric.

## 8. Ground rules (inherited from README.md — non-negotiable)

- All Page engagement is **manual in the LinkedIn UI**. No automation acts on
  LinkedIn on FurlPay's behalf (the API can't yet anyway; when Community
  Management API is approved, automation may draft but a human still approves).
- No scraping, no stealth tooling (`scout.ts`/`warm.ts` stay unused).
- Competitors in `leads.csv` §COMPETITORS are never pitched, in any voice.
- 15–20 personalized touches/day ceiling across ALL channels combined.
