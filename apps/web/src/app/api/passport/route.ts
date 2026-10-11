import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/validate";
import { randomUUID } from "crypto";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { DocumentScanInitSchema, parse } from "@/lib/schemas";
import {
  formatFor,
  isSupportedCountry,
  listDocuments,
  maskDocument,
  putDocument,
} from "@/lib/passport/store";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// /api/passport — the travel-document wallet.
//
// GET  → the acting user's documents, masked.
// POST → open a verification session with the KYC provider (Sumsub).
//
// WHY THERE IS NO WEBHOOK ROUTE HERE. /api/webhooks/sumsub already verifies
// the provider's HMAC in constant time, guards replays through webhookGuard,
// and is already exempt from the middleware's JWT gate via the /api/webhooks
// public prefix. A second webhook would mean a second signature
// implementation, a second secret to rotate, and a second chance to get
// timingSafeEqual wrong — for one more event type on a provider we already
// receive callbacks from. Document results extend that handler instead.
//
// WHAT THE SERVER NEVER RECEIVES: MRZ text, chip data groups, facial images,
// fingerprints, or the full document number. Those stay with the provider,
// which is licensed to hold them. We keep a verification outcome and a 4-char
// tail — see lib/passport/documents.ts for why a "biometric hash" is not a
// safe middle ground.

/** Documents one account may hold. A wallet, not an archive. */
const MAX_DOCUMENTS = 8;

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const docs = listDocuments(auth.account.user.id);
  const now = new Date();
  return NextResponse.json({ documents: docs.map((d) => maskDocument(d, now)) });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  // Identity verification is expensive per attempt and is a natural target for
  // enumeration, so it is budgeted well below what a real user needs.
  const limited = await rateLimitOr429(
    req,
    "passport-scan",
    { limit: 5, windowMs: 60_000 },
    userId
  );
  if (limited) return limited;

  const parsed = parse(DocumentScanInitSchema, await readJsonBody(req).catch(() => ({})));
  if (!parsed.ok) return parsed.res;
  const { issuingCountry, documentType } = parsed.data;

  // Membership is checked here rather than in the Zod enum: a 180-entry enum
  // produces an unreadable error message, and the country list is data.
  if (!isSupportedCountry(issuingCountry)) {
    return NextResponse.json(
      {
        error: "unsupported_country",
        detail: "We can't verify documents from that country yet.",
      },
      { status: 400 }
    );
  }

  if (listDocuments(userId).length >= MAX_DOCUMENTS) {
    return NextResponse.json(
      {
        error: "document_limit_reached",
        detail: `You can store up to ${MAX_DOCUMENTS} documents. Remove one first.`,
      },
      { status: 409 }
    );
  }

  const sessionId = randomUUID();
  const documentId = randomUUID();

  // The pending row is written BEFORE the user leaves for the hosted flow.
  // Without it, a provider webhook arriving while the user is still in the
  // browser has nothing to attach its result to and the verification is lost.
  putDocument({
    id: documentId,
    userId,
    type: documentType,
    issuingCountry,
    documentTail: "",
    expiresOn: "",
    status: "pending",
    verifiedBy: "sumsub",
    verifiedAt: null,
    chipVerified: false,
    label: null,
    isPrimary: listDocuments(userId).length === 0,
    createdAt: new Date().toISOString(),
    sessionId,
  });

  audit("passport.session_created", userId, { documentId, issuingCountry, documentType });

  // Mock session URL until PASSPORT_PROVIDER_API_KEY is configured. It is
  // returned with `live: false` so the client can say so plainly rather than
  // opening a URL that will not verify anything — a verification flow that
  // silently does nothing is worse than one that says it is unavailable.
  const live = !!process.env.SUMSUB_APP_TOKEN;

  return NextResponse.json(
    {
      documentId,
      sessionId,
      live,
      documentFormat: formatFor(documentType),
      sessionUrl: live
        ? `https://in.sumsub.com/websdk/p/${encodeURIComponent(sessionId)}`
        : null,
      detail: live
        ? undefined
        : "Document verification isn't enabled on this deployment yet.",
    },
    { status: 201 }
  );
}
