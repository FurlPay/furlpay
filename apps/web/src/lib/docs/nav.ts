import { Banknote, Layers, LifeBuoy, Puzzle, Rocket, Scale, ShieldCheck, type LucideIcon } from "lucide-react";

// Sidebar structure for the developer documentation portal (furlpay.app/docs).
// `desc` feeds /llms.txt (public/llms.txt) and per-page SEO; `badge` renders in
// the sidebar ("new" for fresh pages, "updated" for recent rewrites); `icon`
// renders next to the section label.

export type DocBadge = "new" | "updated";
export type DocLink = { title: string; href: string; desc: string; badge?: DocBadge };
export type DocSection = { label: string; icon: LucideIcon; items: DocLink[] };

export const DOCS_NAV: DocSection[] = [
  {
    label: "Getting Started",
    icon: Rocket,
    items: [
      { title: "Introduction", href: "/docs", desc: "What FurlPay is: non-custodial stablecoin payment infrastructure for AI agents and humans." },
      { title: "Quickstart", href: "/docs/quickstart", desc: "Install the CLI, make your first API call, forward webhooks, and drop in the checkout widget." },
      { title: "For AI Agents", href: "/docs/agents", desc: "MCP server, LangChain / OpenAI / CrewAI adapters, and paying for APIs over x402." },
    ],
  },
  {
    label: "Architecture",
    icon: Layers,
    items: [
      { title: "Monorepo", href: "/docs/architecture/monorepo", desc: "Turborepo layout: apps, packages, SDKs, and how they depend on each other." },
      { title: "API Routes", href: "/docs/architecture/api-routes", desc: "REST surface, authentication, rate limits, idempotency, and webhook signing." },
      { title: "Authentication", href: "/docs/architecture/authentication", desc: "Sessions, WebAuthn passkeys, roles, agent request signatures, and x402 pay-as-auth.", badge: "new" },
      { title: "Webhook Events", href: "/docs/architecture/webhooks", desc: "Every inbound webhook handler, its signature scheme, and how to verify outbound events.", badge: "new" },
      { title: "Error Codes", href: "/docs/architecture/errors", desc: "Error response shapes, HTTP status conventions, and every machine-readable error code.", badge: "new" },
      { title: "Rate Limits", href: "/docs/architecture/rate-limits", desc: "The baseline per-IP budget, per-route limits, and how to handle 429 responses.", badge: "new" },
    ],
  },
  {
    label: "Payments",
    icon: Banknote,
    items: [
      { title: "Agentic Payments (x402)", href: "/docs/payments/agentic-x402", desc: "HTTP 402 pay-per-call with EIP-3009 USDC settlement on Arbitrum/Base — no API key required." },
      { title: "Agent Trust & Mandates (TAP)", href: "/docs/payments/agent-trust", desc: "Owned agent keys, enforced spending policies, and cryptographic mandates." },
      { title: "CCTP Cross-Chain", href: "/docs/payments/cctp", desc: "Non-custodial cross-chain USDC with Circle CCTP V2 burn-and-mint and Fast Transfers.", badge: "new" },
      { title: "LI.FI Swaps", href: "/docs/payments/lifi-swaps", desc: "Cross-chain token swaps via LI.FI routing — client-signed, with the integrator fee model.", badge: "new" },
      { title: "FurlPay Travels (Travel MCP)", href: "/docs/payments/travels-mcp", desc: "Flight search, reprice, and booking for agents via the Travel MCP server." },
      { title: "Solana Actions & Blinks", href: "/docs/payments/solana-actions", desc: "Spec-correct Solana Actions endpoints and shareable payment Blinks." },
    ],
  },
  {
    label: "Integrations",
    icon: Puzzle,
    items: [
      { title: "AI Assistants", href: "/docs/integrations/ai-assistants", desc: "Wire FurlPay into Claude, ChatGPT, and agent frameworks via MCP and native adapters.", badge: "new" },
      { title: "Stripe Crypto", href: "/docs/integrations/stripe-crypto", desc: "Fiat onramp and card processing through Stripe's crypto products." },
      { title: "Persona KYC", href: "/docs/integrations/persona-kyc", desc: "Identity verification flows and webhook-driven KYC status updates." },
    ],
  },
  {
    label: "Legal & Compliance",
    icon: Scale,
    items: [{ title: "MiCA Roadmap", href: "/docs/compliance/mica", desc: "EU MiCA/CASP posture, licensing roadmap, and what it means for integrators." }],
  },
  {
    label: "Security & Crypto",
    icon: ShieldCheck,
    items: [
      { title: "Security Posture", href: "/docs/security/posture", desc: "What protects your money at each layer: non-custodial settlement, replay protection, money caps, CI scanning, and honest audit status.", badge: "new" },
      { title: "MPC & WebAuthn", href: "/docs/security/mpc-webauthn", desc: "Passkey (FIDO2/WebAuthn) authentication and the MPC key architecture." },
    ],
  },
  {
    label: "Help Center",
    icon: LifeBuoy,
    items: [
      { title: "Help Center", href: "/docs/help", desc: "Self-service help for FurlPay accounts: onboarding, transactions, cards, KYC, travel and developer support.", badge: "new" },
      { title: "Getting Started", href: "/docs/help/getting-started", desc: "Create your FurlPay account, secure it with a passkey, and make your first stablecoin deposit." },
      { title: "KYC Verification", href: "/docs/help/kyc-verification", desc: "Progressive verification tiers 0-3, accepted documents, and fixing a failed or stuck verification." },
      { title: "Passkeys & Biometrics", href: "/docs/help/passkeys-biometrics", desc: "Fingerprint and Face unlock, how passkeys work on web and Android, and what to do if you lose a device." },
      { title: "Privacy & Data Protection", href: "/docs/help/privacy-gdpr", desc: "What FurlPay stores, how support tickets are redacted, and how to exercise GDPR rights including deletion." },
      { title: "Transaction Statuses", href: "/docs/help/transaction-statuses", desc: "What pending, settled, failed and rejected mean, and how to check a transaction on a block explorer." },
      { title: "Gasless Transfers", href: "/docs/help/gasless-transfers", desc: "How FurlPay sponsors network fees with EIP-3009 authorizations so you can send USDC with zero gas." },
      { title: "Deposits & Withdrawals", href: "/docs/help/deposits-withdrawals", desc: "Deposit from an external wallet, bank transfer or card, and off-ramp back to local currency." },
      { title: "Managing Virtual Cards", href: "/docs/help/managing-cards", desc: "Card labels, per-purchase and daily limits, merchant channels, and settlement currency." },
      { title: "Freezing & Unfreezing Cards", href: "/docs/help/freeze-unfreeze", desc: "Instantly lock a card from the app, web or co-pilot, and what happens to subscriptions while frozen." },
      { title: "Declined Transactions", href: "/docs/help/declined-transactions", desc: "The exact reasons a card payment declines and how to resolve each one, including 3-D Secure approvals." },
      { title: "SDK & API Support", href: "/docs/help/sdk-integration", desc: "Where to start as a developer: SDK packages, webhook verification, and how to get integration help." },
      { title: "x402 Monetization Basics", href: "/docs/help/x402-basics", desc: "A plain-language introduction to charging AI agents per request with the x402 protocol." },
      { title: "Booking Travel", href: "/docs/help/travel-booking", desc: "Search and book hotels and flights with stablecoins, on web and from the mobile app." },
      { title: "Travel Refunds & Cancellations", href: "/docs/help/travel-refunds", desc: "Refund windows, how refunds are credited in stablecoins, and how to escalate a booking issue." },
    ],
  },
];

// Top-level resources rendered at the bottom of the sidebar. Deliberately NOT
// part of DOC_ORDER: they are not docs pages, so they must not enter the
// prev/next pager or docMeta lookups.
export type ResourceLink = { title: string; href: string; external?: boolean };
export const RESOURCES_NAV: ResourceLink[] = [
  { title: "Changelog", href: "/changelog" },
  { title: "System Status", href: "/status" },
  { title: "OpenAPI Spec", href: "/openapi.json", external: true },
  { title: "Community", href: "/community" },
  { title: "GitHub", href: "https://github.com/FurlPay", external: true },
];

// Flat, ordered list of pages — used for prev/next footer navigation.
export const DOC_ORDER: DocLink[] = DOCS_NAV.flatMap((s) => s.items);

export function adjacentDocs(pathname: string): { prev?: DocLink; next?: DocLink } {
  const i = DOC_ORDER.findIndex((d) => d.href === pathname);
  if (i === -1) return {};
  return { prev: DOC_ORDER[i - 1], next: DOC_ORDER[i + 1] };
}

/** Section + page lookup for breadcrumbs. */
export function docCrumbs(pathname: string): { section: string; title: string } | null {
  for (const s of DOCS_NAV) {
    const item = s.items.find((i) => i.href === pathname);
    if (item) return { section: s.label, title: item.title };
  }
  return null;
}
