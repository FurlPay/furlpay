import type { Metadata } from "next";
import LandingPage from "@/components/marketing/LandingPage";

export const metadata: Metadata = {
  title: "Payment Infrastructure for AI Agents — x402 & MCP",
  description:
    "Give AI agents a way to pay. Furlpay's x402 facilitator and MCP server let agents discover, negotiate, and settle USDC micropayments on Arbitrum — no API keys, no human checkout.",
  alternates: { canonical: "/solutions/ai-agents" },
  openGraph: {
    type: "website",
    url: "https://furlpay.com/solutions/ai-agents",
    siteName: "Furlpay",
    title: "Payment Infrastructure for AI Agents — x402 & MCP",
    description: "Give AI agents a way to pay. Furlpay's x402 facilitator and MCP server let agents discover, negotiate, and settle USDC micropayments on Arbitrum — no API keys, no human checkout.",
    images: [{ url: "/og.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Payment Infrastructure for AI Agents — x402 & MCP",
    description: "Give AI agents a way to pay. Furlpay's x402 facilitator and MCP server let agents discover, negotiate, and settle USDC micropayments on Arbitrum — no API keys, no human checkout.",
    images: ["/og.png"],
  },
};

export default function AiAgentsSolutionPage() {
  return (
    <LandingPage
      merchantOffer
      eyebrow="Solutions · AI agents"
      title="Payment infrastructure for AI agents."
      subtitle="Let agents pay for what they use. The x402 facilitator and MCP server turn any API into a pay-per-request resource, settled in USDC on Arbitrum — no API keys, no human in the loop."
      atomicAnswer={
        <>
          Furlpay gives AI agents a native way to pay: the <strong className="text-white">x402</strong>{" "}
          facilitator settles USDC micropayments over HTTP and the{" "}
          <strong className="text-white">MCP server</strong> exposes paid tools to models. Agents
          discover a price, pay, and retry — with no API keys and sub-cent Arbitrum gas.
        </>
      }
      featuresTitle="A wallet and a protocol for autonomous software"
      features={[
        { title: "x402 payments", body: "Agents receive a 402 response, pay in USDC, and retry — pay-per-request access without accounts." },
        { title: "MCP server", body: "Expose tools to models through the Model Context Protocol and meter them automatically." },
        { title: "Agent keys", body: "Issue scoped, revocable keys so an agent can spend within limits you set." },
        { title: "Micropayments", body: "Sub-cent gas makes per-call pricing viable for high-frequency agent workloads." },
        { title: "Programmable limits", body: "Set per-agent budgets and policies; every payment is signed and auditable." },
        { title: "Open-source", body: "Facilitator, middleware, and MCP server are MIT-licensed — self-host or use the hosted endpoints." },
      ]}
      faq={[
        { q: "How do AI agents pay for services?", a: "With x402, an agent requests a resource, gets an HTTP 402 with a price, submits a signed USDC payment, and retries. Furlpay's facilitator verifies and settles it on Arbitrum, so the agent transacts without API keys or a human checkout." },
        { q: "What is the MCP server for?", a: "The Model Context Protocol server exposes tools and resources to AI models in a standard way. Paired with x402, those tools can be metered and paid for automatically, so a model can use a paid capability without manual billing setup." },
        { q: "How do I control what an agent can spend?", a: "You issue scoped, revocable agent keys with per-agent budgets and policies. Every payment is signed and recorded, so you can audit and cap spend precisely." },
      ]}
      crumbs={[
        { name: "Home", path: "/" },
        { name: "Solutions", path: "/solutions/ai-agents" },
        { name: "AI agents", path: "/solutions/ai-agents" },
      ]}
      primary={{ href: "/docs/payments/agentic-x402", label: "Read the x402 docs" }}
      secondary={{ href: "/products/x402", label: "x402 product" }}
      cta={{ title: "Give your agents a wallet", subtitle: "x402 + MCP, open-source and hosted.", primary: { href: "/developer/agents", label: "Agent tools" }, secondary: { href: "/docs/payments/agentic-x402", label: "x402 docs" } }}
    />
  );
}
