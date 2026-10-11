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
  // ---- Business payments, compliance and setup (added Oct 2026) -----------
  {
    title: "Merchant payments: links, invoices, checkout",
    section: "Payments",
    href: "/docs/payments/merchant-payments",
    snippet: "USDC payment links, invoices and terminal requests with a hosted checkout; paid only after on-chain verification. Needs provisioned destinations.",
    keywords: ["payment link", "payment links", "invoice", "invoices", "hosted checkout", "checkout", "terminal", "qr", "qr code", "merchant", "accept usdc", "/api/merchant/payments", "/api/checkout/merchant", "/p/", "payment status", "underpaid", "overpaid", "confirmations", "eip-681", "solana pay", "75 bps", "processing fee"],
  },
  {
    title: "Merchant payment setup",
    section: "Payments",
    href: "/docs/payments/merchant-payments#setup",
    snippet: "Migration 0040, per-merchant collection destinations, node endpoints and the unscheduled merchant-payments scanner.",
    keywords: ["merchant_payment_destinations", "migration 0040", "destinations", "readyChains", "503 checkout", "scanner", "/api/cron/merchant-payments", "BASE_RPC_URL", "ARBITRUM_RPC_URL"],
  },
  {
    title: "Contractor payroll and payouts",
    section: "Payments",
    href: "/docs/payments/payroll",
    snippet: "Contractor roster and wallet-signed atomic USDC pay runs through an approved router; documents need a contracted provider.",
    keywords: ["payroll", "contractor", "contractors", "pay run", "batch pay", "batchPay", "eip-712", "router", "w9", "w8ben", "w-8ben", "fira", "tax form", "/api/merchant/payroll", "/api/payouts/payroll", "35 bps", "payout", "mass payout"],
  },
  {
    title: "Virtual bank accounts (requests only)",
    section: "Payments",
    href: "/docs/payments/payroll#virtual-accounts",
    snippet: "A virtual account request stays 'requested' until a configured provider activates it; FurlPay does not issue bank accounts.",
    keywords: ["virtual account", "virtual accounts", "viban", "iban", "bank account", "/api/banking/virtual-accounts", "provider_required", "usd account", "eur account", "inr account"],
  },
  {
    title: "Batch payout intents",
    section: "Payments",
    href: "/docs/payments/payroll#batch-intents",
    snippet: "POST /api/payouts/batch creates up to 100 independent USDC intents on Arbitrum; not an atomic transfer.",
    keywords: ["/api/payouts/batch", "batch payout", "mass disbursal", "disbursement", "idempotency", "screening_unavailable", "compliance_review_required"],
  },
  {
    title: "Settlement workspace",
    section: "Business",
    href: "/docs/settlement/workspace",
    snippet: "Business console for payments, payouts, treasury, compliance and reconciliation; saved records are drafts that do not move money.",
    keywords: ["settlement", "workspace", "settlement os", "treasury", "reconcile", "reconciliation", "drafts", "split rules", "beneficiary", "/settlement", "/api/settlement/workspace", "/api/settlement/transactions"],
  },
  {
    title: "Business onboarding (KYB)",
    section: "Business",
    href: "/docs/settlement/workspace#onboarding",
    snippet: "Seven server-controlled steps with document upload, sanctions screening, officer review and activation blockers.",
    keywords: ["onboarding", "kyb", "know your business", "business verification", "documents", "certificate of incorporation", "activation", "blockers", "/api/settlement/onboarding", "compliance_officer", "review queue"],
  },
  {
    title: "Wallet address screening",
    section: "Legal & Compliance",
    href: "/docs/compliance/screening#address-screening",
    snippet: "Built-in sanctions list, optional Circle Compliance Engine and the USDC issuer blocklist; strictest result wins and outages block.",
    keywords: ["screening", "sanctions", "ofac", "sdn", "aml", "address screening", "usdc_issuer_blocked", "blacklist", "blocklist", "fail closed", "screening_unavailable", "/api/compliance/screen"],
  },
  {
    title: "Transaction monitoring rules",
    section: "Legal & Compliance",
    href: "/docs/compliance/screening#monitoring",
    snippet: "Deterministic rules over the account ledger: high value, velocity, structuring and repeated failures. Three declared rules are disabled.",
    keywords: ["monitoring", "transaction monitoring", "velocity", "structuring", "high value", "alerts", "rules", "/api/compliance/monitoring"],
  },
  {
    title: "Compliance cases and reports",
    section: "Legal & Compliance",
    href: "/docs/compliance/screening#cases",
    snippet: "Case queue with types, statuses, response-time targets and redacted CSV exports; officers only.",
    keywords: ["case", "cases", "case management", "sla", "escalation", "audit trail", "csv", "reports", "/api/compliance/cases", "/api/compliance/reports", "investigator"],
  },
  {
    title: "Travel rule",
    section: "Legal & Compliance",
    href: "/docs/compliance/screening#travel-rule",
    snippet: "A compute endpoint and a Notabene transport adapter; neither authorises a payment and no route calls the adapter automatically.",
    keywords: ["travel rule", "fatf", "notabene", "vasp", "ivms101", "/api/compliance/travel-rule", "NOTABENE_CLIENT_ID"],
  },
  {
    title: "Circle wallets, compliance and USDC",
    section: "Integrations",
    href: "/docs/integrations/circle",
    snippet: "User-controlled MPC wallets, Compliance Engine screening, CCTP V2 and the issuer blocklist; each needs its own credentials.",
    keywords: ["circle", "w3s", "user-controlled wallets", "mpc wallet", "pin", "challenge", "/api/wallets/circle", "CIRCLE_W3S_API_KEY", "CIRCLE_W3S_APP_ID", "CIRCLE_COMPLIANCE_API_KEY", "compliance engine", "usdc", "paymaster", "eip-7702"],
  },
  {
    title: "Ramp providers (buy and sell crypto)",
    section: "Integrations",
    href: "/docs/integrations/ramps",
    snippet: "Coinbase and Transak adapters; FurlPay does not operate an on-ramp or off-ramp and no provider row is live.",
    keywords: ["onramp", "on-ramp", "offramp", "off-ramp", "buy crypto", "sell crypto", "coinbase", "cdp", "transak", "echo", "furlgateway", "furlbridge", "furlpayout", "/api/onramp/session", "/api/offramp/session", "/api/ramp/orders", "beneficiary", "capability matrix", "ONRAMP_LIVE", "OFFRAMP_LIVE"],
  },
  {
    title: "Telegram Mini App",
    section: "Integrations",
    href: "/docs/integrations/telegram",
    snippet: "Sign in to an existing FurlPay account from Telegram; read-only balances and activity, linking requires step-up.",
    keywords: ["telegram", "mini app", "miniapp", "bot", "initdata", "botfather", "/api/auth/telegram", "/api/miniapp/account", "/api/miniapp/telegram-link", "TELEGRAM_BOT_TOKEN", "link_required"],
  },
  {
    title: "Configuration and setup",
    section: "Architecture",
    href: "/docs/architecture/configuration",
    snippet: "Environment variables by area, the three gating layers, money flags, migrations and scheduled jobs.",
    keywords: ["configuration", "environment variables", "env", ".env.example", "setup", "deploy", "INTEGRATION_MODE", "FURLPAY_ENV", "supabase", "upstash", "redis", "kv", "controls_unavailable", "plan_limit"],
  },
  {
    title: "Money flags",
    section: "Architecture",
    href: "/docs/architecture/configuration#flags",
    snippet: "Per-capability switches, default off; a flag marked not implemented cannot be turned on by an environment variable.",
    keywords: ["flags", "feature flags", "money flags", "BROKERAGE_LIVE", "CARD_ISSUING_LIVE", "BANKING_LIVE", "ONCHAIN_SETTLEMENT_LIVE", "kill switch", "FURLPAY_MONEY_KILL_SWITCH", "/api/ops/readiness", "unimplemented"],
  },
  {
    title: "Database migrations",
    section: "Architecture",
    href: "/docs/architecture/configuration#migrations",
    snippet: "Numbered SQL files applied in order; 0037 to 0044 add settlement, compliance cases, merchant payments, payroll and Telegram links.",
    keywords: ["migration", "migrations", "supabase/migrations", "0040", "0041", "0042", "0043", "0044", "schema", "database"],
  },
  {
    title: "Scheduled jobs",
    section: "Architecture",
    href: "/docs/architecture/configuration#cron",
    snippet: "Cron authentication and which jobs are scheduled by default versus needing an external scheduler.",
    keywords: ["cron", "scheduled jobs", "CRON_SECRET", "x-furlpay-cron-key", "vercel.json", "reconcile", "ramp-maintenance", "merchant-payments", "scheduler"],
  },
  // ---- Agentic Commerce (agent-trust + travels) --------------------------
  {
    title: "For AI Agents — quickstart",
    section: "Getting Started",
    href: "/docs/agents",
    snippet: "Connect an agent through MCP, scope access and set spend controls; production payment settlement depends on rail status.",
    keywords: ["ai agents", "agent quickstart", "mcp", "mcp-server", "claude", "cursor", "langchain", "llamaindex", "give agent a wallet", "agent wallet", "x402", "budget", "mandate"],
  },
  {
    title: "Agent Trust & Mandates (TAP)",
    section: "Payments",
    href: "/docs/payments/agent-trust",
    snippet: "Developer library for agent identity, mandates and request signatures; it does not enable production settlement.",
    keywords: ["agent-trust", "@furlpay/agent-trust", "tap", "trusted agent protocol", "mandate", "mandates", "spend mandate", "ed25519", "rfc 9421", "http message signatures", "booking token", "know your agent", "kya", "visa tap"],
  },
  {
    title: "Signed agent escrow (RFC 9421)",
    section: "Payments",
    href: "/docs/payments/agent-trust#escrow",
    snippet: "Agent-key management and an escrow-hold route exist; escrow storage may be unavailable and does not represent card or on-chain settlement.",
    keywords: ["POST /api/agents/keys", "POST /api/escrow", "escrow", "signature-input", "content-digest", "pre-auth hold", "agent authentication", "signed request", "spend policy", "daily budget", "agent spend limit", "revoke agent key"],
  },
  {
    title: "Capability tokens (single-use, audience-bound)",
    section: "Payments",
    href: "/docs/payments/agent-trust#capabilities",
    snippet: "Repository example for scoped capability tokens; check the published package version before importing these methods.",
    keywords: ["capability", "capability token", "mintCapability", "verifyCapability", "dpop", "proof of possession", "audience", "single use", "session key", "tool server", "multi-tier session", "presenterKeyId", "jti"],
  },
  {
    title: "Prompt-injection defense (travel-mcp)",
    section: "Payments",
    href: "/docs/payments/travels-mcp#ipi",
    snippet: "sanitizeExternalText strips hidden HTML/CSS, zero-width chars, injection imperatives, and Morse/hex/base64 smuggling from untrusted inventory.",
    keywords: ["prompt injection", "indirect prompt injection", "ipi", "sanitize", "sanitizeExternalText", "sanitizeId", "hidden css", "zero-width", "bidi", "morse", "jailbreak", "untrusted inventory", "llm security", "agent hijack"],
  },
  {
    title: "USDC payments & HITL compliance review",
    section: "API Routes",
    href: "/docs/architecture/api-routes#payments",
    snippet: "Idempotency-Key retry-storm guard on /api/payments/create; human-in-the-loop review pauses payments over threshold or high-risk before settlement.",
    keywords: ["/api/payments/create", "/api/payments/execute", "/api/payments/review", "idempotency", "idempotency-key", "retry storm", "double charge", "hitl", "human in the loop", "compliance review", "pending_review", "threshold", "high-risk jurisdiction", "pause payment"],
  },
  {
    title: "FurlPay Travels (Travel MCP)",
    section: "Payments",
    href: "/docs/payments/travels-mcp",
    snippet: "Development integration for agent-assisted travel; production inventory, booking and payment are unavailable.",
    keywords: ["travel", "travels", "@furlpay/travel-mcp", "travel-mcp", "travala", "duffel", "flights", "hotels", "stays", "vcn", "virtual card", "mcc", "7011", "4511", "cbbtc", "rebate", "travel_authorize_booking", "mandateToken", "booking"],
  },
  {
    title: "Travel integration status",
    section: "Payments",
    href: "/docs/payments/travels-mcp",
    snippet: "Travel MCP examples use test or demo inventory; FurlPay production travel booking is unavailable.",
    keywords: ["duffel", "DUFFEL_API_KEY", "flight search", "offers", "ndc", "gds", "lcc", "airline logos", "logo_symbol_url", "POST /api/travel/search", "amadeus sunset", "kiwi tequila"],
  },

  // ---- Architecture reference pages --------------------------------------
  {
    title: "Authentication",
    section: "Architecture",
    href: "/docs/architecture/authentication",
    snippet: "Passkey sessions and registered-agent keys; x402 challenges are public, while production settlement is gated.",
    keywords: ["authentication", "auth", "session", "jwt", "cookie", "passkey", "webauthn", "roles", "admin", "totp", "step-up", "api key", "sk_test", "guest", "423 locked"],
  },
  {
    title: "Webhook Events",
    section: "Architecture",
    href: "/docs/architecture/webhooks",
    snippet: "Provider-specific inbound webhook routes and signed merchant payment-event delivery with bounded retries.",
    keywords: ["webhooks", "webhook events", "x-furlpay-signature", "hmac", "raw body", "timingSafeEqual", "stale timestamp", "replay window", "idempotent", "furlpay listen", "stripe webhook", "sumsub webhook", "persona webhook", "merchant webhook"],
  },
  {
    title: "Error Codes",
    section: "Architecture",
    href: "/docs/architecture/errors",
    snippet: "Response shapes, HTTP status conventions, retry behavior, and controls_unavailable 503 handling.",
    keywords: ["errors", "error codes", "amount_over_limit", "replay_rejected", "invalid_signature", "rail_paused", "controls_unavailable", "plan_limit", "quote_expired", "settlement_pending", "service_unavailable", "429", "423", "409", "502", "retry"],
  },
  {
    title: "Rate Limits",
    section: "Architecture",
    href: "/docs/architecture/rate-limits",
    snippet: "150/min mutating baseline per IP + tighter per-route budgets; how to honor Retry-After on 429.",
    keywords: ["rate limit", "rate limits", "429", "retry-after", "throttle", "budget", "flood", "baseline", "per-route", "backoff"],
  },

  // ---- Rails reference pages ----------------------------------------------
  {
    title: "CCTP Cross-Chain USDC",
    section: "Payments",
    href: "/docs/payments/cctp",
    snippet: "Client-signed CCTP V2 transaction construction; check network and rail status before signing.",
    keywords: ["cctp", "cctp v2", "cross-chain", "burn and mint", "depositForBurn", "receiveMessage", "iris", "attestation", "fast transfer", "circle", "native usdc", "/api/intents/cctp", "bridge usdc"],
  },
  {
    title: "LI.FI Swaps",
    section: "Payments",
    href: "/docs/payments/lifi-swaps",
    snippet: "Quote LI.FI routes and prepare wallet-signed swaps; a quote is not an executed swap.",
    keywords: ["lifi", "li.fi", "swap", "swaps", "cross-chain swap", "dex", "bridge", "routing", "integrator fee", "0.5%", "/api/swaps/execute", "sol eth swap", "robinhood chain"],
  },
  {
    title: "Gasless USDC transfer status",
    section: "Payments",
    href: "/docs/payments/agentic-x402",
    snippet: "EIP-3009 relayer flow is implemented, but production sponsorship is not currently enabled.",
    keywords: ["gasless", "smart gas", "no eth", "meta-transaction", "relayer", "/api/transfers/gasless", "transferWithAuthorization", "sponsored gas", "send usdc without eth"],
  },
  {
    title: "Security Posture",
    section: "Security & Crypto",
    href: "/docs/security/posture",
    snippet: "Security controls, client-signed transaction boundaries, gated production settlement and audit status.",
    keywords: ["security posture", "trust", "audit", "unaudited", "non-custodial", "slither", "semgrep", "codeql", "gitleaks", "responsible disclosure", "security.txt", "bug bounty"],
  },

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
    href: "/docs/architecture/authentication",
    snippet: "Register and authenticate passkeys (WebAuthn / FIDO2).",
    keywords: ["POST /api/auth/webauthn", "webauthn", "passkey", "auth", "register", "authenticate", "fido2"],
  },
  {
    title: "Card issuing status",
    section: "API Routes",
    href: "/docs#not-live",
    snippet: "FurlPay does not currently offer production card issuing or card controls.",
    keywords: ["POST /api/cards/settings", "cards", "settings", "freeze", "limit", "issue card", "marqeta"],
  },
  {
    title: "Stock and ETF order status",
    section: "API Routes",
    href: "/docs#not-live",
    snippet: "Stock and ETF order submission is not currently routed to a live brokerage.",
    keywords: ["POST /api/investing/order", "investing", "order", "stocks", "etf", "fractional", "alpaca"],
  },
  {
    title: "webhooks/card-auth",
    section: "API Routes",
    href: "/docs/architecture/webhooks#inbound",
    snippet: "Provider-specific inbound event handling; verify each provider's signature scheme.",
    keywords: ["webhooks/card-auth", "webhooks", "card-auth", "deposit-detect", "callback", "signature verification"],
  },

  // ---- Payments --------------------------------------------------------
  {
    title: "Agentic Payments (x402)",
    section: "Payments",
    href: "/docs/payments/agentic-x402",
    snippet: "x402 endpoint currently returns 503 controls_unavailable; protocol details and settlement gates are documented.",
    keywords: ["x402", "agentic payments", "http 402", "payment required", "ai agents", "usdc", "eip-3009", "pay per call", "X-PAYMENT", "coinbase"],
  },
  {
    title: "x402 endpoint — GET /api/x402/fx",
    section: "Payments",
    href: "/docs/payments/agentic-x402#pay",
    snippet: "The endpoint returned 503 controls_unavailable on 11 Oct 2026; production settlement is gated separately.",
    keywords: ["/api/x402/fx", "x402 fx", "pay per call", "402 quote", "agent api", "micropayment"],
  },
  {
    title: "Solana Actions & Blinks",
    section: "Payments",
    href: "/docs/payments/solana-actions",
    snippet: "Build Solana Actions transaction data for wallet review and signing; generated data is not settlement confirmation.",
    keywords: ["solana actions", "blinks", "actions.json", "dialect", "checkout link", "unfurl", "spl-token", "transferChecked", "dial.to"],
  },

  // ---- Integrations ----------------------------------------------------
  {
    title: "Stripe Crypto checkout",
    section: "Integrations",
    href: "/docs/integrations/stripe-crypto",
    snippet: "Optional Stripe PaymentIntent and webhook integration; provider approval and deployment configuration are required.",
    keywords: ["stripe", "crypto", "stablecoin", "payment intent", "paymentintents", "elements", "usdc", "checkout", "bridge"],
  },
  {
    title: "Stripe webhook verification",
    section: "Integrations",
    href: "/docs/integrations/stripe-crypto#webhook",
    snippet: "Verify the stripe-signature header with constructEvent before trusting events.",
    keywords: ["stripe webhook", "constructEvent", "stripe-signature", "hmac", "payment_intent.succeeded", "signature verification"],
  },
  {
    title: "Persona KYC & liveness",
    section: "Integrations",
    href: "/docs/integrations/persona-kyc",
    snippet: "Persona webhook integration for bound verification outcomes; provider credentials and regional availability vary.",
    keywords: ["persona", "kyc", "identity", "liveness", "selfie", "biometric", "inquiry", "template id", "withpersona"],
  },
  {
    title: "Persona webhook integration",
    section: "Integrations",
    href: "/docs/integrations/persona-kyc#handler",
    snippet: "Verify the raw-body signature, deduplicate events and check the server-side user binding.",
    keywords: ["persona webhook", "persona-signature", "inquiry.completed", "identity", "inquiry binding"],
  },

  // ---- Compliance & Licensing ------------------------------------------
  {
    title: "Regulatory and service status",
    section: "Legal & Compliance",
    href: "/docs/compliance/mica",
    snippet: "FurlPay does not claim MiCA authorization or regulated-service availability; confirm status with the relevant regulator.",
    keywords: ["MiCA", "markets in crypto-assets", "emt", "art", "eu", "casp", "e-money token"],
  },
  {
    title: "US GENIUS Act",
    section: "Legal & Compliance",
    href: "/docs/compliance/mica#us",
    snippet: "FurlPay does not claim to be a stablecoin issuer or a federally or state-authorized US payment service.",
    keywords: ["US GENIUS Act", "genius act", "stablecoin", "us", "federal", "issuer"],
  },
  {
    title: "FCA regulations",
    section: "Legal & Compliance",
    href: "/docs/compliance/mica#uk",
    snippet: "This documentation does not assert FCA authorization or approval of FurlPay products.",
    keywords: ["FCA regulations", "fca", "uk", "financial conduct authority", "promotions"],
  },
  {
    title: "Sumsub provider status",
    section: "Legal & Compliance",
    href: "/docs/compliance/mica#kyc",
    snippet: "FurlPay does not document a live Sumsub service; identity availability depends on configured providers and regions.",
    keywords: ["Sumsub integration", "sumsub", "kyc", "kyb", "identity", "verification", "onboarding"],
  },
  {
    title: "Travel Rule provider status",
    section: "Legal & Compliance",
    href: "/docs/compliance/mica#travel-rule",
    snippet: "FurlPay does not claim automatic Travel Rule exchange through TRUST or another provider.",
    keywords: ["TRUST Travel Rule", "travel rule", "trust", "fatf", "vasp", "originator", "beneficiary"],
  },

  // ---- Developer Ecosystem ---------------------------------------------
  {
    title: "@furlpay/cli",
    section: "Quickstart",
    href: "/docs/architecture/monorepo#surfaces",
    snippet: "CLI package source is in the repository; check its README and release metadata for current package availability.",
    keywords: ["@furlpay/cli", "cli", "command line", "npx furlpay", "scaffold"],
  },
  {
    title: "furlpay listen",
    section: "Quickstart",
    href: "/docs/architecture/webhooks#local",
    snippet: "Use the FurlPay CLI to forward test webhook events during local development.",
    keywords: ["furlpay listen", "listen", "webhook forwarding", "localhost", "tunnel"],
  },
  {
    title: "Payment API quickstart",
    section: "Quickstart",
    href: "/docs/quickstart#fee-quote",
    snippet: "Request a public fee estimate before implementing a payment flow.",
    keywords: ["fee estimate", "payments API", "quote", "checkout", "stablecoin payment"],
  },
  {
    title: "Batch USDC payment intents",
    section: "API Routes",
    href: "/docs/architecture/api-routes#payments",
    snippet: "POST /api/payouts/batch creates independent intents in development; production persistence and payout settlement are unavailable.",
    keywords: ["batch payout", "mass payouts", "batch USDC", "POST /api/payouts/batch", "intent construction", "contractor payout"],
  },
  {
    title: "Webhook signature verification",
    section: "API Routes",
    href: "/docs/architecture/webhooks#merchant-events",
    snippet: "Verify X-FurlPay-Signature over the timestamp and raw request body before trusting an event.",
    keywords: ["webhook signature verification", "signature", "verify", "hmac", "x-furlpay-signature", "security"],
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
    href: "/docs#services",
    snippet: "Market data is available; brokerage order execution is a separate, currently gated service.",
    keywords: ["Twelve Data API", "twelve data", "quotes", "market data", "equities", "fundamentals"],
  },
  {
    title: "Alpaca WebSockets",
    section: "API Routes",
    href: "/docs#not-live",
    snippet: "FurlPay does not currently route stock and ETF orders to a live brokerage.",
    keywords: ["Alpaca WebSockets", "alpaca", "websocket", "streaming", "realtime", "execution"],
  },

  // ---- Security Architecture -------------------------------------------
  {
    title: "Web signing model and passkeys",
    section: "Security & Crypto",
    href: "/docs/security/mpc-webauthn#paths",
    snippet: "The web signing path uses a remote signer and is not 2-of-2 threshold custody; passkeys authenticate the account.",
    keywords: ["web signing", "remote signer", "mpc", "multi-party computation", "co-sign", "threshold", "key shares", "turnkey"],
  },
  {
    title: "Threshold signing status",
    section: "Security & Crypto",
    href: "/docs/security/mpc-webauthn#threshold",
    snippet: "A device-required threshold-signing flow is not currently built; policy checks do not split key material.",
    keywords: ["threshold signing", "2-of-2 MPC", "turnkey", "hsm", "policy engine", "signer", "custody"],
  },
  {
    title: "Fraud provider status",
    section: "Security & Crypto",
    href: "/docs/security/posture",
    snippet: "No live Sardine scoring claim is made in the current security documentation; provider availability must be verified separately.",
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
