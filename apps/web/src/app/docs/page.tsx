import {
  DocTitle,
  Lead,
  H2,
  P,
  UL,
  LI,
  Code,
  Callout,
  DocPager,
} from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";
import { capability, STATUS_LABEL } from "@/lib/productionStatus";

export const metadata = docMeta("/docs");

const SERVICES = [
  {
    id: "developer-platform",
    name: "Developer APIs, SDKs and documentation",
    summary: "REST APIs, SDKs, OpenAPI docs and MCP connectivity; each money-moving route still depends on rail availability.",
    href: "/docs/quickstart",
    link: "Start here",
  },
  {
    id: "passkeys",
    name: "Passkey authentication",
    summary: "WebAuthn sign-in and step-up authentication for protected account actions.",
    href: "/docs/architecture/authentication",
    link: "Authentication guide",
  },
  {
    id: "payment-apis",
    name: "Stablecoin payment APIs",
    summary: "Fee estimates and non-custodial payment or bridge data for a user's wallet to review and sign. This does not mean FurlPay has settled the payment.",
    href: "/docs/architecture/api-routes",
    link: "API routes",
  },
  {
    id: "relayed-settlement",
    name: "FurlPay-operated settlement",
    summary: "Broadcasting a signed payment through a FurlPay-operated production signer.",
    href: "/api/rails",
    link: "Check rail status",
  },
  {
    id: "merchant-payments",
    name: "Merchant payment links, invoices and hosted checkout",
    summary: "USDC collection from a payer's own wallet, marked paid only after on-chain verification. Needs provisioned destinations and the payment migration.",
    href: "/docs/payments/merchant-payments",
    link: "Merchant payments guide",
  },
  {
    id: "payroll",
    name: "Contractor payroll",
    summary: "A contractor roster and wallet-signed USDC pay runs. FurlPay prepares and verifies; the employer's wallet pays.",
    href: "/docs/payments/payroll",
    link: "Payroll guide",
  },
  {
    id: "settlement-workspace",
    name: "Settlement workspace and business onboarding",
    summary: "A business console with onboarding, document review and screening. Records saved in the workspace are drafts and do not move money.",
    href: "/docs/settlement/workspace",
    link: "Workspace guide",
  },
  {
    id: "circle-wallets",
    name: "Circle user-controlled wallets",
    summary: "Wallets the user controls with a PIN or biometric in Circle's SDK. FurlPay holds no key share.",
    href: "/docs/integrations/circle",
    link: "Circle integration",
  },
  {
    id: "telegram-mini-app",
    name: "Telegram Mini App",
    summary: "Sign in to an existing account from Telegram and view balances and activity. It cannot send a payment.",
    href: "/docs/integrations/telegram",
    link: "Telegram guide",
  },
  {
    id: "ramps",
    name: "Buying and selling crypto",
    summary: "Provider adapters exist, but FurlPay does not operate an on-ramp or off-ramp and no provider is live.",
    href: "/docs/integrations/ramps",
    link: "Ramp provider status",
  },
  {
    id: "x402-challenge",
    name: "x402 payment challenges",
    summary: "The endpoint currently returns 503 because operational controls are unavailable. Challenge service and settlement must both be checked separately.",
    href: "/docs/payments/agentic-x402",
    link: "x402 guide",
  },
  {
    id: "x402-settlement",
    name: "x402 and MPP settlement",
    summary: "The agent payment protocols have separate settlement gates; do not treat an issued challenge as a completed payment.",
    href: "/docs/payments/agentic-x402",
    link: "x402 and MPP guide",
  },
  {
    id: "agent-payments",
    name: "AI agent access and payment execution",
    summary: "MCP connectivity, scoped access and spend policies are available; FurlPay agent payment settlement is pending production rail configuration.",
    href: "/docs/agents",
    link: "Agent guide",
  },
  {
    id: "gasless",
    name: "Gasless USDC transfers",
    summary: "A relayed EIP-3009 transfer flow; production sponsorship is not enabled until its rail is configured.",
    href: "/docs/help/gasless-transfers",
    link: "Transfer status",
  },
  {
    id: "market-data",
    name: "Market data",
    summary: "Market quotes, charts and related read-only data. Brokerage execution is a separate service.",
    href: "/markets",
    link: "Open markets",
  },
  {
    id: "hotel-map",
    name: "Hotel discovery",
    summary: "Hotel search and map discovery. Finding a property does not mean a booking or payment can be completed.",
    href: "/hotels/map",
    link: "Explore hotels",
  },
  {
    id: "travel-search",
    name: "Travel booking",
    summary: "Production booking inventory and payment are not currently available.",
    href: "/docs/payments/travels-mcp",
    link: "Travel integration status",
  },
  {
    id: "trading",
    name: "Stock and ETF orders",
    summary: "Order submission is not currently routed to a live brokerage.",
    href: "/products/investing",
    link: "Investing product status",
  },
  {
    id: "cards",
    name: "Card issuing",
    summary: "No production card program is available.",
    href: "/docs/help/managing-cards",
    link: "Card availability",
  },
  {
    id: "banking",
    name: "Local bank accounts and banking rails",
    summary: "FurlPay does not currently provide local account issuance or bank payouts.",
    href: "/docs/help/deposits-withdrawals",
    link: "Funding availability",
  },
  {
    id: "mobile",
    name: "FurlPay mobile apps",
    summary: "Mobile clients are not currently distributed through the app stores.",
    href: "/docs/help/passkeys-biometrics",
    link: "Passkey and device guidance",
  },
  {
    id: "desktop",
    name: "FurlPay desktop app",
    summary: "A signed desktop release is not currently available to users.",
    href: "/docs/architecture/monorepo",
    link: "Repository layout",
  },
  {
    id: "tokenized-stocks",
    name: "Tokenized equities",
    summary: "A verified production token registry and trading path are not available.",
    href: "/products/investing",
    link: "Investing product status",
  },
] as const;

function statusTone(status: string) {
  if (status === "live") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300";
  if (status === "pending") return "border-amber-400/30 bg-amber-400/10 text-amber-300";
  if (status === "internal") return "border-sky-400/30 bg-sky-400/10 text-sky-300";
  return "border-white/15 bg-white/[0.04] text-[var(--muted)]";
}

export default function IntroductionPage() {
  return (
    <article>
      <DocTitle eyebrow="Getting Started">FurlPay services and developer docs</DocTitle>
      <Lead>
        Build stablecoin payment and agent workflows with FurlPay&apos;s APIs, SDKs and wallet
        security tools. This page separates production services from integrations that are still
        being prepared.
      </Lead>

      <Callout type="warning" title="Check availability before handling money">
        A route or SDK existing does not mean its payment rail is enabled. Check{" "}
        <a href="/api/rails" className="text-neon hover:underline">
          <Code>GET /api/rails</Code>
        </a>{" "}
        before building a live flow. If that endpoint cannot return a current status, treat the
        rail as unavailable until its status can be verified. A quote, challenge or payment intent
        is not proof that funds moved.
      </Callout>

      <H2 id="services">Services and current availability</H2>
      <P>
        Status labels come from FurlPay&apos;s production capability registry. <b>Live</b> means
        observed working in production; <b>In development</b> means the flow is implemented but a
        production gate remains; <b>Planned</b> means the production service is not implemented.
        Most configuration observations were recorded on 21 September 2026. On 11 October 2026,
        <Code>/api/rails</Code> returned <Code>503 controls_unavailable</Code> with reason{" "}
        <Code>plan_limit</Code>, and <Code>/api/x402/fx</Code> also returned 503. Treat all payment
        rail status as unknown until the registry responds successfully; these labels are not a
        current availability guarantee.
      </P>
      <div className="mt-5 space-y-3">
        {SERVICES.map((service) => {
          const current = capability(service.id);
          return (
            <section
              key={service.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[15px] font-semibold">{service.name}</h3>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusTone(current.status)}`}
                >
                  {STATUS_LABEL[current.status]}
                </span>
              </div>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--muted)]">
                {service.summary}
              </p>
              {current.gate && (
                <p className="mt-2 text-[12px] leading-relaxed text-amber-200/80">
                  Current gate: {current.gate}
                </p>
              )}
              <a href={service.href} className="mt-3 inline-block text-[13px] text-neon hover:underline">
                {service.link} →
              </a>
            </section>
          );
        })}
      </div>

      <H2 id="payment-rails">Payment rails</H2>
      <P>
        The API includes non-custodial transaction-building and payment protocol integrations. The
        payer signs with their own wallet where a route is client-signed. FurlPay-operated relaying
        is a separate capability and is currently in development. Individual rails can be paused,
        unconfigured or unavailable; read their current status and the linked route guide before
        sending a transaction.
      </P>
      <UL>
        <LI><b>USDC payment APIs:</b> fee estimates, payment intents and signing data for supported flows.</LI>
        <LI><b>Agent protocols:</b> x402 and MPP challenge flows; the x402 endpoint is currently unavailable and settlement readiness is separate.</LI>
        <LI><b>Cross-chain tools:</b> Circle CCTP and LI.FI route construction, subject to rail status.</LI>
        <LI><b>Solana Actions:</b> transaction construction for supported checkout assets.</LI>
      </UL>

      <H2 id="agent-services">Agent and developer services</H2>
      <P>
        FurlPay also provides an MCP endpoint, agent key and spend-policy management, passkey
        authentication, developer documentation and typed SDKs. Connector tools may read data or
        prepare an action; financial settlement remains subject to the user&apos;s authorization and
        the live status of the selected rail.
      </P>
      <UL>
        <LI><a href="/docs/agents" className="text-neon hover:underline">For AI agents</a> — MCP, agent access and spend controls.</LI>
        <LI><a href="/docs/integrations/claude-connector" className="text-neon hover:underline">Claude connector</a> — scoped access and human approval for financial actions.</LI>
        <LI><a href="/docs/architecture/authentication" className="text-neon hover:underline">Authentication</a> — sessions, WebAuthn and API access patterns.</LI>
        <LI><a href="/openapi.json" className="text-neon hover:underline">OpenAPI specification</a> — machine-readable route contracts.</LI>
        <LI><a href="/docs/architecture/configuration" className="text-neon hover:underline">Configuration and setup</a> — credentials, flags, migrations and scheduled jobs.</LI>
        <LI><a href="/docs/compliance/screening" className="text-neon hover:underline">Screening and cases</a> — address screening, monitoring rules and case management.</LI>
      </UL>

      <H2 id="not-live">Services not available as live products</H2>
      <P>
        FurlPay does not currently offer production card issuing, local bank account issuance,
        fiat on-ramp or off-ramp payouts, or live stock and ETF order execution. Travel booking is
        also not available with production inventory. The batch payout route currently constructs
        independent intent records only in development; production persistence and settlement are
        unavailable. Related pages describe integration designs or development work; they are not
        offers to provide those services today.
      </P>
      <P>
        FurlPay is a software and payment-infrastructure provider, not a bank, card issuer,
        brokerage or investment adviser. Availability, supported assets, networks and limits are
        deployment-specific.
      </P>

      <Callout title="Next: verify a rail and request a quote">
        Follow the <a href="/docs/quickstart" className="text-neon hover:underline">Quickstart</a>{" "}
        to inspect rail status and request a fee estimate before you implement a payment flow.
      </Callout>

      <DocPager pathname="/docs" />
    </article>
  );
}
