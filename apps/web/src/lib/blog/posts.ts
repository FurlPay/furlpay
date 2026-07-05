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
  | { type: "diagram"; text: string };

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
    readMins: 8,
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
      {
        type: "diagram",
        text: `2026 booking funnel, where trust breaks:
[ inspiration ] → [ AI planning ] → [ selection ] → [ PAYMENT ] → [ in-trip ] → [ refunds ]
      ✓ solved        ✓ solved         ✓ solved       ✗ trust gap     ~ super-apps    ✗ credit traps`,
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
