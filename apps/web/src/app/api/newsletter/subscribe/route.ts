import { NextRequest, NextResponse } from "next/server";
import { VALID_CATEGORIES, readSubscribers, writeSubscribers } from "@/lib/newsletter";
import { newsletterWelcome, sendEmail } from "@/lib/email";
import { clientIp, rateLimitOr429 } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/newsletter/subscribe — category-based (double-opt-in-ready) signup
// with GDPR consent records. Public route.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "newsletter.subscribe", { limit: 5, windowMs: 60_000 });
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

  const cats = Array.isArray(categories) ? categories.filter((c) => VALID_CATEGORIES.has(c)) : [];
  if (cats.length === 0) {
    return NextResponse.json(
      { error: "Please select at least one notification category." },
      { status: 400 }
    );
  }

  const subscribers = readSubscribers();
  const existing = subscribers.find((s) => s.email.toLowerCase() === email.toLowerCase());

  if (existing) {
    existing.categories = Array.from(new Set([...existing.categories, ...cats]));
    existing.consentTimestamp = new Date().toISOString();
    writeSubscribers(subscribers);
    return NextResponse.json({
      success: true,
      message: "Preferences updated! Your subscription has been refreshed.",
    });
  }

  subscribers.push({
    email: email.toLowerCase(),
    categories: cats,
    consentTimestamp: new Date().toISOString(),
    ip: clientIp(req),
  });
  writeSubscribers(subscribers);

  // Fire-and-forget welcome email (mock-logs without RESEND_API_KEY).
  const welcome = newsletterWelcome(cats);
  void sendEmail({ to: email, ...welcome });

  return NextResponse.json({
    success: true,
    message: "You're subscribed! Check your inbox to confirm.",
  });
}
