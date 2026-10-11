import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/validate";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { DocumentDeleteSchema, DocumentUpdateSchema, parse } from "@/lib/schemas";
import { deleteDocument, getDocument, maskDocument, updateDocument } from "@/lib/passport/store";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// GET / PATCH / DELETE a single travel document.
//
// Every handler resolves through getDocument(userId, id), which returns
// undefined for a document that does not exist AND for one owned by someone
// else. The two are indistinguishable to the caller by design: a 404 that only
// fired for non-existent ids would confirm which document ids are real.

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const doc = getDocument(auth.account.user.id, params.id);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ document: maskDocument(doc) });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const parsed = parse(DocumentUpdateSchema, await readJsonBody(req).catch(() => ({})));
  if (!parsed.ok) return parsed.res;

  // Only label and isPrimary are forwarded. The verified fields — country,
  // expiry, tail, status — are the provider's assertions about a physical
  // document and are not editable by the person presenting it.
  const doc = updateDocument(auth.account.user.id, params.id, {
    label: parsed.data.label,
    isPrimary: parsed.data.isPrimary,
  });
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ document: maskDocument(doc) });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(
    req,
    "passport-delete",
    { limit: 10, windowMs: 60_000 },
    userId
  );
  if (limited) return limited;

  const parsed = parse(DocumentDeleteSchema, await readJsonBody(req).catch(() => ({})));
  if (!parsed.ok) return parsed.res;

  const removed = deleteDocument(userId, params.id);
  if (!removed) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Audited WITHOUT any document detail: the erasure record must not become
  // the copy of the data that survives the erasure.
  audit("passport.deleted", userId, { documentId: params.id });

  return NextResponse.json({ ok: true });
}
