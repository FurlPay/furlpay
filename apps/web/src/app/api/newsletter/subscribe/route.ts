import { NextRequest, NextResponse } from "next/server";
import { VALID_CATEGORIES, readSubscribers, writeSubscribers } from "@/lib/newsletter";
import { newsletterWelcome, sendEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

// ── In-memory rate limiter (max 5 requests/minute per IP) ───────────
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(ip) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) return true;
  recent.push(now);
  rateLimitMap.set(ip, recent);
  return false;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/newsletter/subscribe — category-based (double-opt-in-ready) signup
// with GDPR consent records. Public route.
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429 }
    );
  }

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
    ip,
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
