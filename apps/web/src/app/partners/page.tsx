import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";
import JsonLd from "@/components/JsonLd";
import PartnersExperience from "@/components/partnerships/PartnersExperience";
import "@/components/partnerships/partners.css";

// /partners — the partnership experience. Page text is server-rendered; the
// globe and the inquiry dialog hydrate on the client (PartnersExperience).
//
// Claims policy: this page names no company as a partner. The previous version
// listed providers as partners and an event partnership that nothing in this
// repository evidences; supported public networks are shown as networks, and
// the inquiry form is the way in.
const TITLE = "FurlPay Partnerships | Build Global Payment Infrastructure Together";
const DESCRIPTION = "Partner with FurlPay on programmable stablecoin payments, wallets, merchant checkout, cross-border settlement and AI agent payments. Send a partnership inquiry.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/partners" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/partners", type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function PartnersPage() {
  return (
    <div className="min-h-screen bg-[#020c09]">
      <JsonLd data={{ "@context": "https://schema.org", "@type": "WebPage", name: TITLE, description: DESCRIPTION, url: "https://furlpay.com/partners", publisher: { "@type": "Organization", name: "FurlPay", url: "https://furlpay.com" } }} />
      <LandingChrome />
      <main id="main">
        <PartnersExperience />
      </main>
    </div>
  );
}
