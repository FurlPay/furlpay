import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import LandingChrome from "@/components/landing/LandingChrome";
import JsonLd from "@/components/JsonLd";
import { breadcrumb, faqPage, howTo } from "@/lib/seo/schema";
import { seoMetadata } from "@/lib/seo/meta";
import { INTEGRATIONS, integrationBySlug } from "@/lib/integrations/frameworks";

// Answer-first integration quickstarts, generated per framework from
// lib/integrations/frameworks.ts. The atomic answer + HowTo/FAQ schema are the
// GEO layer: AI search engines lift the direct answer and cite the page.

// The param set below is the complete list, so any other slug is a real miss.
// Without this Next renders it on demand and the not-found page is returned
// with a 200 — a soft 404 that Google indexes as content. Same rule as
// /hotels/[city].
export const dynamicParams = false;

export function generateStaticParams() {
  return INTEGRATIONS.map((i) => ({ slug: i.slug }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const params = await props.params;
  const it = integrationBySlug.get(params.slug);
  if (!it) return {};
  return seoMetadata({
    title: `FurlPay + ${it.name} — ${it.tagline} (2026)`,
    description: it.atomicAnswer,
    path: `/integrations/${it.slug}`,
  });
}

export default async function IntegrationPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const it = integrationBySlug.get(params.slug);
  if (!it) notFound();

  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Integrations", path: "/integrations" },
          { name: it.name, path: `/integrations/${it.slug}` },
        ])}
      />
      <JsonLd
        data={howTo({
          name: `Add FurlPay to ${it.name}`,
          description: it.atomicAnswer,
          steps: [
            { name: "Install the package", text: it.install },
            { name: "Register the tools", text: `Wire the FurlPay tools into your ${it.name} agent (see the quickstart snippet).` },
            { name: "Go live", text: "Set FURLPAY_API_KEY to switch from demo mode to live execution." },
          ],
        })}
      />
      <JsonLd data={faqPage(it.faq)} />

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-14">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-neon">
          <Link href="/integrations" className="hover:underline">Integrations</Link> · {it.language}
        </p>
        <h1 className="mt-3 text-[32px] font-extrabold leading-tight tracking-tighter sm:text-[40px]">
          FurlPay + {it.name}
        </h1>

        {/* Answer-first block — the 50-100 words AI search extracts. */}
        <p className="mt-5 rounded-xl border border-neon/25 bg-neon/5 p-5 text-[15.5px] leading-relaxed text-white">
          {it.atomicAnswer}
        </p>

        <h2 className="mt-12 text-[20px] font-bold tracking-tight">Install</h2>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-4 font-mono text-[13px] leading-relaxed text-textSecondary">
          <code>{it.install}</code>
        </pre>

        <h2 className="mt-10 text-[20px] font-bold tracking-tight">Quickstart</h2>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-4 font-mono text-[13px] leading-relaxed text-textSecondary">
          <code>{it.snippet}</code>
        </pre>

        <h2 className="mt-10 text-[20px] font-bold tracking-tight">What your agent gets</h2>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {it.toolsProvided.map((t) => (
            <li key={t} className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2.5 font-mono text-[13px] text-textSecondary">
              {t}
            </li>
          ))}
        </ul>

        <h2 className="mt-10 text-[20px] font-bold tracking-tight">FAQ</h2>
        <div className="mt-4 space-y-5">
          {it.faq.map((f) => (
            <div key={f.q}>
              <h3 className="text-[15.5px] font-semibold text-white">{f.q}</h3>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-textSecondary">{f.a}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap gap-3">
          <a href={it.registryUrl} target="_blank" rel="noopener noreferrer" className="glass-card px-5 py-2.5 text-[14px] font-semibold transition-colors hover:border-neon/40">
            {it.registry}: {it.packageName}
          </a>
          <a href={it.github} target="_blank" rel="noopener noreferrer" className="glass-card px-5 py-2.5 text-[14px] font-semibold transition-colors hover:border-neon/40">
            Source on GitHub
          </a>
          <Link href="/docs" className="glass-card px-5 py-2.5 text-[14px] font-semibold transition-colors hover:border-neon/40">
            FurlPay docs
          </Link>
        </div>

        <p className="mt-10 text-[12.5px] leading-relaxed text-textSecondary/70">
          All FurlPay integration packages are MIT-licensed and run in demo mode without an API key.
          Framework names are trademarks of their respective owners; FurlPay is not affiliated with or
          endorsed by them.
        </p>
      </main>
    </div>
  );
}
