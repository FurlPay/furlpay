import { NextRequest, NextResponse } from "next/server";
import { getSubscriber, putSubscriber } from "@/lib/newsletter";
import { newsletterWelcome, sendEmail } from "@/lib/email";
import { log } from "@/lib/log";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { trustedClientIp } from "@/lib/clientIp";
import { NewsletterSubscribeSchema } from "@/lib/schemas";
import { validateBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

// POST /api/newsletter/subscribe — category-based (double-opt-in-ready) signup
// with GDPR consent records. Public route.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "newsletter.subscribe", { limit: 5, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, NewsletterSubscribeSchema);
  if (body instanceof NextResponse) return body;

  const { email, categories } = body;

  try {
    const existing = await getSubscriber(email);
    const merged = existing
      ? Array.from(new Set([...existing.categories, ...categories]))
      : categories;

    await putSubscriber({
      email,
      categories: merged,
      consentTimestamp: new Date().toISOString(),
      ip: trustedClientIp(req),
    });

    if (existing) {
      return NextResponse.json({
        success: true,
        message: "Preferences updated! Your subscription has been refreshed.",
      });
    }

    // Fire-and-forget welcome email (mock-logs without RESEND_API_KEY). The
    // subscription is already durable, so a mail failure must not fail the
    // request — but it must not become an unhandled rejection either.
    void sendEmail({ to: email, ...newsletterWelcome(categories) }).catch((err) =>
      log.warn("newsletter welcome email failed", { error: String(err) })
    );

    return NextResponse.json({
      success: true,
      message: "You're subscribed! Check your inbox to confirm.",
    });
  } catch (err) {
    // The store is unreachable (in production that means Redis is unconfigured
    // or down). Say so — reporting success for a subscription that was never
    // recorded is worse than an error the caller can retry.
    log.error("newsletter subscribe failed", { error: String(err) });
    return NextResponse.json(
      { error: "Subscriptions are temporarily unavailable. Please try again shortly." },
      { status: 503 }
    );
  }
}
