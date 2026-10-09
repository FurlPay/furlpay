// Single source of truth for the landing navigation: the sticky nav's
// dropdowns, the mobile menu, and the ⌘K command palette all read this, so a
// route can never appear in one and be missing from another.
//
// EVERY href below resolves in this app (or is an external URL that is already
// linked from the footer). Adding an entry means adding the route first.

export interface NavLink {
  label: string;
  href: string;
  /** Shown in dropdowns and the command palette. */
  desc?: string;
  external?: boolean;
}

export interface NavGroup {
  label: string;
  links: NavLink[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Products",
    links: [
      { label: "Payments", href: "/products/payments", desc: "Stablecoin checkout and transfers" },
      { label: "Merchant", href: "/products/merchant", desc: "Accept USDC on any site" },
      { label: "Wallet", href: "/products/wallet", desc: "Accounts, balances and handles" },
      { label: "Cards", href: "/cards", desc: "Virtual and physical card management" },
      { label: "x402 for agents", href: "/products/x402", desc: "Pay-per-call over HTTP 402" },
      { label: "Travel", href: "/products/travel", desc: "Book stays and flights with crypto" },
      { label: "Investing", href: "/products/investing", desc: "Tokenized assets and corporate actions" },
    ],
  },
  {
    label: "Developers",
    links: [
      { label: "Documentation", href: "/docs", desc: "Guides, concepts and quickstarts" },
      { label: "API reference", href: "/docs/architecture/api-routes", desc: "Every route, request and response" },
      { label: "Quickstart", href: "/docs/quickstart", desc: "First call in a few minutes" },
      { label: "Webhooks", href: "/docs/architecture/webhooks", desc: "Signed event delivery" },
      { label: "API keys", href: "/developer/keys", desc: "Create and rotate keys" },
      { label: "Agent console", href: "/developer/agents", desc: "Agent keys and spend policies" },
    ],
  },
  {
    label: "Solutions",
    links: [
      { label: "AI agents", href: "/solutions/ai-agents", desc: "Autonomous software that pays" },
      { label: "SaaS", href: "/solutions/saas", desc: "Usage billing and payouts" },
      { label: "E-commerce", href: "/solutions/ecommerce", desc: "Stablecoin checkout" },
      { label: "Hotels", href: "/solutions/hotels", desc: "Direct booking payments" },
      { label: "Airlines", href: "/solutions/airlines", desc: "Ticketing and settlement" },
      { label: "Enterprise", href: "/solutions/enterprise", desc: "Treasury and controls" },
    ],
  },
  {
    label: "Resources",
    links: [
      { label: "Changelog", href: "/changelog", desc: "What shipped, when" },
      { label: "Status", href: "/status", desc: "System status board" },
      { label: "Blog", href: "/blog", desc: "Engineering and product writing" },
      // The three content surfaces sit together: where to meet us in person,
      // the online sessions, and the written research.
      { label: "Events", href: "/events", desc: "Where to find us in person" },
      { label: "Webinars", href: "/webinars", desc: "Online sessions and recordings" },
      { label: "Research", href: "/research", desc: "Reports and market intelligence" },
      // /docs/integrations has no index page — link the first guide, not the
      // directory, or this 404s.
      { label: "Integration guides", href: "/docs/integrations/ai-assistants", desc: "AI assistants, Stripe, Persona" },
      { label: "Marketplace", href: "/marketplace", desc: "Apps built on FurlPay" },
      { label: "Newsletter", href: "/newsletter", desc: "Updates worth reading" },
    ],
  },
  {
    label: "Company",
    links: [
      { label: "About", href: "/about", desc: "Who is building this" },
      { label: "Trust & security", href: "/trust", desc: "How money is protected" },
      { label: "FURL token", href: "/token", desc: "Mint address, tokenomics and risks" },
      { label: "Partners", href: "/partners", desc: "Partner with FurlPay" },
      { label: "Become a partner", href: "/partners#inquire", desc: "Send a partnership inquiry" },
      { label: "Careers", href: "/careers", desc: "Open roles" },
      { label: "Press", href: "/press", desc: "Brand and media" },
      { label: "Contact", href: "/contact", desc: "Talk to a human" },
    ],
  },
];

/** Flat list for the command palette, plus the destinations that are not in a
 *  dropdown (pricing, sign-up, GitHub). */
export const PALETTE_LINKS: NavLink[] = [
  { label: "Documentation", href: "/docs", desc: "Guides and concepts" },
  { label: "API reference", href: "/docs/architecture/api-routes", desc: "Routes, requests, responses" },
  { label: "Quickstart", href: "/docs/quickstart", desc: "Make your first call" },
  { label: "SDKs", href: "/developer", desc: "TypeScript, Python, Go, Rust" },
  { label: "Get an API key", href: "/developer/keys", desc: "Create and rotate keys" },
  { label: "Payments", href: "/products/payments", desc: "Stablecoin payments and transfers" },
  { label: "Cards", href: "/cards", desc: "Your virtual and physical cards" },
  { label: "Accounts", href: "/products/wallet", desc: "Global accounts and balances" },
  { label: "AI agents", href: "/solutions/ai-agents", desc: "Agent wallets, policies, x402" },
  { label: "x402", href: "/docs/payments/agentic-x402", desc: "Pay-per-call over HTTP 402" },
  { label: "Webhooks", href: "/docs/architecture/webhooks", desc: "Signed event delivery" },
  { label: "Pricing", href: "/pricing", desc: "Plans and settlement rates" },
  { label: "Status", href: "/status", desc: "System status board" },
  { label: "FURL token", href: "/token", desc: "Mint address, tokenomics and risks" },
  { label: "Changelog", href: "/changelog", desc: "What shipped, when" },
  { label: "Blog", href: "/blog", desc: "Engineering writing" },
  { label: "Talk to us", href: "/talk-to-us", desc: "Book a technical call" },
  { label: "Open the app", href: "/dashboard", desc: "Your FurlPay dashboard" },
  { label: "GitHub", href: "https://github.com/Ashutosh0x/furlpay", desc: "Source and issues", external: true },
];
