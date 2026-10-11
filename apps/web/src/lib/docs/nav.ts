import { Banknote, Coins, Layers, LifeBuoy, Puzzle, Rocket, Scale, ShieldCheck, type LucideIcon } from "lucide-react";

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
      { title: "Services & Availability", href: "/docs", desc: "FurlPay service catalog with production, in-development and planned capability status." },
      { title: "Quickstart", href: "/docs/quickstart", desc: "Check payment-rail availability, request a fee estimate, and choose the right API flow." },
      { title: "For AI Agents", href: "/docs/agents", desc: "MCP connectivity, scoped agent access and spend controls; payment settlement depends on rail status." },
    ],
  },
  {
    label: "Architecture",
    icon: Layers,
    items: [
      { title: "Monorepo", href: "/docs/architecture/monorepo", desc: "Turborepo layout: apps, packages, SDKs, and how they depend on each other." },
      { title: "API Routes", href: "/docs/architecture/api-routes", desc: "REST route groups, authentication, request handling and current rail-availability boundaries." },
      { title: "Authentication", href: "/docs/architecture/authentication", desc: "Sessions, WebAuthn passkeys, agent request signatures, scoped MCP access and the current x402 availability boundary.", badge: "updated" },
      { title: "Webhook Events", href: "/docs/architecture/webhooks", desc: "Provider-specific inbound webhooks and signed merchant payment-event delivery.", badge: "updated" },
      { title: "Error Codes", href: "/docs/architecture/errors", desc: "Error response shapes, HTTP status conventions, and how to handle unavailable rail controls.", badge: "updated" },
      { title: "Rate Limits", href: "/docs/architecture/rate-limits", desc: "The baseline per-IP budget, per-route limits, and how to handle 429 responses.", badge: "new" },
    ],
  },
  {
    label: "Payments",
    icon: Banknote,
    items: [
      { title: "Agentic Payments (x402)", href: "/docs/payments/agentic-x402", desc: "x402 endpoint currently returns 503 controls_unavailable; production x402 and MPP settlement are also gated.", badge: "updated" },
      { title: "Agent Trust & Mandates (TAP)", href: "/docs/payments/agent-trust", desc: "Developer library patterns for agent identity, signed mandates and scoped capabilities; these do not enable production settlement.", badge: "updated" },
      { title: "CCTP Cross-Chain", href: "/docs/payments/cctp", desc: "Client-signed Circle CCTP V2 transaction construction; check network and rail status before signing.", badge: "updated" },
      { title: "LI.FI Swaps", href: "/docs/payments/lifi-swaps", desc: "Quote LI.FI routes and prepare wallet-signed swaps; a quote is not an executed swap.", badge: "updated" },
      { title: "FurlPay Travels (Travel MCP)", href: "/docs/payments/travels-mcp", desc: "Development integration for agent-assisted travel; production inventory, booking and payment are unavailable.", badge: "updated" },
      { title: "Solana Actions & Blinks", href: "/docs/payments/solana-actions", desc: "Solana Actions transaction construction; verify asset configuration and wallet signature requirements before use." },
    ],
  },
  {
    label: "Tokens",
    icon: Coins,
    items: [
      { title: "FURL Token", href: "/docs/tokens/furl", desc: "FURL's mint address, Token-2022 handling, payment integration, allocation model, and the disclosures — no peg, no reserves, no redemption.", badge: "new" },
    ],
  },
  {
    label: "Integrations",
    icon: Puzzle,
    items: [
      { title: "Claude Connector", href: "/docs/integrations/claude-connector", desc: "Connect FurlPay to Claude over MCP with scoped account tools; prepared actions do not guarantee production settlement.", badge: "updated" },
      { title: "AI Assistants", href: "/docs/integrations/ai-assistants", desc: "FurlPay MCP connectivity and human-approved agent actions; live payment execution depends on rail status." },
      { title: "Stripe Crypto", href: "/docs/integrations/stripe-crypto", desc: "Optional Stripe PaymentIntent and webhook integration; provider approval and deployment configuration required." },
      { title: "Persona KYC", href: "/docs/integrations/persona-kyc", desc: "Persona webhook integration; user verification availability depends on provider setup and region." },
    ],
  },
  {
    label: "Legal & Compliance",
    icon: Scale,
    items: [{ title: "Regulatory status", href: "/docs/compliance/mica", desc: "Jurisdiction and licensing boundaries; no authorization or regulated-service availability is implied." }],
  },
  {
    label: "Security & Crypto",
    icon: ShieldCheck,
    items: [
      { title: "Security Posture", href: "/docs/security/posture", desc: "Security controls, client-signed payment boundaries, gated production settlement and audit status.", badge: "updated" },
      { title: "Signing & WebAuthn", href: "/docs/security/mpc-webauthn", desc: "Passkey authentication, remote signing boundaries and what is not threshold signing.", badge: "updated" },
    ],
  },
  {
    label: "Help Center",
    icon: LifeBuoy,
    items: [
      { title: "Help Center", href: "/docs/help", desc: "Account security, payment status and service-availability guidance." },
      { title: "Getting Started", href: "/docs/help/getting-started", desc: "Access your account, secure sign-in and check current product availability before using a payment flow." },
      { title: "KYC Verification", href: "/docs/help/kyc-verification", desc: "Follow identity-check requirements shown in your account; provider and regional availability varies." },
      { title: "Passkeys & Biometrics", href: "/docs/help/passkeys-biometrics", desc: "How WebAuthn passkeys authenticate your web account, recovery steps, and how passkeys differ from wallet keys." },
      { title: "Privacy & Data Protection", href: "/docs/help/privacy-gdpr", desc: "What FurlPay stores, how support tickets are redacted, and how to exercise GDPR rights including deletion." },
      { title: "Transaction Statuses", href: "/docs/help/transaction-statuses", desc: "Common payment states, on-chain verification and safe retry guidance." },
      { title: "Gasless Transfers", href: "/docs/help/gasless-transfers", desc: "EIP-3009 transfer design and the current production relayer status." },
      { title: "Deposits & Withdrawals", href: "/docs/help/deposits-withdrawals", desc: "Current funding limits; local accounts and fiat on/off-ramp are not live FurlPay services." },
      { title: "Managing Virtual Cards", href: "/docs/help/managing-cards", desc: "Card issuing is planned; FurlPay does not currently offer production cards." },
      { title: "Freezing & Unfreezing Cards", href: "/docs/help/freeze-unfreeze", desc: "FurlPay has no production card program; contact the issuing provider for a third-party card." },
      { title: "Declined Transactions", href: "/docs/help/declined-transactions", desc: "FurlPay does not process card authorizations; contact the card's issuer for decline support." },
      { title: "SDK & API Support", href: "/docs/help/sdk-integration", desc: "Where to start as a developer: SDK packages, webhook verification, and how to get integration help." },
      { title: "x402 Monetization Basics", href: "/docs/help/x402-basics", desc: "A plain-language introduction to x402 challenges and the separate settlement-availability gate." },
      { title: "Booking Travel", href: "/docs/help/travel-booking", desc: "Hotel discovery is available; production travel booking and payment are not currently available." },
      { title: "Travel Refunds & Cancellations", href: "/docs/help/travel-refunds", desc: "Where to get help for third-party reservations; FurlPay does not currently operate travel bookings." },
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
