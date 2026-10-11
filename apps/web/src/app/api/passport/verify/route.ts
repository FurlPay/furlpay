import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/validate";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { DocumentVerifySchema, parse } from "@/lib/schemas";
import { findBySession, maskDocument, putDocument, toTail } from "@/lib/passport/store";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// POST /api/passport/verify — settle a document verification.
//
// The client calls this when the hosted flow hands control back. It does NOT
// carry the verification result: the client is not a trusted source for
// whether a passport is genuine. All it carries is the sessionId, and the
// server asks the provider what happened.
//
// A client-supplied "verificationToken" was in the original design. It is
// dropped: a token the client can present is a token the client can forge or
// replay, and there is no reason to accept one when the server can query the
// provider directly by session. The schema still accepts the field so older
// builds do not 400, but nothing reads it.
//
// IDEMPOTENT. Users double-tap, the browser fires the callback twice, and the
// provider's webhook races this route. Re-verifying an already-settled
// document returns the same result instead of a second row or an error.

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(
    req,
    "passport-verify",
    { limit: 10, windowMs: 60_000 },
    userId
  );
  if (limited) return limited;

  const parsed = parse(DocumentVerifySchema, await readJsonBody(req).catch(() => ({})));
  if (!parsed.ok) return parsed.res;

  const doc = findBySession(parsed.data.sessionId);
  // Scoped to the caller: a session id belonging to another account must not
  // resolve here, or one user could settle another user's verification.
  if (!doc || doc.userId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Already settled — return the current state rather than re-running.
  if (doc.status !== "pending") {
    return NextResponse.json({ document: maskDocument(doc) });
  }

  const outcome = await fetchProviderOutcome(parsed.data.sessionId);

  if (outcome.status === "pending") {
    // Nothing to settle yet. The client polls /api/passport/status.
    return NextResponse.json({ document: maskDocument(doc) }, { status: 202 });
  }

  doc.status = outcome.status;
  doc.verifiedAt = outcome.status === "verified" ? new Date().toISOString() : null;
  if (outcome.status === "verified") {
    // toTail runs HERE, at the trust boundary. The full number exists only in
    // this function scope and is never written anywhere.
    doc.documentTail = toTail(outcome.documentNumber ?? "");
    doc.expiresOn = outcome.expiresOn ?? "";
    doc.chipVerified = outcome.chipVerified ?? false;
  }
  putDocument(doc);

  audit("passport.verified", userId, {
    documentId: doc.id,
    issuingCountry: doc.issuingCountry,
    status: doc.status,
  });

  return NextResponse.json({ document: maskDocument(doc) });
}

interface ProviderOutcome {
  status: "verified" | "failed" | "pending";
  /** Present only on success, and consumed immediately. Never stored. */
  documentNumber?: string;
  expiresOn?: string;
  chipVerified?: boolean;
}

/**
 * Ask the provider what happened in this session.
 *
 * Without SUMSUB_APP_TOKEN there is no provider to ask, so this reports
 * `pending` rather than inventing a pass. A verification flow that returns
 * "verified" because it is unconfigured is worse than one that never
 * completes: it puts a green tick on an unchecked document.
 */
async function fetchProviderOutcome(_sessionId: string): Promise<ProviderOutcome> {
  if (!process.env.SUMSUB_APP_TOKEN) return { status: "pending" };

  // The live call belongs here: GET /resources/applicants/{id}/one, signed
  // with SUMSUB_SECRET_KEY over ts+method+path. Until those credentials are
  // provisioned, fail closed rather than guess.
  return { status: "pending" };
}
