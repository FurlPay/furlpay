import type { CategoryId } from "@/lib/blog/categories";

// Blog content lives here as structured blocks (MDX-style authoring without an
// external MDX pipeline). Article pages render these via ArticleBody; the feed
// and category pages read the frontmatter fields.

export type Block =
  | { type: "h2"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "code"; lang: string; code: string }
  | { type: "quote"; text: string }
  | { type: "diagram"; text: string }
  // Comparison/data tables. The first cell of each row renders as a row
  // header; highlightCol tints one column (0-indexed into headers/rows) —
  // used to spotlight the Furlpay column in competitive matrices.
  | { type: "table"; headers: string[]; rows: string[][]; highlightCol?: number };

export type Post = {
  slug: string;
  title: string;
  excerpt: string;
  category: CategoryId;
  date: string; // ISO date, YYYY-MM-DD
  readMins: number;
  author: string;
  featured?: boolean;
  cover?: string; // real photo URL (hotlinked Unsplash CDN); CSS art fallback when absent
  body: Block[];
};

export const POSTS: Post[] = [
  // 0 -----------------------------------------------------------------
  {
    slug: "why-we-built-furlpay-stablecoins-agents-arbitrum",
    title: "Why We Built Furlpay Around Stablecoin Payments, AI Agents and Arbitrum",
    excerpt:
      "Merchant payment fees run 1.5-3.5% on card rails. Stablecoin payments on Arbitrum cost a fraction of that — and the industry's biggest players are moving the same direction. Here is the thesis behind Furlpay, what we have built so far, and where we fit in the payments landscape.",
    category: "product-news",
    date: "2026-07-05",
    readMins: 8,
    author: "Furlpay Team",
    body: [
      {
        type: "p",
        text: `Furlpay is a stablecoin payments, travel and investing platform. You can book from 2.2M+ hotels and flights, pay in USDC, and hold a portfolio — in one app, secured by passkeys instead of seed phrases. Under the hood, every payment settles on Arbitrum, and every API we expose can be called and paid for by an AI agent as easily as by a person.`,
      },
      {
        type: "p",
        text: `We did not arrive at this stack by accident. Over the past eighteen months, the largest names in payments have been converging on the same ingredients: Mastercard brought [24/7 stablecoin settlement to Arbitrum](https://blog.arbitrum.foundation/), Robinhood launched [its own chain on Arbitrum Orbit](https://robinhoodchain.blockscout.com), Coinbase created the [x402 payment protocol](https://docs.cdp.coinbase.com/x402/welcome) for AI agents, and Visa is building agent-trust infrastructure with [Cloudflare](https://developers.cloudflare.com/agents/agentic-payments/x402/). These moves validate a broader trend: programmable payments and stablecoin infrastructure are going mainstream. Furlpay is built for that same direction — focused on combining payments, travel and investing into a single consumer product.`,
      },
      { type: "h2", text: "The problem: merchant payment fees on card rails" },
      {
        type: "p",
        text: `When a customer pays $150 by card, the merchant typically receives $144.75 to $147.75. The difference — interchange, network assessments and acquirer margin — usually lands between 1.5% and 3.5%, and it funds rewards programs, fraud losses and several layers of intermediaries.`,
      },
      {
        type: "p",
        text: `A stablecoin transfer has none of those layers. The money moves directly from payer to merchant on-chain. On Arbitrum, the entire cost is Furlpay's 0.5% fee plus roughly half a cent of gas.`,
      },
      {
        type: "table",
        headers: ["Rail", "Cost on $150", "Rate"],
        rows: [
          ["Cards (typical range)", "$2.25 - $5.25", "1.5% - 3.5% merchant discount"],
          ["Coinbase Commerce", "$1.50", "1% flat"],
          ["Furlpay (USDC on Arbitrum)", "$0.75", "0.5% + ~$0.004 gas"],
        ],
        highlightCol: 0,
      },
      {
        type: "p",
        text: `The Furlpay figure is live, not projected — you can query it right now at [furlpay.com/api/payments/fees/estimate](https://furlpay.com/api/payments/fees/estimate?amount=150). Card figures are typical merchant discount ranges based on public information; actual pricing varies by issuer, category and geography. For a travel merchant on ten-percent margins, the gap is a meaningful share of the profit on every booking.`,
      },
      { type: "h2", text: "What we built: stablecoin payments with a 0.5% fee" },
      {
        type: "p",
        text: `Our payments API creates a quote, hands the payer's wallet an EIP-712 authorization to sign, screens both sides against sanctions lists, and settles in USDC on Arbitrum One. Receipts link straight to Arbiscan.`,
      },
      {
        type: "ul",
        items: [
          `Compliance before the chain — KYC tiers, sanctions screening on both legs of every payment, FATF Travel Rule payloads and MiCA-aware jurisdiction rules run server-side before any transaction is submitted.`,
          `A hard ceiling in the contract — our router is designed to refuse any fee above 1% on-chain, whatever the API quotes, so the trust boundary is cryptographic rather than organizational.`,
          `Batch payouts, refunds and a public fee estimator round out the merchant surface.`,
        ],
      },
      { type: "h2", text: "Agentic commerce: AI agents as paying customers" },
      {
        type: "p",
        text: `The fastest-growing payments customer of 2026 is not a person. The [x402 protocol](https://www.x402.org/) revives HTTP's 402 status code so an AI agent can pay per request in USDC — no account, no card on file. Coinbase and Cloudflare created it, and adoption has been rapid across Base and Solana.`,
      },
      {
        type: "p",
        text: `Furlpay runs its own x402 facilitator on Arbitrum, Base and Solana. We designed it around the attack classes documented in recent x402 security research (see ["Free-Riding the Agentic Web"](https://arxiv.org/abs/2605.30998)): quotes are cryptographically bound to the resource they price, nonces are single-use, and malformed payment headers fail closed. Agents discover what Furlpay sells through our resource catalog and MCP servers, and can search, book and pay for travel autonomously.`,
      },
      {
        type: "p",
        text: `We are not alone here, and that is the point. Visa's Trusted Agent Protocol and Mastercard's Agent Pay bring agents to card rails; Coinbase operates a hosted facilitator across several chains. Agentic payments is the youngest layer of the stack — positions are far from settled, and we believe a focused, security-first implementation can be genuinely competitive.`,
      },
      { type: "h2", text: "Why Arbitrum" },
      {
        type: "p",
        text: `Arbitrum One offers deep stablecoin liquidity, sub-cent transaction fees with predictable gas pricing after the [ArbOS Dia upgrade](https://docs.arbitrum.io/run-arbitrum-node/arbos-releases/overview), and Ethereum-grade security. It is also where institutional settlement is consolidating — the same rail Mastercard chose for stablecoin settlement and Robinhood chose for its tokenized-stock chain.`,
      },
      {
        type: "p",
        text: `Our smart contracts — a payment router, an x402 settlement facilitator, a travel booking escrow and ERC-721 booking receipts — are [open source on GitHub](https://github.com/Ashutosh0x/furlpay) with a passing test suite, heading to Arbitrum Sepolia next. Renting block space on Arbitrum rather than running our own chain keeps our costs near zero while we grow; the option to graduate to a dedicated Orbit chain later stays open.`,
      },
      { type: "h2", text: "Where Furlpay fits in the payments landscape" },
      {
        type: "p",
        text: `We are not trying to replace card networks, exchanges or brokerages — they serve billions of people well. Our observation is simpler: few platforms combine real-world commerce, agentic payments and compliance-first stablecoin rails in a single product, and we believe that whitespace is worth building into.`,
      },
      {
        type: "table",
        headers: ["Layer", "Established players", "Furlpay's approach"],
        rows: [
          [
            "Merchant payments",
            "Card networks settle between banks at a 1.5-3.5% merchant cost",
            "Direct USDC settlement on Arbitrum at 0.5% + gas",
          ],
          [
            "Agentic payments",
            "Visa TAP and Mastercard Agent Pay extend card rails; Coinbase hosts an x402 facilitator",
            "Self-hosted x402 facilitator hardened against published attack classes, with agent spend mandates",
          ],
          [
            "Consumer product",
            "Exchanges trade crypto; brokerages trade stocks; travel platforms take cards",
            "Travel, investing and payments in one passkey-secured app, bookable by humans or agents",
          ],
          [
            "Developer platform",
            "Enterprise onboarding at the networks; strong self-serve tooling at Coinbase",
            "Open APIs, SDKs in four languages, MCP servers and MIT-licensed packages",
          ],
        ],
        highlightCol: 2,
      },
      { type: "h2", text: "What we are honest about" },
      {
        type: "p",
        text: `Furlpay is early. The product is live at furlpay.com with real authentication and real APIs, but several integrations run in demo mode, our contracts are tested rather than deployed, and we have no payment volume yet. The incumbents have distribution, licenses and balance sheets we do not.`,
      },
      {
        type: "p",
        text: `What we have is speed, focus and timing. The proof points ahead of us, in order: deploy the contracts to Arbitrum Sepolia and then Arbitrum One; complete a real end-to-end agentic booking — agent finds a hotel via MCP, pays via x402, escrow releases on-chain, receipt minted; and sign a first design partner who accepts USDC through the merchant rail.`,
      },
      { type: "h2", text: "Try it" },
      {
        type: "ul",
        items: [
          `Explore travel with USDC checkout at [furlpay.com/travel](/travel).`,
          `Building something? Start at the [developer portal](/developer) and the [docs](/docs).`,
          `Query the live fee estimator: [furlpay.com/api/payments/fees/estimate?amount=150](https://furlpay.com/api/payments/fees/estimate?amount=150).`,
          `Read the contracts and SDKs [on GitHub](https://github.com/Ashutosh0x/furlpay).`,
          `Talk to us directly — [furlpay.com/talk-to-us](/talk-to-us). We will be at the Arbitrum Open House in London, July 10-12.`,
        ],
      },
    ],
  },
  {
    slug: "integrating-furlpay-with-arbitrum",
    title: "Integrating Furlpay with Arbitrum: Payments, x402 and Contracts on the Largest L2",
    excerpt:
      "Furlpay's settlement stack is going Arbitrum-first. Here is exactly what we shipped — an x402 facilitator that settles on Arbitrum, a unified USDC payments API, a chain registry, and four Solidity contracts with a green 17-test suite — and what ships next.",
    category: "engineering",
    date: "2026-07-05",
    readMins: 9,
    author: "Furlpay Engineering",
    featured: true,
    body: [
      {
        type: "p",
        text: `Arbitrum One has quietly become the institutional settlement layer of Ethereum. The network has processed over 2.1 billion lifetime transactions, secures roughly $20B in value, and holds the deepest stablecoin liquidity of any L2 — which is why Mastercard chose it for 24/7 stablecoin settlement and why Robinhood built its tokenized-stock chain on Arbitrum Orbit. January's ArbOS "Dia" upgrade added predictable gas pricing on top. For a payments company whose pitch is "0.5% USDC rails instead of 3.5% card interchange," this is the rail you settle on.`,
      },
      {
        type: "p",
        text: `This week we made Furlpay Arbitrum-first. This post is the engineering log: what shipped, how it fits together, and what is still in front of us before the Arbitrum Open House in London (July 10-12).`,
      },
      { type: "h2", text: "What shipped: the API layer" },
      {
        type: "ul",
        items: [
          `x402 on Arbitrum — our facilitator now verifies and settles agentic payments on arbitrum and arbitrum-sepolia alongside Base and Solana, and quotes default to native USDC on Arbitrum One (0xaf88...5831). The hardening we published in "Five Ways to Rob an AI Agent" carries over unchanged: HMAC-bound quotes, single-use nonces, strict web-layer parsing.`,
          `A unified payments API — POST /api/payments/create returns a 0.5% fee quote plus EIP-712 typed data; /execute verifies the payer's signature, screens both parties against sanctions lists, and settles on Arbitrum One. Receipts link straight to Arbiscan. Batch, refund, history and a public fee estimator round out the surface.`,
          `A chain registry — /api/chain/status, /gas-price, /contracts, /usdc/supply and /tx lookups across Arbitrum One (42161), Arbitrum Sepolia (421614), Robinhood Chain (4663), Base and Ethereum. Mock-first, so the whole stack runs with zero credentials; flip INTEGRATION_MODE=live for real JSON-RPC.`,
          `An x402 resource catalog — agents can now discover what Furlpay sells (GET /api/x402/resources), quote any resource without triggering a 402 (/price), and confirm settlements (/settlement/:tx). Third-party servers onboard their own priced endpoints via /register.`,
        ],
      },
      { type: "h2", text: "What shipped: the contracts" },
      {
        type: "p",
        text: `Four Solidity contracts, OpenZeppelin 5 throughout, compiled for the Cancun EVM target Arbitrum supports, with a 17-test suite covering the full lifecycle of each — payments, replays, expiry, wrong-signer rejection, fee ceilings, escrow release and refund paths, and EIP-3009 settlement.`,
      },
      {
        type: "diagram",
        text: `apps/web (Next.js API)                    packages/contracts (Arbitrum One)
POST /api/payments/create  ── EIP-712 ──>  FurlPayRouter.pay()      0.5% fee, nonce replay guard
POST /api/x402/facilitator/settle ──────>  X402Facilitator.settle() EIP-3009, resource-bound log
POST /api/travel/bookings  ─── USDC ───>   FurlPayEscrow            oracle release / timed refund
                                     └──>  BookingReceipt (ERC-721) minted to the traveler`,
      },
      {
        type: "ul",
        items: [
          `FurlPayRouter — a payer signs a Payment authorization off-chain (the exact typed data our API already emits); a relayer submits it. The merchant receives amount minus fee, the treasury accrues the fee, and the contract enforces a hard 1% fee ceiling on-chain regardless of what any API quotes. Nonces are single-use; authorizations expire.`,
          `X402Facilitator — forwards EIP-3009 transferWithAuthorization to USDC, so the facilitator never holds funds or keys, then writes an indexed settlement record binding the payment to a hash of the resource it bought. Coinbase's hosted facilitator and PayAI already settle x402 on Arbitrum; ours differs by indexing settlements on-chain and binding them to resources, which is what /api/x402/settlement serves back to agents.`,
          `FurlPayEscrow — travel bookings fund in USDC and release on oracle-confirmed check-in, refund inside the cancellation window, or release permissionlessly after a 7-day grace period so providers are never hostage to a dead oracle.`,
          `BookingReceipt — an ERC-721 minted on funding whose tokenId is the booking id, so proof-of-purchase is verifiable straight from the booking reference.`,
        ],
      },
      { type: "h2", text: "Design decisions worth stealing" },
      {
        type: "ul",
        items: [
          `Sign off-chain, settle on-chain. Users and agents never pay gas to authorize; a relayer batches submissions. Arbitrum's post-Dia fee floor makes the relayer's cost per settlement fractions of a cent.`,
          `Compliance before the chain. Both legs of every payment pass sanctions screening server-side before any transaction is submitted — the same pattern institutional settlers use, and the reason the contract layer can stay simple.`,
          `Fee ceilings belong on-chain. The API quotes 0.5%, but the router refuses anything above 1% cryptographically. If our API is ever compromised, the blast radius is bounded by the contract.`,
          `Mock-first infrastructure. Every endpoint runs deterministically with zero credentials and switches to live RPC with one environment variable. Demos never depend on testnet faucets cooperating.`,
        ],
      },
      { type: "h2", text: "What is left" },
      {
        type: "ul",
        items: [
          `Deploy to Arbitrum Sepolia, then One — the deploy script already prints the FURLPAY_* environment variables the web app reads; the contract directory flips from "pending deployment" to live addresses the moment they exist.`,
          `The relayer — a small service that takes executed API payments and submits them to FurlPayRouter, completing the off-chain-to-on-chain loop.`,
          `Merchant API and compliance endpoints — checkout sessions, payouts, webhooks, and public sanctions-screening routes on top of the screening engine that already guards /execute.`,
          `ERC-4337 passkey wallets — our WebAuthn authentication already exists; wiring it to a smart account with a USDC paymaster removes the last piece of gas UX entirely.`,
          `The Orbit question — Robinhood validated launch-on-One, migrate-to-Orbit. If Furlpay's settlement volume justifies a dedicated chain with compliance hooks at the sequencer level, the Nitro stack is the obvious path.`,
        ],
      },
      {
        type: "p",
        text: `The pattern behind all of it: stablecoin settlement is consolidating on Arbitrum, agentic payments are consolidating on x402, and Furlpay sits at the intersection — the payment rail where both humans and machines transact, with compliance built in rather than bolted on. If you are at the Open House in London, come find us; the contracts will be on Sepolia by then.`,
      },
    ],
  },
  {
    slug: "five-ways-to-rob-an-ai-agent-securing-x402",
    title: "Five Ways to Rob an AI Agent: How Furlpay Hardens x402 Payments",
    excerpt:
      "x402 moves ~$600M a year in agentic USDC payments — and 2026 security research documents attack classes most implementations don't defend. Here's how Furlpay's pay-per-call API closes authorization, binding, replay, and web-layer holes.",
    category: "security",
    date: "2026-07-02",
    readMins: 7,
    author: "Furlpay Security",
    body: [
      {
        type: "p",
        text: `The most interesting payments customer of 2026 isn't a person — it's an AI agent. The x402 protocol (created by Coinbase and Cloudflare) revives HTTP's long-dormant 402 "Payment Required" status code so any agent, script, or API client can pay per-request in USDC: no account, no API key, no card on file. Adoption has been explosive — over 119 million transactions on Base and 35 million on Solana, roughly $600M in annualized volume, with Google (AP2), Stripe/Tempo (MPP), and Visa (TAP) all racing to ship competing agentic-payment standards.`,
      },
      {
        type: "p",
        text: `But speed of adoption has outrun security. Three 2026 research papers — "Five Attacks on x402" (arXiv:2605.11781), "Free-Riding the Agentic Web" (arXiv:2605.30998), and "Hardening x402" (arXiv:2604.11430) — document concrete, working attacks against naive x402 servers across four weakness classes: authorization, binding, replay protection, and web-layer handling. Most implementations in the wild defend none of them.`,
      },
      { type: "h2", text: "The four weakness classes" },
      {
        type: "ul",
        items: [
          `Authorization — servers that trust fields echoed back by the client (amount, recipient, network) can be paid $0.000001 for a $10 resource, or paid on the wrong chain entirely.`,
          `Binding — a payment authorized for one resource is presented to unlock a different, more expensive one, because nothing ties the signed authorization to the specific URL and method it was quoted for.`,
          `Replay — a single signed EIP-3009 authorization is redeemed repeatedly against servers that don't track nonces, turning one $0.01 payment into unlimited API calls.`,
          `Web-layer — oversized or malformed X-PAYMENT headers crash naive parsers into failure modes that leak the resource without payment.`,
        ],
      },
      { type: "h2", text: "How Furlpay's x402 endpoint closes them" },
      {
        type: "p",
        text: `We shipped our first agentic pay-per-call API — GET /api/x402/fx, a mid-market FX quote for $0.01 USDC per call — with all four classes defended by construction, not by review checklist.`,
      },
      {
        type: "diagram",
        text: `[ Agent GET /api/x402/fx ] ──> 402 + quote (HMAC-bound to resource+method+amount+expiry)
[ Agent signs EIP-3009 ]  ──> retry with X-PAYMENT header
[ Furlpay verifies ]      ──> exact-match amount/recipient/network · binding MAC · single-use nonce ──> 200 + receipt`,
      },
      {
        type: "ul",
        items: [
          `Server-side truth: every field of the presented payment is compared against the server's own quote. The client's copy of the requirements is never trusted.`,
          `Cryptographic binding: each 402 quote carries an HMAC over (resource, method, amount, quoteId, expiry). A payment bound to one endpoint fails closed on every other endpoint — and tampered quotes fail the timing-safe MAC comparison.`,
          `Single-use everything: quoteIds and EIP-3009 nonces are burned on first redemption, and quotes expire in 300 seconds. Replays are rejected with an explicit "already redeemed" error.`,
          `Strict web layer: the X-PAYMENT header is size-capped before parsing, malformed input returns 400 — never a 500, never a free resource.`,
        ],
      },
      { type: "h2", text: "Why this matters for the agentic web" },
      {
        type: "p",
        text: `Agentic commerce only works if machine payments are safe for the seller as well as the buyer. Every attack above steals from the API provider — quietly, at machine speed, thousands of times per minute. As x402 volume compounds and AP2, MPP, and TAP arrive, the platforms that win won't be the ones that added a 402 handler first; they'll be the ones that made machine-speed money movement boring and safe. That's the standard we're building Furlpay to.`,
      },
      {
        type: "quote",
        text: `Auth for humans is a login. Auth for agents is the payment itself — which makes payment verification your entire security boundary.`,
      },
      {
        type: "p",
        text: `Try it: curl https://furlpay.com/api/x402/fx — you'll get a 402 quote back. The full hardened verifier ships in our monorepo, and a spec-correct Solana Actions template is open source at github.com/FurlPay.`,
      },
    ],
  },
  // 1 -----------------------------------------------------------------
  {
    slug: "announcing-furlpay-connect",
    title: "Announcing Furlpay Connect: B2B Stablecoin Settlement",
    excerpt:
      "A single-integration gateway that slashes merchant settlement fees to a flat 0.5% and deposits local currency straight into your bank account.",
    category: "product-news",
    date: "2026-07-01",
    readMins: 4,
    author: "Furlpay Team",
    featured: true,
    body: [
      {
        type: "p",
        text: `Traditional merchant payment gateways are built on legacy 1970s rails. Between interchange fees, merchant discount rates (MDR) and chargeback liabilities, businesses routinely surrender 2.5% to 4.0% of their top-line revenue just to process digital card payments. Today, we're launching Furlpay Connect — a single-integration gateway that slashes settlement fees to a flat 0.5% and deposits local currency directly into your bank account.`,
      },
      { type: "h2", text: "How it works" },
      {
        type: "p",
        text: `Furlpay Connect sits between high-speed Layer 2 blockchains (Base, Solana, Arbitrum) and domestic bank routing networks (ACH, SEPA, RTP). When a customer checks out:`,
      },
      {
        type: "ul",
        items: [
          `They sign a transaction using their Furlpay Passkey.`,
          `Stablecoins (USDC or EURC) are instantly transferred to Furlpay's liquidity pool.`,
          `Our backend automatically triggers a local payout through the Bridge.xyz API, depositing domestic currency into the merchant's bank account in seconds.`,
        ],
      },
      {
        type: "diagram",
        text: `[ Customer Wallet ] ──(0.5% fee)──> [ Furlpay Pool ] ──(local rail)──> [ Merchant Bank Account ]`,
      },
      { type: "h2", text: "Why it wins" },
      {
        type: "ul",
        items: [
          `Near-zero fees: cut merchant discount fees by up to 80%.`,
          `Zero volatility: merchants receive settlement in USD, EUR or GBP, shielded from asset volatility.`,
          `Frictionless integration: drop Connect into your checkout with a single script tag or our headless TypeScript SDK.`,
        ],
      },
    ],
  },

  // 2 -----------------------------------------------------------------
  {
    slug: "designing-2of2-mpc-key-generation",
    title: "Designing 2-of-2 MPC Key Generation for Self-Custody",
    excerpt:
      "No single private key is ever generated. Here's how Furlpay splits signing across a device passkey share and an HSM policy share.",
    category: "engineering",
    date: "2026-06-28",
    readMins: 6,
    author: "Security Engineering",
    body: [
      { type: "h2", text: "The security dilemma" },
      {
        type: "p",
        text: `In Web3, users historically faced a harsh choice: trust a centralized exchange with their keys (custodial) or write down a 12-word seed phrase on paper (self-custodial). The former exposes users to exchange insolvency; the latter places the entire burden of key security on the user, leading to millions lost to misplaced papers and phishing attacks. Furlpay solves this by implementing 2-of-2 Multi-Party Computation (MPC).`,
      },
      { type: "h2", text: "Under the hood: key splitting" },
      {
        type: "p",
        text: `With MPC, a single private key is never generated in one place. Instead, during account setup, our backend runs a cryptographic protocol (distributed key generation) to produce two distinct key shares:`,
      },
      {
        type: "ul",
        items: [
          `Share A (client-side): stored on the user's device, encrypted and accessible only via WebAuthn / passkey biometrics.`,
          `Share B (server-side): managed inside Furlpay's Hardware Security Module (HSM) cluster, gated by policy rules.`,
        ],
      },
      {
        type: "diagram",
        text: `[ Client Device ] ─────> Share A  (biometric-gated)
                            │
                     (co-signing engine)
                            │
[ Furlpay HSM ]   ─────> Share B  (policy rules)`,
      },
      {
        type: "p",
        text: `To sign a transaction, the client app and the Furlpay HSM compute a signature cooperatively. Neither party ever reveals its share, and the complete private key is never assembled in memory. If our server is breached, the attacker cannot steal your funds because they lack Share A. If you lose your device, Furlpay assists recovery through a secure social/email verification protocol to regenerate your key shares.`,
      },
      {
        type: "quote",
        text: `Compromising one share yields nothing usable — an attacker must defeat both the device and the HSM policy at the same time.`,
      },
    ],
  },

  // 3 -----------------------------------------------------------------
  {
    slug: "navigating-mica-auto-swaps-eurc-usdc",
    title: "Navigating MiCA: Why Furlpay Enforces Auto-Swaps to EURC/USDC",
    excerpt:
      "With MiCA in full effect from July 1 2026, Furlpay's Dynamic Compliance Engine auto-swaps non-compliant stablecoins into authorised EMTs for EEA users.",
    category: "compliance",
    date: "2026-06-25",
    readMins: 5,
    author: "Compliance Team",
    body: [
      { type: "h2", text: "The regulatory landscape" },
      {
        type: "p",
        text: `As of July 1, 2026, the European Union's Markets in Crypto-Assets (MiCA) regulation is in full effect. One of its strictest provisions governs Electronic Money Tokens (EMTs) — commonly known as fiat-pegged stablecoins. To be legal in Europe, stablecoin issuers must hold a licence as a European Electronic Money Institution (EMI) or credit institution, maintaining 100% reserve segregation and publishing monthly audits.`,
      },
      { type: "h2", text: "The USDT delisting wave" },
      {
        type: "p",
        text: `Because of these requirements, many offshore, unregulated stablecoins (such as USDT) face restrictions or delisting across the EEA. To keep Furlpay 100% compliant while protecting users from regulatory blocks, we built a Dynamic Compliance Engine directly into the wallet routing layer:`,
      },
      {
        type: "diagram",
        text: `[ Inbound USDT ] ──(EEA user?)──> Yes ──> [ Auto-swap via Li.Fi ] ──> [ Compliant EURC/USDC Wallet ]
                        └────────> No  ──> [ Standard USDT Deposit ]`,
      },
      {
        type: "p",
        text: `When a user in Europe receives a USDT payment or deposit, Furlpay detects the jurisdiction and automatically routes the transaction through on-chain liquidity (such as Uniswap or 1inch) to swap USDT for a fully authorised EMT — like EURC or Circle's USDC — before depositing it. European users can then spend seamlessly at Visa terminals without their cards being declined for regulatory reasons.`,
      },
    ],
  },

  // 4 -----------------------------------------------------------------
  {
    slug: "agentic-commerce-x402-ai-payments",
    title: "Agentic Commerce: Securing Autonomous AI Payments with x402",
    excerpt:
      "Furlpay now supports the x402 Machine Payments Protocol, letting users delegate spend-limited sub-wallets to autonomous AI agents.",
    category: "product-news",
    date: "2026-06-20",
    readMins: 5,
    author: "Furlpay Team",
    body: [
      { type: "h2", text: "The AI economy" },
      {
        type: "p",
        text: `We've entered the era of "agentic commerce." Users are no longer just using AI to write emails; they're deploying autonomous agents to manage businesses, buy software subscriptions and restock physical offices. But legacy card networks are structurally incapable of handling AI agents — they require human biometrics or 2FA checks to authorise a transaction.`,
      },
      { type: "h2", text: "Enter the x402 protocol" },
      {
        type: "p",
        text: `To bridge this gap, Furlpay is proud to support the x402 Machine Payments Protocol, developed in collaboration with Stripe and Coinbase:`,
      },
      {
        type: "code",
        lang: "typescript",
        code: `// Authorize an AI agent to execute payments under strict limits
const agentWallet = await Furlpay.agents.create({
  ownerAddress: userSafeAddress,
  spendingLimits: {
    daily: 100.00,        // maximum $100 per day
    perTransaction: 20.00 // maximum $20 per transaction
  },
  allowedMerchants: ["github.com", "openai.com", "vercel.com"]
});`,
      },
      {
        type: "p",
        text: `Using x402, users delegate a sub-wallet to an AI agent. The agent signs micro-transactions on L2 networks using programmatic keys, but only within the limits set in the wallet contract. If the agent is compromised or goes rogue, it cannot spend beyond its daily allowance — bringing security and accountability to the machine economy.`,
      },
    ],
  },

  // 5 -----------------------------------------------------------------
  {
    slug: "erc-4337-paymasters-l2",
    title: "Bypassing the Gas Crisis: ERC-4337 Paymasters on L2 Networks",
    excerpt:
      "Nobody should need ETH just to send USDC. How Furlpay uses ERC-4337 account abstraction and Paymasters to make gas disappear.",
    category: "engineering",
    date: "2026-06-15",
    readMins: 5,
    author: "Protocol Engineering",
    body: [
      { type: "h2", text: "The gas fee friction" },
      {
        type: "p",
        text: `One of the largest hurdles to mainstream blockchain adoption is gas fees. Forcing a user to buy and hold ETH or MATIC just to transfer USDC is a poor experience. If a user holds $50 of USDC, they should be able to send it immediately — without buying a gas token first.`,
      },
      { type: "h2", text: "Account abstraction & Paymasters" },
      {
        type: "p",
        text: `Furlpay leverages ERC-4337 account abstraction to solve this. Every Furlpay wallet is a deployed Safe smart-contract account. When a transaction is submitted:`,
      },
      {
        type: "ul",
        items: [
          `The transaction is packaged as a UserOperation.`,
          `It is sent to a Paymaster contract on-chain.`,
          `The Paymaster pays the network gas fee (in ETH) to the validator.`,
          `The Paymaster then deducts the equivalent value in USDC from the transaction — or sponsors the fee entirely for promotional tiers.`,
        ],
      },
      {
        type: "diagram",
        text: `[ User Action ] ──(USDC)──> [ Paymaster Contract ] ──(ETH gas paid)──> [ Blockchain Network ]`,
      },
      {
        type: "p",
        text: `This gas abstraction makes stablecoin transactions feel exactly like traditional Web2 payments — smooth, fast and free of blockchain jargon.`,
      },
    ],
  },

  // 6 -----------------------------------------------------------------
  {
    slug: "wise-mid-market-fx-rates",
    title: "Why Furlpay Integrates Wise for Mid-Market FX Rates",
    excerpt:
      "Most 'free' international transfers hide fees inside the exchange rate. Furlpay uses Wise's real mid-market rate with every fee shown upfront.",
    category: "product-news",
    date: "2026-06-10",
    readMins: 4,
    author: "Payments Team",
    body: [
      { type: "h2", text: "The FX fee scam" },
      {
        type: "p",
        text: `Many neobanks and payment platforms claim to offer "free" international transfers, but they hide their fees in the exchange rate. They apply a marked-up rate and pocket the difference — which can cost users up to 3% of their transfer value.`,
      },
      { type: "h2", text: "Total transparency via Wise" },
      {
        type: "p",
        text: `Furlpay is committed to total fee transparency. That's why we integrate directly with the Wise Business API for all fiat cross-border bank deposits (ACH, SEPA, SWIFT).`,
      },
      {
        type: "ul",
        items: [
          `Real mid-market rate: the exact rate you see on Google, with zero markups.`,
          `Upfront fees: conversion fees (typically 0.3% to 0.5%) are shown clearly before you confirm.`,
        ],
      },
      {
        type: "diagram",
        text: `[ User Stablecoins ] ──(Li.Fi swap)──> [ Fiat Account ] ──(Wise mid-market rate)──> [ Recipient Bank ]`,
      },
      {
        type: "p",
        text: `By combining stablecoin transfers with the Wise routing network, Furlpay lets you send money internationally at a fraction of the cost of traditional wires.`,
      },
    ],
  },

  // 7 -----------------------------------------------------------------
  {
    slug: "fractional-stock-investing-alpaca",
    title: "Fractional US Stock Investing on Web3 Rails: The Alpaca SDK",
    excerpt:
      "Buy $1 of AAPL, TSLA or SPY straight from your Web3 dashboard. Fractional US equities via the Alpaca Brokerage-as-a-Service API.",
    category: "product-news",
    date: "2026-06-05",
    readMins: 4,
    author: "Investing Team",
    body: [
      { type: "h2", text: "Unifying your assets" },
      {
        type: "p",
        text: `For most users, cash, stablecoins, crypto and stocks are scattered across different apps (Chase, Coinbase, Robinhood). This fragmentation makes it hard to track true net worth or move funds when markets shift. Furlpay solves it by bringing fractional stock investing directly into your Web3 dashboard.`,
      },
      { type: "h2", text: "Embedded brokerage-as-a-service" },
      {
        type: "p",
        text: `Furlpay integrates the Alpaca Brokerage-as-a-Service API to enable seamless equity trading:`,
      },
      {
        type: "ul",
        items: [
          `Fractional shares: buy as little as $1 of common stocks and ETFs (AAPL, TSLA, SPY).`,
          `Instant funding: sell stablecoins in your wallet and buy stocks immediately, without waiting for T+2 settlement.`,
        ],
      },
      {
        type: "code",
        lang: "typescript",
        code: `// Purchase fractional stock via Furlpay's investing client
const order = await furlpay.investing.placeOrder({
  symbol: 'AAPL',
  notional: 10.00, // buy exactly $10 of Apple stock
  side: 'buy',
  type: 'market'
});`,
      },
      {
        type: "p",
        text: `All accounts are opened directly with Alpaca Securities LLC, a regulated SEC broker-dealer, so your investments are protected by SIPC.`,
      },
    ],
  },

  // 8 -----------------------------------------------------------------
  {
    slug: "time-locked-preauthorization-escrows",
    title: "Solving Card Declines: Time-Locked Pre-Authorization Escrows",
    excerpt:
      "Why self-custodial cards get declined at gas pumps and hotels — and how Furlpay's time-locked escrow contracts fix pre-authorization holds.",
    category: "engineering",
    date: "2026-06-01",
    readMins: 5,
    author: "Protocol Engineering",
    body: [
      { type: "h2", text: "The card hold problem" },
      {
        type: "p",
        text: `Self-custodial debit cards frequently fail at gas pumps, hotels and car rental agencies. Traditional card networks require a pre-authorization hold (for example, locking $150 at the pump before fuel is dispensed). Because on-chain smart wallets can't easily support temporary hold states, these transactions are usually declined automatically.`,
      },
      { type: "h2", text: "The Furlpay escrow solution" },
      {
        type: "p",
        text: `To solve this, Furlpay developed the Pre-Authorization Escrow Contract. When a merchant requests a hold, our backend creates an isolated, time-locked escrow and moves the hold amount from the user's wallet into it.`,
      },
      {
        type: "diagram",
        text: `[ Merchant pre-auth ] ──> [ Time-locked Escrow ] ──(final amount)──> [ Merchant ]
                                 │
                                 └──(remainder / 7-day expiry)──> [ User Wallet ]`,
      },
      {
        type: "p",
        text: `Once the final purchase amount settles, the escrow releases that amount to the merchant and returns the remaining balance to the user. If the merchant never claims the funds, the escrow automatically expires after 7 days, returning the entire deposit to the user — no stuck holds, no manual reversals.`,
      },
    ],
  },

  // 9 -----------------------------------------------------------------
  {
    slug: "death-of-the-seed-phrase-webauthn",
    title: "The Death of the Seed Phrase: WebAuthn & Device Trust",
    excerpt:
      "Furlpay replaces the 12-word seed phrase with phishing-resistant WebAuthn passkeys bound to your device's secure hardware.",
    category: "engineering",
    date: "2026-05-28",
    readMins: 5,
    author: "Security Engineering",
    body: [
      { type: "h2", text: "The usability gap" },
      {
        type: "p",
        text: `For decades, using cryptocurrency required writing down a 12- or 24-word seed phrase. Cryptographically secure, yes — but a massive usability gap for average users. Lose the paper and your funds are gone forever. Get tricked into typing it on a malicious site and your wallet is instantly drained.`,
      },
      { type: "h2", text: "Phishing-resistant WebAuthn" },
      {
        type: "p",
        text: `Furlpay replaces seed phrases entirely by leveraging WebAuthn (FIDO2) credentials:`,
      },
      {
        type: "code",
        lang: "javascript",
        code: `// Register a new Furlpay account using local biometrics
const credential = await navigator.credentials.create({
  publicKey: {
    challenge: serverChallenge,
    rp: { name: "Furlpay" },
    user: { id: userId, name: userName, displayName: userName },
    pubKeyCredParams: [{ alg: -7, type: "public-key" }] // ES256
  }
});`,
      },
      {
        type: "p",
        text: `This API triggers the user's device — MacBook Touch ID, Windows Hello or a YubiKey — to generate a secure public-key credential. The private key stays locked inside the device's hardware security chip, protected from remote extraction and phishing. Furlpay associates the public key with your Safe smart wallet on-chain, letting you sign transactions with a fingerprint or face scan.`,
      },
    ],
  },

  // 10 ----------------------------------------------------------------
  {
    slug: "hybrid-off-chain-policy-guards",
    title: "Securing the Ledger: Hybrid Off-Chain Policy Guards vs. Modular Bugs",
    excerpt:
      "Modular smart wallets expand the attack surface. Furlpay's hybrid guard pairs on-chain Safe wallets with an off-chain HSM policy engine.",
    category: "security",
    date: "2026-05-24",
    readMins: 6,
    author: "Security Team",
    body: [
      { type: "h2", text: "The risk of pure on-chain modularity" },
      {
        type: "p",
        text: `Modern smart-contract wallets are designed to be modular. That flexibility lets developers add features like spending limits and time-locks — but it also expands the attack surface. If a single module contains a signature-verification flaw, an attacker can bypass the wallet's main security controls and drain its assets.`,
      },
      { type: "h2", text: "Furlpay's hybrid guard architecture" },
      {
        type: "p",
        text: `To protect user assets from contract exploits, Furlpay implements a Hybrid Guard System that combines on-chain smart wallets with an off-chain security engine:`,
      },
      {
        type: "diagram",
        text: `[ User Action ] ──> [ Policy Guard ] ──(verified?)──> Yes ──> [ HSM co-signs ] ──> [ Safe executes ]
                                     └──────────────────> No  ──> [ Blocked ]`,
      },
      {
        type: "p",
        text: `Every transaction requires a 2-of-2 signature:`,
      },
      {
        type: "ul",
        items: [
          `Signature 1: generated by the user's local passkey (client-side).`,
          `Signature 2: generated by Furlpay's HSM backend (server-side).`,
        ],
      },
      {
        type: "p",
        text: `Before the HSM co-signs, it runs real-time security checks:`,
      },
      {
        type: "ul",
        items: [
          `Velocity limits — does this transaction exceed the user's typical patterns?`,
          `Address screening — is the destination linked to high-risk wallets (via the Chainalysis API)?`,
          `Sanctions checks — does the transaction comply with global regulatory guidelines?`,
        ],
      },
      {
        type: "p",
        text: `If an attacker exploits a bug in a smart-contract module, they still can't drain your wallet — they lack the HSM's co-signature. This hybrid approach gives you the security of self-custody alongside the active protection of a traditional bank.`,
      },
    ],
  },

  // 11 ----------------------------------------------------------------
  {
    slug: "furlpay-for-openbb-execution-layer",
    title: "FurlPay for OpenBB: Giving the Open-Source Terminal an Execution Layer",
    excerpt:
      "OpenBB gives 50,000+ analysts and AI agents world-class financial data — but it can't move a dollar. Our new open-source plugin adds the missing half: screen an asset in OpenBB, then trade it, DCA into it, or settle agentic API revenue, all in stablecoins.",
    category: "product-news",
    date: "2026-07-04",
    readMins: 6,
    author: "Furlpay",
    featured: true,
    body: [
      {
        type: "p",
        text: `Every serious financial-data platform in 2026 has converged on the same shape: rich data plus a Model Context Protocol (MCP) server so AI agents can query it. OpenBB shipped Workspace MCP. Morningstar's MCP server is live inside Claude, ChatGPT, and Copilot. Bloomberg is under pressure from a wave of $200-a-month AI alternatives. But every one of them stops at the same wall — they can research an asset, and they cannot act on it. The agent can tell you a fund is a five-star buy; it cannot buy it.`,
      },
      {
        type: "p",
        text: `That gap is exactly the shape of FurlPay. Today we're releasing furlpay-openbb-plugin — an open-source backend that drops FurlPay's execution layer directly into the OpenBB Workspace canvas an analyst already lives in.`,
      },
      { type: "h2", text: "Research → Execute, in one workspace" },
      {
        type: "p",
        text: `The plugin registers as a standard OpenBB custom backend: it serves the widgets.json and apps.json that OpenBB expects, and ships a ready-made "Research to Execution" app with four tabs. It exposes two kinds of widgets — the data OpenBB users expect, and the execution OpenBB itself doesn't have.`,
      },
      {
        type: "ul",
        items: [
          `Data widgets — portfolio summary, open positions with live P&L, stablecoin balances across Solana and Base, x402 paywall revenue, and recent payments.`,
          `Action widgets — Place Order (buy or sell a fractional position, funded in USDC), Auto-Invest (schedule a recurring DCA), and Send Stablecoins. Each is an OpenBB input form that posts to the FurlPay API and refreshes a blotter with the result.`,
        ],
      },
      {
        type: "diagram",
        text: `[ Screen an asset in OpenBB ] ──> [ Place Order / DCA form ] ──> [ FurlPay API ]
                                                                        │
                                          fractional · USDC-funded · 24/7 · on-chain settle`,
      },
      { type: "h2", text: "Why stablecoins make this work" },
      {
        type: "p",
        text: `Because execution is fractional and stablecoin-funded, a $1 order works exactly like a $10,000 one — no bank rails, no market-hours gate, no minimums. An analyst in any country can screen the S&P 500 in OpenBB and dollar-cost-average into it with USDC from the same screen. The same rails settle agentic revenue: the x402 paywall widget shows per-resource calls and USDC earned, so an API that charges AI agents per call reconciles in the same dashboard where its owner trades.`,
      },
      { type: "h2", text: "Open source, clone-and-run" },
      {
        type: "p",
        text: `The plugin is MIT-licensed and runs on deterministic demo data out of the box — add http://localhost:7777 as a custom backend and every widget renders immediately, no account required. Set a FurlPay API key and the same widgets go live against your real portfolio, wallets, and paywalls. A 12-test suite asserts the exact OpenBB contract so a green run means it will register and render.`,
      },
      {
        type: "quote",
        text: `Bloomberg has the data. Morningstar has the research. OpenBB has the terminal. None of them move money. That's the layer we build — and now it lives inside the terminal too.`,
      },
      {
        type: "p",
        text: `Get it at github.com/FurlPay/furlpay-openbb-plugin. It's the first of a series of composed integrations — pairing the open-source financial data stack with the one thing it's always been missing: rails that actually execute.`,
      },
    ],
  },

  // 12 ----------------------------------------------------------------
  {
    slug: "x402-guard-closing-all-five-free-riding-attacks",
    title: "x402-guard v0.2: Closing All Five Free-Riding Attacks on Agentic Payments",
    excerpt:
      "A 2026 security paper catalogues five ways to free-ride an x402 facilitator, reaching resource-leakage ratios up to 100%. x402-guard now ships a tested defense for every one — as a zero-dependency library any facilitator can drop in.",
    category: "security",
    date: "2026-07-03",
    readMins: 7,
    author: "Furlpay Security",
    body: [
      {
        type: "p",
        text: `x402 decouples off-chain verification from on-chain settlement to get throughput. That gap is where the money leaks. "Free-Riding the Agentic Web: A Systematic Security Analysis of x402 Payments" (arXiv:2605.30998) tested official SDKs and a production deployment and found resource-leakage ratios up to 100% — attackers receiving the paid resource while paying little or nothing. It catalogues five distinct flaw classes. Most facilitators in the wild defend none of them.`,
      },
      {
        type: "p",
        text: `x402-guard is our answer: a zero-dependency TypeScript library that hardens the state machine around any x402 settler, independent of which facilitator or SDK you run. Version 0.2 closes all five classes, each with a test that reproduces the attack and proves it's blocked.`,
      },
      { type: "h2", text: "The five flaws — and the fix for each" },
      {
        type: "ul",
        items: [
          `F1 Cross-resource substitution — a payment minted for resource A unlocks an equal-priced resource B. Fix: commit H(method · uri · body) into the authorization and reject any mismatch. Near-universal in the wild: 38% of hosts expose same-price sibling resources.`,
          `F2 Duplicate-settlement race — concurrent requests with one nonce all clear verification before any settles on-chain; each gets the service, one pays. Fix: atomic nonce linearization (Null → PENDING → SETTLED), and — critically — never roll a timed-out nonce back to replayable.`,
          `F3 Allowance overdraft — under the "upto" scheme, N concurrent requests each read the full remaining balance and all proceed, spending N times the authorized amount. Fix: pessimistic reserve-commit — escrow the max atomically before execution, bill the actual, refund the rest.`,
          `F4 Denial of settlement — an attacker floods the facilitator with slow settlements until honest ones time out, and the server that already delivered eats the loss. Fix: reserve settlement capacity before serving; overflow returns 429 instead of free service.`,
          `F5 Hidden-compute pricing — pay-per-token cost is unknowable at quote time, so adversarial prompts maximize compute per fixed quote. Fix: an adaptive billing weight that learns the observed cost ratio and quotes enough headroom that the escrow always covers the bill — honest callers are refunded the difference.`,
        ],
      },
      { type: "h2", text: "Why a library, and why failure-closed" },
      {
        type: "p",
        text: `The subtle bug is the timeout. A naive facilitator deletes the nonce when settlement "fails" — but a facilitator timeout is not proof the transaction failed; it may still confirm on-chain. Freeing the nonce reopens it for replay. x402-guard distinguishes a settlement that provably did not land (safe to release) from one whose outcome is unknown (kept locked, never replayable). Every defense fails closed: when in doubt, refuse — never serve for free.`,
      },
      {
        type: "diagram",
        text: `[ settle request ] ──> reserve capacity (F4) ──> bind-check (F1) ──> atomic nonce claim (F2)
                                                                              │
                          confirmed ──> SETTLED    failed_no_tx ──> released    unknown ──> stays LOCKED`,
      },
      {
        type: "p",
        text: `The nonce and allowance stores are simple interfaces — the in-memory defaults are atomic within one process, and map directly onto Redis SETNX or a conditional SQL decrement for multi-instance facilitators. No dependencies, works on Base, Solana, or any x402 deployment.`,
      },
      {
        type: "quote",
        text: `Agentic commerce only works if machine payments are safe for the seller. Every one of these attacks steals from the API provider — quietly, at machine speed, thousands of times a minute.`,
      },
      {
        type: "p",
        text: `x402-guard is MIT-licensed and open source at github.com/FurlPay/x402-guard. The test suite reproduces each attack — including the paper's 20-concurrent-request race — and asserts it's defeated. As the x402 Foundation drives toward a v1.0 spec, these are the semantics we think belong in the standard.`,
      },
    ],
  },

  // 13 ----------------------------------------------------------------
  {
    slug: "letting-your-ai-agent-book-travel-travala-mcp-furlpay",
    cover: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=1600&q=70",
    title: "Letting Your AI Agent Book Travel: Composing Travala's Travel MCP with FurlPay Payments",
    excerpt:
      "Travala launched its Agentic AI Travel Protocol on Base, enabling gasless USDC travel bookings. Here is how to compose their Travel MCP with FurlPay's wallets and x402 budget guards using TypeScript.",
    category: "travel",
    date: "2026-07-04",
    readMins: 5,
    author: "FurlPay Engineering",
    body: [
      {
        type: "p",
        text: `In June 2026, Travala launched its Agentic AI Travel Protocol, introducing a remote Model Context Protocol (MCP) server accessible at https://travel-mcp.travala.com/mcp. This allows autonomous AI agents to search and reserve from over 2.2 million properties globally. However, search and selection are only half the battle. To complete the loop, the agent needs a secure payment mechanism that respects spending limits and doesn't require sharing raw API keys or card numbers.`,
      },
      {
        type: "p",
        text: `By composing Travala's Travel MCP with FurlPay's payment rails, developers can build agents that book travel autonomously. FurlPay acts as the payment and financial orchestration layer, allowing agents to request single-use payment authorizations using the x402 open standard on Base and Solana.`,
      },
      { type: "h2", text: "The Agentic Travel Flow" },
      {
        type: "diagram",
        text: `[ AI Agent ] ──> Searches inventory via Travala Travel MCP (travel-mcp.travala.com/mcp)
     │
     ├──> Requests budget clearance from FurlPay wallet (ERC-7715 session keys)
     │
     └──> Signs & settles gasless USDC transaction via x402 on Base L2`,
      },
      { type: "h2", text: "Composing the MCP Tools" },
      {
        type: "p",
        text: `Using FurlPay's client SDK, developers can implement an agent tool that handles the budget authorization and payment settlement. This allows the AI agent to verify that the booking quote matches the user's spending policies before executing the transaction.`,
      },
      {
        type: "code",
        lang: "typescript",
        code: `import { FurlPayClient } from "@furlpay/furlpay-node";

// Verify booking quote and generate on-chain x402 payment proof
const client = new FurlPayClient({ apiKey: process.env.FURLPAY_SECRET_KEY });

const quote = await client.travel.verifyQuote({
  quoteId: "trvl_quote_9821379",
  amount: 180.00,
  currency: "USDC"
});

if (quote.isValid && quote.amount <= maxBudgetLimit) {
  const paymentProof = await client.x402.createProof({
    amount: quote.amount,
    token: "USDC",
    destination: "travala_facilitator"
  });
  console.log("Booking authorized. Transaction hash:", paymentProof.txHash);
}`,
      },
      {
        type: "quote",
        text: `In the agentic web, search is performed by the machine, but authorization must remain anchored to the human. Composing the inventory provider with the payment gateway is the ultimate friction reducer for travel.`,
      },
      {
        type: "p",
        text: `Furthermore, developers who integrate these tools can capture Travala's 10% cbBTC (Coinbase Wrapped Bitcoin) rebate. FurlPay automatically routes these rebates back to the developer's wallet, creating a sustainable monetization channel for autonomous agents.`,
      },
    ],
  },

  // 14 ----------------------------------------------------------------
  {
    slug: "tradfi-goes-24-7-mastercard-stablecoin-settlement",
    cover: "https://images.unsplash.com/photo-1449034446853-66c86144b0ad?auto=format&fit=crop&w=1600&q=70",
    title: "TradFi Goes 24/7/365: Leveraging Mastercard's New Stablecoin Rails for Corporate Travel",
    excerpt:
      "Mastercard acquired BVNK for $1.8B and announced 24/7 intraday stablecoin settlement. Here is how FurlPay B2B Travels leverages these rails to issue programmatically locked virtual corporate debit cards.",
    category: "travel",
    date: "2026-07-04",
    readMins: 5,
    author: "FurlPay Product",
    body: [
      {
        type: "p",
        text: `Traditional corporate travel booking is choked by legacy banking calendars. Weekend flight updates, last-minute room adjustments, or holiday travel bookings frequently fail because of settlement delays, leading to canceled reservations and accounting friction. With Mastercard's acquisition of BVNK and their expansion of settlement capabilities to support intraday, weekend, and holiday settlement for regulated stablecoins (USDC), the financial rails are finally matching the speed of travel.`,
      },
      {
        type: "p",
        text: `FurlPay B2B Travels integrates directly with these new 24/7 settlement rails, allowing companies to fund corporate travel accounts with stablecoins and instantly issue virtual travel cards to employees.`,
      },
      { type: "h2", text: "24/7 Stablecoin Settlement" },
      {
        type: "diagram",
        text: `[ Corporate USDC Treasury ] ──(24/7/365 Intraday Rail)──> [ FurlPay Card Engine ]
                                                             │
                                                  (Single-Use Virtual Card)
                                                             │
                                                             ▼
                                                [ Visa/Mastercard Network ]`,
      },
      { type: "h2", text: "Dynamic Spending Controls & MCC Locks" },
      {
        type: "p",
        text: `When an employee requests travel authorization, FurlPay programmatically issues a single-use virtual card. By leveraging Mastercard's real-time settlement and our card issuing engine, we apply strict Merchant Category Code (MCC) locks. This guarantees the card can only be charged by travel merchants (e.g., lodging and airlines) and is capped at the exact amount of the booking, eliminating expense fraud by design.`,
      },
      {
        type: "quote",
        text: `TradFi is going 24/7. FurlPay's double-entry ledger and card issuing platform allow startups to instantly tap into this real-time payment network, using stablecoins to fund employee travel globally.`,
      },
    ],
  },

  // 15 ----------------------------------------------------------------
  {
    slug: "inside-the-visa-and-bridge-stablecoin-cards-rollout",
    cover: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=1600&q=70",
    title: "Stablecoin Cards in 100+ Countries: Inside the Visa and Bridge Global Rollout",
    excerpt:
      "Visa and Stripe-owned Bridge have expanded their partnership to scale stablecoin-linked card issuing in over 100 countries. We explore how FurlPay utilizes this global network to enable instant fiat conversions at the checkout.",
    category: "travel",
    date: "2026-07-04",
    readMins: 6,
    author: "FurlPay Compliance",
    body: [
      {
        type: "p",
        text: `Visa and Stripe-owned Bridge have expanded their partnership to bring stablecoin-linked card issuance to over 100 countries. This is a massive milestone for global travel, as it allows stablecoins (like USDC and USDT) to be spent seamlessly at millions of physical and digital merchants worldwide, with instant fiat conversion at the point of sale.`,
      },
      {
        type: "p",
        text: `FurlPay Travels leverages this global network to bridge Web3 wallets with legacy travel merchants (such as Airbnb, Booking.com, and local train networks) that do not yet accept crypto natively.`,
      },
      { type: "h2", text: "Real-Time Crypto-to-Fiat Conversion" },
      {
        type: "p",
        text: `When a traveler checks out on FurlPay, the platform uses Bridge's API in the background to swap the traveler's stablecoins into the merchant's local currency (USD, EUR, or GBP) in real-time. The merchant receives a standard bank settlement, while the traveler avoids the friction of manual off-ramping or holding multiple fiat currencies.`,
      },
      { type: "h2", text: "Global Compliance and the Travel Rule" },
      {
        type: "p",
        text: `Operating a cross-border travel network in 2026 requires strict adherence to international regulations, including the Financial Action Task Force (FATF) Travel Rule and the European Union's Markets in Crypto-Assets (MiCA) regulation. FurlPay's Dynamic Compliance Engine monitors every transaction:`,
      },
      {
        type: "ul",
        items: [
          `Auto-swapping non-compliant stablecoins into licensed EMTs (Electronic Money Tokens like EURC) for EEA users.`,
          `Verifying originator and beneficiary identity for transactions exceeding $1,000.`,
          `Performing real-time sanctions screening before cards are issued.`,
        ],
      },
      {
        type: "quote",
        text: `Compliance isn't a blocker; it's the bridge that allows on-chain finance to scale to the physical world. By embedding Travel Rule verification directly into the checkout, we keep global travel safe and legal.`,
      },
    ],
  },
  // Open USD ----------------------------------------------------------
  {
    slug: "why-furlpay-is-adopting-open-usd",
    cover: "https://images.unsplash.com/photo-1621761191319-c6fb62004040?auto=format&fit=crop&w=1600&q=70",
    title: "Why Furlpay Is Adopting Open USD — the Visa, Mastercard & Coinbase Stablecoin Standard",
    excerpt:
      "In July 2026, a 140-firm consortium — Visa, Mastercard, Stripe, Coinbase, BlackRock, BNY, Google and Ripple among them — launched Open USD (OUSD), a partner-governed stablecoin that shares reserve revenue and undercuts the single-issuer model. Here's why Furlpay is adding it as a settlement rail for travel and brokerage.",
    category: "travel",
    date: "2026-07-04",
    readMins: 6,
    author: "Furlpay",
    featured: true,
    body: [
      {
        type: "p",
        text: `On July 3, 2026, a new independent company called Open Standard launched Open USD (OUSD) — a fully-reserved US-dollar stablecoin backed by a consortium of more than 140 firms spanning banking, payments, tech and crypto: Visa, Mastercard, Stripe, Coinbase, BlackRock, BNY, Google, IBM, Ripple, OKX and Standard Chartered among them. The market reaction was immediate — Circle's stock fell roughly 13% within hours as traders priced OUSD as a direct competitor to USDC and USDT. This is the most significant stablecoin launch since USDC itself, and Furlpay is adopting it.`,
      },
      { type: "h2", text: "Why the industry wanted a neutral stablecoin" },
      {
        type: "p",
        text: `Today's dominant stablecoins are single-issuer: one company mints the token, holds the reserves, and keeps the interest those reserves earn. That concentrates both counterparty risk and economics. OUSD is structured to break that model. It's operated by Open Standard — an independent company whose board is composed of the consortium's partners, with founding CEO Zach Abrams — so no single firm controls issuance. Businesses can mint and redeem OUSD at no cost and with no volume caps, and nearly all of the interest earned on the backing reserves flows to partners after a management fee, rather than to one issuer.`,
      },
      { type: "h2", text: "What's actually different about OUSD" },
      {
        type: "ul",
        items: [
          `Partner-governed, not single-issuer — reserve risk and revenue are distributed across the consortium, not held by one company.`,
          `Free mint & redeem, no caps — treasuries can move in and out of OUSD without spread or volume limits, which matters for high-throughput settlement.`,
          `Shared reserve revenue — the interest on reserves is returned to partners, changing the economics of every business that routes volume through it.`,
          `Multi-chain from launch — OUSD goes live natively on Solana from day one, with Stellar, Base, Polygon and other chains following through 2026.`,
        ],
      },
      { type: "h2", text: "How Furlpay uses OUSD" },
      {
        type: "p",
        text: `Furlpay is a settlement-agnostic financial OS: the same API moves stablecoins for payments, fractional investing, and agentic x402 calls. Adding OUSD alongside USDC gives our users a neutral, institutional-grade dollar for two flows in particular — travel and brokerage.`,
      },
      {
        type: "ul",
        items: [
          `Travel — Furlpay Travels settles bookings routed through Travala's Agentic AI Travel Protocol in gasless stablecoin on Base and Solana. OUSD's zero-cost mint/redeem and native Solana support make it a natural funding token for both agent-initiated x402 bookings and single-use Visa virtual cards.`,
          `Brokerage — fractional stock and ETF orders (via Alpaca) are funded from the same wallet. Settling in a consortium-backed dollar reduces the conversion friction between on-chain balances and regulated brokerage rails.`,
          `Micro-transactions — high-throughput, low-fee settlement on Solana and Base makes sub-cent flows economically viable: pay-per-call API data over x402, per-booking travel insurance, and agent tips.`,
        ],
      },
      {
        type: "diagram",
        text: `[ Furlpay wallet: USDC · OUSD ]
        │
        ├─ x402 / Travala booking ─▶ gasless settle on Base/Solana ─▶ 10% cbBTC rebate
        ├─ single-use Visa VCN ────▶ Visa × Bridge rails ───────────▶ 100+ countries
        └─ Alpaca fractional order ▶ regulated brokerage settlement`,
      },
      {
        type: "p",
        text: `Because Furlpay never hard-codes a single settlement token, adopting OUSD is additive: existing USDC integrations keep working, and users gain a second dollar backed by the networks that already run global commerce. We'll roll OUSD support out first on Solana — where it launches natively — then Base, tracking Open Standard's own chain schedule.`,
      },
      {
        type: "quote",
        text: `The winning stablecoin for real-world commerce won't be the one with the best yield — it'll be the one payments networks, banks and merchants already trust. OUSD is that bet, and Furlpay is built to route it.`,
      },
    ],
  },
  // ------------------------------------------------------------------
  {
    slug: "travel-super-app-race-2026-payments-decide",
    title: "The 2026 Travel Super-App Race Will Be Decided at the Payment Step",
    excerpt:
      "Online travel is a $719B market racing toward $1.3T, and Booking, Airbnb and Trip.com are all rebuilding as super-apps. But the layer none of them own — money movement — is where the race gets decided.",
    category: "travel",
    date: "2026-07-05",
    readMins: 9,
    author: "FurlPay Travels",
    body: [
      {
        type: "p",
        text: `Online travel booking is projected to grow from roughly $719 billion in 2026 to over $1.3 trillion by 2033 — a 9% compound annual clip — and the way people book has already tipped: mobile drives more than 63% of global online bookings and 68% of travel searches. The strategic response from the big three platforms is identical in ambition and different in execution: stop being a booking site, become the operating system for the whole trip.`,
      },
      { type: "h2", text: "Three super-app strategies" },
      {
        type: "ul",
        items: [
          `Trip.com is the transactional consolidator — flights across ~5,000 cities, 1.4M hotels, direct rail APIs (Eurostar, National Rail) with a "Split Tickets" engine that segments journeys to find cheaper fares, and a flight-hotel cancellation guarantee stitching verticals together.`,
          `Airbnb's Summer 2026 release pivots from home-sharing to full-service travel: boutique hotels in 20 gateway cities, plus Instacart groceries, Welcome Pickups airport transfers, and Bounce luggage storage embedded directly in the post-booking flow.`,
          `Booking.com layers GPT-4o-mini "Smart Filters" over the industry's deepest structured inventory — you describe the hotel in a sentence, the LLM applies the filter boxes for you.`,
        ],
      },
      { type: "h2", text: "The cracks are all money-shaped" },
      {
        type: "p",
        text: `Look at where travelers actually get angry with these platforms in 2026 and a pattern emerges. Booking.com's Best Rate Guarantee pays out in Booking Wallet credit — after claims survive single-screenshot rules and currency-conversion nitpicks — and cashing out takes a support call. Airbnb's boutique-hotel price match refunds exclusively in travel credit, capped at $400, expiring in twelve months. Genius loyalty discounts are routinely funded by inflated base rates, so logged-in members sometimes pay more than an incognito window. None of these are search problems or inventory problems. They are all payment problems: platforms treating refunds and rewards as retention leverage instead of money.`,
      },
      { type: "h2", text: "Agentic booking makes payments the whole ballgame" },
      {
        type: "p",
        text: `The next booking interface is conversational. Sabre, PayPal and MindTrip are assembling an end-to-end agentic pipeline — conversational planning over 420+ airlines and 2M hotels with payment inside the chat. Google has said plainly it has no intention of becoming an OTA; it wants to hand qualified intent to whoever can complete the transaction. And in the most telling move of the year, OpenAI pulled native travel checkout from ChatGPT after finding users happily plan in chat but balk at typing card numbers into it. Planning is solved. Trust at the moment money moves is not.`,
      },
      { type: "h2", text: "Walking the 2026 booking funnel, stage by stage" },
      {
        type: "p",
        text: `Trace a 2026 trip from first daydream to final refund and you can see exactly where trust holds and where it breaks. Inspiration is a solved stage: TikTok, Instagram and AI-curated feeds surface destinations more effectively than any brochure ever did, and travelers arrive at platforms already knowing roughly what they want. Planning is solved too — conversational AI over inventories like Sabre's 420+ airlines and 2M hotels turns a week of tab-juggling into a ten-minute chat, and tools like Booking.com's Smart Filters translate a sentence into structured search. Selection follows the same arc: with deep inventory, verified reviews and LLM-ranked results, picking the right hotel or flight is no longer where users struggle or platforms differentiate.`,
      },
      {
        type: "p",
        text: `Then comes payment, and the funnel snaps. This is the trust gap: users who happily planned an entire itinerary in a chat interface refuse to type a card number into that same chat — the exact behavior that made OpenAI pull native travel checkout from ChatGPT. There is no cryptographic authorization standard the average traveler trusts an agent with, so the most automated funnel in history still ends with a human hesitating over a card form. Every stage upstream has been optimized; the moment money actually moves is the one moment platforms haven't earned.`,
      },
      {
        type: "p",
        text: `The two stages after payment are where the earlier cracks compound. In-trip is only partially solved — this is the super-app battleground, where Airbnb bolts on groceries and airport transfers, Trip.com stitches rail and cancellation guarantees, and everyone races to own the traveler mid-journey; useful, but fragmented and still maturing. Refunds, the final stage, is where trust breaks outright: this is credit-trap territory, where price-match payouts arrive as expiring wallet credit, guarantees are capped and hedged with screenshot rules, and getting actual cash back requires a support call. A funnel that starts with frictionless AI inspiration ends with your own money held hostage as a retention token — and that asymmetry, not inventory or search, is the real weakness of the 2026 booking stack.`,
      },
      { type: "h2", text: "Our bet: settle like software" },
      {
        type: "p",
        text: `FurlPay Travels is built on the premise that the payment layer — not inventory breadth — is the durable differentiator. Agents pay over x402 with cryptographic authorization instead of a card number in a chat box. Refunds and price-match payouts settle as USDC cash to your wallet in under a minute — never as credit that expires. And this week we shipped two features straight from this thesis: Price Alerts with an honest success-rate model and auto-book from your USDC balance when your target lands, and a Price Match Guarantee that pays the difference in withdrawable USDC, not a coupon.`,
      },
      {
        type: "quote",
        text: `Super-apps compete on how much of the trip they capture. We compete on what every leg of the trip runs on: money that moves at machine speed and stays yours.`,
      },
    ],
  },
  // ------------------------------------------------------------------
  {
    slug: "polite-sanitization-ai-review-summaries",
    title: "Polite Sanitization: When AI Review Summaries Hide the Warnings That Matter",
    excerpt:
      "2026 investigations caught AI review summaries describing a food-poisoning-lawsuit resort as 'spotless' and systemic harassment as 'minor service lapses.' Here's why models flatten danger — and how verified, settlement-bound reviews fix it.",
    category: "travel",
    date: "2026-07-04",
    readMins: 6,
    author: "FurlPay Travels",
    body: [
      {
        type: "p",
        text: `Reviews are the currency of online travel, and in 2026 that currency is being debased from two directions at once. On the supply side, industry studies estimate 15–20% of visible online reviews are now AI-generated fakes. On the interpretation side, the AI summaries platforms bolt on top have developed a failure mode consumer researchers call "polite sanitization" — and it is worse than fake reviews, because it launders real ones.`,
      },
      { type: "h2", text: "What the investigations found" },
      {
        type: "ul",
        items: [
          `A consumer-group audit found an AI summary describing a Cape Verde resort as "spotless" with "rave reviews for diverse dining" — omitting that the property faced high-court litigation from hundreds of guests over mass food poisoning and documented rodent activity.`,
          `Another summary called hotel staff "friendly" while the underlying reviews contained repeated reports from female guests of systemic harassment, compressed by the model into "minor service lapses."`,
        ],
      },
      {
        type: "p",
        text: `The mechanism is boring and structural. Generative models are trained mostly on neutral-to-positive consumer language, and summarization optimizes for the statistical center of a corpus. Fear, disgust and physical danger are edge cases by definition — so the model averages them away. A hundred five-star reviews and three reports of rats in the kitchen summarize to "guests love the food." No one lied; the truth just got smoothed.`,
      },
      { type: "h2", text: "The industry's answer: verify harder" },
      {
        type: "p",
        text: `Booking.com's May 2026 update shows where platforms are heading: reviews only count within 28 days of a verified checkout, scores roll over a 24-month window with a recency boost, and the first month of enforcement purged 7,800 unverifiable reviews. Verification is the right instinct — but it only fixes the supply side. A perfectly verified corpus still gets sanitized by the summary layer on top.`,
      },
      { type: "h2", text: "How FurlPay Travels handles it" },
      {
        type: "ul",
        items: [
          `Settlement-bound reviews: a review can only be attached to a booking that settled on-chain. The payment receipt is the proof of stay — there is no review form without a matching settlement, so synthetic review farms have nothing to attach to.`,
          `Safety flags are never averaged: reports tagged hygiene, safety or harassment bypass summarization entirely and surface verbatim, with counts — "3 guests reported pest activity in the last 90 days" — even when the overall score is 4.8.`,
          `Summaries state coverage, not vibes: every AI digest on a property page discloses how many verified stays it draws from and links the raw reviews it compressed.`,
        ],
      },
      {
        type: "quote",
        text: `An AI summary that reads well and hides a health hazard isn't a summary — it's a liability with good manners. The fix is structural: bind reviews to settled payments, and never let safety signals pass through an averaging function.`,
      },
      {
        type: "p",
        text: `Trust infrastructure is payments infrastructure. The same on-chain receipt that makes our refunds instant makes our reviews attributable — one primitive, two problems solved.`,
      },
    ],
  },
  // 23 ----------------------------------------------------------------
  {
    slug: "crypto-vs-card-fees-the-real-math",
    title: "Crypto vs Card Fees: The Real Math on Every $100,000 in Sales",
    excerpt:
      "Credit cards take 2.9%-3.5% of every sale. USDC on Arbitrum takes 0.5%. On $100,000 in volume that is roughly a $3,000 difference. Here is the honest, line-by-line math — including the costs each side hides.",
    category: "product-news",
    date: "2026-07-06",
    readMins: 7,
    author: "Furlpay Team",
    featured: true,
    cover: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `Payment fees are the tax nobody quotes you at signup. They sit at 2.9% plus 30 cents on most card transactions, and by the end of the year they are one of the largest line items a small business never negotiated. Stablecoin payments change that number by an order of magnitude. This is the real math — not a marketing figure — with the parts each rail would rather you not add up.`,
      },
      { type: "h2", text: "How much do card payments actually cost?" },
      {
        type: "p",
        text: `A US card payment costs a merchant roughly 2.9% + $0.30 online (the standard published rate at processors like Stripe), and a blended 3.5% is a fair estimate once you include international cards, premium rewards cards, and chargeback fees. That fee is really three stacked fees: interchange paid to the card-issuing bank, network assessments paid to Visa or Mastercard, and the processor's own margin.`,
      },
      {
        type: "table",
        headers: ["On $100,000 in sales", "Card (2.9% + 30¢)", "Card (3.5% blended)", "Furlpay (USDC, 0.5%)"],
        rows: [
          ["Percentage fee", "$2,900", "$3,500", "$500"],
          ["Per-transaction fee*", "~$400", "included", "~$5 gas"],
          ["Chargeback exposure", "Yes", "Yes", "None"],
          ["Total cost", "~$3,300", "~$3,500", "~$505"],
        ],
        highlightCol: 3,
      },
      {
        type: "p",
        text: `*Assumes an average ticket around $75, so $100,000 is roughly 1,330 transactions at $0.30 each. The exact number moves with your average order value — a store selling $15 items pays far more in fixed per-transaction fees than one selling $500 items.`,
      },
      { type: "h2", text: "What does a USDC payment on Arbitrum cost?" },
      {
        type: "p",
        text: `A USDC payment on Furlpay costs a flat 0.5% plus Arbitrum gas, which runs between a tenth of a cent and half a cent per transaction. There is no interchange because there is no card-issuing bank, no network assessment because there is no card network, and no chargeback reserve because on-chain payments are final. You can verify a live quote right now at [furlpay.com/api/payments/fees/estimate](https://furlpay.com/api/payments/fees/estimate?amount=150).`,
      },
      {
        type: "diagram",
        text: `$100,000 in card sales  →  you keep ~$96,700\n$100,000 in USDC sales  →  you keep ~$99,495\n                              ─────────────────\n                              ~$2,795 more, per $100k`,
      },
      { type: "h2", text: "The costs each side hides" },
      {
        type: "p",
        text: `Honest comparisons have to include the awkward parts. Cards hide the cost of chargebacks and multi-day settlement holds: a disputed transaction can cost you the sale plus a $15-$25 dispute fee, and a rolling reserve ties up cash you have already earned. Stablecoins hide a different cost: your customer needs USDC and a wallet. Furlpay narrows that gap with passkey wallets that need no seed phrase and a checkout that guides funding, but card acceptance is still more universal today. The right framing is not "crypto replaces cards everywhere" — it is "offer USDC as the cheaper option and keep the 0.5% instead of the 3%."`,
      },
      {
        type: "ul",
        items: [
          `Card costs that do not show on the sticker: chargeback fees, rolling reserves, cross-border surcharges, and PCI compliance overhead.`,
          `Stablecoin costs that do not show on the sticker: customer wallet friction and the operational work of holding or converting USDC — both shrinking as passkey wallets mature.`,
          `Where the math is decisive: high volume, low margin, cross-border, and recurring or machine-to-machine payments.`,
        ],
      },
      { type: "h2", text: "When cards still win" },
      {
        type: "p",
        text: `If most of your customers will only ever tap a card, a 0.5% rail they do not use saves nothing. Cards win on ubiquity, on familiar dispute rights, and on the long tail of local payment methods that processors like Stripe support. That is why most businesses adding stablecoin acceptance run it alongside cards rather than instead of them — see our full breakdown in [Furlpay vs Stripe](/compare/stripe).`,
      },
      { type: "h2", text: "Run your own number" },
      {
        type: "p",
        text: `The figures above scale linearly, so the savings on your volume are easy to estimate: multiply your annual card volume by roughly 3% to see what you would keep at 0.5%. Or use the interactive [fee savings calculator](/resources/tools/fee-calculator) to plug in your volume and average ticket, and read our [payments product page](/products/payments) for how settlement works end to end.`,
      },
      {
        type: "quote",
        text: `The card fee is not a law of nature. It is the price of a specific set of intermediaries. Remove the intermediaries and 3% becomes 0.5% — the same dollars, minus the toll.`,
      },
      {
        type: "p",
        text: `Furlpay is not a bank. Card figures are typical published rates and vary by issuer, card type, merchant category, and geography; the Furlpay figure is live and verifiable but excludes any conversion you choose to do between USDC and local currency. This article is informational, not financial advice.`,
      },
    ],
  },
  // 24 ----------------------------------------------------------------
  {
    slug: "usdc-vs-usdt-for-payments",
    title: "USDC vs USDT for Payments: Which Stablecoin Should a Business Accept?",
    excerpt:
      "USDT is bigger; USDC is more transparent. For accepting payments, reserve quality, attestations, and regulatory posture matter more than market cap. Here is how the two compare where it counts for merchants.",
    category: "compliance",
    date: "2026-07-06",
    readMins: 6,
    author: "Furlpay Team",
    cover: "https://images.unsplash.com/photo-1621761191319-c6fb62004040?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `USDT (Tether) and USDC (Circle) are both dollar-pegged stablecoins, and both let a business get paid in something that holds its value between the sale and the settlement. But they are not interchangeable when you are the one accepting them. The differences that matter for a merchant are reserve quality, attestation cadence, regulatory posture, and which chains they are cheap to move on — not which has the larger market cap.`,
      },
      { type: "h2", text: "The short answer" },
      {
        type: "p",
        text: `For accepting payments in the US and EU, USDC is generally the safer default: it publishes monthly third-party attestations, holds reserves in cash and short-dated US Treasuries, and is issued by a US-regulated company that has leaned into compliance frameworks like MiCA. USDT has the deepest liquidity and widest exchange support globally, which matters if your counterparties are international, but its reserve disclosures are less granular. Furlpay settles in USDC on Arbitrum for exactly these reasons.`,
      },
      {
        type: "table",
        headers: ["Factor", "USDC (Circle)", "USDT (Tether)"],
        rows: [
          ["Issuer", "Circle (US-regulated)", "Tether (offshore)"],
          ["Reserves", "Cash + short-dated US Treasuries", "Mixed; less granular disclosure"],
          ["Attestations", "Monthly, third-party", "Quarterly, less detailed"],
          ["Regulatory posture", "Proactive (MiCA, US frameworks)", "Broad global usage, lighter disclosure"],
          ["Liquidity", "Deep, growing", "Deepest globally"],
          ["Best for", "US/EU merchants, compliance", "International reach, exchanges"],
        ],
        highlightCol: 1,
      },
      { type: "h2", text: "Why reserve transparency matters to a merchant" },
      {
        type: "p",
        text: `When you accept a stablecoin, you are briefly holding a claim on the issuer's reserves. If the peg wobbles because the market doubts those reserves, you eat the difference on money you have already earned. USDC's monthly attestations and Treasury-heavy reserves make that tail risk easier to reason about. This is the same reason we wrote about [reserve transparency and MiCA](/blog/navigating-mica-auto-swaps-eurc-usdc) — the compliance posture is not paperwork, it is what backs the dollar you just got paid.`,
      },
      { type: "h2", text: "The chain matters as much as the coin" },
      {
        type: "p",
        text: `A stablecoin is only as cheap to accept as the network it settles on. USDC on Ethereum mainnet can cost several dollars in gas per transfer; the same USDC on Arbitrum costs a fraction of a cent. That is why Furlpay settles USDC on Arbitrum One (Chain ID 42161) rather than mainnet — the coin is dollar-stable and the rail is sub-cent. Read [USDC on Arbitrum](/blog/integrating-furlpay-with-arbitrum) for the integration details.`,
      },
      { type: "h2", text: "So which should you accept?" },
      {
        type: "ul",
        items: [
          `Selling mostly to US and EU customers, or care about audit and compliance: accept USDC.`,
          `Selling to a global, crypto-native audience that already holds USDT on exchanges: supporting USDT can reduce customer friction.`,
          `Either way, settle on a low-fee chain like Arbitrum — the network choice affects your cost more than the coin choice does.`,
        ],
      },
      {
        type: "quote",
        text: `Market cap tells you how popular a stablecoin is. Attestations and reserves tell you how safe it is to be paid in one. For a merchant, the second question is the one that costs money.`,
      },
      {
        type: "p",
        text: `This article is informational and not financial or legal advice. Stablecoins carry issuer and peg risk and are not deposit-insured. Compare how acceptance works on our [payments](/products/payments) and [merchant](/products/merchant) pages.`,
      },
    ],
  },
  // 25 ----------------------------------------------------------------
  {
    slug: "how-crypto-payments-work",
    title: "How Do Crypto Payments Work? A Plain-English Guide for Businesses",
    excerpt:
      "No jargon: what actually happens when a customer pays a business in USDC, how settlement differs from cards, what a wallet and gas are, and why on-chain payments are final. A practical primer for merchants.",
    category: "product-news",
    date: "2026-07-06",
    readMins: 8,
    author: "Furlpay Team",
    cover: "https://images.unsplash.com/photo-1518546305927-5a555bb7020d?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `Crypto payments sound complicated and are mostly not. Stripped of jargon, a stablecoin payment is a customer moving digital dollars from their account to yours over a shared ledger, in about a second, for a fraction of a cent. This guide explains what actually happens, in order, and how it differs from the card payment you already understand.`,
      },
      { type: "h2", text: "What is a crypto payment, really?" },
      {
        type: "p",
        text: `A crypto payment is a transfer of value recorded on a blockchain — a shared, tamper-evident ledger that many computers agree on. For payments, the value being moved is usually a stablecoin like USDC, which is pegged one-to-one to the US dollar. So "crypto payment" here does not mean volatile Bitcoin; it means a digital dollar that settles on rails that happen to be built on blockchain technology.`,
      },
      { type: "h2", text: "The five steps of a USDC payment" },
      {
        type: "ul",
        items: [
          `1. Quote: your checkout requests a price. Furlpay creates a payment for, say, $150 in USDC and returns the details.`,
          `2. Authorize: the customer's wallet signs an authorization (an EIP-712 signature) approving the transfer. No card number changes hands.`,
          `3. Screen: both sides are checked against sanctions lists before anything settles — compliance happens inline.`,
          `4. Settle: the USDC moves from customer to merchant on Arbitrum and finalizes in about a second.`,
          `5. Receipt: you get a signed receipt linking to Arbiscan, the public record of the payment, for your books.`,
        ],
      },
      {
        type: "diagram",
        text: `Customer wallet ──authorize──▶ Furlpay ──screen──▶ Arbitrum ──settle──▶ Merchant\n        (signs)              (quote + compliance)     (~1 second)        (receipt)`,
      },
      { type: "h2", text: "What is a wallet? What is gas?" },
      {
        type: "p",
        text: `A wallet is the app that holds the customer's digital dollars and produces the signature that authorizes a payment. Traditional wallets make you back up a twelve-word "seed phrase," which is easy to lose or get phished. Furlpay uses passkey wallets instead — the same Face ID or fingerprint mechanism you already use to sign in — so there is no seed phrase. Gas is the tiny network fee paid to process a transaction; on Arbitrum it is a fraction of a cent, and Furlpay can sponsor it so customers do not need to hold a separate token to pay it. We wrote about [replacing the seed phrase with passkeys](/blog/death-of-the-seed-phrase-webauthn) if you want the security detail.`,
      },
      { type: "h2", text: "How is this different from a card payment?" },
      {
        type: "table",
        headers: ["", "Card payment", "USDC payment"],
        rows: [
          ["Who is in the middle", "Issuer, network, processor", "Almost no one"],
          ["Settlement time", "2-3 business days", "~1 second"],
          ["Typical fee", "2.9% + 30¢", "0.5% + sub-cent gas"],
          ["Reversible?", "Yes (chargebacks)", "No (final on-chain)"],
          ["Works across borders", "With FX fees", "Natively, dollar-stable"],
        ],
        highlightCol: 2,
      },
      {
        type: "p",
        text: `The finality point cuts both ways. No chargebacks means no friendly fraud and no dispute fees for you — but it also means refunds are something you issue deliberately through the API, not something a bank claws back. For a fuller cost breakdown, see [Crypto vs Card Fees: The Real Math](/blog/crypto-vs-card-fees-the-real-math).`,
      },
      { type: "h2", text: "Do my customers need to understand any of this?" },
      {
        type: "p",
        text: `No — and that is the point. A good stablecoin checkout feels closer to a card checkout than to a crypto app: the customer approves with a passkey and the payment settles. The blockchain, the gas, and the screening happen underneath. Your job as a merchant is to add the checkout; Furlpay handles the rest.`,
      },
      { type: "h2", text: "Getting started" },
      {
        type: "p",
        text: `You can accept your first USDC payment from a hosted checkout link without writing code, or integrate the API in an afternoon. Start with the [quickstart](/docs/quickstart), read how [merchant acceptance](/products/merchant) works, or estimate your savings with the [fee calculator](/resources/tools/fee-calculator).`,
      },
      {
        type: "quote",
        text: `A stablecoin payment is just digital dollars moving directly from one account to another, recorded once, and final. Everything else is plumbing you do not have to see.`,
      },
      {
        type: "p",
        text: `Furlpay is not a bank. This guide is informational and not financial advice. On-chain payments are final; issue refunds deliberately through the API.`,
      },
    ],
  },
  // 26 ----------------------------------------------------------------
  {
    slug: "usdc-on-arbitrum-complete-guide",
    title: "USDC on Arbitrum: The Complete Guide for Businesses (2026)",
    excerpt:
      "USDC on Arbitrum One settles in about a second for a fraction of a cent of gas — the combination that makes 0.5% payment pricing viable. Here is how it works, why it matters, and how to accept it.",
    category: "product-news",
    date: "2026-07-06",
    readMins: 7,
    author: "Furlpay Team",
    cover: "https://images.unsplash.com/photo-1639762681485-074b7f938ba0?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `USDC is a dollar-pegged stablecoin issued by Circle. Arbitrum One is an Ethereum Layer 2. Put them together and you get the single most practical rail for stablecoin payments in 2026: digital dollars that move in about a second for a fraction of a cent, with Ethereum-grade security underneath. This guide explains what that means for a business and how to accept it.`,
      },
      { type: "h2", text: "What is USDC on Arbitrum?" },
      {
        type: "p",
        text: `USDC on Arbitrum is the same dollar-pegged token you know, issued natively on the Arbitrum One network (Chain ID 42161) rather than on Ethereum mainnet. Arbitrum batches many transactions and posts proofs back to Ethereum, so it inherits Ethereum's security while spreading the mainnet cost across everyone. The result is a transfer that finalises in roughly a second and costs a tiny fraction of a cent in gas.`,
      },
      {
        type: "table",
        headers: ["", "USDC on Ethereum", "USDC on Arbitrum"],
        rows: [
          ["Typical gas per transfer", "$1 – $5+", "~$0.002 – $0.005"],
          ["Settlement time", "~12 seconds+", "~1 second"],
          ["Security model", "Ethereum L1", "Ethereum L1 (via L2 proofs)"],
        ],
        highlightCol: 2,
      },
      { type: "h2", text: "Why the network matters more than the coin" },
      {
        type: "p",
        text: `A stablecoin is only as cheap to accept as the chain it settles on. The same USDC that costs several dollars to move on Ethereum mainnet costs a fraction of a cent on Arbitrum. That difference is the whole game for payments: it is what allows a 0.5% flat fee and even per-request micropayments, which would be impossible if every transfer cost a dollar in gas. You can compare chains yourself with our [gas cost estimator](/resources/tools/gas-estimator).`,
      },
      { type: "h2", text: "Who is already building here" },
      {
        type: "p",
        text: `Arbitrum is not a fringe choice. Mastercard brought 24/7 stablecoin settlement to Arbitrum, Robinhood built its own chain on Arbitrum Orbit, and Circle supports native USDC on Arbitrum directly. For a business, that ecosystem maturity means liquidity, tooling, and institutional comfort — not an experiment.`,
      },
      { type: "h2", text: "How to accept USDC on Arbitrum" },
      {
        type: "ul",
        items: [
          `Create a payment via the Furlpay API or a hosted checkout link.`,
          `The customer authorises the transfer from a passkey wallet (an EIP-712 signature) — no seed phrase.`,
          `Both sides are screened against sanctions lists, then USDC settles on Arbitrum in about a second.`,
          `You receive a signed receipt linked to Arbiscan for reconciliation.`,
        ],
      },
      {
        type: "p",
        text: `The whole flow costs a flat 0.5% plus sub-cent gas, with no chargebacks. See how it works on the [payments product page](/products/payments), or read the honest cost breakdown in [Crypto vs Card Fees](/blog/crypto-vs-card-fees-the-real-math).`,
      },
      {
        type: "quote",
        text: `USDC gives you dollar stability. Arbitrum gives you speed and near-zero fees. Neither is enough alone — together they are the first stablecoin rail that actually competes with cards on cost.`,
      },
      {
        type: "p",
        text: `This article is informational and not financial advice. Stablecoins carry issuer and peg risk and can lose value.`,
      },
    ],
  },
  // 27 ----------------------------------------------------------------
  {
    slug: "arbitrum-vs-base-for-payments",
    title: "Arbitrum vs Base for Payments: Which Layer 2 Should You Settle On?",
    excerpt:
      "Both are strong Ethereum Layer 2s with sub-cent fees. For stablecoin payments the deciding factors are settlement finality, ecosystem maturity, and where institutional volume already lives. Here is the honest comparison.",
    category: "engineering",
    date: "2026-07-06",
    readMins: 6,
    author: "Furlpay Team",
    cover: "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `Arbitrum and Base are both excellent Ethereum Layer 2 networks, both settle USDC for a fraction of a cent, and either would beat card rails on cost. So for a payments business the question is not "which is good" — both are — but which is the better default to settle on. This is our honest take, and why Furlpay chose Arbitrum.`,
      },
      {
        type: "table",
        headers: ["Factor", "Arbitrum One", "Base"],
        rows: [
          ["Type", "Optimistic rollup (Ethereum L2)", "Optimistic rollup (Ethereum L2)"],
          ["Gas per USDC transfer", "~$0.002 – $0.005", "~$0.003 – $0.008"],
          ["Backing", "Offchain Labs / Arbitrum DAO", "Coinbase"],
          ["Institutional footprint", "Mastercard settlement, Robinhood Chain", "Coinbase ecosystem, growing"],
          ["Native USDC", "Yes (Circle)", "Yes (Circle)"],
        ],
        highlightCol: 1,
      },
      { type: "h2", text: "Where they are the same" },
      {
        type: "p",
        text: `Both are optimistic rollups securing to Ethereum, both have native Circle-issued USDC, and both offer sub-cent gas and fast confirmation. For most integrations the developer experience is similar, and Circle's CCTP lets USDC move between them. If your customers or partners are already on Base — for example, deep in the Coinbase ecosystem — settling on Base is entirely reasonable.`,
      },
      { type: "h2", text: "Why Furlpay defaults to Arbitrum" },
      {
        type: "ul",
        items: [
          `Institutional volume already lives there: Mastercard runs 24/7 stablecoin settlement on Arbitrum, and Robinhood built its chain on Arbitrum Orbit.`,
          `Mature Orbit ecosystem: a clear path to an app-specific chain later without changing rails.`,
          `Consistently low, predictable fees for high-frequency payment and agent workloads.`,
        ],
      },
      {
        type: "p",
        text: `None of this makes Base a bad choice — it is a strong network with a large ecosystem. It is a question of defaults, and for a payments and settlement product the institutional gravity around Arbitrum tipped it for us. We go deeper on the rail itself in [USDC on Arbitrum](/blog/usdc-on-arbitrum-complete-guide).`,
      },
      { type: "h2", text: "The practical answer" },
      {
        type: "p",
        text: `Settle where your money and counterparties already are, and where fees are predictably tiny. For most businesses accepting stablecoin payments in 2026, that is Arbitrum — but Base is a close, legitimate second, and multi-chain via CCTP means you are not locked in either way.`,
      },
      {
        type: "quote",
        text: `Both chains make the gas cost a rounding error. So pick on ecosystem and finality, not on a tenth of a cent — and settle where the institutions already do.`,
      },
      {
        type: "p",
        text: `This article is informational and not financial advice.`,
      },
    ],
  },
  // 28 ----------------------------------------------------------------
  {
    slug: "crypto-payments-for-hotels-2026",
    title: "Crypto Payments for Hotels: The Complete 2026 Guide",
    excerpt:
      "International guests, high room rates, and card FX fees make hotels a natural fit for stablecoin payments. Palazzo Versace and Emirates already accept crypto. Here is how any hotel can, at 0.5% and zero chargebacks.",
    category: "product-news",
    date: "2026-07-06",
    readMins: 8,
    author: "Furlpay Team",
    cover: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `Hotels sit at the intersection of every reason stablecoin payments make sense: a high share of international guests, large average transaction sizes, painful foreign-exchange fees on foreign cards, and costly no-show chargebacks. In 2026 the early movers are already here — and any hotel can follow at a flat 0.5% with no chargebacks.`,
      },
      { type: "h2", text: "Who is already accepting crypto" },
      {
        type: "ul",
        items: [
          `Palazzo Versace Dubai accepts Bitcoin, Ethereum and BNB for rooms, dining and spa via a Binance partnership.`,
          `Emirates and Dubai Duty Free have signed with Crypto.com to accept crypto payments, including stablecoins.`,
          `Trip.com integrated USDT and USDC payments for flights and hotels globally.`,
          `Major chains including Marriott, Hilton and Accor are exploring blockchain payments for international guests.`,
        ],
      },
      { type: "h2", text: "Why hotels specifically benefit" },
      {
        type: "table",
        headers: ["Pain point", "On cards", "On USDC (Furlpay)"],
        rows: [
          ["Processing fee", "2.9% – 3.5%", "0.5% flat"],
          ["International guest FX", "1% – 3% extra", "None (dollar-stable)"],
          ["Settlement", "2 – 4 days", "~1 second"],
          ["No-show chargebacks", "Common + dispute fees", "None (on-chain final)"],
        ],
        highlightCol: 2,
      },
      {
        type: "p",
        text: `On a property doing $2M a year in card volume, moving eligible bookings to 0.5% keeps roughly $60,000 that would otherwise go to card networks — before counting avoided chargebacks. Model your own number with the [fee calculator](/resources/tools/fee-calculator) or [ROI calculator](/resources/tools/roi-calculator).`,
      },
      { type: "h2", text: "How it works without changing your PMS" },
      {
        type: "p",
        text: `You do not rip out your property-management system. Furlpay adds a hosted checkout or API alongside it: the guest pays in USDC on Arbitrum from a passkey wallet, you receive a signed receipt, and funds settle in about a second. Refunds are issued deliberately through the API, and a single USDC ledger keeps reconciliation clean.`,
      },
      { type: "h2", text: "Getting started" },
      {
        type: "p",
        text: `Start with the [hotels solution page](/solutions/hotels), or the regional versions for [UK hotels](/uk/solutions/hotels) and [Dubai hotels](/ae/solutions/hotels). A pilot on a single property, run alongside your existing card acceptance, is the low-risk way to prove the savings before rolling out.`,
      },
      {
        type: "quote",
        text: `Your guests already arrive with crypto wallets and international cards. Accepting USDC turns their most expensive-to-process payments into your cheapest — at 0.5%, settled instantly, with no chargebacks.`,
      },
      {
        type: "p",
        text: `Furlpay is not a bank. Figures are illustrative estimates and vary by property. This article is informational, not financial advice.`,
      },
    ],
  },
  // 29 ----------------------------------------------------------------
  {
    slug: "fca-crypto-regulations-2026",
    title: "FCA Crypto Regulations 2026: What UK Businesses Need to Know",
    excerpt:
      "The FCA published final crypto rules on 30 June 2026. The authorisation gateway opens 30 September 2026 and the regime becomes mandatory on 25 October 2027. Here is what UK businesses should understand — plainly.",
    category: "compliance",
    date: "2026-07-06",
    readMins: 7,
    author: "Furlpay Team",
    cover: "https://images.unsplash.com/photo-1529101091764-c3526daf38fe?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `The UK is building one of the world's clearest crypto regimes, and 2026 is the pivotal year. The FCA published its final core rules on 30 June 2026, the authorisation gateway opens on 30 September 2026, and the new regime becomes mandatory on 25 October 2027. This is a plain-English summary for UK businesses — not legal advice.`,
      },
      { type: "h2", text: "The timeline that matters" },
      {
        type: "table",
        headers: ["Date", "What happens"],
        rows: [
          ["4 Feb 2026", "The FSMA (Cryptoassets) Regulations 2026 bring crypto into the FCA's remit"],
          ["30 Jun 2026", "FCA publishes final core rules and guidance"],
          ["30 Sep 2026", "Authorisation gateway opens; firms can apply (until 28 Feb 2027)"],
          ["25 Oct 2027", "New regime becomes mandatory"],
        ],
        highlightCol: 0,
      },
      {
        type: "p",
        text: `The FCA is offering pre-application support meetings from July 2026, so serious firms are engaging now rather than waiting for the gateway to open.`,
      },
      { type: "h2", text: "Who needs to be authorised" },
      {
        type: "p",
        text: `Firms carrying out regulated cryptoasset activities in the UK — trading platforms, intermediaries, custodians, stablecoin issuers, and firms arranging staking — will need FCA authorisation. If your business only accepts a stablecoin as payment for goods or services, your obligations differ from those of a crypto exchange, but you should still take advice on where you sit.`,
      },
      { type: "h2", text: "The financial promotions rule you cannot ignore" },
      {
        type: "p",
        text: `Separately from authorisation, marketing cryptoassets to UK consumers has been regulated since October 2023 under the financial promotions regime. A promotion must be made by an FCA-authorised person, approved by an authorised "section 21 approver", or fall under an exemption — otherwise it can be a criminal offence. Promotions must carry a prescribed risk warning, cannot offer incentives that induce investment, and give first-time investors a 24-hour cooling-off period.`,
      },
      {
        type: "ul",
        items: [
          `If you market crypto to UK consumers, line up an authorised approver or a clear exemption first.`,
          `Use the FCA's prescribed risk-warning wording.`,
          `Do not offer referral bonuses or cashback that incentivise investment in cryptoassets to UK consumers.`,
        ],
      },
      { type: "h2", text: "How Furlpay approaches it" },
      {
        type: "p",
        text: `We state our position honestly: Furlpay is not yet FCA authorised, because the gateway does not open until 30 September 2026. Our UK pages carry the prescribed risk warning and an accurate status, and we are preparing for the regime. You can read our current position on the [UK trust page](/uk/trust).`,
      },
      {
        type: "quote",
        text: `The UK is not banning crypto — it is professionalising it. Firms that treat authorisation and honest promotions as a feature, not a chore, will be the ones enterprises and regulators trust.`,
      },
      {
        type: "p",
        text: `This article is information, not legal or financial advice. Dates and rules are accurate as of July 2026 and may change; consult qualified counsel about your specific situation.`,
      },
    ],
  },
  // 30 ----------------------------------------------------------------
  {
    slug: "genius-act-2026-what-businesses-need-to-know",
    title: "The GENIUS Act: What US Businesses Need to Know About Stablecoins in 2026",
    excerpt:
      "The GENIUS Act, signed in July 2025, is the first US federal law for payment stablecoins. It regulates issuers like Circle — not merchants — and gives businesses the legal clarity to accept USDC with confidence. Here is the plain-English version.",
    category: "compliance",
    date: "2026-07-06",
    readMins: 7,
    author: "Furlpay Team",
    cover: "https://images.unsplash.com/photo-1591994843349-f415893b3a6b?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `For years the biggest blocker to stablecoin payments in the US was not technology — it was legal uncertainty. That changed on 18 July 2025, when the GENIUS Act was signed into law. It is the first federal framework for payment stablecoins, and for a business deciding whether to accept USDC, it is the green light that was missing.`,
      },
      { type: "h2", text: "What the GENIUS Act actually does" },
      {
        type: "p",
        text: `The GENIUS Act (Guiding and Establishing National Innovation for U.S. Stablecoins) creates a federal regime for "payment stablecoins" — dollar-pegged tokens like USDC used for payments. It defines who is allowed to issue them and the rules they must follow.`,
      },
      {
        type: "ul",
        items: [
          `Only permitted issuers may issue a payment stablecoin for US persons — a subsidiary of an insured depository institution, or a federally or state-qualified issuer.`,
          `100% reserve backing in liquid assets such as US dollars and short-dated Treasuries, with monthly public disclosure of reserves.`,
          `Issuers are subject to the Bank Secrecy Act — real AML, sanctions screening and customer identification programs.`,
          `Compliant payment stablecoins are carved out of the federal "security" and "commodity" definitions, removing a major source of ambiguity.`,
        ],
      },
      { type: "h2", text: "The key point: it regulates issuers, not merchants" },
      {
        type: "p",
        text: `This is the part most summaries get wrong. The GENIUS Act's obligations fall on the issuer of the stablecoin — for USDC, that is Circle — not on the merchant who accepts it. A hotel or shop accepting USDC is not becoming a regulated stablecoin issuer. What the law gives that business is confidence that the dollar it is being paid in sits inside a federal framework with reserve and disclosure requirements behind it.`,
      },
      {
        type: "quote",
        text: `The GENIUS Act does not make accepting USDC complicated. It makes the USDC you accept trustworthy — federally regulated, fully reserved, and transparently disclosed.`,
      },
      { type: "h2", text: "What it means for your business" },
      {
        type: "table",
        headers: ["Before", "After the GENIUS Act"],
        rows: [
          ["\"Is this even legal?\"", "Federal framework for payment stablecoins"],
          ["Unclear reserve backing", "100% reserves + monthly disclosure required"],
          ["Security/commodity ambiguity", "Carved out for compliant payment stablecoins"],
          ["Patchwork by state", "A federal baseline"],
        ],
        highlightCol: 1,
      },
      {
        type: "p",
        text: `In practice, the legal clarity is what unlocks enterprise adoption. It is a large part of why so many US merchants now accept crypto, and why accepting USDC is a defensible decision for a CFO rather than a risky one.`,
      },
      { type: "h2", text: "How Furlpay fits" },
      {
        type: "p",
        text: `Furlpay is a payments platform, not a stablecoin issuer — we help businesses accept USDC (issued by Circle under the GENIUS Act framework) on Arbitrum for a flat 0.5%. We are honest about our own status and do not claim to be a GENIUS Act issuer. See how acceptance works on the [payments page](/products/payments) and the honest cost breakdown in [Crypto vs Card Fees](/blog/crypto-vs-card-fees-the-real-math).`,
      },
      {
        type: "p",
        text: `This article is information, not legal advice. The GENIUS Act was signed 18 July 2025 and its implementing rules continue to develop; consult qualified counsel about your specific situation.`,
      },
    ],
  },
  // 31 ----------------------------------------------------------------
  {
    slug: "2026-card-fee-changes-hotels",
    title: "The 2026 Card Fee Changes Hotels Should Watch — and the USDC Alternative",
    excerpt:
      "April 2026 brought a wave of card network fee changes — new Mastercard transaction fees, Visa's Level 2 sunset, and revised hotel interchange. Here is what actually changed, honestly, and how USDC at 0.5% compares.",
    category: "product-news",
    date: "2026-07-06",
    readMins: 6,
    author: "Furlpay Team",
    cover: "https://images.unsplash.com/photo-1563013544-824ae1b704d3?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `Card acceptance costs rarely go down, and April 2026 continued the trend with a set of specific network changes. There was no single dramatic "fees doubled" headline — the reality is more granular, and worth understanding accurately before anyone pitches you a scare story. Here is what actually changed, and how a flat-0.5% USDC rail compares.`,
      },
      { type: "h2", text: "What actually changed in April 2026" },
      {
        type: "ul",
        items: [
          `Mastercard introduced a new Force Post Transaction Fee of about nine cents per transaction in the US, and pricing changes to the Digital Enablement Fee (a minimum around $0.025 on transactions up to $100).`,
          `Mastercard added a new Fallback Avoidance fee.`,
          `Visa began sunsetting its standalone Level 2 (CEDP) interchange incentive for commercial cards, effective mid-April 2026 — relevant to business-card acceptance.`,
          `Discover revised a number of Hotel/Car Rental interchange rates in its April release.`,
        ],
      },
      {
        type: "p",
        text: `None of these is a blanket rate hike, but together they nudge effective acceptance costs up and make card pricing harder to predict — especially for hotels, which sit in specific interchange programs and take a lot of commercial and international cards.`,
      },
      { type: "h2", text: "Why hotels feel it most" },
      {
        type: "p",
        text: `Hotels combine three expensive ingredients: large average tickets, a high share of international and commercial cards, and meaningful chargeback exposure from cancellations and no-shows. Small per-transaction and interchange changes therefore land harder here than in most retail.`,
      },
      {
        type: "table",
        headers: ["", "Cards (2026)", "USDC on Furlpay"],
        rows: [
          ["Headline cost", "~2.9% – 3.5% + new per-tx fees", "0.5% flat"],
          ["International cards", "+ cross-border + FX", "No FX (dollar-stable)"],
          ["Settlement", "2 – 4 days", "~1 second"],
          ["Chargebacks", "Yes + dispute fees", "None (final)"],
          ["Fee predictability", "Changes each release", "One flat rate"],
        ],
        highlightCol: 2,
      },
      { type: "h2", text: "The honest takeaway" },
      {
        type: "p",
        text: `You do not need to drop cards — most guests will still tap a card, and you should let them. The point is to add a cheaper, predictable rail for the guests who can use it. USDC on Arbitrum is a flat 0.5% that does not change every April, settles instantly, and cannot be charged back. On a property doing $2M a year, moving even part of that volume is real money. Model it with the [ROI calculator](/resources/tools/roi-calculator), or read the [hotels guide](/blog/crypto-payments-for-hotels-2026).`,
      },
      {
        type: "quote",
        text: `Card fees are not going to stop drifting up. The hedge is not to fight every interchange release — it is to offer a second rail whose price you actually control.`,
      },
      {
        type: "p",
        text: `Figures are illustrative and based on publicly reported April 2026 network changes; your effective rates vary by processor, card mix and category. This is information, not financial advice.`,
      },
    ],
  },
  // 32 ----------------------------------------------------------------
  {
    slug: "dubai-cashless-2026-hotels-crypto",
    title: "Dubai Cashless 2026: How Hotels Can Accept Crypto Payments",
    excerpt:
      "Dubai is targeting a largely cashless economy, Emirates and Dubai Duty Free are enabling crypto, and Palazzo Versace already accepts it. Here is how any Dubai hotel can accept USDC at 0.5% — and the honest regulatory picture.",
    category: "travel",
    date: "2026-07-06",
    readMins: 7,
    author: "FurlPay Travels",
    cover: "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `Few cities are moving toward digital payments as deliberately as Dubai. With a stated goal of a largely cashless economy and a stream of high-value international guests, Dubai's hotels are an almost perfect fit for stablecoin payments — and several of the emirate's biggest names are already there.`,
      },
      { type: "h2", text: "The market is already moving" },
      {
        type: "ul",
        items: [
          `Emirates and Dubai Duty Free have signed agreements with Crypto.com to accept crypto payments, including stablecoins.`,
          `Palazzo Versace Dubai accepts Bitcoin, Ethereum and BNB for rooms, dining and spa via a Binance partnership.`,
          `The UAE has launched DDSC, a Central Bank–approved dirham-backed stablecoin, now available on VARA-regulated platforms.`,
          `Dubai's broader agenda targets a large majority of transactions going cashless.`,
        ],
      },
      { type: "h2", text: "Why Dubai hotels benefit more than most" },
      {
        type: "p",
        text: `Dubai combines the highest international-guest share and among the highest room rates in the world. That is precisely the mix where card interchange and foreign-exchange fees take the biggest absolute bite. Accepting USDC — dollar-stable, borderless — removes the FX cost and drops processing to a flat 0.5%.`,
      },
      {
        type: "table",
        headers: ["Pain point", "On cards", "On USDC (Furlpay)"],
        rows: [
          ["Processing fee", "2.9% – 3.5%", "0.5% flat"],
          ["International-guest FX", "1% – 3% extra", "None"],
          ["Settlement", "2 – 4 days", "~1 second"],
          ["Chargebacks", "Common + fees", "None (final)"],
        ],
        highlightCol: 2,
      },
      { type: "h2", text: "How a Dubai hotel accepts USDC" },
      {
        type: "p",
        text: `Furlpay adds a hosted checkout or API alongside the property's PMS. The guest pays in USDC on Arbitrum from a passkey wallet, the hotel gets a signed receipt, and funds settle in about a second. See the [Dubai hotels page](/ae/solutions/hotels) for the full picture.`,
      },
      { type: "h2", text: "The honest regulatory note" },
      {
        type: "p",
        text: `Dubai's Virtual Assets Regulatory Authority (VARA) requires a licence to offer virtual asset services in or from the emirate. Furlpay is not currently VARA-licensed and is evaluating licensing; our Dubai pages state this plainly and carry a virtual-asset risk note. Any hotel exploring crypto acceptance should confirm its own regulatory position — see our [UAE trust page](/ae/trust).`,
      },
      {
        type: "quote",
        text: `Dubai's guests already arrive with crypto wallets and foreign cards. Accepting USDC turns their most expensive-to-process payments into the cheapest — at 0.5%, instantly, with no FX.`,
      },
      {
        type: "p",
        text: `Furlpay is not a bank and is not currently VARA-licensed. Virtual assets are high risk and can lose value. This article is information, not financial or legal advice.`,
      },
    ],
  },
  {
    slug: "rwa-tokenized-economy-needs-a-settlement-layer",
    title: "The Tokenized Economy Still Needs a Cash Register: Stablecoins as the RWA Settlement Layer",
    excerpt:
      "Roughly $27B of real-world assets are now on-chain and BlackRock's BUIDL alone passed $2.5B. But a tokenized Treasury or hotel share is only half a market — it still needs a payment rail. Here is where stablecoin settlement fits, and where Furlpay honestly does and does not play.",
    category: "product-news",
    date: "2026-07-07",
    cover: "https://images.unsplash.com/photo-1620266757065-5814239881fd?auto=format&fit=crop&w=1600&q=80",
    readMins: 7,
    author: "Furlpay Team",
    body: [
      {
        type: "p",
        text: `Real-world asset (RWA) tokenization stopped being a thesis and became a balance sheet in 2026. On-chain RWA value sits around $26–36B depending on how you count, tokenized US Treasuries alone are roughly $12.9B, and BlackRock's tokenized money-market fund (BUIDL) passed $2.5B in May. Boston Consulting Group and Ripple project the broader market reaching $18.9T by 2033 — a number worth treating as a direction, not a promise, given how wide the published estimates run.`,
      },
      {
        type: "p",
        text: `Ahead of the RWA Week panel "Who Owns the Tokenized Economy" (8 July 2026), it is worth being precise about one layer everyone assumes and few build: settlement. A tokenized asset is a claim. Turning that claim into money still needs a payment rail — and that is a different problem from issuing the token.`,
      },
      { type: "h2", text: "Tokenization solves ownership, not payment" },
      {
        type: "p",
        text: `Tokenizing an asset answers "who owns this, and can I transfer a fraction of it." It does not answer "how does the coupon get paid, how does a buyer settle, how does a guest actually pay the hotel whose shares were just tokenized." Those are settlement questions, and today they mostly fall back to bank wires (multi-day) or card rails (1.5–3.5% and chargeback-prone) — the exact frictions tokenization set out to remove.`,
      },
      {
        type: "table",
        headers: ["Layer", "What it does", "Who builds it"],
        rows: [
          ["Issuance", "Mints the token that represents the asset", "Ondo, Franklin Templeton, BlackRock/Securitize"],
          ["Marketplace", "Lists and trades the tokenized asset", "InvestaX, tokenization platforms, exchanges"],
          ["Settlement", "Moves money for the trade, coupon or real-world use", "Stablecoin payment rails"],
        ],
        highlightCol: 2,
      },
      { type: "h2", text: "Where stablecoins fit — and where Furlpay does" },
      {
        type: "p",
        text: `Stablecoins are the natural settlement asset for tokenized markets: dollar-stable, borderless, final in about a second on a network like Arbitrum. Furlpay builds that settlement layer — a USDC payments API that settles on Arbitrum for a flat 0.5%, plus an x402 facilitator so machines and platforms can pay per call. That is the honest edge of what we do.`,
      },
      {
        type: "p",
        text: `We should be equally clear about what we do not do. Furlpay is not an RWA issuer. We do not tokenize hotels, issue fractional property shares, or operate a securities marketplace, and nothing here is an offer of any tokenized investment. Our role is upstream of ownership and downstream of it: the rail that moves dollars when a tokenized asset needs to be paid for, or when the real-world business behind it — a hotel, an airline, a merchant — takes a payment.`,
      },
      { type: "h2", text: "The concrete example: tokenized hospitality" },
      {
        type: "p",
        text: `Take a hotel whose ownership is tokenized so global investors can hold a fraction. That structure is only compelling if the underlying property runs efficiently — and a property that still pays 3% plus FX on every international guest is leaking yield the tokenization was supposed to unlock. A hotel accepting USDC at 0.5% ([see how](/solutions/hotels)) improves the real cash flows the token is a claim on. Settlement and ownership are two ends of the same asset.`,
      },
      { type: "h2", text: "Public rails, regulated wrappers" },
      {
        type: "p",
        text: `The regulatory direction reinforces this. The US GENIUS Act, the EU's MiCA, Japan's June 2026 recognition of USDC as an Electronic Payment Instrument, and Dubai's VARA regime all point the same way: regulated wrappers on top of public blockchains, not walled-garden chains. Settlement infrastructure that is compliance-aware on a public network is exactly the shape those frameworks reward. Furlpay states its own regulatory status plainly on each market's trust page rather than overclaiming it.`,
      },
      {
        type: "quote",
        text: `A tokenized asset without a settlement rail is a share certificate you cannot cash. The tokenized economy will be owned by whoever makes the money move — cheaply, instantly, and within the rules.`,
      },
      {
        type: "p",
        text: `Furlpay is not a bank and is not an issuer of securities or tokenized real-world assets. Crypto assets are high risk and can lose value. Market figures are third-party estimates as of mid-2026 and vary by source. This article is information, not financial or legal advice.`,
      },
    ],
  },
  {
    slug: "usdc-legal-in-japan-2026-what-it-means-for-payments",
    title: "USDC's Legal Path in Japan: What the June 2026 Stablecoin Rules Mean for Payments",
    excerpt:
      "From 1 June 2026, qualifying foreign stablecoins can be distributed in Japan under the Payment Services Act — with USDC's pathway running through SBI VC Trade. Here is what actually changed, why USDT still can't clear the bar, and what it means for hotels and merchants.",
    category: "compliance",
    date: "2026-07-07",
    cover: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=1600&q=80",
    readMins: 7,
    author: "Compliance Team",
    body: [
      {
        type: "p",
        text: `For years, using a dollar stablecoin to pay in Japan sat in a grey zone. That changed in June 2026. Under an update to the Payment Services Act effective 1 June 2026, qualifying foreign stablecoins can now be distributed in Japan through licensed intermediaries, regulated by the Financial Services Agency (JFSA) as Electronic Payment Instruments (EPI). For a business deciding whether to accept USDC, that is the legal clarity that was missing.`,
      },
      { type: "h2", text: "What actually changed" },
      {
        type: "p",
        text: `Japan's framework treats fiat-backed stablecoins as Electronic Payment Instruments, and a foreign stablecoin can only be offered through a registered Electronic Payment Instrument Exchange Service Provider (EPIESP) after clearing a JFSA "equivalence" test on its issuer and reserves. The practical result is a short, curated list of stablecoins that are actually usable on licensed platforms.`,
      },
      {
        type: "table",
        headers: ["Stablecoin", "Status in Japan", "Pathway"],
        rows: [
          ["USDC", "Usable via licensed distribution", "SBI VC Trade (registered EPIESP) + Circle"],
          ["RLUSD", "First foreign stablecoin to clear JFSA equivalence", "SBI VC Trade / Ripple, June 2026"],
          ["JPYC", "Legal domestic yen stablecoin", "JPYC Inc. (licensed issuer)"],
          ["USDT", "Not available on licensed platforms", "No registered distributor"],
        ],
        highlightCol: 0,
      },
      {
        type: "p",
        text: `Two nuances the headlines flatten. First, USDC's route to market is its distribution partnership with SBI VC Trade, which registered as an EPIESP — the token is usable, but through that regulated channel rather than freely. Second, Ripple's RLUSD was actually the first foreign-issued stablecoin to formally clear the JFSA equivalence test in June 2026, also via SBI. USDT, by contrast, has no licensed distributor and remains effectively unavailable on regulated Japanese platforms.`,
      },
      { type: "h2", text: "Why it matters for hotels and merchants" },
      {
        type: "p",
        text: `Japan drew over 40 million inbound visitors in 2025, a growing share of whom carry stablecoins. A hotel, ryokan or merchant that accepts USDC through a compliant pathway can serve that demand while cutting processing from the 3–4% typical of Japanese cards (plus FX on foreign cards) to a flat 0.5%, settled in about a second with no chargebacks. Retail precedent already exists — major electronics chains have accepted crypto for years — so acceptance is not the leap it once was.`,
      },
      {
        type: "ul",
        items: [
          `Legal clarity: USDC is a recognised Electronic Payment Instrument, not a grey-area asset.`,
          `Lower cost: 0.5% versus 3–4% card-plus-FX on inbound guests.`,
          `Finality: on-chain settlement removes chargebacks on high-value ryokan and hotel stays.`,
          `Omotenashi: one less point of friction at checkout, complementing service rather than replacing it.`,
        ],
      },
      { type: "h2", text: "Furlpay's honest status in Japan" },
      {
        type: "p",
        text: `Furlpay is a payments platform, not a stablecoin issuer or a JFSA-registered exchange. We are not registered with the JFSA as a Crypto-Asset Exchange Service Provider or an EPIESP, and we do not claim to be — those registrations require a local presence and are how distribution is licensed in Japan. We are evaluating a licensed-intermediary pathway and state exactly where we stand on our [Japan trust page](/jp/trust). See how acceptance works for [Japanese hotels](/jp/solutions/hotels).`,
      },
      {
        type: "p",
        text: `Furlpay is not a bank and is not registered with the JFSA. Crypto assets are high risk, are not legal tender, and can lose value. Regulatory details are accurate to the best of our knowledge as of July 2026 and continue to develop; consult qualified Japanese counsel about your specific situation. This article is information, not legal advice.`,
      },
    ],
  },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Deterministic date formatting — avoids timezone drift from Date parsing.
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function getSortedPosts(): Post[] {
  return [...POSTS].sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getFeatured(): Post {
  return POSTS.find((p) => p.featured) ?? getSortedPosts()[0];
}

export function getPost(slug: string): Post | undefined {
  return POSTS.find((p) => p.slug === slug);
}

export function postsByCategory(category: CategoryId): Post[] {
  return getSortedPosts().filter((p) => p.category === category);
}
