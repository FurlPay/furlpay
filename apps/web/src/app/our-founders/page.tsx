import type { Metadata, Viewport } from "next";
import Image from "next/image";
import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import { seoMetadata } from "@/lib/seo/meta";
import { breadcrumb, ORG_ID, SITE } from "@/lib/seo/schema";
import "./founders.css";

// ---------------------------------------------------------------------------
// /our-founders — the founder page.
//
// A Server Component with no client JavaScript at all. The page is typography,
// one photograph and static copy; a "use client" boundary here would ship a
// hydration payload to buy nothing.
//
// EVERY FACT ON THIS PAGE IS SOURCED. Name, role and employer come from the
// founder profile already published in `lib/blog/authors.ts`; the two
// certifications were supplied by the account owner. Nothing else is asserted
// — no funding, no customers, no press, no awards, no years-of-experience
// count, no investor or partner logos. A founder page is exactly the surface
// where an unverifiable claim is most damaging, because it is the page people
// check when they are deciding whether to trust the product.
//
// ON THE "WORKING WITH GOOGLE" SECTION. It names Google Cloud CERTIFICATIONS,
// which are credentials Google issues to individuals. It deliberately does not
// say, imply or structure anything as employment by, partnership with,
// sponsorship from, or funding by Google — `worksFor` in the JSON-LD below
// points at FurlPay, and the certifications are modelled as `hasCredential`,
// which is what they are.
// ---------------------------------------------------------------------------

const PATH = "/our-founders";
const URL = `${SITE}${PATH}`;
const PORTRAIT = "/team/ashutosh-kumar-singh.jpg";

export const viewport: Viewport = {
  themeColor: "#00E599",
};

export const metadata: Metadata = {
  ...seoMetadata({
    title: "Our Founder — Ashutosh Kumar Singh | FurlPay",
    ogTitle: "Ashutosh Kumar Singh — Founder, FurlPay",
    description:
      "Ashutosh Kumar Singh is the founder of FurlPay and a Software Engineer at Skyhigh Security. He builds payment infrastructure — stablecoin settlement, agentic payments and the security boundary around them.",
    path: PATH,
    // The portrait is the card. A founder page shared to LinkedIn or X with the
    // generic site image loses the one thing that makes it worth opening.
    image: PORTRAIT,
  }),
  keywords: [
    "Ashutosh Kumar Singh",
    "FurlPay founder",
    "FurlPay team",
    "Skyhigh Security engineer",
    "fintech founder",
    "stablecoin payments",
    "agentic payments",
    "payment infrastructure",
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

/**
 * The founder's own social profiles.
 *
 * These are personal accounts, deliberately separate from the FurlPay company
 * accounts in the root layout's Organization node — conflating the two would
 * make the company look like it has more presence than it does. They are also
 * emitted as `sameAs` on the Person below, which is what lets a search engine
 * resolve "Ashutosh Kumar Singh" to one identity across the web rather than
 * treating each profile as a different person.
 *
 * `rel="me"` states the same claim to anything that reads the HTML directly.
 * External links get `noopener` — `target="_blank"` without it hands the opened
 * page a `window.opener` reference back into ours.
 */
const SOCIALS = [
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/ashutosh-kumar-singh951/",
    // Paths are the official simple-icons glyphs, inlined. A remote icon font
    // or CDN sprite would be a third-party request on a page that otherwise
    // makes none, and the CSP does not allow one.
    path: "M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13M7.12 20.45H3.56V9h3.56zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.22.79 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.73C24 .77 23.2 0 22.22 0",
  },
  {
    label: "X",
    href: "https://x.com/0xAshutosh",
    path: "M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.46l8.6-9.83L0 1.15h7.59l5.24 6.93zm-1.29 19.5h2.04L6.49 3.24H4.3z",
  },
  {
    label: "Instagram",
    href: "https://instagram.com/ashutosh0x",
    path: "M12 0C8.74 0 8.33.02 7.05.07 5.78.13 4.9.33 4.14.63a5.9 5.9 0 0 0-2.13 1.38A5.9 5.9 0 0 0 .63 4.14C.33 4.9.13 5.78.07 7.05.02 8.33 0 8.74 0 12s.02 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.31.79.72 1.46 1.38 2.13a5.9 5.9 0 0 0 2.13 1.38c.76.3 1.64.5 2.91.56C8.33 23.98 8.74 24 12 24s3.67-.02 4.95-.07c1.27-.06 2.15-.26 2.91-.56a5.9 5.9 0 0 0 2.13-1.38 5.9 5.9 0 0 0 1.38-2.13c.3-.76.5-1.64.56-2.91.05-1.28.07-1.69.07-4.95s-.02-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.9 5.9 0 0 0-1.38-2.13A5.9 5.9 0 0 0 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.02 15.26 0 12 0m0 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07m0 3.68a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32M12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8m7.85-10.4a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0",
  },
];

/**
 * Google Cloud certifications.
 *
 * Rendered with the issuer shown on every row, so a reader can never take a
 * certification for an employment relationship. `hasCredential` in the JSON-LD
 * carries the same distinction to machines.
 */
const CERTIFICATIONS = [
  { name: "Professional Cloud Architect", issuer: "Google Cloud" },
  { name: "Professional Cloud Security Engineer", issuer: "Google Cloud" },
];

/** What he actually builds, described from this repository rather than invented. */
const WORK = [
  {
    title: "Stablecoin settlement",
    body: "USDC settlement across Arbitrum, Base, Ethereum and Solana, with a double-entry ledger in integer minor units — floats never touch money.",
  },
  {
    title: "Agentic payments",
    body: "Per-request payments over the open x402 standard, with agent keys held to explicit spending policies rather than trusted by default.",
  },
  {
    title: "Transaction security",
    body: "One authorization boundary: simulation, device attestation, user confirmation and the signature all commit to the same canonical transaction, or nothing is signed.",
  },
];

export default function OurFoundersPage() {
  return (
    <>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "ProfilePage",
            "@id": `${URL}#profile`,
            url: URL,
            name: "Ashutosh Kumar Singh — Founder, FurlPay",
            mainEntity: {
              "@type": "Person",
              "@id": `${SITE}/#founder`,
              name: "Ashutosh Kumar Singh",
              jobTitle: "Founder, FurlPay",
              image: `${SITE}${PORTRAIT}`,
              url: URL,
              // Founder of FurlPay, employed by Skyhigh Security. Two separate
              // relationships, stated separately — collapsing them would make
              // one of the two claims false.
              worksFor: { "@type": "Organization", name: "Skyhigh Security" },
              founderOf: { "@id": ORG_ID },
              knowsAbout: [
                "Payment infrastructure",
                "Stablecoin settlement",
                "Agentic payments",
                "Cloud security",
              ],
              // Certifications, not affiliations. `recognizedBy` names Google
              // Cloud as the ISSUER; nothing here asserts employment.
              hasCredential: CERTIFICATIONS.map((c) => ({
                "@type": "EducationalOccupationalCredential",
                credentialCategory: "certification",
                name: `${c.issuer} ${c.name}`,
                recognizedBy: { "@type": "Organization", name: c.issuer },
              })),
              sameAs: [
                "https://github.com/Ashutosh0x",
                ...SOCIALS.map((x) => x.href),
              ],
            },
          },
          breadcrumb([
            { name: "Home", path: "/" },
            { name: "Our Founders", path: PATH },
          ]),
        ]}
      />

      <main className="founders-page">
        <div aria-hidden="true" className="ambient-grid" />

        <nav aria-label="Main navigation" className="launch-nav">
          <Link aria-label="FurlPay home" className="wordmark" href="/">
            {/* eslint-disable-next-line @next/next/no-img-element -- 28px static brand mark; next/image's wrapper adds layout for no benefit at this size, matching the reasoning in components/card/HoloCard.tsx */}
            <img src="/icon.png" alt="" aria-hidden="true" />
            <span>FurlPay</span>
          </Link>
          <Link className="nav-link" href="/wallet">
            Wallet <span aria-hidden="true">↗</span>
          </Link>
        </nav>

        <section className="founders-hero" aria-labelledby="founders-heading">
          <div className="founders-lede">
            <p className="founders-eyebrow">Our Founders</p>
            <h1 id="founders-heading">Building the financial rails for the agentic internet.</h1>
          </div>

          {/* The photograph, as supplied. 500×500 source, served square. */}
          <figure className="founder-portrait">
            <Image
              src={PORTRAIT}
              alt="Ashutosh Kumar Singh, founder of FurlPay"
              width={500}
              height={500}
              priority
              sizes="(max-width: 900px) 380px, 42vw"
            />
            <figcaption>Ashutosh Kumar Singh · Founder</figcaption>
            <ul className="founder-socials">
              {SOCIALS.map((s) => (
                <li key={s.label}>
                  <a
                    href={s.href}
                    rel="me noopener noreferrer"
                    target="_blank"
                    // The accessible name is the whole label. An icon link whose
                    // only name is "LinkedIn" read out of context tells a screen
                    // reader user nothing about WHOSE profile it opens.
                    aria-label={`Ashutosh Kumar Singh on ${s.label} (opens in a new tab)`}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                      <path d={s.path} />
                    </svg>
                  </a>
                </li>
              ))}
            </ul>
          </figure>

          <div className="founder-identity">
            <h2 className="founder-name">Ashutosh Kumar Singh</h2>
            <p className="founder-roles">
              <b>Founder, FurlPay</b> · Software Engineer at Skyhigh Security
            </p>
            <p className="founder-bio">
              Ashutosh is a software engineer working across cloud infrastructure and security. He
              founded FurlPay to build payment infrastructure for a web where software, not only
              people, moves money.
            </p>
            <p className="founder-bio">
              His work on FurlPay is mostly in the parts nobody sees: the ledger that has to
              balance, the settlement path that must not double-pay, and the authorization boundary
              that decides whether a transaction is allowed to reach a signing key at all.
            </p>
          </div>
        </section>

        {/* The exact section requested, with the issuer named on every row so a
            certification can never be read as employment. */}
        <section className="founders-section" aria-labelledby="google-heading">
          <p className="section-eyebrow">Working with Google</p>
          <h2 className="section-title" id="google-heading">
            Experience in fintech
          </h2>
          <p className="section-sub">
            Google Cloud certifications, issued to individuals who pass Google&apos;s own
            examinations in cloud architecture and cloud security.
          </p>
          <ul className="credential-list">
            {CERTIFICATIONS.map((c) => (
              <li key={c.name}>
                <span aria-hidden="true" className="credential-mark">
                  ✓
                </span>
                <span>{c.name}</span>
                <span className="credential-issuer">{c.issuer}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="founders-section" aria-labelledby="work-heading">
          <p className="section-eyebrow">What he builds</p>
          <h2 className="section-title" id="work-heading">
            The parts of a payment nobody sees.
          </h2>
          <div className="work-grid">
            {WORK.map((w) => (
              <article className="work-card" key={w.title}>
                <h3>{w.title}</h3>
                <p>{w.body}</p>
              </article>
            ))}
          </div>
          <div className="founders-links">
            <Link className="nav-link" href="/wallet">
              Reserve a wallet name <span aria-hidden="true">↗</span>
            </Link>
            <Link className="nav-link" href="/about">
              About FurlPay <span aria-hidden="true">↗</span>
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
    </>
  );
}
