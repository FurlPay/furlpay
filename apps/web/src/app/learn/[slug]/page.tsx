import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { TERMS, getTerm, relatedTerms } from "@/lib/learn/glossary";
import { breadcrumb, faqPage, SITE, ORG_ID } from "@/lib/seo/schema";

// ---------------------------------------------------------------------------
// One page per term.
//
// The short definition is rendered first and verbatim, because that is the
// block a featured snippet and an AI answer both lift. Burying it under an
// introduction is the single most common way a glossary page loses the
// snippet it would otherwise win.
//
// Both DefinedTerm and FAQPage are emitted: the first says what this page IS,
// the second matches how the question is actually typed ("what is a
// stablecoin"). They describe the same content and do not compete.
// ---------------------------------------------------------------------------

// The param set below is the complete list, so any other slug is a real miss.
// Without this Next renders it on demand and the not-found page is returned
// with a 200 — a soft 404 that Google indexes as content. Same rule as
// /hotels/[city].
export const dynamicParams = false;

export function generateStaticParams() {
  return TERMS.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const t = getTerm(slug);
  if (!t) return {};
  const url = `${SITE}/learn/${t.slug}`;
  return {
    title: `What is ${t.term}?${t.expansion ? ` (${t.expansion})` : ""}`,
    description: t.short,
    alternates: { canonical: url },
    openGraph: { type: "article", url, title: `What is ${t.term}?`, description: t.short },
  };
}

export default async function TermPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const t = getTerm(slug);
  if (!t) notFound();

  const url = `${SITE}/learn/${t.slug}`;
  const related = relatedTerms(t);

  const term = {
    "@context": "https://schema.org",
    "@type": "DefinedTerm",
    "@id": `${url}#term`,
    name: t.term,
    ...(t.expansion ? { alternateName: t.expansion } : {}),
    description: t.short,
    url,
    termCode: t.slug,
    inDefinedTermSet: {
      "@type": "DefinedTermSet",
      "@id": `${SITE}/learn#set`,
      name: "Furlpay Glossary",
      url: `${SITE}/learn`,
    },
    publisher: { "@id": ORG_ID },
  };

  return (
    <>
      <JsonLd
        data={[
          term,
          faqPage([{ q: `What is ${t.term}?`, a: t.short }]),
          breadcrumb([
            { name: "Learn", path: "/learn" },
            { name: t.term, path: `/learn/${t.slug}` },
          ]),
        ]}
      />

      <nav aria-label="Breadcrumb" className="text-[13px] text-textMuted">
        <Link href="/learn" className="transition-colors hover:text-white">
          Learn
        </Link>
        <span aria-hidden="true" className="px-2">
          /
        </span>
        <span className="text-textSecondary">{t.term}</span>
      </nav>

      <article className="mt-6 max-w-2xl">
        <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-textMuted">
          {t.category}
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-white">
          What is {t.term}?
        </h1>
        {t.expansion && <p className="mt-2 text-[15px] text-textMuted">{t.expansion}</p>}

        {/* The snippet block. First, short, and unqualified on purpose. */}
        <p className="mt-6 border-l-2 border-neon/50 pl-5 text-[17px] leading-relaxed text-white">
          {t.short}
        </p>

        <div className="mt-8 space-y-5">
          {t.body.map((p, i) => (
            <p key={i} className="text-[15px] leading-relaxed text-textSecondary">
              {p}
            </p>
          ))}
        </div>

        {related.length > 0 && (
          <section aria-labelledby="related" className="mt-12 border-t border-white/10 pt-8">
            <h2 id="related" className="text-[13px] font-semibold uppercase tracking-[0.18em] text-textMuted">
              Related
            </h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link
                    href={`/learn/${r.slug}`}
                    className="inline-flex min-h-[38px] items-center rounded-full border border-white/10 px-4 text-[13px] text-textSecondary transition-colors hover:border-neon/40 hover:text-white"
                  >
                    {r.term}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-10 text-[12px] leading-relaxed text-textMuted">
          Definitions are educational and general. Nothing here is financial, legal or tax
          advice, and regulatory descriptions summarise frameworks that change — check the
          current rules for your jurisdiction before relying on them.
        </p>
      </article>
    </>
  );
}
