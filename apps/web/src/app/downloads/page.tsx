import Link from "next/link";
import type { Metadata } from "next";
import MarketingBar from "@/components/marketing/MarketingBar";
import { seoMetadata } from "@/lib/seo/meta";

// /downloads — the destination every store badge and desktop link on the
// marketing pages points at. It did not exist until now: StoreBadges shipped
// four links to this path and all four 404'd.
//
// The page states what is available today rather than implying store listings
// that are not live. There is no play.google.com or apps.apple.com URL in this
// repo; when a listing goes live, replace the relevant "status" line and point
// the badge in components/marketing/StoreBadges.tsx at the store URL.

export const metadata: Metadata = {
  ...seoMetadata({
    title: "Downloads",
    ogTitle: "Get FurlPay",
    description:
      "Use FurlPay in the browser today, and track the mobile and desktop builds. Web app, Android, iOS, Windows, macOS and Linux.",
    path: "/downloads",
  }),
};

type Availability = "available" | "building";

const PLATFORMS: {
  name: string;
  detail: string;
  state: Availability;
  note: string;
  href?: string;
  cta?: string;
}[] = [
  {
    name: "Web app",
    detail: "Any modern browser",
    state: "available",
    note: "The full dashboard — accounts, transfers, cards, agent keys. Sign in with a passkey; nothing to install.",
    href: "/dashboard",
    cta: "Open the web app",
  },
  {
    name: "Android",
    detail: "Google Play",
    state: "building",
    note: "A signed release build exists. The Play listing is not published yet, so there is no store link to give you.",
  },
  {
    name: "iOS",
    detail: "App Store",
    state: "building",
    note: "The iOS client is in the repo and builds on macOS CI. Not submitted to the App Store yet.",
  },
  {
    name: "Windows",
    detail: ".msi installer",
    state: "building",
    note: "Desktop wrapper around the dashboard. Installer artifacts are not published yet.",
  },
  {
    name: "macOS",
    detail: ".dmg image",
    state: "building",
    note: "Desktop wrapper around the dashboard. Installer artifacts are not published yet.",
  },
  {
    name: "Linux",
    detail: ".deb package",
    state: "building",
    note: "Desktop wrapper around the dashboard. Installer artifacts are not published yet.",
  },
];

export default function DownloadsPage() {
  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <main className="section pb-24 pt-14">
        <p className="section-eyebrow">Downloads</p>
        <h1 className="section-title mt-3">Get FurlPay.</h1>
        <p className="section-lede mt-4">
          The web app is live today. Mobile and desktop builds are listed below with their real
          status — this page will never link you to a store page that does not exist.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PLATFORMS.map((p) => (
            <div key={p.name} className="surface p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[17px] font-bold">{p.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-textMuted">{p.detail}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                    p.state === "available"
                      ? "bg-neon/15 text-neon"
                      : "bg-white/[0.06] text-textSecondary"
                  }`}
                >
                  {p.state === "available" ? "Available" : "In build"}
                </span>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-textSecondary">{p.note}</p>
              {p.href && p.cta && (
                <Link href={p.href} className="btn-green mt-5 inline-flex px-5 py-2.5 text-[14px]">
                  {p.cta}
                </Link>
              )}
            </div>
          ))}
        </div>

        <div className="mt-12 surface p-6">
          <p className="text-[15px] font-bold">Building on FurlPay instead?</p>
          <p className="mt-2 text-[13.5px] leading-relaxed text-textSecondary">
            The API needs no download. Install an SDK — TypeScript, Python, Go or Rust — or call
            the REST endpoints directly.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/docs/quickstart" className="btn-green px-5 py-2.5 text-[14px]">
              Quickstart
            </Link>
            <Link href="/developer/keys" className="btn-outline px-5 py-2.5 text-[14px]">
              Get an API key
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
