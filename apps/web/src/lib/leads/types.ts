import { z } from "zod";

// ---------------------------------------------------------------------------
// Leads and content interactions.
//
// ── THIS IS NOT REVENUE DATA ───────────────────────────────────────────────
//
// Deliberately a separate domain from lib/revenue, in separate tables, read by
// a separate ops endpoint. A downloaded report is INTEREST, not income, and the
// moment the two share a table someone will sum a column and report a pipeline
// number as revenue. They stay apart until there is a real, verified
// attribution mechanism — and even then the link is a join, not a merge.
//
// ── ONE PERSON, MANY INTERACTIONS ──────────────────────────────────────────
//
//   Lead  1 ──── n  ContentInteraction
//
// Someone who downloads three reports is ONE lead with three interactions, not
// three contacts. Dedup is on the normalised email, reusing the same
// normalisation the newsletter already uses so the two systems agree on what
// "the same address" means.
//
// ── CONSENT IS TWO SEPARATE DECISIONS ──────────────────────────────────────
//
// Handing over an email to receive a report is not permission to market to
// that person. The form records them separately:
//
//   consent          — required. Acknowledges the transaction itself.
//   marketingConsent — optional, defaults FALSE, and is the ONLY thing that
//                      authorises a non-transactional email.
//
// Nothing here ever defaults marketingConsent to true, and there is no code
// path that infers it from the presence of the other.
//
// ── MINIMAL COLLECTION ─────────────────────────────────────────────────────
//
// Only fields with a stated purpose. No IP-based geolocation, no tracking
// pixels, no browser fingerprint, no referrer chain. The consent IP is kept
// because that is the GDPR record of the consent itself (same as the
// newsletter), and nothing else about the request is stored.
// ---------------------------------------------------------------------------

export const LEAD_SOURCES = [
  "report_download",
  "webinar_registration",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const INTERACTION_TYPES = [
  "report_download",
  "webinar_registration",
] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

export const INTEREST_OPTIONS = [
  "Stablecoin payments",
  "Global banking",
  "Cards",
  "Treasury",
  "Developer APIs",
  "Web3 infrastructure",
  "Investment",
  "Partnerships",
  "Enterprise",
  "Other",
] as const;

/**
 * Whether an address looks like a work address.
 *
 * ── LIMITATIONS, STATED ────────────────────────────────────────────────────
 *
 * This is a DOMAIN check against a list of well-known consumer mailbox
 * providers. That is all it can be. It does not verify employment, it does not
 * verify the domain belongs to the company typed into the form, and a founder
 * running their company from a Gmail address is misclassified by design.
 *
 * It is an internal segmentation hint and nothing else:
 *   - no address is ever REJECTED for being consumer,
 *   - the original address is always stored unchanged,
 *   - nothing downstream gates on it.
 *
 * Anything stronger (MX lookups, provider APIs) would be a guess with a
 * network dependency attached, which is worse than a hint that is honest about
 * being a hint.
 */
const CONSUMER_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.co.in",
  "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com",
  "gmx.com", "gmx.de", "mail.com", "zoho.com", "yandex.com", "qq.com",
  "163.com", "126.com", "naver.com", "rediffmail.com",
]);

export type EmailType = "business" | "consumer" | "unknown";

export function classifyEmail(email: string): EmailType {
  const at = email.lastIndexOf("@");
  if (at < 0) return "unknown";
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain || !domain.includes(".")) return "unknown";
  return CONSUMER_DOMAINS.has(domain) ? "consumer" : "business";
}

// ── Records ────────────────────────────────────────────────────────────────

export interface Lead {
  /** Normalised email — the identity. */
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  jobTitle: string;
  country: string;
  phone?: string;
  interests?: string[];
  /** Segmentation hint only. See classifyEmail. */
  emailType: EmailType;
  /** Where we first met them. */
  firstSource: LeadSource;
  /** Required consent for the transaction. Always true if a record exists. */
  consent: true;
  consentAt: string;
  consentVersion: string;
  /** The GDPR record of where consent came from. */
  consentIp: string;
  /** Explicit marketing opt-in. Defaults false and is never inferred. */
  marketingConsent: boolean;
  marketingConsentAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentInteraction {
  id: string;
  /** Normalised email of the lead. */
  leadEmail: string;
  eventType: InteractionType;
  contentType: "report" | "webinar";
  /** The slug. Never a database id. */
  contentId: string;
  createdAt: string;
}

/** Bumped whenever the consent wording changes, so old records stay auditable. */
export const CONSENT_VERSION = "2026-09-27";

// ── Validation ─────────────────────────────────────────────────────────────

/**
 * Deliberately strict on shape, generous on content.
 *
 * Free-text fields are length-capped (a form post is untrusted input and these
 * strings reach an admin CSV), but nothing is rejected for looking "wrong" —
 * names, companies and job titles vary far more than any pattern allows, and a
 * validator that rejects a real person's name to feel rigorous is a bug.
 */
const text = (max: number) => z.string().trim().min(1).max(max);

export const leadCaptureSchema = z.object({
  firstName: text(80),
  lastName: text(80),
  // Zod's email check plus a length cap. No MX lookup: a network round-trip in
  // a form handler is a latency and availability problem, not a validation one.
  email: z.string().trim().toLowerCase().email().max(254),
  company: text(120),
  jobTitle: text(120),
  country: text(80),
  phone: z.string().trim().max(40).optional(),
  interests: z.array(z.string().trim().max(60)).max(10).optional(),
  /** Must be true — the form cannot be submitted without it. */
  consent: z.literal(true),
  /** Absent means NO. Never defaulted to true. */
  marketingConsent: z.boolean().optional(),
});

export type LeadCaptureInput = z.infer<typeof leadCaptureSchema>;

/**
 * Report downloads ask for an email and nothing else. The profile fields a
 * webinar registration collects are optional here, and an update never blanks
 * ones an earlier submission recorded (upsertLead keeps them).
 */
export const reportLeadSchema = leadCaptureSchema.partial({
  firstName: true,
  lastName: true,
  company: true,
  jobTitle: true,
  country: true,
});

export type ReportLeadInput = z.infer<typeof reportLeadSchema>;
