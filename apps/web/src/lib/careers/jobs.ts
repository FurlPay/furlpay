// ---------------------------------------------------------------------------
// Self-hosted job board — no third-party ATS. One typed record per role drives
// the /careers index, the per-role page, its Google JobPosting JSON-LD and the
// sitemap. Google ranks self-hosted pages identically to ATS-powered ones; all
// that matters is valid structured data on a crawlable URL.
//
// HONESTY RULE: JobPosting JSON-LD is emitted ONLY for status "open" roles.
// Publishing schema for roles we are not actually hiring is a bait listing —
// Google penalizes it and candidates remember it. "upcoming" roles render a
// public page + pipeline form but stay out of Google for Jobs until flipped.
// To open a role: set status "open", datePosted (today) and validThrough
// (~60 days out); expired/closed roles must be flipped back within 24h.
// ---------------------------------------------------------------------------

export type JobStatus = "open" | "upcoming" | "closed";

export interface Job {
  slug: string;
  title: string;
  team: "Engineering" | "Security" | "Growth" | "Product" | "Legal";
  location: string;
  /** schema.org jobLocationType — all Furlpay roles are remote. */
  locationType: "TELECOMMUTE";
  employmentType: "FULL_TIME" | "CONTRACTOR";
  salaryMinUsd: number;
  salaryMaxUsd: number;
  /** e.g. "0.5–1.5%" — shown on the page; not part of JobPosting schema. */
  equityBand: string;
  status: JobStatus;
  /** Required when status is "open" (ISO dates). */
  datePosted?: string;
  validThrough?: string;
  summary: string;
  responsibilities: string[];
  requirements: string[];
  niceToHave: string[];
}

export const JOBS: Job[] = [
  {
    slug: "senior-full-stack-engineer",
    title: "Senior Full-Stack Engineer",
    team: "Engineering",
    location: "Remote (Global)",
    locationType: "TELECOMMUTE",
    employmentType: "FULL_TIME",
    salaryMinUsd: 120_000,
    salaryMaxUsd: 170_000,
    equityBand: "0.5–1.5%",
    status: "upcoming",
    summary:
      "Own product surface end to end — from the Next.js client through the payment APIs to the on-chain settlement layer. You will be one of the first engineers on a codebase that already ships payments, travel booking and investing in one client.",
    responsibilities: [
      "Ship full features across the Next.js app, API routes and the TypeScript SDKs.",
      "Extend the x402 payment flows — 402 responses, EIP-3009 authorizations, settlement verification.",
      "Harden production paths: rate limiting, idempotent webhooks, session security, audit trails.",
      "Review PRs and set the engineering bar for everyone hired after you.",
    ],
    requirements: [
      "5+ years building production web applications, with deep TypeScript and React experience.",
      "You have owned systems that move money, or equivalently unforgiving domains.",
      "Comfortable reading Solidity even if you do not write it daily.",
      "Strong async written communication — we work remote-first across time zones.",
    ],
    niceToHave: [
      "Experience with ERC-4337 account abstraction or WebAuthn/passkeys.",
      "Open-source track record — a merged PR into our repos fast-tracks you to the final round.",
    ],
  },
  {
    slug: "solana-rust-engineer",
    title: "Solana / Rust Engineer",
    team: "Engineering",
    location: "Remote (Global)",
    locationType: "TELECOMMUTE",
    employmentType: "FULL_TIME",
    salaryMinUsd: 130_000,
    salaryMaxUsd: 180_000,
    equityBand: "0.5–1.5%",
    status: "upcoming",
    summary:
      "Build the Solana leg of Furlpay's x402 facilitator — verify and settle agent payments at scale on the chain where most x402 volume lives today.",
    responsibilities: [
      "Design and ship Solana programs for x402 settlement, escrow and booking receipts.",
      "Build the Rust services that verify payment authorizations at high throughput.",
      "Own cross-chain routing between Solana and Arbitrum (CCTP).",
    ],
    requirements: [
      "3+ years of Rust, with at least one production Solana program shipped.",
      "You can explain rent, CPI, PDAs and versioned transactions without notes.",
      "Security-first mindset — you write the attack before you write the fix.",
    ],
    niceToHave: ["Anchor and program-audit experience.", "Familiarity with the x402 or AP2 specs."],
  },
  {
    slug: "security-engineer",
    title: "Security Engineer",
    team: "Security",
    location: "Remote (Global)",
    locationType: "TELECOMMUTE",
    employmentType: "FULL_TIME",
    salaryMinUsd: 130_000,
    salaryMaxUsd: 180_000,
    equityBand: "0.5–1.5%",
    status: "upcoming",
    summary:
      "Own the security posture of a payments company: smart-contract review, key management (2-of-2 MPC with passkey-bound shares), API hardening and incident response.",
    responsibilities: [
      "Audit and threat-model the settlement contracts before external audits do.",
      "Own the MPC custody architecture and the WebAuthn ceremony end to end.",
      "Build the abuse pipeline: rate limits, anomaly detection, scam-pattern ML.",
      "Run responsible disclosure and write the post-mortems we publish.",
    ],
    requirements: [
      "4+ years in security engineering, with real findings you can talk about (CVEs, audit reports, bounties).",
      "Deep familiarity with EVM attack classes: reentrancy, signature replay, approval phishing.",
      "You have operated production incident response, not just tabletops.",
    ],
    niceToHave: ["Published security research.", "Experience with HSMs or MPC libraries."],
  },
  {
    slug: "developer-relations",
    title: "Developer Relations",
    team: "Growth",
    location: "Remote (US / EU / India)",
    locationType: "TELECOMMUTE",
    employmentType: "FULL_TIME",
    salaryMinUsd: 90_000,
    salaryMaxUsd: 140_000,
    equityBand: "0.3–0.8%",
    status: "upcoming",
    summary:
      "Make Furlpay the default answer to 'how do I let my agent pay for things?'. You own the SDKs' developer experience, the docs, the examples and the community that forms around them.",
    responsibilities: [
      "Own the quickstarts for every agent framework — Vercel AI SDK, LangChain, MCP, OpenAI Agents.",
      "Ship example agents that book real travel with x402 and write up how they work.",
      "Run the Discord, triage GitHub issues, and turn recurring questions into docs.",
    ],
    requirements: [
      "You write working code and clear prose — links to both required.",
      "2+ years in DevRel, developer tooling or as an engineer who writes in public.",
    ],
    niceToHave: ["An audience among AI-agent or web3 developers.", "Conference speaking experience."],
  },
  {
    slug: "compliance-generalist",
    title: "Compliance Generalist",
    team: "Legal",
    location: "Remote (US / EU / India)",
    locationType: "TELECOMMUTE",
    employmentType: "FULL_TIME",
    salaryMinUsd: 80_000,
    salaryMaxUsd: 130_000,
    equityBand: "0.2–0.6%",
    status: "upcoming",
    summary:
      "Turn the regulatory map — GENIUS Act, MiCA, FCA e-money, VARA, Japan's EPI regime — into product requirements, and keep our compliance-as-code honest as we enter each corridor.",
    responsibilities: [
      "Own jurisdiction analysis for each market we enter and the licensing roadmap.",
      "Translate Travel Rule, KYC-tiering and sanctions requirements into specs engineers can build.",
      "Run our AML program and vendor relationships (KYC, sanctions screening).",
    ],
    requirements: [
      "3+ years in fintech/crypto compliance with at least one jurisdiction owned end to end.",
      "You read regulations in the original and summarize them without losing the teeth.",
    ],
    niceToHave: ["Experience with stablecoin issuers or VASPs.", "A law degree is useful, not required."],
  },
  {
    slug: "product-designer",
    title: "Product Designer",
    team: "Product",
    location: "Remote (Global)",
    locationType: "TELECOMMUTE",
    employmentType: "FULL_TIME",
    salaryMinUsd: 100_000,
    salaryMaxUsd: 150_000,
    equityBand: "0.3–1%",
    status: "upcoming",
    summary:
      "Make paying with a passkey feel more trustworthy than paying with a card. You own the design system across payments, travel and investing — one client, three domains, zero seams.",
    responsibilities: [
      "Own the end-to-end checkout, onboarding and travel booking flows.",
      "Evolve the design system (dark-first, OLED-friendly) without a redesign-for-its-own-sake.",
      "Prototype with real data and ship alongside engineers — no handoff wall.",
    ],
    requirements: [
      "4+ years designing consumer product, with shipped fintech or crypto work in your portfolio.",
      "You design in systems and can defend every divergence from one.",
    ],
    niceToHave: ["You prototype in code.", "Motion design for transaction states."],
  },
  {
    slug: "technical-writer",
    title: "Technical Writer",
    team: "Product",
    location: "Remote · Contract",
    locationType: "TELECOMMUTE",
    employmentType: "CONTRACTOR",
    salaryMinUsd: 60_000,
    salaryMaxUsd: 90_000,
    equityBand: "0.05–0.2%",
    status: "upcoming",
    summary:
      "Own the docs that developers actually read: API reference, integration guides, and the x402 explainers that AI search engines cite as authoritative.",
    responsibilities: [
      "Rewrite the API reference from the OpenAPI spec up — every endpoint, every error.",
      "Own /docs information architecture and keep quickstarts runnable in CI.",
    ],
    requirements: [
      "You have written developer docs that shipped, and you test every code sample you publish.",
      "Comfortable in TypeScript and cURL; you read code to document it, not screenshots.",
    ],
    niceToHave: ["Experience documenting payments or blockchain APIs."],
  },
  {
    slug: "community-manager",
    title: "Community Manager",
    team: "Growth",
    location: "Remote (Global)",
    locationType: "TELECOMMUTE",
    employmentType: "FULL_TIME",
    salaryMinUsd: 60_000,
    salaryMaxUsd: 100_000,
    equityBand: "0.1–0.4%",
    status: "upcoming",
    summary:
      "Build the builder community around Furlpay — Discord, hackathons, the ambassador program — with the professional voice of a payments company, not a memecoin.",
    responsibilities: [
      "Own Discord programming: office hours, build challenges, showcase channels.",
      "Run hackathon logistics end to end, including judging pipelines.",
      "Surface community signal to product weekly — what devs hit, what they want.",
    ],
    requirements: [
      "2+ years growing developer or crypto communities you can point at.",
      "Professional written voice — our brand does not do hype.",
    ],
    niceToHave: ["You have shipped something yourself; builders trust builders."],
  },
];

export function getJob(slug: string): Job | undefined {
  return JOBS.find((j) => j.slug === slug);
}

export function visibleJobs(): Job[] {
  return JOBS.filter((j) => j.status !== "closed");
}

export function openJobs(): Job[] {
  return JOBS.filter((j) => j.status === "open");
}

/** schema.org JobPosting for an OPEN role — callers must gate on status. */
export function jobPostingJsonLd(job: Job) {
  return {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: job.title,
    description: `<p>${job.summary}</p><p><strong>Responsibilities</strong></p><ul>${job.responsibilities
      .map((r) => `<li>${r}</li>`)
      .join("")}</ul><p><strong>Requirements</strong></p><ul>${job.requirements
      .map((r) => `<li>${r}</li>`)
      .join("")}</ul>`,
    identifier: { "@type": "PropertyValue", name: "Furlpay", value: `FP-${job.slug}` },
    datePosted: job.datePosted,
    validThrough: job.validThrough,
    employmentType: job.employmentType,
    hiringOrganization: {
      "@type": "Organization",
      name: "Furlpay",
      sameAs: "https://furlpay.com",
      logo: "https://furlpay.com/icon.png",
    },
    jobLocation: {
      "@type": "Place",
      address: { "@type": "PostalAddress", addressLocality: "Remote", addressCountry: "US" },
    },
    jobLocationType: job.locationType,
    baseSalary: {
      "@type": "MonetaryAmount",
      currency: "USD",
      value: {
        "@type": "QuantitativeValue",
        minValue: job.salaryMinUsd,
        maxValue: job.salaryMaxUsd,
        unitText: "YEAR",
      },
    },
    directApply: true,
  };
}
