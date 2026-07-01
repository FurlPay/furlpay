// AI-style fuzzy search index for the docs portal. Every entry maps a set of
// keywords to a destination page (+ anchor). The index encodes all six blueprint
// categories: Monorepo Architecture, API Endpoints, Compliance & Licensing,
// Developer Ecosystem, Visual Assets & Feeds, Security Architecture.

export type SearchDoc = {
  title: string;
  section: string;
  href: string;
  snippet: string;
  keywords: string[];
};

export const SEARCH_INDEX: SearchDoc[] = [
  // ---- Monorepo Architecture -------------------------------------------
  {
    title: "Monorepo layout",
    section: "Architecture",
    href: "/docs/architecture/monorepo",
    snippet: "Turborepo workspaces: apps, packages, sdks, mcp — and how they build.",
    keywords: ["turbo.json", "turborepo", "monorepo", "workspaces", "apps", "packages", "sdks", "pnpm", "next.config.js"],
  },
  {
    title: "Tauri desktop wrappers",
    section: "Architecture",
    href: "/docs/architecture/monorepo#desktop",
    snippet: "Windows .msi, macOS .dmg and Linux .deb builds from a shared Tauri shell.",
    keywords: ["tauri", "desktop", "msi", "dmg", "deb", "windows", "macos", "linux", "rust"],
  },
  {
    title: "Browser extension",
    section: "Architecture",
    href: "/docs/architecture/monorepo#extension",
    snippet: "apps/extension — the MV3 checkout + autofill browser extension.",
    keywords: ["apps/extension", "extension", "mv3", "manifest v3", "chrome", "checkout"],
  },

  // ---- API Endpoints ----------------------------------------------------
  {
    title: "POST /api/auth/webauthn",
    section: "API Routes",
    href: "/docs/architecture/api-routes#auth",
    snippet: "Register and authenticate passkeys (WebAuthn / FIDO2).",
    keywords: ["POST /api/auth/webauthn", "webauthn", "passkey", "auth", "register", "authenticate", "fido2"],
  },
  {
    title: "POST /api/cards/settings",
    section: "API Routes",
    href: "/docs/architecture/api-routes#cards",
    snippet: "Freeze, set spend limits and update controls on an issued card.",
    keywords: ["POST /api/cards/settings", "cards", "settings", "freeze", "limit", "issue card", "marqeta"],
  },
  {
    title: "POST /api/investing/order",
    section: "API Routes",
    href: "/docs/architecture/api-routes#investing",
    snippet: "Place fractional stock / ETF orders routed to Alpaca.",
    keywords: ["POST /api/investing/order", "investing", "order", "stocks", "etf", "fractional", "alpaca"],
  },
  {
    title: "webhooks/marqeta",
    section: "API Routes",
    href: "/docs/architecture/api-routes#webhooks",
    snippet: "Card processor callbacks (marqeta), plus bridge and wise webhooks.",
    keywords: ["webhooks/marqeta", "webhooks", "marqeta", "bridge", "wise", "callback", "signature verification"],
  },

  // ---- Payments --------------------------------------------------------
  {
    title: "Agentic Payments (x402)",
    section: "Payments",
    href: "/docs/payments/agentic-x402",
    snippet: "Pay-per-request USDC over HTTP 402 for AI agents — hardened verification.",
    keywords: ["x402", "agentic payments", "http 402", "payment required", "ai agents", "usdc", "eip-3009", "pay per call", "X-PAYMENT", "coinbase"],
  },
  {
    title: "x402 endpoint — GET /api/x402/fx",
    section: "Payments",
    href: "/docs/payments/agentic-x402#pay",
    snippet: "Pay $0.01 USDC per mid-market FX quote via the x402 flow.",
    keywords: ["/api/x402/fx", "x402 fx", "pay per call", "402 quote", "agent api", "micropayment"],
  },
  {
    title: "Solana Actions & Blinks",
    section: "Payments",
    href: "/docs/payments/solana-actions",
    snippet: "Shareable checkout links that unfurl into signable payment widgets.",
    keywords: ["solana actions", "blinks", "actions.json", "dialect", "checkout link", "unfurl", "spl-token", "transferChecked", "dial.to"],
  },

  // ---- Integrations ----------------------------------------------------
  {
    title: "Stripe Crypto checkout",
    section: "Integrations",
    href: "/docs/integrations/stripe-crypto",
    snippet: "Accept stablecoin payments with the Stripe PaymentIntents API + Elements.",
    keywords: ["stripe", "crypto", "stablecoin", "payment intent", "paymentintents", "elements", "usdc", "checkout", "bridge"],
  },
  {
    title: "Stripe payouts & transfers",
    section: "Integrations",
    href: "/docs/integrations/stripe-crypto#payouts",
    snippet: "B2B settlement payouts to merchant wallets via the Transfers API.",
    keywords: ["stripe transfers", "payout", "b2b", "connect", "settlement", "merchant", "bridge rails"],
  },
  {
    title: "Stripe webhook verification",
    section: "Integrations",
    href: "/docs/integrations/stripe-crypto#security",
    snippet: "Verify the stripe-signature header with constructEvent before trusting events.",
    keywords: ["stripe webhook", "constructEvent", "stripe-signature", "hmac", "payment_intent.succeeded", "signature verification"],
  },
  {
    title: "Persona KYC & liveness",
    section: "Integrations",
    href: "/docs/integrations/persona-kyc",
    snippet: "Embedded identity verification with selfie + government ID and PAD liveness.",
    keywords: ["persona", "kyc", "identity", "liveness", "selfie", "biometric", "inquiry", "template id", "withpersona"],
  },
  {
    title: "Persona webhooks & KYB",
    section: "Integrations",
    href: "/docs/integrations/persona-kyc#webhooks",
    snippet: "Verify persona-signature, handle inquiry outcomes, and run KYB owner screening.",
    keywords: ["persona webhook", "persona-signature", "inquiry.completed", "kyb", "business associated persons", "ubo", "inquiry search"],
  },

  // ---- Compliance & Licensing ------------------------------------------
  {
    title: "MiCA roadmap",
    section: "Legal & Compliance",
    href: "/docs/compliance/mica",
    snippet: "EU Markets in Crypto-Assets licensing path and EMT/ART treatment.",
    keywords: ["MiCA", "markets in crypto-assets", "emt", "art", "eu", "casp", "e-money token"],
  },
  {
    title: "US GENIUS Act",
    section: "Legal & Compliance",
    href: "/docs/compliance/mica#us",
    snippet: "US federal stablecoin framework and issuer obligations.",
    keywords: ["US GENIUS Act", "genius act", "stablecoin", "us", "federal", "issuer"],
  },
  {
    title: "FCA regulations",
    section: "Legal & Compliance",
    href: "/docs/compliance/mica#uk",
    snippet: "UK FCA registration and the cryptoasset promotions regime.",
    keywords: ["FCA regulations", "fca", "uk", "financial conduct authority", "promotions"],
  },
  {
    title: "Sumsub KYC integration",
    section: "Legal & Compliance",
    href: "/docs/compliance/mica#kyc",
    snippet: "Tiered, reusable KYC/KYB and identity verification via Sumsub.",
    keywords: ["Sumsub integration", "sumsub", "kyc", "kyb", "identity", "verification", "onboarding"],
  },
  {
    title: "TRUST Travel Rule",
    section: "Legal & Compliance",
    href: "/docs/compliance/mica#travel-rule",
    snippet: "FATF Travel Rule messaging via the TRUST network for VASP transfers.",
    keywords: ["TRUST Travel Rule", "travel rule", "trust", "fatf", "vasp", "originator", "beneficiary"],
  },

  // ---- Developer Ecosystem ---------------------------------------------
  {
    title: "@furlpay/cli",
    section: "Quickstart",
    href: "/docs/quickstart#cli",
    snippet: "Scaffold, run and debug integrations from the terminal.",
    keywords: ["@furlpay/cli", "cli", "command line", "npx furlpay", "scaffold"],
  },
  {
    title: "furlpay listen",
    section: "Quickstart",
    href: "/docs/quickstart#listen",
    snippet: "Forward live webhooks to localhost during development.",
    keywords: ["furlpay listen", "listen", "webhook forwarding", "localhost", "tunnel"],
  },
  {
    title: "FurlpayCheckoutButton widget",
    section: "Quickstart",
    href: "/docs/quickstart#elements",
    snippet: "Drop-in React Element for stablecoin checkout.",
    keywords: ["FurlpayCheckoutButton widget", "checkout button", "react elements", "widget", "@furlpay/react"],
  },
  {
    title: "Webhook signature verification",
    section: "API Routes",
    href: "/docs/architecture/api-routes#webhooks",
    snippet: "Verify the Furlpay-Signature header before trusting webhook events.",
    keywords: ["webhook signature verification", "signature", "verify", "hmac", "furlpay-signature", "security"],
  },

  // ---- Visual Assets & Feeds -------------------------------------------
  {
    title: "CryptoLogos.cc token art",
    section: "Architecture",
    href: "/docs/architecture/monorepo#assets",
    snippet: "Token/brand logos sourced from CryptoLogos.cc in packages/ui.",
    keywords: ["CryptoLogos.cc", "cryptologos", "logos", "token art", "brand", "assets"],
  },
  {
    title: "Lucide React icons",
    section: "Architecture",
    href: "/docs/architecture/monorepo#assets",
    snippet: "The icon system used across web, desktop and extension surfaces.",
    keywords: ["Lucide React", "lucide", "icons", "iconography", "svg"],
  },
  {
    title: "Twelve Data API",
    section: "API Routes",
    href: "/docs/architecture/api-routes#investing",
    snippet: "Equity quotes and fundamentals feed for the investing module.",
    keywords: ["Twelve Data API", "twelve data", "quotes", "market data", "equities", "fundamentals"],
  },
  {
    title: "Alpaca WebSockets",
    section: "API Routes",
    href: "/docs/architecture/api-routes#investing",
    snippet: "Real-time trade/quote streams and order execution via Alpaca.",
    keywords: ["Alpaca WebSockets", "alpaca", "websocket", "streaming", "realtime", "execution"],
  },

  // ---- Security Architecture -------------------------------------------
  {
    title: "2-of-2 MPC signing",
    section: "Security & Crypto",
    href: "/docs/security/mpc-webauthn#mpc",
    snippet: "Every spend is co-signed 2-of-2; no single full key ever exists.",
    keywords: ["2-of-2 MPC", "mpc", "multi-party computation", "co-sign", "threshold", "key shares"],
  },
  {
    title: "Turnkey HSM policy",
    section: "Security & Crypto",
    href: "/docs/security/mpc-webauthn#hsm",
    snippet: "Policy-gated signing enforced inside Turnkey HSMs.",
    keywords: ["Turnkey HSM policy", "turnkey", "hsm", "policy engine", "signer", "custody"],
  },
  {
    title: "Sardine biometric fraud",
    section: "Security & Crypto",
    href: "/docs/security/mpc-webauthn#fraud",
    snippet: "Device + biometric behavioural risk scoring on every transfer.",
    keywords: ["Sardine biometric fraud", "sardine", "fraud", "risk engine", "device", "behavioural"],
  },
  {
    title: "Gnosis Pay exploit prevention",
    section: "Security & Crypto",
    href: "/docs/security/mpc-webauthn#exploits",
    snippet: "Controls designed to prevent Gnosis Pay-class card drain exploits.",
    keywords: ["Gnosis Pay exploit prevention", "gnosis pay", "exploit", "card drain", "allowance", "hardening"],
  },
  {
    title: "WebAuthn passkeys",
    section: "Security & Crypto",
    href: "/docs/security/mpc-webauthn#webauthn",
    snippet: "Phishing-resistant passkey login bound to the registrable domain.",
    keywords: ["WebAuthn", "passkey", "fido2", "rp_id", "phishing-resistant", "fingerprint", "face id"],
  },
];

// ---- Fuzzy matcher ------------------------------------------------------

// Subsequence match with contiguity + prefix bonuses. Returns 0 when the needle
// is not a subsequence of the haystack.
function fuzzyScore(needle: string, haystack: string): number {
  needle = needle.toLowerCase();
  haystack = haystack.toLowerCase();
  if (!needle) return 0;

  const idx = haystack.indexOf(needle);
  let score = 0;
  if (idx === 0) score += 120;
  else if (idx > 0) score += Math.max(20, 70 - idx);

  let h = 0;
  let matched = 0;
  let streak = 0;
  for (let n = 0; n < needle.length; n++) {
    let found = false;
    while (h < haystack.length) {
      if (haystack[h] === needle[n]) {
        found = true;
        h++;
        streak++;
        matched++;
        score += 1 + streak;
        break;
      }
      h++;
      streak = 0;
    }
    if (!found) break;
  }
  if (matched < needle.length) return 0;
  return score;
}

export type SearchResult = SearchDoc & { score: number };

export function searchDocs(query: string, limit = 8): SearchResult[] {
  const q = query.trim();
  if (!q) return [];
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);

  const results: SearchResult[] = [];
  for (const doc of SEARCH_INDEX) {
    const haystacks = [doc.title, doc.section, doc.snippet, ...doc.keywords];
    let total = 0;
    let matchedAllTokens = true;

    for (const token of tokens) {
      let best = 0;
      for (const hay of haystacks) {
        const s = fuzzyScore(token, hay);
        // Title / keyword hits weigh more than snippet prose.
        const weighted = hay === doc.snippet ? s * 0.6 : s;
        if (weighted > best) best = weighted;
      }
      if (best === 0) {
        matchedAllTokens = false;
        break;
      }
      total += best;
    }

    if (matchedAllTokens && total > 0) results.push({ ...doc, score: total });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
