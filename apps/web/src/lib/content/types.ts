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

/**
 * Editorial workflow. Only `published` — and `scheduled` once its publishedAt
 * has passed — is visible on the public site; everything else is a 404.
 *
 *   draft → review → approved → scheduled | published → archived
 *
 * `scheduled` exists for an ALREADY-APPROVED report waiting for its date. A
 * cadence ("monthly") never moves a report forward on its own: a date
 * arriving is not editorial approval.
 */
export type PublishStatus = "draft" | "review" | "approved" | "scheduled" | "published" | "archived";

/** The single definition of "a reader may see this", shared by every listing and page. */
export function isPubliclyVisible(item: { status: PublishStatus; publishedAt?: string; startsAt?: string }, now = Date.now()): boolean {
  if (item.status === "published") return true;
  if (item.status === "scheduled") {
    const at = Date.parse(item.publishedAt ?? item.startsAt ?? "");
    return Number.isFinite(at) && at <= now;
  }
  return false;
}

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
  /** Numbers into `sources` (the report's own bracketed references). */
  refs?: number[];
}

/**
 * Source-type label, as defined in the report's evidence grading. Shown next
 * to a figure so a reader can tell a regulator's number from an estimate.
 */
export type EvidenceLabel = "primary" | "independent" | "secondary" | "company-claim" | "estimate" | "law";

export const EVIDENCE_LABEL_TEXT: Record<EvidenceLabel, string> = {
  primary: "Primary",
  independent: "Independent",
  secondary: "Secondary",
  "company-claim": "Company claim",
  estimate: "Estimate / model",
  law: "Law",
};

export interface Citation {
  /** Shown as the source line. */
  label: string;
  /** Only when the source document gives one. Never reconstructed. */
  url?: string;
  /** The report's bracketed reference number, when it has one. */
  ref?: number;
}

/** A headline figure with what it measures and how strong the evidence is. */
export interface ReportMetric {
  label: string;
  value: string;
  /** Period, definition and scope — what the number actually counts. */
  context: string;
  evidence: EvidenceLabel;
  refs?: number[];
}

/** The six standing research desks. */
export const RESEARCH_DESKS = [
  { slug: "stablecoin-markets", title: "Stablecoin Market Intelligence", blurb: "Supply, issuers, reserves, chains, and the gap between on-chain volume and real payments." },
  { slug: "security", title: "Blockchain & Financial Security", blurb: "Incidents, depegs, custody and wallet risk — confirmed facts kept apart from allegations." },
  { slug: "payments-infrastructure", title: "Payments & Fintech Infrastructure", blurb: "Card networks, settlement, cross-border economics, merchant and treasury adoption." },
  { slug: "regulation", title: "Regulation & Compliance", blurb: "Enacted law, final rules, consultations and guidance — by jurisdiction, with as-of dates." },
  { slug: "networks", title: "Networks & Developer Infrastructure", blurb: "Chains, x402 and agent payments, settlement latency, fees and developer tooling." },
  { slug: "market-intelligence", title: "Market & Competitive Intelligence", blurb: "Launches, partnerships, pricing and market structure relevant to stablecoin payments." },
] as const;
export type ResearchDesk = (typeof RESEARCH_DESKS)[number]["slug"];

/** Publishing cadence. A cadence is a schedule, never permission to publish. */
export const CADENCES = {
  weekly: "Weekly brief",
  monthly: "Monthly report",
  quarterly: "Quarterly review",
  annual: "Annual report",
  brief: "Research brief",
  dataset: "Dataset",
} as const;
export type Cadence = keyof typeof CADENCES;

/** A correction or material revision, shown on the report page. */
export interface Revision {
  date: string;
  version: string;
  note: string;
}

/**
 * A PDF held in PRIVATE storage. Never served from /public and never linked
 * directly: delivery is a verified, short-lived grant that resolves to a
 * signed URL (lib/research/storage.ts).
 */
export interface PrivatePdf {
  /** Object key inside the private research bucket. */
  objectKey: string;
  bytes: number;
  /** sha256 of the exact file uploaded, so a swapped file is detectable. */
  sha256: string;
  version: string;
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

  // ── Research programme fields (optional: older records predate them) ──
  desk?: ResearchDesk;
  cadence?: Cadence;
  /** What the data covers, e.g. "January 2025 – 2 October 2026". */
  reportingPeriod?: string;
  version?: string;
  revisions?: Revision[];
  /** Headline figures, each with its context and evidence label. */
  metrics?: ReportMetric[];
  /** Full PDF in private storage, delivered only through email verification. */
  privatePdf?: PrivatePdf;
  /** Plain-language disclaimer shown with the report. */
  disclaimer?: string;
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
