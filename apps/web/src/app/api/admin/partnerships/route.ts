import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { INQUIRY_STATUSES } from "@/lib/partnerships/model";
import { addInquiryNote, inquiryDetail, InquiriesUnavailable, listInquiries, setInquiryStatus } from "@/lib/partnerships/repository";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const fail = (e: unknown) => e instanceof InquiriesUnavailable
  ? NextResponse.json({ error: "Partnership inquiries are unavailable. Configure storage and apply migration 0049." }, { status: 503, headers })
  : NextResponse.json({ error: "Partnership inquiries could not be loaded." }, { status: 502, headers });

// Staff view of partnership inquiries. ADMIN ONLY: these rows hold prospective
// partners' contact details. Every action records who did it.
export async function GET(req: NextRequest) {
  const auth = await requireRole(req, "admin"); if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "admin.partnerships.read", { limit: 60, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  const id = req.nextUrl.searchParams.get("id");
  const status = req.nextUrl.searchParams.get("status");
  if (id && !z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid inquiry ID" }, { status: 400, headers });
  if (status && !(INQUIRY_STATUSES as readonly string[]).includes(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400, headers });
  try {
    if (id) {
      const detail = await inquiryDetail(id);
      return detail ? NextResponse.json(detail, { headers }) : NextResponse.json({ error: "Inquiry not found" }, { status: 404, headers });
    }
    return NextResponse.json({ inquiries: await listInquiries({ status: (status ?? undefined) as (typeof INQUIRY_STATUSES)[number] | undefined, q: req.nextUrl.searchParams.get("q") ?? undefined }) }, { headers });
  } catch (e) { return fail(e); }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), id: z.string().uuid(), from: z.enum(INQUIRY_STATUSES), to: z.enum(INQUIRY_STATUSES), note: z.string().trim().max(2000).optional() }).strict(),
  z.object({ action: z.literal("note"), id: z.string().uuid(), note: z.string().trim().min(1).max(2000) }).strict(),
]);

export async function PATCH(req: NextRequest) {
  const auth = await requireRole(req, "admin"); if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "admin.partnerships.write", { limit: 60, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  const input = await validateBody(req, actionSchema); if (input instanceof NextResponse) return input;
  const actor = auth.account.user.email || auth.account.user.id;
  try {
    if (input.action === "note") {
      await addInquiryNote(input.id, actor, input.note);
    } else {
      const changed = await setInquiryStatus(input.id, input.from, input.to, actor, input.note);
      if (!changed) return NextResponse.json({ error: "This inquiry changed since you loaded it. Reload and try again." }, { status: 409, headers });
    }
    const detail = await inquiryDetail(input.id);
    return detail ? NextResponse.json(detail, { headers }) : NextResponse.json({ error: "Inquiry not found" }, { status: 404, headers });
  } catch (e) { return fail(e); }
}
