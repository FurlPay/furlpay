import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { consumeVerificationToken } from "@/lib/research/access";
import { getPublishedReport } from "@/lib/content";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

// POST /api/research/download-verifications — consume an emailed token once.
//
// Body: { token } (from the verify page, which reads it out of the URL
// fragment). Success mints a 10-minute grant bound to one report version and
// returns the grant's download path. The token itself is never echoed and
// never logged.
//
// Responses are deliberately coarse: a guessed token and an expired real one
// both read "invalid_or_expired", so the endpoint cannot be used to probe.

const schema = z.object({ token: z.string().trim().min(1).max(100) });
const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "research.verify", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, schema);
  if (body instanceof NextResponse) return body;

  let result;
  try {
    result = await consumeVerificationToken(body.token);
  } catch (e) {
    log.error("research verification store unavailable", { error: (e as Error).message });
    return NextResponse.json(
      { error: "temporarily_unavailable", detail: "Please try the link again shortly." },
      { status: 503, headers: NO_STORE },
    );
  }

  if (!result.ok) {
    return result.reason === "used"
      ? NextResponse.json(
          { error: "link_used", detail: "This link has already been used. Request the report again for a new one." },
          { status: 410, headers: NO_STORE },
        )
      : NextResponse.json(
          { error: "invalid_or_expired", detail: "This link is invalid or has expired. Request the report again." },
          { status: 400, headers: NO_STORE },
        );
  }

  // The report must STILL be published and still point at the object the
  // token was issued for; an unpublished or re-versioned report does not
  // honour an old link.
  const report = getPublishedReport(result.grant.slug);
  if (!report || report.privatePdf?.objectKey !== result.grant.objectKey) {
    return NextResponse.json(
      { error: "invalid_or_expired", detail: "This report is no longer available at this version." },
      { status: 400, headers: NO_STORE },
    );
  }

  audit("research.verification_consumed", "anonymous", { slug: report.slug, version: report.privatePdf.version });
  return NextResponse.json(
    {
      ok: true,
      title: report.title,
      downloadUrl: `/api/research/downloads/${result.grantId}`,
      expiresAt: result.grant.expiresAt,
    },
    { headers: NO_STORE },
  );
}
