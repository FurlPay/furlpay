import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import MarketingBar from "@/components/marketing/MarketingBar";
import JsonLd from "@/components/JsonLd";
import { breadcrumb } from "@/lib/seo/schema";
import { seoMetadata } from "@/lib/seo/meta";
import { INTEGRATIONS } from "@/lib/integrations/frameworks";

export const metadata: Metadata = seoMetadata({
  title: "Integrations â€” Add Stablecoin Payments to Any AI Agent Framework (2026)",
  description:
    "Official FurlPay integrations for Vercel AI SDK, LangChain, LlamaIndex, CrewAI, OpenAI Agents, Pydantic AI, MCP clients and OpenBB â€” USDC payments, investing, travel and x402 pay-per-call tools with copy-paste quickstarts.",
  path: "/integrations",
});

export default function IntegrationsIndexPage() {
  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Integrations", path: "/integrations" },
        ])}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: INTEGRATIONS.map((it, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: `FurlPay + ${it.name}`,
            url: `https://furlpay.com/integrations/${it.slug}`,
          })),
        }}
      />
      <main className="mx-auto max-w-4xl px-6 pb-24 pt-14">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-neon">Integrations</p>
        <h1 className="mt-3 text-[34px] font-extrabold leading-tight tracking-tighter sm:text-[44px]">
          Give any agent framework a wallet
        </h1>
        <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-textSecondary">
          Official, open-source FurlPay tool packages for every major AI agent framework â€” stablecoin
          balances and transfers, token swaps, fractional stock orders, travel booking, USDC yield, and
          x402 pay-per-call budgets. Each integration runs in demo mode without an API key.
        </p>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {INTEGRATIONS.map((it) => (
            <Link
              key={it.slug}
              href={`/integrations/${it.slug}`}
              className="group glass-card flex flex-col p-6 transition-colors hover:border-neon/40"
            >
              <div className="flex items-center justify-between">
                <span className="text-[17px] font-bold">{it.name}</span>
                <ArrowRight className="h-4 w-4 text-textSecondary transition-transform group-hover:translate-x-0.5 group-hover:text-neon" />
              </div>
              <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">{it.tagline}</p>
              <p className="mt-3 font-mono text-[12px] text-neon/80">
                {it.registry} Â· {it.packageName}
              </p>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
