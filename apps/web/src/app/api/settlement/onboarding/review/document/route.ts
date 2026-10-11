import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { loadState, OnboardingUnavailable, readDocument } from "@/lib/settlement/onboardingStore";

// GET /api/settlement/onboarding/review/document?owner=<id>&id=<uuid>
// A compliance officer opens one onboarding document. Applicants never read
// documents back; this is the only read path, and every open is audited.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, "compliance_officer");
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "settlement.review.document", { limit: 60, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;
  const owner = req.nextUrl.searchParams.get("owner") ?? "";
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9_.:@-]{3,128}$/.test(owner) || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (owner === auth.account.user.id) return NextResponse.json({ error: "You cannot review your own onboarding case." }, { status: 403 });
  try {
    const doc = (await loadState(owner)).documents.find((d) => d.id === id);
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    const file = await readDocument(owner, doc);
    audit("settlement.onboarding.review_document_opened", auth.account.user.id, { owner, documentId: id, kind: doc.kind });
    return new NextResponse(Buffer.from(file.bytes), {
      headers: {
        "Content-Type": doc.contentType,
        "Content-Disposition": `inline; filename="${doc.kind}${doc.contentType === "application/pdf" ? ".pdf" : doc.contentType === "image/png" ? ".png" : ".jpg"}"`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof OnboardingUnavailable ? e.message : "Document unavailable" }, { status: 503 });
  }
}
