import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { captureLead } from "@/lib/leads/capture";
import { getPublishedReport } from "@/lib/content";
import { reportDownloadEmail, researchVerifyEmail } from "@/lib/emailTemplates";
import { SITE } from "@/lib/seo/schema";
import { limit } from "@/lib/rateLimit";
import { sendEmail } from "@/lib/email";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { isDisposableEmail } from "@/lib/research/disposable";
import { issueVerificationToken, sha256, TOKEN_TTL_SECONDS } from "@/lib/research/access";
import { storageConfigured } from "@/lib/research/storage";

export const dynamic = "force-dynamic";

/** Per-mailbox cap, across IPs: one address cannot be used to flood itself. */
const PER_EMAIL = { limit: 3, windowMs: 60 * 60_000 };

async function requestVerifiedDownload(
  req: NextRequest,
  slug: string,
  title: string,
  objectKey: string,
  reportUrl: string,
): Promise<NextResponse> {
  // Fail visibly before collecting anything: a verification email for a file
  // that cannot be delivered is a promise the next step would break.
  if (!storageConfigured()) {
    log.error("research download requested but private storage is not configured", { slug });
    return NextResponse.json(
      { error: "downloads_unavailable", detail: "Downloads are temporarily unavailable. You can read the summary online." },
      { status: 503 },
    );
  }

  // Peek at the address before the lead is stored, so a throwaway mailbox is
  // refused without creating a contact record. captureLead re-validates the
  // full body with the shared schema.
  const peek = (await req.clone().json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof peek?.email === "string" ? peek.email.trim().toLowerCase() : "";
  if (email && isDisposableEmail(email)) {
    return NextResponse.json(
      { error: "email_not_accepted", detail: "Please use an email address you can receive mail at long-term." },
      { status: 422 },
    );
  }
  if (email) {
    const perEmail = await limit(`research.verify_email:${sha256(email)}`, PER_EMAIL);
    if (!perEmail.ok) {
      return NextResponse.json(
        { error: "rate_limited", detail: "Too many requests for this address. Try again later.", retryAfterSeconds: perEmail.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(perEmail.retryAfterSeconds) } },
      );
    }
  }

  // Lead + consent record (newsletter consent stays a separate, default-off
  // flag). No email from here: the verification email is sent below with its
  // own idempotency key, so a second request gets a fresh, working link.
  const { response, lead } = await captureLead(req, {
    source: "report_download",
    interaction: "report_download",
    contentType: "report",
    contentId: slug,
  });
  if (response) return response;

  let token: string;
  try {
    token = await issueVerificationToken({ slug, objectKey, email: lead!.email });
  } catch (e) {
    log.error("research verification token could not be stored", { slug, error: (e as Error).message });
    return NextResponse.json(
      { error: "temporarily_unavailable", detail: "Could not start the download. Please try again shortly." },
      { status: 503 },
    );
  }

  const minutes = TOKEN_TTL_SECONDS / 60;
  // Fragment, not query: never sent to a server, so never in a request log.
  const verifyUrl = `${SITE}/research/verify#t=${token}`;
  const rendered = researchVerifyEmail({ reportTitle: title, verifyUrl, expiresMinutes: minutes });
  // sendEmail reports failure in its result rather than throwing, and with no
  // RESEND_API_KEY it "mocks" (logs and returns ok). In production a mocked
  // send is a send that did not happen: telling the reader to check their
  // inbox would be false, so both cases fail visibly.
  const sent = await sendEmail({
    to: lead!.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    category: "ops",
    idempotencyKey: `research-verify:${sha256(token).slice(0, 32)}`,
  }).catch((e: Error) => ({ ok: false as const, error: e.message }));
  const delivered = sent.ok && !(process.env.NODE_ENV === "production" && "mocked" in sent && sent.mocked);
  if (!delivered) {
    log.error("research verification email failed", { slug, error: sent.ok ? "mocked send in production" : sent.error });
    return NextResponse.json(
      { error: "email_failed", detail: "We could not send the verification email. Please try again." },
      { status: 503 },
    );
  }

  audit("research.verification_sent", "anonymous", { slug, marketingConsent: lead!.marketingConsent });

  // Identical for every address: the response never reveals whether this
  // mailbox has asked for, or downloaded, anything before.
  return NextResponse.json(
    { ok: true, verification: "sent", expiresMinutes: minutes, readUrl: `/reports/${slug}`, title, reportUrl },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}

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

  // ── Verified delivery (privatePdf) ────────────────────────────────────
  // The PDF lives in private storage. Nothing is downloadable from this
  // response: the reader gets an emailed single-use link that proves they
  // control the mailbox, and only that link can mint a short-lived grant.
  if (report.privatePdf) {
    return requestVerifiedDownload(req, report.slug, report.title, report.privatePdf.objectKey, reportUrl);
  }

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
