import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { log } from "@/lib/log";
import { validateInquiry } from "@/lib/partnerships/model";
import { InquiriesUnavailable, submitInquiry } from "@/lib/partnerships/repository";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

// POST /api/partnerships/inquiries — the /partnerships "Let's build together" form.
//
// PUBLIC on purpose (a prospective partner has no account), so: a tight per-IP
// budget, a 16 KB body cap, the shared Zod schema plus per-method contact
// validation, and two bot traps (a hidden field, and a form submitted faster
// than a person can type). The response says "received" only after the row is
// committed; with no storage configured it is a 503, never a pretend success.
// Logs carry the inquiry id and outcome only — no names, emails or message text.
const MIN_HUMAN_MS = 1500;

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "partnerships.inquiry", { limit: 5, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const body = await validateBody(req, z.record(z.unknown()), { maxBytes: 16_384 });
  if (body instanceof NextResponse) return body;

  const checked = validateInquiry(body);
  if (!checked.ok) {
    const bot = "companySite" in checked.errors;
    return NextResponse.json(bot ? { error: "Submission rejected." } : { error: "Please check the highlighted fields.", fields: checked.errors }, { status: 400, headers });
  }
  if (typeof body.elapsedMs === "number" && body.elapsedMs < MIN_HUMAN_MS) {
    return NextResponse.json({ error: "Submission rejected." }, { status: 400, headers });
  }

  try {
    const out = await submitInquiry(checked.row);
    log.info("partnership inquiry stored", { id: out.id, duplicate: out.duplicate, notification: out.notification, interest: checked.row.partnership_interest });
    return NextResponse.json({ ok: true, id: out.id, duplicate: out.duplicate }, { status: out.duplicate ? 200 : 201, headers });
  } catch (e) {
    if (e instanceof InquiriesUnavailable) {
      return NextResponse.json({ error: "Partnership inquiries are temporarily unavailable, so nothing was submitted. Please try again later." }, { status: 503, headers });
    }
    // Postgres errors can include the entire failing row. Never log their text.
    log.error("partnership inquiry failed", { category: "storage" });
    return NextResponse.json({ error: "We could not confirm receipt of your inquiry. Please retry; an inquiry already saved today will not be duplicated." }, { status: 502, headers });
  }
}
