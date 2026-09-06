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
// Full-resolution original. Used for the Open Graph card and the Person
// graph, where a tight circular crop would be the wrong shape.
const PORTRAIT = "/team/ashutosh-kumar-singh.jpg";
// The same photograph composed for a circle. See founders.css.
const PORTRAIT_CIRCLE = "/team/ashutosh-kumar-singh-portrait.jpg";

export const viewport: Viewport = {
  themeColor: "#00E599",
};

export const metadata: Metadata = {
  ...seoMetadata({
    title: "Our Founder — Ashutosh Kumar Singh | FurlPay",
    ogTitle: "Ashutosh Kumar Singh — Founder & CEO, FurlPay",
    description:
      "Ashutosh Kumar Singh is the founder and CEO of FurlPay, and a Software Engineer at Skyhigh Security. He builds payment infrastructure — stablecoin settlement, agentic payments and the security boundary around them.",
    path: PATH,
    // The portrait is the card. A founder page shared to LinkedIn or X with the
    // generic site image loses the one thing that makes it worth opening.
    image: PORTRAIT,
  }),
  // One English page, offered to every English-speaking market rather than
  // split into per-country copies. Google's guidance is that a single page
  // cannot rank well in several countries at once — but the honest alternative
  // here is not eight near-identical founder pages, which is a doorway pattern
  // and would be treated as one. `x-default` says "this is the version for
  // everyone else", which is exactly true of a founder page.
  alternates: {
    canonical: PATH,
    languages: { "x-default": URL, en: URL },
  },
  // `absolute` opts out of the root layout's "%s — Furlpay" template, which
  // would otherwise render "… | FurlPay — Furlpay". Google truncates titles
  // around 60 characters, so a duplicated brand costs real SERP width.
  title: { absolute: "Our Founder — Ashutosh Kumar Singh | FurlPay" },
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
    label: "email",
    href: "mailto:founder@furlpay.com",
    path: "M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-.607.229-1.088.632-1.408A1.62 1.62 0 0 1 1.636 3.68c.343 0 .662.1.938.28L12 10.907l9.426-6.947c.276-.18.595-.28.938-.28.36 0 .717.124 1.004.369.403.32.632.801.632 1.408",
  },
  {
    label: "Instagram",
    href: "https://instagram.com/ashutosh0x",
    path: "M12 0C8.74 0 8.33.02 7.05.07 5.78.13 4.9.33 4.14.63a5.9 5.9 0 0 0-2.13 1.38A5.9 5.9 0 0 0 .63 4.14C.33 4.9.13 5.78.07 7.05.02 8.33 0 8.74 0 12s.02 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.31.79.72 1.46 1.38 2.13a5.9 5.9 0 0 0 2.13 1.38c.76.3 1.64.5 2.91.56C8.33 23.98 8.74 24 12 24s3.67-.02 4.95-.07c1.27-.06 2.15-.26 2.91-.56a5.9 5.9 0 0 0 2.13-1.38 5.9 5.9 0 0 0 1.38-2.13c.3-.76.5-1.64.56-2.91.05-1.28.07-1.69.07-4.95s-.02-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.9 5.9 0 0 0-1.38-2.13A5.9 5.9 0 0 0 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.02 15.26 0 12 0m0 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07m0 3.68a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32M12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8m7.85-10.4a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0",
  },
];

/**
 * Where he has worked.
 *
 * Stated by the account owner, who is the subject and therefore the primary
 * source on his own employment history. Deliberately carries NO dates: a
 * tenure I was not given is a tenure I would be inventing, and on this page an
 * invented date is the detail a reader would check first.
 */
const EXPERIENCE = [
  { company: "Google", title: "" },
  { company: "Skyhigh Security", title: "Software Engineer" },
  { company: "Quantiphi", title: "Cybersecurity Engineer" },
];

/**
 * Contact.
 *
 * `founder@` reaches him; `hello@` is the company inbox already published in
 * the root layout's Organization node. Both are shown as text as well as an
 * icon — an envelope glyph alone makes a reader click to discover an address
 * they may only have wanted to read or copy.
 */
const EMAILS = ["founder@furlpay.com", "hello@furlpay.com"];

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

/**
 * What FurlPay actually does.
 *
 * Every line here is the SITE'S OWN wording, lifted from /products, the
 * landing sections and the product pages — not new copy written for this
 * section. That is deliberate: a founder page that describes the product in
 * different words from the product pages creates two versions of what FurlPay
 * is, and a reader who notices the difference trusts neither.
 *
 * Sources, so a future editor can check rather than guess:
 *   payments / merchant / travel / wallet / x402  -> src/app/products/page.tsx
 *   travel one-liner                              -> components/landing/BuildSection.tsx
 *   agent wallet + human approval                 -> components/landing/BuildSection.tsx
 *   2-of-2 MPC custody                            -> src/app/products/wallet/page.tsx
 *   card kinds and limits                         -> lib/types.ts, src/app/cards/page.tsx
 *
 * `emphasis` marks the two consumer-facing products that get a wider card.
 */
const PRODUCTS = [
  {
    name: "Stablecoins & payments",
    href: "/products/payments",
    emphasis: false,
    body: "Accept and send USDC on Arbitrum with sub-second settlement and a live fee API. Merchants take stablecoin payments online with hosted checkout, receipts and refunds.",
    points: ["USDC payments", "Hosted checkout", "On-chain settlement", "Programmable payouts"],
  },
  {
    name: "Travel",
    href: "/products/travel",
    emphasis: true,
    body: "Book hotels and flights and pay in USDC, with on-chain receipts and rewards. Stays and flights paid in stablecoins, settled on-chain.",
    points: ["Hotels and stays", "Flights", "Paid in stablecoins", "On-chain receipts"],
  },
  {
    name: "Wallet",
    href: "/products/wallet",
    emphasis: true,
    body: "A passkey-secured MPC wallet — phishing-resistant, with no seed phrase to lose. The signing key is split 2-of-2, so neither FurlPay nor a single device can move funds alone.",
    points: ["No seed phrase", "2-of-2 MPC custody", "Multi-asset balances", "Wallet handles"],
  },
  {
    name: "Cards",
    // No link. `/cards` is the signed-in app screen and sits behind the auth
    // gate, so an anonymous reader clicking this card would land on a login
    // form — and there is no public cards page to send them to instead. A
    // marketing card that promises a destination it cannot deliver is worse
    // than one that simply describes the product.
    href: null,
    emphasis: false,
    body: "Virtual and physical cards that spend from the same balance, with a daily limit, a per-purchase limit and a freeze you control.",
    points: ["Virtual cards", "Physical cards", "Daily limits", "Freeze on demand"],
  },
  {
    name: "x402 for AI agents",
    href: "/products/x402",
    emphasis: false,
    body: "Give an autonomous agent its own wallet, a spending policy it cannot exceed, and the ability to pay per API call over x402 — with human approval required before money moves.",
    points: ["Agent wallets", "Spending policies", "Pay per API call", "Human approval"],
  },
];

/**
 * Device availability, stated as it actually is.
 *
 * `state` is copied from /downloads, which is the site's own source of truth:
 * the Android build has no published Play listing, and the iOS client has not
 * been submitted. The Wear OS status comes from the launch post in
 * lib/blog/posts.ts, which says physical-device testing and a Play listing are
 * still ahead.
 *
 * If any of these ship, update /downloads FIRST and copy it here — one place
 * to be wrong is better than two places that disagree.
 */
const DEVICES = [
  {
    name: "Web",
    state: "Live",
    tone: "live",
    note: "Use FurlPay in any modern browser today.",
  },
  {
    name: "Android",
    state: "In build",
    tone: "building",
    note: "A signed release build exists; the Play listing is not published yet.",
  },
  {
    name: "iOS",
    state: "In build",
    tone: "building",
    note: "The client builds on macOS CI and has not been submitted to the App Store.",
  },
  {
    name: "Wear OS",
    state: "In development",
    tone: "building",
    note: "A Kotlin companion app, validated on the Wear OS 5 emulator. Physical-device testing and a store listing are still ahead.",
  },
];

/**
 * Where FurlPay's work already reaches.
 *
 * These are markets the product itself addresses — the repository carries
 * dedicated UK, UAE and Japan surfaces, and settlement is in USDC, which has no
 * country. Listing them is a statement about REACH, not about offices: FurlPay
 * has no premises in any of them and this page does not imply otherwise.
 */
const MARKETS = [
  "United States",
  "United Kingdom",
  "United Arab Emirates",
  "Hong Kong",
  "Singapore",
  "Japan",
  "India",
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
            name: "Ashutosh Kumar Singh — Founder & CEO, FurlPay",
            mainEntity: {
              "@type": "Person",
              "@id": `${SITE}/#founder`,
              name: "Ashutosh Kumar Singh",
              jobTitle: "Founder & CEO, FurlPay",
              image: `${SITE}${PORTRAIT}`,
              url: URL,
              // Founder of FurlPay, employed by Skyhigh Security. Two separate
              // relationships, stated separately — collapsing them would make
              // one of the two claims false.
              worksFor: EXPERIENCE.map((e) => ({ "@type": "Organization", name: e.company })),
              email: `mailto:${EMAILS[0]}`,
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

          {/* The photograph, as supplied — no filter, no retouching. The circle
              is a compositional crop applied in CSS rather than a second file,
              so the full 500×500 source stays available for the social card. */}
          <figure className="founder-portrait">
            <div className="portrait-circle">
              <Image
                src={PORTRAIT_CIRCLE}
                alt="Ashutosh Kumar Singh, founder of FurlPay"
                width={400}
                height={400}
                priority
                sizes="300px"
              />
            </div>
            <figcaption>Ashutosh Kumar Singh · Founder &amp; CEO</figcaption>
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
              <b>Founder &amp; CEO, FurlPay</b> · Software Engineer at Skyhigh Security
            </p>
            <ul className="founder-experience">
              {EXPERIENCE.map((e) => (
                <li key={e.company}>
                  <span className="experience-company">{e.company}</span>
                  {e.title ? <span className="experience-title">{e.title}</span> : null}
                </li>
              ))}
            </ul>
            <p className="founder-contact">
              {EMAILS.map((address, i) => (
                <span key={address}>
                  {i > 0 ? <span aria-hidden="true"> · </span> : null}
                  <a href={`mailto:${address}`}>{address}</a>
                </span>
              ))}
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

        {/* The reason this page exists: to be a door, not a brochure. */}
        <section className="founders-section" aria-labelledby="contact-heading">
          <p className="section-eyebrow">Get in touch</p>
          <h2 className="section-title" id="contact-heading">
            Email him directly.
          </h2>
          <p className="section-sub">
            No contact form, no routing queue. FurlPay works with founders,
            engineering teams and payment companies internationally — write in English from
            wherever you are.
          </p>
          <ul className="credential-list" aria-label="Email addresses">
            {EMAILS.map((address) => (
              <li key={address}>
                <span aria-hidden="true" className="credential-mark">
                  @
                </span>
                <a className="contact-address" href={`mailto:${address}`}>
                  {address}
                </a>
                <span className="credential-issuer">
                  {address.startsWith("founder") ? "Founder" : "General"}
                </span>
              </li>
            ))}
          </ul>
          {/* Markets the PRODUCT reaches. Stated as reach, never as offices —
              FurlPay has premises in none of them. */}
          <p className="markets-label">FurlPay&apos;s work reaches</p>
          <ul className="markets-list">
            {MARKETS.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </section>

        {/* What FurlPay does — the product, not the founder.
            Replaces an FAQ that answered "who is the CEO"; a visitor who lands
            here should understand the product within a few seconds, and the
            founder is already the whole hero above. */}
        <section className="founders-section" aria-labelledby="product-heading">
          <p className="section-eyebrow">What FurlPay does</p>
          <h2 className="section-title" id="product-heading">
            One financial platform for payments, stablecoins, travel and your everyday wallet.
          </h2>
          <p className="section-sub">
            FurlPay brings payments, stablecoins, cards, travel and digital wallets into one
            financial platform — a simpler way for people and businesses to move, hold and spend
            money across the modern internet.
          </p>

          <div className="product-grid">
            {PRODUCTS.map((p) => {
              const body = (
                <>
                  <h3>{p.name}</h3>
                  <p>{p.body}</p>
                  <ul>
                    {p.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                  {p.href ? (
                    <span aria-hidden="true" className="product-more">
                      Learn more →
                    </span>
                  ) : null}
                </>
              );
              const className = `product-card${p.emphasis ? " is-featured" : ""}${
                p.href ? "" : " is-static"
              }`;
              // A card with nowhere public to go renders as a plain element, not
              // a dead link: it stays out of the tab order and offers no
              // affordance it cannot honour.
              return p.href ? (
                <Link className={className} href={p.href} key={p.name}>
                  {body}
                </Link>
              ) : (
                <div className={className} key={p.name}>
                  {body}
                </div>
              );
            })}
          </div>
        </section>

        {/* Devices. Deliberately NOT written as "available on Android, iOS and
            Wear OS" — /downloads says the Android build has no Play listing and
            the iOS client has not been submitted, and the Wear OS post says a
            store listing is still ahead. Claiming otherwise here would make the
            site contradict itself on the one page a sceptical reader checks. */}
        <section className="founders-section" aria-labelledby="devices-heading">
          <p className="section-eyebrow">Across your devices</p>
          <h2 className="section-title" id="devices-heading">
            Your wallet in your pocket — and on your wrist.
          </h2>
          <p className="section-sub">
            One account, one balance and the same spending controls wherever you open FurlPay. The
            web app is live today; the native clients are built and not yet in the app stores, and
            we would rather say so than show you a store badge that goes nowhere.
          </p>
          <ul className="device-list">
            {DEVICES.map((d) => (
              <li key={d.name}>
                <span className="device-name">{d.name}</span>
                <span className={`device-state device-state--${d.tone}`}>{d.state}</span>
                <span className="device-note">{d.note}</span>
              </li>
            ))}
          </ul>
          <div className="founders-links">
            <Link className="nav-link" href="/downloads">
              Get FurlPay <span aria-hidden="true">↗</span>
            </Link>
            <Link className="nav-link" href="/products">
              All products <span aria-hidden="true">↗</span>
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
