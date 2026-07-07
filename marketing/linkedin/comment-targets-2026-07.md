# Comment Targets — Week of July 5, 2026

Live posts found via the LinkedIn MCP (sanctioned channel). Comment **as the
FurlPay Page** (switch identity under the comment box). Adapt wording — never
paste verbatim; one comment per company per day max. Log named-lead touches in
`leads.csv` → `warmed_comment_date`.

---

## Priority 1 — Together AI (top Segment A lead, Series C JUST CLOSED)

Their `leads.csv` hook ("$800M Series C ~Jul 1") is now confirmed and live on
their feed. This is the week to get on their radar — after this week the
congrats window closes.

**T1. CEO article: "The Economy of Tokens" by Vipul Ved Prakash** — posted 1d
ago, only 4 reactions, **0 comments**. The CEO wrote about inference tokenomics
and nobody has engaged. Highest-visibility comment available this week.
> Suggested comment: "The economics framing is right — once open models win on
> cost, the billing layer becomes the bottleneck. Token pricing solved the
> human-buys-inference case; agent-buys-inference at machine speed still runs
> on rails that can't price a $0.001 call. That's the layer we build (hardened
> x402, $0.01/call in USDC) — good to see the tokenomics conversation moving
> up the stack."

**T2. Series C week-in-pictures post** — 16h old, 42 reactions, 1 comment.
Fresh, uncrowded (the main announcement 3d ago already has 19 comments).
> "Congrats to the whole team — four years of betting on open source paying
> off. As more workloads move to competitive inference, per-call economics
> become the differentiator, and that's a payments problem as much as a
> kernels problem. Rooting for you."

**T3. Watch July 8:** Vipul's RAISE Summit fireside "AI Sticker Shock: Open
Source as the Answer to Broken Tokenomics." Comment on the recap post the day
it appears — the "broken tokenomics" frame is FurlPay's exact wedge.

**People to track for later personal outreach** (fills the empty `profile_url`
column for the Together AI row): Vipul Ved Prakash (CEO, /in/vipulved),
Zain Hasan (AI/ML, very active poster, /in/zainhas), Hassan El Mghari (DevEx).

## Priority 2 — Circle (watering hole; their audience is our ICP)

**C1. Circle Agent Stack post** ("An agent pays 0.007 USDC and continues
automatically") — 2d, 22 reactions, **1 comment**. Their flagship agentic
narrative, near-zero engagement.
> "This is the right UX for machine customers — no card, no signup, no broken
> paywall. The next question the space has to answer is security: autonomous
> payment flows need replay and binding protection before enterprises trust
> agents with budgets. We published a breakdown of the four x402 attack
> classes from running our own $0.01/call API — the agentic-payments stack is
> maturing fast."

**C2. Machine Payments Protocol (MPP) spec post** — 1w, 60 reactions, 4
comments. A USDC method spec for agent payments across EVM + Solana.
> "Standardization is what this space needed — fragmented agent-payment
> methods were becoming the new card-network lock-in. We settle x402 flows on
> both Base and Solana, so a chain-agnostic spec with crosschain support via
> Gateway is directly useful. Reading the spec now."

**C3. BNY adds USDC (CCO Kash Razzaghi's repost)** — 5d, 546 reactions, 8
comments. Highest-traffic thread; institutional-validation angle.
> "The oldest bank in the US offering USDC settles the 'is this real
> infrastructure' debate. The next tier of adoption is mid-market platforms
> that BNY won't serve directly — that's where settlement-cost math (flat vs
> 2.5–4% interchange) does the convincing."

**C4. Register: "Banking on Stablecoins" webinar — Tue July 7, 2pm BST.**
EMEA banking audience. Attend, note engaged commenters → they're self-
identified prospects for the pipeline.

**C5. Zebec Network cross-border payroll post** — Segment B watering hole.
CAUTION: Zebec itself is payout infrastructure (coopetition — don't pitch them),
but commenters on payroll/USDC posts are Segment B prospects.

## Priority 3 — Visa (2.6M followers; stablecoin + agentic posts, low comment counts)

Visa's feed this week is unusually aligned with FurlPay's two wedges (OUSD
and agentic payments). Comments here reach the largest audience on the list.

**V1. Visa supports Open USD (OUSD)** — 4d, 476 reactions, 17 comments, 79
reposts. Their biggest stablecoin post of the week. FurlPay has a published
OUSD adoption post — one of the few companies our size with a public position.
> Suggested comment: "The consortium structure is what makes this different
> from previous stablecoin cycles — free mint/redeem with reserve revenue
> shared across partners changes the economics for everyone routing volume
> through it. We announced OUSD support alongside USDC at FurlPay for exactly
> that reason: settlement infrastructure should not be locked to a single
> issuer's balance sheet. Good to see Visa bridging it to existing rails."

**V2. Cuy Sheffield video: what pain points stablecoins actually solve** — 2d,
112 reactions, only 3 comments. Sheffield leads Visa's crypto division; his
threads are read by the entire crypto-payments ecosystem.
> "The pain-point framing is the right one. In our experience the sharpest
> pain is mid-market and below: platforms moving supplier payouts cross-border
> lose 2.5-4% plus days of float on rails built for a different era. Stablecoin
> settlement with local-currency deposit solves that today — the challenge is
> distribution, not technology."

**V3. Jack Forestell: "The agentic era in 90 seconds"** — 3w, 1,079 reactions,
10 comments. Highest-traffic agentic-payments thread on LinkedIn right now.
> "The trust layer is the whole game. Agents already plan and decide well;
> what they lack is a payment primitive with cryptographic authorization
> scoped to intent. That is what the x402 pattern gets right — payment bound
> to a specific resource, replay-protected, settled in stablecoin. We run a
> production x402 API and the demand signal from agent developers is real."

**V4. Oliver Jenkyn: agents that shop — three hurdles (technology, psychology,
business)** — 3w, 635 reactions, 5 comments.
> "The psychology hurdle is underrated. Users happily let agents plan but
> hesitate the moment money moves — OpenAI saw this directly with travel
> checkout in ChatGPT. Our view: trust transfers when authorization is
> verifiable and refunds are instant. Solve the money-movement trust gap and
> the other two hurdles shrink."

**People worth tracking from Visa's orbit** (ecosystem nodes, not leads):
Cuy Sheffield (crypto lead), Jack Forestell (CPSO). Their commenters are
self-identified agentic-payments prospects — harvest for the pipeline.

## Follow-up actions

- **Payslip lead:** the `payslip` LinkedIn slug is a different company (a
  small South African payroll software shop, 265 followers). Find the global
  payroll Payslip (payslip.com, Ireland, Salica-funded) manually and record
  the correct URL in `leads.csv` before any outreach.
- Pull Coinbase (x402 originators), Visa, and remaining `leads.csv` companies
  (Groq, Fireworks, Papaya Global, Travorio) on the next run — 3–5 targets
  per week keeps every comment high-quality.
- After each comment: check the FurlPay Page Inbox daily; reply with the
  templates in `page-engagement-playbook.md` §6.
