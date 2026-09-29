// ---------------------------------------------------------------------------
// FurlPay editorial content — webinars and research reports.
//
// ── THE PUBLISHING RULE ────────────────────────────────────────────────────
//
// `status` gates visibility, and "draft" content is NEVER rendered publicly.
// Accessors filter it out; the public pages call only the filtered accessors.
//
// This exists because the platform shipped before the content did. FurlPay has
// not published a webinar or a research report yet, and inventing one — a
// speaker who did not speak, a statistic nobody measured, a "2026 State of
// Stablecoins" nobody wrote — would put a false claim on the company's own
// research portal. The few records in data.ts are DRAFT fixtures that exercise
// the UI and the tests; the site renders empty states until someone publishes
// something real.
//
// ── CROSS-LINKING IS BY SLUG ───────────────────────────────────────────────
//
// A report names related webinars and vice versa, by slug. Resolution drops
// anything unpublished or missing, so a draft can reference a draft without
// leaking it, and deleting an item cannot produce a dead link.
// ---------------------------------------------------------------------------

/** Draft is invisible to the public site. Nothing else is. */
export type PublishStatus = "draft" | "published";

/** Shared taxonomy so a reader filtering "Stablecoins" sees both content types. */
export const CONTENT_CATEGORIES = [
  "Stablecoins",
  "Payments",
  "Banking",
  "Markets",
  "Web3",
  "Developers",
  "AI & Agents",
  "Security",
  "Regulation",
  "Emerging Markets",
  "FurlPay Product",
] as const;

export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

export interface Speaker {
  /** Stable id so a speaker can front several sessions without duplication. */
  id: string;
  name: string;
  title: string;
  company: string;
  bio?: string;
  /** Path under /public. Omitted renders initials rather than a broken image. */
  photo?: string;
  /** Absolute https URL. */
  link?: string;
}

// ── Webinars ───────────────────────────────────────────────────────────────

/**
 * Where a session sits in time.
 *
 * Stored rather than derived — unlike events, whose status comes from dates.
 * A webinar's recording does not appear the moment the session ends: it is cut
 * and published hours or days later, so "the date has passed" does not imply
 * "watchable". Deriving it would promise a video that does not exist yet.
 */
export type WebinarStatus = "upcoming" | "live" | "on-demand";

export interface Webinar {
  slug: string;
  status: PublishStatus;
  sessionStatus: WebinarStatus;
  title: string;
  description: string;
  category: ContentCategory;
  tags?: string[];
  /** ISO-8601 with offset. Absent for an on-demand item with no fixed date. */
  startsAt?: string;
  /** Human-readable, e.g. "45 min". */
  duration?: string;
  /** 16:9 image under /public. */
  thumbnail?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  speakers: Speaker[];
  topics?: string[];
  agenda?: { time?: string; item: string }[];
  /** Third-party registration page, when one exists. */
  registrationUrl?: string;
  /** Recording. Absent means "no video" — the page says so, never a dead player. */
  videoUrl?: string;
  relatedReports?: string[];
  relatedWebinars?: string[];
  featured?: boolean;
}

// ── Reports ────────────────────────────────────────────────────────────────

/** A block of structured report body. Not an HTML blob — see data.ts. */
export type ReportBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[]; ordered?: boolean }
  | { kind: "quote"; text: string; attribution?: string }
  | { kind: "callout"; title?: string; text: string }
  | { kind: "table"; columns: string[]; rows: string[][]; caption?: string };

export interface KeyFinding {
  title: string;
  detail: string;
}

export interface Citation {
  /** Shown as the source line. */
  label: string;
  url?: string;
}

export interface Report {
  slug: string;
  status: PublishStatus;
  title: string;
  subtitle?: string;
  description: string;
  category: ContentCategory;
  tags?: string[];
  /** ISO-8601 date. */
  publishedAt: string;
  updatedAt?: string;
  /** Portrait cover under /public (3:4). */
  coverImage?: string;
  coverWidth?: number;
  coverHeight?: number;
  /** Named team or person. Never invented. */
  authors?: string[];
  readingTime?: string;
  pageCount?: number;
  /**
   * Path under /public to a real PDF, or absent.
   *
   * Absent means the report is read online and the UI says "Read online" — it
   * never renders a Download button pointing at a file that does not exist.
   * See lib/content/pdf.ts for how a path is validated before it is served.
   */
  pdfPath?: string;
  /** True when the PDF requires the lead-capture form before download. */
  gated?: boolean;
  executiveSummary?: string;
  keyFindings?: KeyFinding[];
  body?: ReportBlock[];
  methodology?: string;
  sources?: Citation[];
  relatedReports?: string[];
  relatedWebinars?: string[];
  featured?: boolean;
}

export type ContentType = "report" | "webinar";

/** The shape both cards and search results share. */
export interface ContentSummary {
  type: ContentType;
  slug: string;
  title: string;
  description: string;
  category: ContentCategory;
  href: string;
  image?: string;
  date?: string;
  badge?: string;
}
