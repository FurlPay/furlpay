import { NextRequest, NextResponse } from "next/server";
import { deleteSubscriber, getSubscriber, putSubscriber } from "@/lib/newsletter";
import { log } from "@/lib/log";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { NewsletterUnsubscribeSchema } from "@/lib/schemas";
import { validateBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

// POST /api/newsletter/unsubscribe — one-click unsubscribe (RFC 8058-friendly).
// Optional `categories` for selective opt-out; omitted = full unsubscribe.
// Always returns success (does not reveal whether an email was subscribed).
export async function POST(req: NextRequest) {
  // Public mutation of subscriber state — throttle enumeration/abuse.
  const limited = await rateLimitOr429(req, "newsletter.unsubscribe", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, NewsletterUnsubscribeSchema);
  if (body instanceof NextResponse) return body;

  const { email, categories } = body;

  try {
    const existing = await getSubscriber(email);

    if (!existing) {
      return NextResponse.json({
        success: true,
        message: "If that email is subscribed, it has been removed.",
      });
    }

    // Selective unsubscribe — only when something would actually remain.
    if (categories && categories.length > 0) {
      const removing = new Set<string>(categories);
      const remaining = existing.categories.filter((c) => !removing.has(c));
      if (remaining.length > 0) {
        await putSubscriber({ ...existing, categories: remaining });
        return NextResponse.json({
          success: true,
          message: "Updated. You'll still receive updates for your remaining preferences.",
        });
      }
      // Nothing left — fall through to full unsubscribe.
    }

    await deleteSubscriber(email);
    return NextResponse.json({
      success: true,
      message: "You've been fully unsubscribed. We're sorry to see you go.",
    });
  } catch (err) {
    // Never claim someone was unsubscribed when the write did not land — that
    // is the failure mode that turns into a spam complaint.
    log.error("newsletter unsubscribe failed", { error: String(err) });
    return NextResponse.json(
      { error: "Unsubscribe is temporarily unavailable. Please try again shortly." },
      { status: 503 }
    );
  }
}
