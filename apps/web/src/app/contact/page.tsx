import type { Metadata } from "next";
import Link from "next/link";
import LandingChrome from "@/components/landing/LandingChrome";
import { Hero } from "@/components/marketing/blocks";
import JsonLd from "@/components/JsonLd";
import { breadcrumb, ORG_ID, SITE } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "Contact Furlpay — Sales, Support & Community",
  description:
    "Get in touch with Furlpay. Talk to sales about enterprise settlement, reach support, join the Discord and Telegram communities, or email the team.",
  alternates: { canonical: "/contact" },
};

const CHANNELS = [
  { title: "Talk to sales", body: "Enterprise settlement, volume pricing, and partnerships.", href: "/talk-to-us", cta: "Book a call" },
  { title: "Email", body: "General questions and support requests.", href: "mailto:hello@furlpay.com", cta: "hello@furlpay.com" },
  { title: "Discord", body: "Join the community and get help from the team.", href: "/discord", cta: "Join Discord" },
  { title: "Telegram", body: "Chat with us and the wider community.", href: "/telegram", cta: "Open Telegram" },
  { title: "Developers", body: "API keys, webhooks, and integration help.", href: "/developer", cta: "Developer hub" },
  { title: "Security", body: "Report a vulnerability under responsible disclosure.", href: "/legal/responsible-disclosure", cta: "Disclose" },
];

const contactSchema = {
  "@context": "https://schema.org",
  "@type": "ContactPage",
  url: `${SITE}/contact`,
  about: { "@id": ORG_ID },
  mainEntity: {
    "@type": "Organization",
    "@id": ORG_ID,
    contactPoint: [
      { "@type": "ContactPoint", contactType: "sales", url: `${SITE}/talk-to-us` },
      { "@type": "ContactPoint", contactType: "customer support", email: "hello@furlpay.com" },
    ],
  },
};

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={[
          contactSchema,
          breadcrumb([
            { name: "Home", path: "/" },
            { name: "Contact", path: "/contact" },
          ]),
        ]}
      />
      <main className="section pb-24 pt-14">
        <Hero
          eyebrow="Contact"
          title="Get in touch."
          subtitle="Whether you're evaluating stablecoin settlement for an enterprise, integrating the API, or just have a question — here's how to reach us."
          primary={{ href: "/talk-to-us", label: "Talk to us" }}
          secondary={{ href: "mailto:hello@furlpay.com", label: "Email us" }}
        />

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CHANNELS.map((c) => (
            <div key={c.title} className="glass-card flex flex-col p-6">
              <h2 className="text-[16px] font-bold">{c.title}</h2>
              <p className="mt-2 flex-1 text-[14px] leading-relaxed text-textSecondary">{c.body}</p>
              <Link href={c.href} className="mt-4 text-[14px] font-semibold text-neon">
                {c.cta} →
              </Link>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
