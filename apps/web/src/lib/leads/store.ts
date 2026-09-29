import { randomUUID } from "crypto";
import { sbInsert, sbSelect, sbUpsert, supabaseBackend } from "@/lib/supabase";
import { normalizeEmail } from "@/lib/newsletter";
import { log } from "@/lib/log";
import {
  classifyEmail,
  CONSENT_VERSION,
  type ContentInteraction,
  type InteractionType,
  type Lead,
  type LeadCaptureInput,
  type LeadSource,
} from "./types";

// ---------------------------------------------------------------------------
// Lead persistence.
//
// Same shape as lib/revenue/store: Supabase when configured, a process-local
// map otherwise, and `leadsDurable()` so the ops surface can say which. It is
// a SEPARATE store from revenue on purpose — see types.ts.
//
// `normalizeEmail` is imported from the newsletter module rather than
// reimplemented, so "the same address" means the same thing in both systems. A
// second lowercase-and-trim helper would drift.
// ---------------------------------------------------------------------------

const LEADS = "content_leads";
const INTERACTIONS = "content_interactions";

const leadMemory = new Map<string, Lead>();
const interactionMemory: ContentInteraction[] = [];

export function leadsDurable(): boolean {
  return supabaseBackend === "supabase";
}

/** Tests only. */
export function __resetLeadMemory(): void {
  leadMemory.clear();
  interactionMemory.length = 0;
}

interface LeadRow {
  email: string;
  first_name: string;
  last_name: string;
  company: string;
  job_title: string;
  country: string;
  phone: string | null;
  interests: string[] | null;
  email_type: string;
  first_source: string;
  consent_at: string;
  consent_version: string;
  consent_ip: string;
  marketing_consent: boolean;
  marketing_consent_at: string | null;
  created_at: string;
  updated_at: string;
}

const toLeadRow = (l: Lead): LeadRow => ({
  email: l.email,
  first_name: l.firstName,
  last_name: l.lastName,
  company: l.company,
  job_title: l.jobTitle,
  country: l.country,
  phone: l.phone ?? null,
  interests: l.interests ?? null,
  email_type: l.emailType,
  first_source: l.firstSource,
  consent_at: l.consentAt,
  consent_version: l.consentVersion,
  consent_ip: l.consentIp,
  marketing_consent: l.marketingConsent,
  marketing_consent_at: l.marketingConsentAt ?? null,
  created_at: l.createdAt,
  updated_at: l.updatedAt,
});

const fromLeadRow = (r: LeadRow): Lead => ({
  email: r.email,
  firstName: r.first_name,
  lastName: r.last_name,
  company: r.company,
  jobTitle: r.job_title,
  country: r.country,
  phone: r.phone ?? undefined,
  interests: r.interests ?? undefined,
  emailType: r.email_type as Lead["emailType"],
  firstSource: r.first_source as LeadSource,
  consent: true,
  consentAt: r.consent_at,
  consentVersion: r.consent_version,
  consentIp: r.consent_ip,
  marketingConsent: r.marketing_consent,
  marketingConsentAt: r.marketing_consent_at ?? undefined,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function findLead(email: string): Promise<Lead | null> {
  const key = normalizeEmail(email);
  if (!leadsDurable()) return leadMemory.get(key) ?? null;
  const rows = await sbSelect<LeadRow>(LEADS, `email=eq.${encodeURIComponent(key)}&limit=1`);
  return rows[0] ? fromLeadRow(rows[0]) : null;
}

export interface UpsertResult {
  lead: Lead;
  /** False when this updated an existing contact. */
  created: boolean;
}

/**
 * Create or update the lead for this email.
 *
 * ── WHAT AN UPDATE MAY AND MAY NOT DO ──────────────────────────────────────
 *
 * Profile fields (name, company, job title) are refreshed — people change jobs
 * and the latest submission is the better record.
 *
 * `marketingConsent` is different: it can be turned ON by a later opt-in, but a
 * submission that simply leaves the box unticked does NOT revoke an existing
 * opt-in. Someone who subscribed last month and today downloaded a report
 * without re-ticking has not withdrawn consent, and silently dropping it would
 * lose a permission they actually granted. Withdrawal is an explicit act and
 * goes through unsubscribe, not through an omitted checkbox.
 *
 * `firstSource` and `createdAt` are never overwritten — how we first met
 * someone is a fact about the past.
 */
export async function upsertLead(
  input: LeadCaptureInput,
  source: LeadSource,
  consentIp: string,
): Promise<UpsertResult> {
  const email = normalizeEmail(input.email);
  const now = new Date().toISOString();
  const existing = await findLead(email);

  const optedIn = input.marketingConsent || existing?.marketingConsent === true;

  const lead: Lead = {
    email,
    firstName: input.firstName,
    lastName: input.lastName,
    company: input.company,
    jobTitle: input.jobTitle,
    country: input.country,
    phone: input.phone ?? existing?.phone,
    interests: input.interests?.length ? input.interests : existing?.interests,
    emailType: classifyEmail(email),
    firstSource: existing?.firstSource ?? source,
    consent: true,
    consentAt: now,
    consentVersion: CONSENT_VERSION,
    consentIp,
    marketingConsent: optedIn,
    marketingConsentAt:
      input.marketingConsent && !existing?.marketingConsent
        ? now
        : existing?.marketingConsentAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (!leadsDurable()) {
    leadMemory.set(email, lead);
    return { lead, created: !existing };
  }

  await sbUpsert<LeadRow>(LEADS, toLeadRow(lead));
  return { lead, created: !existing };
}

interface InteractionRow {
  id: string;
  lead_email: string;
  event_type: string;
  content_type: string;
  content_id: string;
  created_at: string;
}

/**
 * Append an interaction.
 *
 * Separate rows per download, so "downloaded three reports" is three facts
 * rather than one contact with a counter. Failures are logged, not thrown: the
 * visitor has already been given their report and must not see an error
 * because an analytics insert failed.
 */
export async function recordInteraction(input: {
  leadEmail: string;
  eventType: InteractionType;
  contentType: "report" | "webinar";
  contentId: string;
}): Promise<ContentInteraction | null> {
  const interaction: ContentInteraction = {
    id: randomUUID(),
    leadEmail: normalizeEmail(input.leadEmail),
    eventType: input.eventType,
    contentType: input.contentType,
    contentId: input.contentId,
    createdAt: new Date().toISOString(),
  };

  try {
    if (!leadsDurable()) {
      interactionMemory.push(interaction);
      return interaction;
    }
    await sbInsert<InteractionRow>(INTERACTIONS, {
      id: interaction.id,
      lead_email: interaction.leadEmail,
      event_type: interaction.eventType,
      content_type: interaction.contentType,
      content_id: interaction.contentId,
      created_at: interaction.createdAt,
    });
    return interaction;
  } catch (e) {
    log.error("content interaction not recorded", {
      contentId: input.contentId,
      error: (e as Error).message,
    });
    return null;
  }
}

export async function listLeads(limit = 1000): Promise<Lead[]> {
  const capped = Math.min(limit, 5000);
  if (!leadsDurable()) {
    return [...leadMemory.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, capped);
  }
  const rows = await sbSelect<LeadRow>(LEADS, `order=created_at.desc&limit=${capped}`);
  return rows.map(fromLeadRow);
}

export async function listInteractions(limit = 5000): Promise<ContentInteraction[]> {
  const capped = Math.min(limit, 20_000);
  if (!leadsDurable()) {
    return [...interactionMemory]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, capped);
  }
  const rows = await sbSelect<InteractionRow>(
    INTERACTIONS,
    `order=created_at.desc&limit=${capped}`,
  );
  return rows.map((r) => ({
    id: r.id,
    leadEmail: r.lead_email,
    eventType: r.event_type as InteractionType,
    contentType: r.content_type as "report" | "webinar",
    contentId: r.content_id,
    createdAt: r.created_at,
  }));
}
