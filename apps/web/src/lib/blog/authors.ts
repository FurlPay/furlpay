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

const FOUNDER: Author = {
  name: "Ashutosh Kumar Singh",
  role: "Software Engineer at Skyhigh Security",
  credentials: "Contributor at Google DeepMind",
  bio: "Ashutosh is a Software Engineer at Skyhigh Security and a contributor at Google DeepMind. He builds Furlpay's payment rails, wallet security (2-of-2 MPC and WebAuthn passkeys), and the x402 agentic-payment infrastructure. He writes here about stablecoin payments, Arbitrum, and the security of on-chain money.",
  url: "https://github.com/Ashutosh0x",
  sameAs: [
    "https://github.com/Ashutosh0x",
    "https://x.com/furlpay",
    "https://linkedin.com/company/furlpay",
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
      "https://x.com/furlpay",
    ],
    isPerson: false,
  };
}

export function getAuthor(name: string): Author {
  return REGISTRY[name] ?? teamAuthor(name);
}
