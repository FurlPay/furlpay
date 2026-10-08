import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BodyTooLarge, readBoundedBody } from "@/lib/settlement/boundedBody";
import { requireUser } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { DOCUMENT_KINDS, DOCUMENT_MAX_BYTES, DOCUMENT_TYPES, type DocumentKind, type DocumentRecord, type OnboardingState } from "@/lib/settlement/onboarding";
import { loadState, OnboardingUnavailable, putDocument, Refusal, removeDocument, updateState } from "@/lib/settlement/onboardingStore";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** The file's first bytes must match its declared type — a renamed file is refused. */
function sniff(bytes: Uint8Array): (typeof DOCUMENT_TYPES)[number] | null {
  const b = bytes;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf"; // %PDF
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

/** An approved case whose documents change goes back to review: approval covered the old files. */
function reopen(state: OnboardingState, by: string, reason: string) {
  if (state.review?.status !== "approved") return;
  const at = new Date().toISOString();
  state.review = { ...state.review, status: "pending", submittedAt: at, history: [...state.review.history, { at, by, action: "reopened", reason }] };
}

// POST /api/settlement/onboarding/documents — multipart: `kind`, `file`.
// Stores one document per kind (re-uploading replaces it). Only the metadata
// returns to the browser; the object itself is never served back.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "settlement.onboarding.document", { limit: 20, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;
  // The cap is enforced on the bytes actually streamed: a chunked request has no
  // Content-Length, and req.formData() alone would buffer it without limit.
  let form: FormData;
  try {
    const raw = await readBoundedBody(req, DOCUMENT_MAX_BYTES + 64 * 1024);
    form = await new Response(raw, { headers: { "Content-Type": req.headers.get("content-type") ?? "" } }).formData();
  } catch (e) {
    if (e instanceof BodyTooLarge) return fail("This upload is larger than 10 MB.", 413);
    return fail("Upload a single file.", 400);
  }
  if ([...form.keys()].some((k) => k !== "kind" && k !== "file") || form.getAll("kind").length !== 1 || form.getAll("file").length !== 1) return fail("Upload one kind and one file only.", 400);
  const input = z.object({ kind: z.enum(DOCUMENT_KINDS as [DocumentKind, ...DocumentKind[]]), file: z.instanceof(File) }).strict().safeParse({ kind: form.get("kind"), file: form.get("file") });
  if (!input.success) return fail("Choose a valid document type and file.", 400);
  const { kind, file } = input.data;
  if (file.size === 0) return fail("This file is empty.", 400);
  if (file.size > DOCUMENT_MAX_BYTES) return fail("This file is larger than 10 MB.", 413);
  if (!DOCUMENT_TYPES.includes(file.type as (typeof DOCUMENT_TYPES)[number])) return fail("Upload a PDF, JPG or PNG file.", 415);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const actual = sniff(bytes);
  if (!actual || actual !== file.type) return fail("Unable to verify this document: its contents do not match a PDF, JPG or PNG.", 415);

  const userId = auth.account.user.id;
  const doc: DocumentRecord = {
    id: crypto.randomUUID(),
    kind: kind as DocumentKind,
    name: file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "document",
    size: file.size,
    contentType: actual,
    uploadedAt: new Date().toISOString(),
    review: "received",
  };
  let stored = false;
  let committed = false;
  try {
    if ((await loadState(userId)).activation.status === "ACTIVE") return fail("Documents are locked after activation. Contact support to update them.", 409);
    await putDocument(userId, doc, bytes);
    stored = true;
    let replaced: DocumentRecord[] = [];
    // Serialised with every other onboarding write, so concurrent uploads never drop each other.
    await updateState(userId, (state) => {
      if (state.activation.status === "ACTIVE") throw new Refusal("Documents are locked after activation. Contact support to update them.", 409);
      replaced = state.documents.filter((d) => d.kind === doc.kind);
      state.documents = [...state.documents.filter((d) => d.kind !== doc.kind), doc];
      reopen(state, userId, `${doc.kind} replaced`);
      return state;
    });
    committed = true;
    // Best-effort cleanup of the replaced object once the new one is recorded.
    for (const old of replaced) await removeDocument(userId, old).catch(() => undefined);
    // Metadata only: never file contents or the original file name.
    audit(replaced.length ? "settlement.onboarding.document_replaced" : "settlement.onboarding.document_uploaded", userId, { kind: doc.kind, size: doc.size, contentType: doc.contentType, documentId: doc.id });
    return NextResponse.json({ document: doc }, { status: 201, headers });
  } catch (e) {
    // A timed-out write may have committed. Never delete a file that its row
    // references, or when persistence cannot tell us whether it committed.
    if (stored && !committed) {
      const current = await loadState(userId).catch(() => null);
      if (current && !current.documents.some((d) => d.id === doc.id)) await removeDocument(userId, doc).catch(() => undefined);
    }
    if (e instanceof Refusal) return fail(e.message, e.status);
    return fail(e instanceof OnboardingUnavailable ? e.message : "The upload could not be confirmed. Reload your documents before retrying.", 503);
  }
}

// DELETE /api/settlement/onboarding/documents?id=<uuid>
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "settlement.onboarding.document", { limit: 20, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("Invalid document id.", 400);
  const userId = auth.account.user.id;
  try {
    let removed: DocumentRecord | undefined;
    await updateState(userId, (state) => {
      if (state.activation.status === "ACTIVE") throw new Refusal("Documents are locked after activation.", 409);
      removed = state.documents.find((d) => d.id === id);
      if (!removed) throw new Refusal("Document not found.", 404);
      state.documents = state.documents.filter((d) => d.id !== id);
      // A required document going away re-opens the identity step.
      state.completed = state.completed.filter((s) => s !== "identity");
      reopen(state, userId, `${removed.kind} removed`);
      return state;
    });
    if (removed) await removeDocument(userId, removed).catch(() => undefined);
    audit("settlement.onboarding.document_removed", userId, { kind: removed?.kind, documentId: id });
    return NextResponse.json({ removed: true }, { headers });
  } catch (e) {
    if (e instanceof Refusal) return fail(e.message, e.status);
    return fail(e instanceof OnboardingUnavailable ? e.message : "The document could not be removed; try again.", 503);
  }
}
