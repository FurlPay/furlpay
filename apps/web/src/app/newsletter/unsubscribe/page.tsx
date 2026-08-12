import Link from "next/link";
import type { Metadata, Viewport } from "next";
import UnsubscribeForm from "./UnsubscribeForm";
import "../../wallet/wallet.css";
import "../newsletter.css";

export const viewport: Viewport = {
  themeColor: "#00E599",
};

export const metadata: Metadata = {
  title: "Manage your subscription",
  description: "Unsubscribe from Furlpay emails, or remove individual topics.",
  alternates: { canonical: "/newsletter/unsubscribe" },
  // A preference page has nothing to rank for, and an indexed unsubscribe form
  // is a phishing lookalike waiting to happen.
  robots: { index: false, follow: false },
};

export default function UnsubscribePage() {
  return (
    <div className="newsletter-shell">
      <main className="launch-page newsletter-page">
        <div aria-hidden="true" className="ambient-grid" />
        <nav aria-label="Main navigation" className="launch-nav">
          <Link aria-label="Furlpay home" className="wordmark" href="/">
            {/* eslint-disable-next-line @next/next/no-img-element -- static brand icon, sized by CSS */}
            <img alt="" aria-hidden="true" className="furl-icon" src="/icon.png" />
            <span>Furlpay</span>
          </Link>
          <Link className="nav-link" href="/newsletter">
            <span aria-hidden="true">←</span> Newsletter
          </Link>
        </nav>

        <section className="nl-unsub">
          <p className="hero-eyebrow">Preferences</p>
          <h1 className="nl-unsub-title">Manage your subscription</h1>
          <p className="nl-unsub-sub">
            Remove individual topics, or opt out of everything. Either way it takes effect
            immediately — there is no retention flow.
          </p>
          <UnsubscribeForm />
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
