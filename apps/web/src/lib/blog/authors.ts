// Author profiles for E-E-A-T. Google's YMYL (financial) quality systems reward
// content attached to a real, credentialed person — not an anonymous byline.
// Posts reference an author by string; getAuthor() resolves it to a profile,
// synthesizing a sensible team default for names without an explicit entry.
//
// NOTE: review the founder profile below — swap in your public-facing name,
// personal LinkedIn, and a headshot at /authors/<slug>.jpg if you have one.

export type Author = {
  name: string;
  role: string;
  bio: string;
  credentials?: string; // short, e.g. "Security researcher · published CVEs"
  avatar?: string; // /public path; falls back to a monogram when absent
  url?: string; // primary profile URL (used as Person.url in schema)
  sameAs: string[]; // profile URLs for schema Person.sameAs
  isPerson: boolean; // true → schema.org/Person, false → Organization byline
};

// ---------------------------------------------------------------------------
// ONE PERSON ENTITY, EVERYWHERE.
//
// This record is the byline on every article, so it is also where Google forms
// its idea of who "Ashutosh Kumar Singh" is. Three things here were quietly
// working against that, and all three are the "data friction" that stops an
// entity resolving:
//
//   1. `url` pointed at GitHub. That made GITHUB the entity home for the
//      person — every article's Person node sent Google somewhere we do not
//      control and cannot mark up. It is now /our-founders, which exists to be
//      exactly that page.
//   2. `sameAs` listed the COMPANY accounts (x.com/furlpayglobal,
//      linkedin.com/company/furlpay) on a PERSON node — an explicit assertion
//      that the man and the company are the same entity. They are now his
//      personal profiles, which is what `sameAs` is for.
//   3. `role` said "Software Engineer at Skyhigh Security · Building Furlpay"
//      while /our-founders says "Founder & CEO, FurlPay". A site that gives two
//      job titles for one person is a site Google waits on.
// ---------------------------------------------------------------------------

const FOUNDER: Author = {
  name: "Ashutosh Kumar Singh",
  role: "Founder & CEO, FurlPay · Software Engineer at Skyhigh Security",
  credentials: "NeurIPS 2026 author · Google DeepMind contributor · ex-Quantiphi",
  bio: "Ashutosh is a Software Engineer at Skyhigh Security (previously Quantiphi), working across ML systems and cloud infrastructure. He is a contributor to Google DeepMind and a NeurIPS 2026 author. He is building Furlpay: stablecoin payments, travel booking, and investing in one client — settled on Arbitrum. Pay in USDC, book 2.2M+ stays and flights, and let AI agents pay per-request via x402. Phishing-resistant. Compliance-aware. Zero gas.",
  // The entity home: the one page on this site that answers "who is this?".
  url: "https://furlpay.com/our-founders",
  avatar: "/team/ashutosh-kumar-singh.jpg",
  sameAs: [
    "https://www.linkedin.com/in/ashutosh-kumar-singh951/",
    "https://x.com/0xAshutosh",
    "https://github.com/Ashutosh0x",
    "https://instagram.com/ashutosh0x",
  ],
  isPerson: true,
};

// Explicit profiles keyed by the exact `author` string used in posts.ts.
const REGISTRY: Record<string, Author> = {
  "Ashutosh Kumar Singh": FOUNDER,
  // Re-point the flagship byline to the founder for E-E-A-T on money pages.
  "Furlpay Team": FOUNDER,
};

// Team/department bylines that should read as an authored group, not a person.
function teamAuthor(name: string): Author {
  return {
    name,
    role: "Furlpay",
    bio: "Written by the Furlpay team — engineers and compliance specialists building an on-chain financial operating system for stablecoin payments, travel, and investing on Arbitrum.",
    sameAs: [
      "https://furlpay.com",
      "https://github.com/Ashutosh0x/furlpay",
      "https://x.com/furlpayglobal",
    ],
    isPerson: false,
  };
}

export function getAuthor(name: string): Author {
  return REGISTRY[name] ?? teamAuthor(name);
}

// ---------------------------------------------------------------------------
// Author pages.
//
// A byline that is only a string is invisible to a search engine: there is no
// URL to attach a Person entity to, so the credentials above never accumulate
// into an authority signal. Giving each author a real page — with their posts,
// their profiles, and a Person node with sameAs — is what turns a name into an
// entity Google and AI answer engines can resolve.
//
// Slugs are derived, not stored, so a byline can never point at a page that
// does not exist: every author reachable through getAuthor() has a page.
// ---------------------------------------------------------------------------

/** URL-safe slug for an author name. Stable: derived from the name alone. */
export function authorSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Every distinct byline that appears on a post, as {name, slug}. */
export function allAuthorNames(bylines: readonly string[]): { name: string; slug: string }[] {
  const seen = new Map<string, string>();
  for (const b of bylines) {
    const slug = authorSlug(b);
    // First writer wins so the canonical spelling of a name is the one used.
    if (!seen.has(slug)) seen.set(slug, b);
  }
  return [...seen].map(([slug, name]) => ({ name, slug }));
}

/** Resolve a slug back to the byline string, or null when nothing matches. */
export function authorBySlug(bylines: readonly string[], slug: string): string | null {
  return bylines.find((b) => authorSlug(b) === slug) ?? null;
}
