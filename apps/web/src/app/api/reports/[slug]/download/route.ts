import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { captureLead } from "@/lib/leads/capture";
import { getPublishedReport } from "@/lib/content";
import { reportDownloadEmail } from "@/lib/emailTemplates";
import { SITE } from "@/lib/seo/schema";

export const dynamic = "force-dynamic";

// POST /api/reports/[slug]/download — lead-gated report access.
//
// ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
//
// It never serves file BYTES and it never takes a path from the request. The
// only thing that can be downloaded is the `pdfPath` recorded on a PUBLISHED
// report in lib/content/data.ts — a fixed value in the repository, not user
// input. There is therefore no path-traversal surface here: no `..`, no
// user-supplied filename, no storage key, nothing to escape.
//
// The response carries a relative URL under /public. When reports move to
// private storage this is the one function that changes: it issues a
// short-lived signed URL instead, and every caller keeps working.
//
// ── UNPUBLISHED IS A 404 ───────────────────────────────────────────────────
//
// A draft report is indistinguishable from a slug that never existed. An
// endpoint that says "this exists but is not published yet" leaks the
// publishing pipeline to anyone guessing slugs.

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  // Unauthenticated public write that creates a contact record and sends
  // mail — both abusable at volume, so this is well under the middleware's
  // 150/min mutating baseline.
  const limited = await rateLimitOr429(req, "content.report_download", { limit: 5, windowMs: 60_000 });
  if (limited) return limited;

  const { slug } = await ctx.params;

  const report = getPublishedReport(slug);
  if (!report) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const reportUrl = `${SITE}/reports/${report.slug}`;
  // Resolved from the record, never from the request.
  const downloadUrl = report.pdfPath ?? null;

  const { response, lead } = await captureLead(req, {
    source: "report_download",
    interaction: "report_download",
    contentType: "report",
    contentId: report.slug,
    email: () =>
      reportDownloadEmail({
        reportTitle: report.title,
        downloadUrl: downloadUrl ? `${SITE}${downloadUrl}` : undefined,
        reportUrl,
      }),
  });
  if (response) return response;

  return NextResponse.json({
    ok: true,
    // Null when the report has no PDF: the client shows "Read online" rather
    // than a download that would 404. Never a fabricated link.
    downloadUrl,
    readUrl: `/reports/${report.slug}`,
    title: report.title,
    // Echoed so the UI can confirm what the person chose, and for nothing else.
    marketingConsent: lead?.marketingConsent ?? false,
  });
}
