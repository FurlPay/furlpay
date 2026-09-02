import Link from "next/link";
import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { TERMS, TERM_CATEGORIES, termsInCategory } from "@/lib/learn/glossary";
import { breadcrumb, SITE } from "@/lib/seo/schema";

// ---------------------------------------------------------------------------
// The glossary index.
//
// Emitted as a DefinedTermSet with every term inline. That is the vocabulary
// that tells a crawler this is a reference work rather than a pile of thin
// pages, and it is what lets an answer engine lift a single definition with
// attribution instead of summarising the whole page.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Learn — stablecoins, agentic payments and investing, defined",
  description: `Plain definitions of ${TERMS.length} terms across stablecoins, payment settlement, fractional investing, AI agent payments, compliance and security. No jargon, no sales pitch.`,
  alternates: { canonical: `${SITE}/learn` },
};

export default function LearnIndex() {
  const set = {
    "@context": "https://schema.org",
    "@type": "DefinedTermSet",
    "@id": `${SITE}/learn#set`,
    name: "Furlpay Glossary",
    description:
      "Definitions across stablecoins, payment settlement, fractional investing, agentic AI payments, compliance and security.",
    url: `${SITE}/learn`,
    hasDefinedTerm: TERMS.map((t) => ({
      "@type": "DefinedTerm",
      "@id": `${SITE}/learn/${t.slug}#term`,
      name: t.term,
      description: t.short,
      url: `${SITE}/learn/${t.slug}`,
      inDefinedTermSet: { "@id": `${SITE}/learn#set` },
    })),
  };

  return (
    <>
      <JsonLd data={[set, breadcrumb([{ name: "Learn", path: "/learn" }])]} />

      <header className="max-w-2xl">
        <h1 className="text-4xl font-bold tracking-tight text-white">Learn</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-textSecondary">
          {TERMS.length} definitions across stablecoins, settlement, investing, agentic
          payments, compliance and security. Written to explain the mechanism rather than
          to sell anything — where a term has a genuine trade-off or a common
          misunderstanding, that is the part we spend the words on.
        </p>
      </header>

      <div className="mt-12 space-y-12">
        {TERM_CATEGORIES.map((cat) => {
          const terms = termsInCategory(cat);
          if (terms.length === 0) return null;
          return (
            <section key={cat} aria-labelledby={`cat-${cat}`}>
              <h2
                id={`cat-${cat}`}
                className="text-[13px] font-semibold uppercase tracking-[0.18em] text-textMuted"
              >
                {cat}
              </h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {terms.map((t) => (
                  <li key={t.slug}>
                    <Link
                      href={`/learn/${t.slug}`}
                      className="block h-full rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-neon/40 hover:bg-white/[0.04]"
                    >
                      <p className="text-[15px] font-bold text-white">
                        {t.term}
                        {t.expansion && (
                          <span className="ml-2 font-normal text-[12px] text-textMuted">
                            {t.expansion}
                          </span>
                        )}
                      </p>
                      <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-textSecondary">
                        {t.short}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
