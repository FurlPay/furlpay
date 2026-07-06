import JsonLd from "@/components/JsonLd";
import { faqPage } from "@/lib/seo/schema";

// Renders a visible FAQ list AND the matching FAQPage JSON-LD from the same
// source of truth. Keep answers tight and factual — the first ~50 words of
// each answer is what Google's AI Overviews extract and cite (GEO).
export default function FaqSection({
  items,
  title = "Frequently asked questions",
}: {
  items: { q: string; a: string }[];
  title?: string;
}) {
  return (
    <section className="mx-auto mt-20 max-w-2xl">
      <JsonLd data={faqPage(items)} />
      <h2 className="mb-6 text-center text-[24px] font-bold tracking-tighter">{title}</h2>
      <div className="divide-y divide-white/[0.06] rounded-2xl border border-white/10">
        {items.map((f) => (
          <div key={f.q} className="p-5">
            <p className="font-semibold">{f.q}</p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-textSecondary">{f.a}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
