import type { Metadata } from "next";
import MarketingBar from "@/components/marketing/MarketingBar";
import { Hero, FeatureGrid, Section, CtaBand } from "@/components/marketing/blocks";
import FaqSection from "@/components/marketing/FaqSection";
import JsonLd from "@/components/JsonLd";
import { financialProduct, breadcrumb, SITE } from "@/lib/seo/schema";

const URL = `${SITE}/products/x402`;

export const metadata: Metadata = {
  title: "x402 Payments for AI Agents — Pay-Per-Request over HTTP",
  description:
    "Let AI agents discover, negotiate, and pay for HTTP resources with x402. Furlpay's facilitator verifies and settles USDC micropayments on Arbitrum for the agentic economy.",
  alternates: { canonical: "/products/x402" },
  openGraph: { type: "website", url: URL, title: "x402 Payments for AI Agents" },
};

const FEATURES = [
  { title: "HTTP 402, revived", body: "x402 uses the long-reserved 402 Payment Required status so any API can quote a price and get paid inline." },
  { title: "Agent-native", body: "An agent hits a resource, receives a price, pays in USDC, and retries — no API keys or human checkout in the loop." },
  { title: "Facilitator API", body: "Furlpay's facilitator verifies and settles payments so resource servers don't touch chain logic themselves." },
  { title: "Micropayments", body: "Sub-cent Arbitrum gas makes per-request pricing viable — charge fractions of a cent per call." },
  { title: "MCP-ready", body: "Pairs with our MCP server so tools exposed to models can be metered and paid for automatically." },
  { title: "Open-source", body: "The facilitator and middleware are MIT-licensed — self-host or use the hosted endpoint." },
];

const FAQ = [
  {
    q: "What is the x402 payment protocol?",
    a: "x402 is an open protocol that uses the HTTP 402 'Payment Required' status code to let a server quote a price for a resource and a client — often an AI agent — pay for it inline, typically in USDC stablecoin. It enables pay-per-request APIs without accounts or API keys.",
  },
  {
    q: "How do AI agents pay with x402?",
    a: "An agent requests a resource, receives a 402 response with payment details, submits a signed USDC payment, and retries the request. Furlpay's facilitator verifies and settles the payment on Arbitrum, so the resource server gets paid without handling chain logic.",
  },
  {
    q: "Why USDC on Arbitrum for agent payments?",
    a: "Agent workloads make many small calls, so fees must be tiny. Arbitrum gas is a fraction of a cent and USDC is dollar-stable, which makes true per-request micropayments economically viable.",
  },
  {
    q: "Is Furlpay's x402 facilitator open-source?",
    a: "Yes. The facilitator and payment middleware are MIT-licensed on GitHub. You can self-host or call the hosted endpoint at /api/x402/facilitator.",
  },
];

export default function X402Page() {
  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <JsonLd
        data={[
          financialProduct({
            name: "Furlpay x402 Facilitator",
            description: "Verify and settle USDC micropayments for AI agents over the x402 protocol on Arbitrum.",
            url: URL,
            serviceUrl: `${SITE}/docs/payments/agentic-x402`,
            category: "Agentic payments",
          }),
          breadcrumb([
            { name: "Home", path: "/" },
            { name: "Products", path: "/products" },
            { name: "x402", path: "/products/x402" },
          ]),
        ]}
      />
      <main className="mx-auto max-w-5xl px-6 pb-24 pt-14">
        <Hero
          eyebrow="x402"
          title="Payments for AI agents, over plain HTTP."
          subtitle="x402 revives the HTTP 402 status so any API can quote a price and get paid in USDC. Furlpay's facilitator verifies and settles on Arbitrum — built for the agentic economy."
          primary={{ href: "/docs/payments/agentic-x402", label: "Read the docs" }}
          secondary={{ href: "/solutions/ai-agents", label: "For AI builders" }}
        />

        <p className="mt-8 max-w-2xl rounded-xl border border-white/10 bg-white/[0.02] p-5 text-[15px] leading-relaxed text-textSecondary">
          <strong className="text-white">x402</strong> lets an AI agent request a resource, receive a{" "}
          <strong className="text-white">402 Payment Required</strong> response, pay in USDC, and
          retry — no API keys, no human checkout. Furlpay&apos;s facilitator handles verification and
          settlement on Arbitrum.
        </p>

        <Section title="Infrastructure for agentic commerce">
          <FeatureGrid items={FEATURES} />
        </Section>

        <FaqSection items={FAQ} />

        <CtaBand
          title="Meter your API for agents"
          subtitle="Open-source middleware and a hosted facilitator."
          primary={{ href: "/docs/payments/agentic-x402", label: "x402 docs" }}
          secondary={{ href: "/developer/agents", label: "Agent tools" }}
        />
      </main>
    </div>
  );
}
