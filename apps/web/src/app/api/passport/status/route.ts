import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { getDocument, maskDocument } from "@/lib/passport/store";

export const dynamic = "force-dynamic";

// GET /api/passport/status?documentId=<uuid> — poll one document's state.
//
// Separate from GET /api/passport/[id] because it is called on a timer while
// the user waits on the verification screen, and therefore gets its own,
// looser rate budget. Same data, different traffic shape.

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  // Generous: a client polling every 2s for two minutes is normal here. Still
  // bounded, so a stuck screen cannot poll forever.
  const limited = await rateLimitOr429(
    req,
    "passport-status",
    { limit: 90, windowMs: 60_000 },
    userId
  );
  if (limited) return limited;

  const documentId = req.nextUrl.searchParams.get("documentId") ?? "";
  if (!documentId) {
    return NextResponse.json(
      { error: "missing_document_id", detail: "documentId is required." },
      { status: 400 }
    );
  }

  const doc = getDocument(userId, documentId);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ document: maskDocument(doc) });
}
