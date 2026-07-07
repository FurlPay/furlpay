// ---------------------------------------------------------------------------
// config.ts — Central configuration for the LinkedIn Scout tool.
// Tune delays, limits, and search parameters here.
// ---------------------------------------------------------------------------

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");

/** Where scraped lead data is persisted (JSON + CSV). */
export const DATA_DIR = path.join(ROOT, "data");

/** Path to the exported LinkedIn session cookies file. */
export const COOKIES_PATH = path.join(ROOT, "cookies.json");

// ---------------------------------------------------------------------------
// Safety limits — keep these conservative to avoid LinkedIn detection.
// LinkedIn monitors for fixed-interval, high-frequency bot patterns.
// ---------------------------------------------------------------------------

/** Max profiles to scrape per run (single session). */
export const MAX_LEADS_PER_RUN = 50;

/** Min delay between page navigations (ms). */
export const MIN_DELAY_MS = 3_000;

/** Max delay between page navigations (ms). */
export const MAX_DELAY_MS = 7_000;

/** Delay after initial page load to let JS render (ms). */
export const PAGE_SETTLE_MS = 4_000;

/** Max pages to paginate through in a single search. */
export const MAX_SEARCH_PAGES = 5;

/** Connection request limit per day (LinkedIn's safe ceiling is ~20-30). */
export const MAX_CONNECTIONS_PER_DAY = 20;

// ---------------------------------------------------------------------------
// Default search queries — modify these to match your ICP.
// ---------------------------------------------------------------------------

export const SEARCH_QUERIES = {
  /** Segment A: AI Agent & API Providers (x402 targets). */
  segmentA: {
    label: "AI Agent CTOs",
    url: "https://www.linkedin.com/search/results/people/?keywords=AI%20agent%20CTO&origin=GLOBAL_SEARCH_HEADER",
  },
  /** Segment B: Cross-Border SaaS / Marketplace Founders. */
  segmentB: {
    label: "Cross-Border SaaS Founders",
    url: "https://www.linkedin.com/search/results/people/?keywords=cross-border%20payments%20founder&origin=GLOBAL_SEARCH_HEADER",
  },
  /** Segment C: Stablecoin / Web3 Finance decision-makers. */
  segmentC: {
    label: "Stablecoin Finance Leaders",
    url: "https://www.linkedin.com/search/results/people/?keywords=stablecoin%20CFO%20fintech&origin=GLOBAL_SEARCH_HEADER",
  },
} as const;

export type SegmentKey = keyof typeof SEARCH_QUERIES;
