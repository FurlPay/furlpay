# Ready-to-Post Drafts

Formula: **Hook** (first 2 lines) → **Connection** (the struggle) → **Value** (the insight) → **CTA** (a real question). Copy-paste, tweak the voice, ship.

---

## Draft 1 — [AGENTIC] The non-human customer (Day 1)

> The most active payments customer of 2026 isn't a human.
> It's an AI agent — and it can't use a credit card.
>
> Every autonomous agent that calls an API, buys data, or pays for compute needs to settle in real time, per request. Card rails were built for humans with accounts, cards on file, and chargebacks. None of that maps to a script making 10,000 micro-payments an hour.
>
> That's the gap x402 fills: HTTP's dormant "402 Payment Required" status, revived so any agent pays per-call in USDC — no account, no key, no card. ~$600M annualized already moves this way on Base and Solana.
>
> We built FurlPay's FX API on it: $0.01 USDC per call, no signup.
>
> What's your policy on letting AI agents spend money autonomously — hard caps, allowlists, or not yet at all?

---

## Draft 2 — [COMPLY] Five ways to rob an AI agent (Day 3, carousel)

> You can rob most x402 servers in five ways. We built ours so you can't.
>
> x402 adoption outran x402 security. Three 2026 papers documented working attacks against naive servers across four classes — and most implementations in the wild defend none of them:
>
> 1. Authorization — pay $0.000001 for a $10 resource, or pay on the wrong chain.
> 2. Binding — a payment quoted for one endpoint unlocks a pricier one.
> 3. Replay — one signed authorization redeemed unlimited times.
> 4. Web-layer — a malformed header crashes the parser into giving the resource away free.
>
> Every one of these steals from the API provider, quietly, at machine speed.
>
> Here's how we close all four by construction (not by checklist): [link in comments]
>
> If you're shipping an x402 endpoint — which of these four are you defending today?

*(Carousel slides: 1 title, 4 attack slides, 1 "how we fix it", 1 CTA.)*

---

## Draft 3 — [AGENTIC] Unit economics of $0.01 (Day 8)

> Why would anyone price an API call at one cent?
> Because for an AI agent, one cent is the difference between "usable" and "unusable."
>
> A human buys an FX quote once. An agent hedging a treasury might pull 50,000 quotes a day. At card-processing minimums (~$0.30 + 2.9%), that's economically impossible. At $0.01 flat in USDC, it's a rounding error.
>
> Machine payments aren't small human payments. They're a different volume-and-margin regime, and the rails have to match.
>
> If you're building agent infrastructure — what's the smallest payment you'd need to charge, and can your current processor even do it?

---

## Draft 4 — [BUILD] The MPC key-recovery decision (Day 18)

> We spent three weeks arguing about a feature most users will never see.
>
> The question: what happens when someone loses access to their wallet? The easy answer is "not our problem — it's self-custody." The honest answer is that "you lost your seed phrase, your money is gone forever" is not a product mid-market businesses will adopt.
>
> So we built 2-of-2 MPC key recovery: no single point of failure, no seed phrase to lose, no custodian holding your funds. It cost us weeks. It's the reason a CFO will sign off.
>
> Sometimes the invisible work is the whole product.
>
> Founders — what's the least visible thing you built that turned out to matter most?

---

## Draft 5 — [COMPLY] Auth IS the payment (Day 22)

> For humans, authentication is a login.
> For AI agents, authentication is the payment itself.
>
> There's no username, no session, no OAuth handshake with an autonomous agent. The signed payment is the only thing proving the caller is allowed to have the resource. That means your payment verification isn't a billing concern bolted on the side — it's your entire security boundary.
>
> Get it wrong and you're not just losing revenue; you're serving your product to anyone who can forge a header.
>
> If payment == auth, how are you thinking about verification — same team as billing, or same team as security?

---

*Reuse the Value section of each as the seed for a company-page reshare with a different one-line intro.*
