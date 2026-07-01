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
    featured: true,
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
