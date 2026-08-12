import Link from "next/link";
import type { Metadata, Viewport } from "next";
import MarketingBar from "@/components/marketing/MarketingBar";
import JsonLd from "@/components/JsonLd";
import { editionLabel } from "@/components/card/edition";
import { seoMetadata } from "@/lib/seo/meta";
import { breadcrumb, faqPage } from "@/lib/seo/schema";
import NewsletterClaim from "./NewsletterClaim";
import "../wallet/wallet.css";
import "./newsletter.css";

export const viewport: Viewport = {
  themeColor: "#00E599",
};

export const metadata: Metadata = {
  ...seoMetadata({
    // The root layout applies the "%s — Furlpay" template, so the suffix must
    // not be repeated here — the old value rendered "Newsletter — Furlpay — Furlpay".
    title: "Newsletter",
    ogTitle: "Subscribe to Furlpay updates",
    description:
      "Product updates, engineering deep-dives, policy alerts, security bulletins and a weekly market digest — pick exactly what you want. No spam, one-click unsubscribe.",
    path: "/newsletter",
  }),
};

// Answers the questions people actually ask before handing over an address.
// Every one of these is checkable against the code that runs on submit.
const FAQ = [
  {
    q: "How often will I receive emails?",
    a: "It depends on your selections. Product Updates and Engineering posts go out when we ship (typically 2–4 per month). The Weekly Digest lands every Monday. Security Bulletins are sent only when there's a genuine advisory.",
  },
  {
    q: "Can I unsubscribe anytime?",
    a: "Yes — every email includes a one-click unsubscribe link. You can also visit our unsubscribe page to selectively remove categories or opt out entirely.",
  },
  {
    q: "What does Furlpay store about me?",
    a: "Your email address, the topics you selected, a consent timestamp, and the IP address the consent came from — that last one is the evidence that the consent was real. Nothing else, and none of it is sold or shared with third parties.",
  },
  {
    q: "Is this GDPR compliant?",
    a: "We record explicit, per-topic consent with a timestamp, we send only the topics you chose, and you can modify or delete your data at any time by emailing privacy@furlpay.com or using the unsubscribe page.",
  },
];

const PROMISES: { title: string; body: string; icon: React.ReactNode }[] = [
  {
    title: "Only what you picked",
    body: "Topics are stored per subscriber and enforced at send time. Choosing Security Bulletins alone means you never see a product email.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    ),
  },
  {
    title: "One click to leave",
    body: "Every email carries a one-click unsubscribe header. No login, no retention flow, no \"are you sure\" — the record is deleted.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
      </svg>
    ),
  },
  {
    title: "Consent on record",
    body: "Each signup writes a durable consent record — address, topics, timestamp, origin IP — so an opt-in can always be evidenced.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M12 3l7 3v6c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
];

export default function NewsletterPage() {
  return (
    <div className="newsletter-shell">
      <JsonLd
        data={[
          faqPage(FAQ),
          breadcrumb([
            { name: "Home", path: "/" },
            { name: "Newsletter", path: "/newsletter" },
          ]),
        ]}
      />
      <MarketingBar />
      <main className="launch-page newsletter-page">
        <div aria-hidden="true" className="ambient-grid" />

        <section className="launch-hero">
          <NewsletterClaim initialEdition={editionLabel(new Date())} />
        </section>

        <section className="wallet-features" aria-label="What subscribing means">
          {PROMISES.map((p) => (
            <article className="feature-card" key={p.title}>
              <div className="feature-icon">{p.icon}</div>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </article>
          ))}
        </section>

        <section className="nl-faq" aria-labelledby="newsletter-faq-title">
          <h2 className="nl-faq-title" id="newsletter-faq-title">
            Frequently asked questions
          </h2>
          <div className="nl-faq-grid">
            {FAQ.map((item) => (
              <article className="nl-faq-item" key={item.q}>
                <h3>{item.q}</h3>
                <p>{item.a}</p>
              </article>
            ))}
          </div>
          <div className="nl-faq-foot">
            <Link className="nav-link" href="/blog">
              Read the blog <span aria-hidden="true">↗</span>
            </Link>
            <Link className="nl-manage" href="/newsletter/unsubscribe">
              Manage preferences / unsubscribe →
            </Link>
          </div>
        </section>

        <footer className="launch-footer">
          <span>Built on FurlPay&apos;s global network</span>
          <div>
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/terms">Terms</Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
