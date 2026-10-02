import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { readGrant } from "@/lib/research/access";
import { signedPdfUrl } from "@/lib/research/storage";
import { getPublishedReport } from "@/lib/content";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

// GET /api/research/downloads/[grantId] — redeem a live grant.
//
// Redirects (303) to a 60-second signed URL for the ONE object the grant names.
// The grant id is the only input and it cannot select a different object: the
// object key comes from the grant record, cross-checked against the current
// published report. Responses are no-store and noindex, and the redirect sets
// no-referrer so the signed URL is not leaked to anything the PDF viewer loads.

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };

export async function GET(req: NextRequest, ctx: { params: Promise<{ grantId: string }> }) {
  const limited = await rateLimitOr429(req, "research.download", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const { grantId } = await ctx.params;
  let grant;
  try {
    grant = await readGrant(grantId);
  } catch (e) {
    log.error("research grant store unavailable", { error: (e as Error).message });
    return NextResponse.json({ error: "temporarily_unavailable" }, { status: 503, headers: NO_STORE });
  }
  if (!grant) {
    return NextResponse.json(
      { error: "expired", detail: "This download link has expired. Request the report again." },
      { status: 410, headers: NO_STORE },
    );
  }

  const report = getPublishedReport(grant.slug);
  if (!report || report.privatePdf?.objectKey !== grant.objectKey) {
    return NextResponse.json({ error: "expired" }, { status: 410, headers: NO_STORE });
  }

  const signed = await signedPdfUrl(grant.objectKey);
  if (!signed.ok) {
    log.error("research signed URL unavailable", { slug: report.slug, reason: signed.reason });
    return NextResponse.json(
      { error: "downloads_unavailable", detail: "The file is temporarily unavailable. Please try again shortly." },
      { status: 503, headers: NO_STORE },
    );
  }

  audit("research.download_issued", "anonymous", { slug: report.slug, version: report.privatePdf.version });
  return NextResponse.redirect(signed.url, { status: 303, headers: NO_STORE });
}
