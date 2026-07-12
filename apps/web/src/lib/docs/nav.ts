// Sidebar structure for the developer documentation portal (furlpay.app/docs).
// Mirrors the 2026 blueprint: Getting Started, Architecture, Legal & Compliance,
// Security & Crypto. `desc` feeds /llms.txt and per-page SEO; `badge` renders
// in the sidebar ("new" for fresh pages, "updated" for recent rewrites).

export type DocBadge = "new" | "updated";
export type DocLink = { title: string; href: string; desc: string; badge?: DocBadge };
export type DocSection = { label: string; items: DocLink[] };

export const DOCS_NAV: DocSection[] = [
  {
    label: "Getting Started",
    items: [
      { title: "Introduction", href: "/docs", desc: "What FurlPay is: non-custodial stablecoin payment infrastructure for AI agents and humans." },
      { title: "Quickstart", href: "/docs/quickstart", desc: "Install the CLI, make your first API call, forward webhooks, and drop in the checkout widget." },
      { title: "For AI Agents", href: "/docs/agents", desc: "MCP server, LangChain / OpenAI / CrewAI adapters, and paying for APIs over x402." },
    ],
  },
  {
    label: "Architecture",
    items: [
      { title: "Monorepo", href: "/docs/architecture/monorepo", desc: "Turborepo layout: apps, packages, SDKs, and how they depend on each other." },
      { title: "API Routes", href: "/docs/architecture/api-routes", desc: "REST surface, authentication, rate limits, idempotency, and webhook signing." },
    ],
  },
  {
    label: "Payments",
    items: [
      { title: "Agentic Payments (x402)", href: "/docs/payments/agentic-x402", desc: "HTTP 402 pay-per-call with EIP-3009 USDC settlement on Arbitrum/Base — no API key required." },
      { title: "Agent Trust & Mandates (TAP)", href: "/docs/payments/agent-trust", desc: "Owned agent keys, enforced spending policies, and cryptographic mandates." },
      { title: "FurlPay Travels (Travel MCP)", href: "/docs/payments/travels-mcp", desc: "Flight search, reprice, and booking for agents via the Travel MCP server." },
      { title: "Solana Actions & Blinks", href: "/docs/payments/solana-actions", desc: "Spec-correct Solana Actions endpoints and shareable payment Blinks." },
    ],
  },
  {
    label: "Integrations",
    items: [
      { title: "AI Assistants", href: "/docs/integrations/ai-assistants", desc: "Wire FurlPay into Claude, ChatGPT, and agent frameworks via MCP and native adapters.", badge: "new" },
      { title: "Stripe Crypto", href: "/docs/integrations/stripe-crypto", desc: "Fiat onramp and card processing through Stripe's crypto products." },
      { title: "Persona KYC", href: "/docs/integrations/persona-kyc", desc: "Identity verification flows and webhook-driven KYC status updates." },
    ],
  },
  {
    label: "Legal & Compliance",
    items: [{ title: "MiCA Roadmap", href: "/docs/compliance/mica", desc: "EU MiCA/CASP posture, licensing roadmap, and what it means for integrators." }],
  },
  {
    label: "Security & Crypto",
    items: [
      { title: "Security Posture", href: "/docs/security/posture", desc: "What protects your money at each layer: non-custodial settlement, replay protection, money caps, CI scanning, and honest audit status.", badge: "new" },
      { title: "MPC & WebAuthn", href: "/docs/security/mpc-webauthn", desc: "Passkey (FIDO2/WebAuthn) authentication and the MPC key architecture." },
    ],
  },
];

// Flat, ordered list of pages — used for prev/next footer navigation.
export const DOC_ORDER: DocLink[] = DOCS_NAV.flatMap((s) => s.items);

export function adjacentDocs(pathname: string): { prev?: DocLink; next?: DocLink } {
  const i = DOC_ORDER.findIndex((d) => d.href === pathname);
  if (i === -1) return {};
  return { prev: DOC_ORDER[i - 1], next: DOC_ORDER[i + 1] };
}
