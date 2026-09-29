import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { captureLead } from "@/lib/leads/capture";
import { getPublishedWebinar, formatDate } from "@/lib/content";
import { webinarRegistrationEmail } from "@/lib/emailTemplates";
import { SITE } from "@/lib/seo/schema";

export const dynamic = "force-dynamic";

// POST /api/webinars/[slug]/register — webinar registration.
//
// ── THE PROVIDER BOUNDARY ──────────────────────────────────────────────────
//
// FurlPay has no webinar provider configured. Rather than invent a Zoom or
// Meet API call, this records the registration in FurlPay's own system and
// hands back the webinar's `registrationUrl` when the record has one.
//
// That is the integration point: when a provider is chosen, the call goes
// after the lead is stored and before the confirmation email, and its returned
// join link replaces `registrationUrl` in the response. Nothing else moves.
//
// The confirmation email carries a join link ONLY when one genuinely exists.
// A "join" button that goes nowhere is worse than no button, because the
// person finds out at the moment the session starts.

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  // Unauthenticated public write that creates a contact record and sends
  // mail — both abusable at volume, so this is well under the middleware's
  // 150/min mutating baseline.
  const limited = await rateLimitOr429(req, "content.webinar_register", { limit: 5, windowMs: 60_000 });
  if (limited) return limited;

  const { slug } = await ctx.params;

  // A draft webinar 404s exactly like an unknown slug — see the report route.
  const webinar = getPublishedWebinar(slug);
  if (!webinar) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (webinar.sessionStatus === "on-demand") {
    // Nothing to register for. The page offers the recording instead.
    return NextResponse.json(
      { error: "not_registrable", detail: "This session is available on demand." },
      { status: 409 },
    );
  }

  const webinarUrl = `${SITE}/webinars/${webinar.slug}`;
  const when = webinar.startsAt ? formatDate(webinar.startsAt) : undefined;
  const speakers = webinar.speakers.map((s) => `${s.name}, ${s.title}`).join("; ");

  const { response } = await captureLead(req, {
    source: "webinar_registration",
    interaction: "webinar_registration",
    contentType: "webinar",
    contentId: webinar.slug,
    email: () =>
      webinarRegistrationEmail({
        webinarTitle: webinar.title,
        when,
        speakers: speakers || undefined,
        joinUrl: webinar.registrationUrl,
        webinarUrl,
      }),
  });
  if (response) return response;

  return NextResponse.json({
    ok: true,
    title: webinar.title,
    // Null until a provider is wired — the UI says "details by email" rather
    // than linking nowhere.
    joinUrl: webinar.registrationUrl ?? null,
  });
}
