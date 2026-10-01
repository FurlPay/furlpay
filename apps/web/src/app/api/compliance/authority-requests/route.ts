import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { trustedClientIp } from "@/lib/clientIp";
import { validateBody } from "@/lib/validate";
import { requireAnyRole } from "@/lib/authz";
import {
  createAuthorityRequest,
  listAuthorityRequests,
  STATUTORY_BASES,
  TARGET_TYPES,
} from "@/lib/compliance/authorityRequest";

export const dynamic = "force-dynamic";

const CreateRequestSchema = z.object({
  agencyName: z.string().trim().min(2).max(200),
  agencyCountry: z.string().trim().length(2),
  jurisdiction: z.string().trim().min(2).max(100),
  officialEmail: z.string().trim().email().max(255),
  officerName: z.string().trim().min(2).max(120),
  badgeId: z.string().trim().min(1).max(64),
  docketNumber: z.string().trim().min(1).max(120),
  statutoryBasis: z.enum(STATUTORY_BASES),
  emergencyDeclaration: z.string().trim().max(4000).optional(),
  targetType: z.enum(TARGET_TYPES),
  targetIdentifier: z.string().trim().min(1).max(255),
});

// POST /api/compliance/authority-requests — Hardened intake portal
// Allows government / law enforcement entities to submit official legal requests.
// NOTE: Submission alone DOES NOT authorize any data release.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "compliance.auth_req.submit", {
    limit: 10,
    windowMs: 600_000,
  });
  if (limited) return limited;

  const body = await validateBody(req, CreateRequestSchema);
  if (body instanceof NextResponse) return body;

  try {
    const request = await createAuthorityRequest({
      ...body,
      submittedByIp: trustedClientIp(req) ?? undefined,
    });

    return NextResponse.json(
      {
        ok: true,
        requestId: request.id,
        status: request.status,
        message:
          "Authority request logged into Sovereign Authority Gate. Mandatory independent out-of-band verification and compliance review initiated.",
      },
      { status: 202 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to record request.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}

// GET /api/compliance/authority-requests — Compliance officers & admins list requests.
export async function GET(req: NextRequest) {
  const auth = await requireAnyRole(req, ["compliance_officer", "admin"]);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "compliance.auth_req.list", {
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const requests = await listAuthorityRequests();
  return NextResponse.json({ ok: true, requests });
}
