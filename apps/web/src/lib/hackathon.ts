// ---------------------------------------------------------------------------
// FurlPay Build Challenge — hackathon submissions.
//
// Public submission surface: builders submit a project (idea or working build)
// against a track. Mock-first, matching the repo convention — an in-memory
// store that runs with zero credentials (production: Postgres). The public
// gallery reads a sanitized view (no emails); the API stores the full record
// and emails the team on each submission.
// ---------------------------------------------------------------------------

import { randomUUID } from "crypto";

export type TrackId = "agentic" | "consumer" | "infra" | "wildcard";

export interface Track {
  id: TrackId;
  label: string;
  blurb: string;
}

export const TRACKS: Track[] = [
  { id: "agentic", label: "Best Agentic", blurb: "AI agents that discover, negotiate and pay for things autonomously via x402." },
  { id: "consumer", label: "Best Consumer", blurb: "Delightful travel, payments or investing experiences built on FurlPay rails." },
  { id: "infra", label: "Best Infra", blurb: "SDKs, x402 middleware, facilitators, dev tooling — the plumbing others build on." },
  { id: "wildcard", label: "Wildcard", blurb: "Anything stablecoin- or Arbitrum-native that surprises us. Go weird." },
];

export function isTrack(v: unknown): v is TrackId {
  return typeof v === "string" && TRACKS.some((t) => t.id === v);
}

export function trackLabel(id: string): string {
  return TRACKS.find((t) => t.id === id)?.label ?? "Wildcard";
}

// Non-attributed idea prompts — inspiration, not fake submissions.
export const IDEAS: string[] = [
  "An AI travel agent that books a hotel end-to-end: searches, hits a 402, signs, settles USDC, gets a receipt.",
  "An x402-metered API (weather, data, inference) that prices per call through the FurlPay facilitator.",
  "A one-tag stablecoin checkout widget any merchant can drop into a page.",
  "A corporate travel bot that settles team expenses in USDC with spend limits.",
  "An on-chain settlement explorer that visualizes x402 payments in real time.",
  "A cross-border creator-payout bot: one click, many wallets, one USDC ledger.",
];

export interface Submission {
  id: string;
  projectName: string;
  teamName: string;
  email: string; // private — never returned by the public API
  track: TrackId;
  oneLiner: string;
  description: string;
  repoUrl?: string;
  demoUrl?: string;
  chain?: string;
  featured?: boolean;
  at: string; // ISO timestamp
}

// Public shape — the gallery never sees contact emails.
export type PublicSubmission = Omit<Submission, "email">;

const g = globalThis as unknown as { __hackathon?: Submission[] };
const store: Submission[] = g.__hackathon ?? (g.__hackathon = []);

export function addSubmission(s: Omit<Submission, "id" | "at">): Submission {
  const entry: Submission = {
    ...s,
    id: `sub_${randomUUID()}`,
    at: new Date().toISOString(),
  };
  store.unshift(entry);
  if (store.length > 1000) store.length = 1000;
  return entry;
}

export function listSubmissions(track?: TrackId): PublicSubmission[] {
  const rows = track ? store.filter((s) => s.track === track) : store;
  // Featured first, then newest. Explicitly project to the public shape so the
  // contact email is never included (no destructure-omit / lint-disable dance).
  return rows
    .slice()
    .sort((a, b) => (Number(b.featured ?? false) - Number(a.featured ?? false)) || (a.at < b.at ? 1 : -1))
    .map((s) => ({
      id: s.id,
      projectName: s.projectName,
      teamName: s.teamName,
      track: s.track,
      oneLiner: s.oneLiner,
      description: s.description,
      repoUrl: s.repoUrl,
      demoUrl: s.demoUrl,
      chain: s.chain,
      featured: s.featured,
      at: s.at,
    }));
}

export function submissionCount(): number {
  return store.length;
}
