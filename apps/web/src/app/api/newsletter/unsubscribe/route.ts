import { NextRequest, NextResponse } from "next/server";
import { readSubscribers, writeSubscribers } from "@/lib/newsletter";
import { rateLimitOr429 } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/newsletter/unsubscribe — one-click unsubscribe (RFC 8058-friendly).
// Optional `categories` for selective opt-out; omitted = full unsubscribe.
// Always returns success (does not reveal whether an email was subscribed).
export async function POST(req: NextRequest) {
  // Public mutation of subscriber state — throttle enumeration/abuse.
  const limited = await rateLimitOr429(req, "newsletter.unsubscribe", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  let body: { email?: string; categories?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { email, categories } = body;

  if (!email || typeof email !== "string" || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }

  const subscribers = readSubscribers();
  const idx = subscribers.findIndex((s) => s.email.toLowerCase() === email.toLowerCase());

  if (idx === -1) {
    return NextResponse.json({
      success: true,
      message: "If that email is subscribed, it has been removed.",
    });
  }

  // Selective unsubscribe.
  if (Array.isArray(categories) && categories.length > 0) {
    const remaining = subscribers[idx].categories.filter((c) => !categories.includes(c));
    if (remaining.length > 0) {
      subscribers[idx].categories = remaining;
      writeSubscribers(subscribers);
      return NextResponse.json({
        success: true,
        message: "Updated. You'll still receive updates for your remaining preferences.",
      });
    }
    // Nothing left — fall through to full unsubscribe.
  }

  subscribers.splice(idx, 1);
  writeSubscribers(subscribers);
  return NextResponse.json({
    success: true,
    message: "You've been fully unsubscribed. We're sorry to see you go.",
  });
}
