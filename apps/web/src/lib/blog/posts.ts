import type { CategoryId } from "@/lib/blog/categories";

// Blog content lives here as structured blocks (MDX-style authoring without an
// external MDX pipeline). Article pages render these via ArticleBody; the feed
// and category pages read the frontmatter fields.

export type Block =
  | { type: "h2"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "code"; lang: string; code: string }
  | { type: "quote"; text: string };

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
  {
    slug: "announcing-furlpay-connect",
    title: "Announcing Furlpay Connect: Low-Cost B2B Stablecoin Settlement",
    excerpt:
      "Furlpay Connect lets platforms settle in stablecoins and pay out to local bank accounts in real time — cutting processing costs by up to 70% versus legacy card rails.",
    category: "product-news",
    date: "2026-06-30",
    readMins: 4,
    author: "Furlpay Team",
    featured: true,
    body: [
      {
        type: "p",
        text: "Today we're introducing Furlpay Connect — a settlement API that lets marketplaces, PSPs and online platforms accept stablecoin payments and pay out to local bank accounts in real time. No 2–3% interchange, no multi-day settlement windows.",
      },
      { type: "h2", text: "Why we built it" },
      {
        type: "p",
        text: "Legacy card processing bundles interchange, scheme fees and cross-border markups into a 2–4% cost that platforms ultimately pass to their users. By settling in USDC and EURC on Base and Solana, then off-ramping through Wise rails, Connect collapses that stack.",
      },
      {
        type: "ul",
        items: [
          "Up to 70% lower cost versus legacy card processors on cross-border flows",
          "Real-time local settlement — IBAN, routing and account numbers via Wise",
          "Zero gas for end users; sponsored through Furlpay paymasters",
        ],
      },
      { type: "h2", text: "Availability" },
      {
        type: "p",
        text: "Connect is rolling out to platforms in the EEA, UK and US first, with additional corridors following as our compliance coverage expands. Existing @furlpay/node users can request access from the dashboard today.",
      },
    ],
  },
  {
    slug: "furlpay-connect-global-local-settlements",
    title: "Furlpay Connect Launches Globally: Real-Time Local Bank Settlements for Stablecoin Transactions",
    excerpt:
      "A closer look at the settlement engine behind Connect — how stablecoin balances become local-currency payouts in seconds across dozens of corridors.",
    category: "product-news",
    date: "2026-06-18",
    readMins: 5,
    author: "Payments Team",
    body: [
      {
        type: "p",
        text: "Connect abstracts the on-chain leg entirely. A platform charges its customer in USDC; Furlpay handles conversion and delivers a local-currency payout to the recipient's bank account — often within seconds.",
      },
      { type: "h2", text: "How a settlement flows" },
      {
        type: "ul",
        items: [
          "Customer pays in USDC/EURC on Base or Solana",
          "Furlpay nets the flow and quotes an FX rate through partner liquidity",
          "Wise rails deliver the local-currency payout (IBAN / ACH / Faster Payments)",
        ],
      },
      {
        type: "quote",
        text: "The goal is simple: developers integrate one API and their users never think about chains, gas or bridges.",
      },
    ],
  },
  {
    slug: "navigating-mica-eea-auto-swap",
    title: "Navigating MiCA in the EEA: Our Auto-Swap and Reserve Strategy",
    excerpt:
      "How Furlpay keeps EEA users compliant under MiCA — auto-swapping non-compliant tokens and mapping every balance to an authorised e-money token.",
    category: "compliance",
    date: "2026-06-12",
    readMins: 6,
    author: "Compliance Team",
    body: [
      {
        type: "p",
        text: "Under the EU Markets in Crypto-Assets (MiCA) regime, the tokens Furlpay settles in are treated as e-money tokens (EMTs) and asset-referenced tokens (ARTs). For EEA users, that shapes which stablecoins we hold and how.",
      },
      { type: "h2", text: "Auto-swap for compliant balances" },
      {
        type: "p",
        text: "When an EEA user receives a token that isn't MiCA-authorised, the jurisdiction resolver flags it and offers an in-app auto-swap into a compliant EMT such as EURC — with the rate and fee shown before confirmation.",
      },
      { type: "h2", text: "Reserve transparency" },
      {
        type: "p",
        text: "We publish monthly attestations for the issuers behind the EMTs we support, so enterprise partners can verify reserve backing without taking our word for it.",
      },
    ],
  },
  {
    slug: "automating-fatf-travel-rule",
    title: "Operating a Compliant On-Chain FinTech: How Furlpay Automates FATF Travel Rule Metadata Transmission",
    excerpt:
      "Travel Rule messaging shouldn't be a manual chore. Here's how Furlpay attaches originator and beneficiary data to qualifying transfers automatically.",
    category: "compliance",
    date: "2026-05-28",
    readMins: 5,
    author: "Compliance Team",
    body: [
      {
        type: "p",
        text: "The FATF Travel Rule requires VASPs to exchange originator and beneficiary information for qualifying transfers. Furlpay attaches this metadata over the TRUST network automatically, keyed off the jurisdiction resolver.",
      },
      { type: "h2", text: "Where it fits in the request path" },
      {
        type: "code",
        lang: "typescript",
        code: "// packages/compliance — attached transparently before broadcast\nconst rule = resolveTravelRule(originator, beneficiary, amount);\nif (rule.required) {\n  await trust.send({ originator, beneficiary, ref: transfer.id });\n}",
      },
      {
        type: "p",
        text: "Route handlers stay jurisdiction-agnostic — the compliance package decides when the rule applies and handles the messaging.",
      },
    ],
  },
  {
    slug: "cryptography-behind-2of2-mpc",
    title: "Securing User Assets: The Cryptography Behind Furlpay's 2-of-2 MPC Key Generation",
    excerpt:
      "A developer-oriented walkthrough of how Furlpay splits signing across a device share and an HSM-policy share so no full private key ever exists.",
    category: "engineering",
    date: "2026-05-15",
    readMins: 8,
    author: "Security Engineering",
    body: [
      {
        type: "p",
        text: "Furlpay wallets never materialise a single private key. Every signature is produced by a 2-of-2 multi-party computation between a device share and a server share held under HSM policy.",
      },
      { type: "h2", text: "Key generation" },
      {
        type: "p",
        text: "During onboarding, the two parties run a distributed key generation (DKG) protocol. Each ends up with a secret share; the full key is never assembled, not even transiently, on either side.",
      },
      {
        type: "ul",
        items: [
          "Device share — bound to hardware, unlocked by a WebAuthn passkey",
          "Server share — released only when the Turnkey HSM policy passes",
          "Neither share alone can produce a valid signature",
        ],
      },
      {
        type: "quote",
        text: "If an attacker compromises one share, they get nothing usable — they must defeat both the device and the HSM policy simultaneously.",
      },
    ],
  },
  {
    slug: "lessons-from-gnosis-pay-exploit",
    title: "Lessons from the Gnosis Pay Exploit: Why Furlpay Uses Hybrid Off-Chain Policy Engines",
    excerpt:
      "Following June 2026's Gnosis Pay incident, we explain the card-drain class of exploit and the architectural choices that prevent it on Furlpay.",
    category: "security",
    date: "2026-06-25",
    readMins: 7,
    author: "Security Team",
    body: [
      {
        type: "p",
        text: "In June 2026, an exploit drained funds from a set of Gnosis Pay cards. We think transparency serves users better than silence, so here's our read of the incident class — and why Furlpay's architecture is designed to prevent it.",
      },
      { type: "h2", text: "The card-drain class of exploit" },
      {
        type: "p",
        text: "Pure on-chain card modules often rely on standing token allowances. If the module or its allowance logic is subverted, an attacker can pull funds up to the approved amount. Unbounded or long-lived approvals turn a single flaw into a full drain.",
      },
      { type: "h2", text: "Hybrid off-chain policy engine" },
      {
        type: "ul",
        items: [
          "No unbounded approvals — spend is capped per authorization at signing time",
          "A hybrid off-chain policy engine gates each spend before any co-signature",
          "Every settlement reconciles through the double-entry ledger — nothing moves without a matching entry",
        ],
      },
      {
        type: "p",
        text: "The result: even a compromised on-chain component can't exceed a single pre-authorised amount, and anomalies surface immediately in reconciliation.",
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
