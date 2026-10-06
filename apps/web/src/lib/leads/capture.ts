import { NextRequest, NextResponse } from "next/server";
import { validateBody } from "@/lib/validate";
import { trustedClientIp } from "@/lib/clientIp";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { sendEmail } from "@/lib/email";
import type { RenderedEmail } from "@/lib/emailTemplates";
import { recordInteraction, upsertLead } from "./store";
import { leadCaptureSchema, reportLeadSchema, type InteractionType, type LeadSource } from "./types";

// ---------------------------------------------------------------------------
// The shared lead-capture pipeline behind report downloads and webinar
// registrations. One implementation, so both endpoints get the same handling
// of validation, consent, dedup and the response shape.
//
// ── RATE LIMITING LIVES AT THE ROUTE, NOT HERE ─────────────────────────────
//
// Each route calls rateLimitOr429() itself before delegating. That is
// deliberate: routeManifest.spec.ts reads route files statically to prove a
// public endpoint has a budget, and a limit hidden inside a shared helper is
// invisible to that check — and to a human reading the route. Per-route also
// means a download and a registration can carry different budgets.
//
// ── NO EMAIL ENUMERATION ───────────────────────────────────────────────────
//
// The response is IDENTICAL whether the address was already known or is new.
// `upsertLead` reports `created`, and that flag is used for logging only — it
// never reaches the client. An endpoint that says "welcome back" turns a
// public form into an oracle for "does this person's address exist in your
// CRM", which is a disclosure about someone who is not the one asking.
//
// ── THE CONFIRMATION EMAIL IS TRANSACTIONAL ────────────────────────────────
//
// It is the thing they just asked for, so it sends regardless of the marketing
// opt-in. What it may NOT do is carry promotional content, and no other email
// is authorised by this flow. Marketing sends read the explicit opt-in.
//
// A send failure does not fail the request: they already have their report or
// their registration, and turning a successful capture into an error because
// an email provider was slow would lose the lead we just gained.
// ---------------------------------------------------------------------------

export interface CaptureOutcome {
  /** Non-null when the caller should return it unchanged. */
  response: NextResponse | null;
  lead?: { email: string; firstName: string; marketingConsent: boolean };
}

export async function captureLead(
  req: NextRequest,
  opts: {
    source: LeadSource;
    interaction: InteractionType;
    contentType: "report" | "webinar";
    contentId: string;
    /** Built after the lead is stored; null skips the email. */
    email?: (lead: { firstName: string }) => RenderedEmail | null;
    /** "email": the profile fields are optional (report downloads). */
    profile?: "full" | "email";
  },
): Promise<CaptureOutcome> {
  // validateBody enforces the 100KB cap before parsing (AGENTS.md rule 1).
  const body = await validateBody(req, opts.profile === "email" ? reportLeadSchema : leadCaptureSchema);
  if (body instanceof NextResponse) return { response: body };

  // consent_ip is NOT NULL (migration 0019); an address that could not be
  // established is recorded as exactly that, never as a plausible IP.
  const ip = trustedClientIp(req) ?? "unestablished";

  let lead;
  try {
    const result = await upsertLead(body, opts.source, ip);
    lead = result.lead;
    // `created` stays server-side — see the enumeration note above.
    log.info("content lead captured", {
      source: opts.source,
      contentId: opts.contentId,
      created: result.created,
      emailType: lead.emailType,
    });
  } catch (e) {
    log.error("lead capture failed", { contentId: opts.contentId, error: (e as Error).message });
    return {
      response: NextResponse.json(
        { error: "capture_failed", detail: "Could not record your request. Please try again." },
        { status: 503 },
      ),
    };
  }

  // Interaction is separate from the contact: three downloads are three facts
  // about one person. Failures here are logged inside recordInteraction and
  // never surface — the visitor's request has already succeeded.
  await recordInteraction({
    leadEmail: lead.email,
    eventType: opts.interaction,
    contentType: opts.contentType,
    contentId: opts.contentId,
  });

  audit("content.lead_captured", lead.email, {
    source: opts.source,
    contentType: opts.contentType,
    contentId: opts.contentId,
    marketingConsent: lead.marketingConsent,
  });

  const rendered = opts.email?.({ firstName: lead.firstName });
  if (rendered) {
    await sendEmail({
      to: lead.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      category: "ops",
      // Same person + same content = same send, so a double-submit does not
      // deliver twice.
      idempotencyKey: `${opts.interaction}:${opts.contentId}:${lead.email}`,
    }).catch((e) =>
      log.error("content confirmation email failed", {
        contentId: opts.contentId,
        error: (e as Error).message,
      }),
    );
  }

  return {
    response: null,
    lead: {
      email: lead.email,
      firstName: lead.firstName,
      marketingConsent: lead.marketingConsent,
    },
  };
}
