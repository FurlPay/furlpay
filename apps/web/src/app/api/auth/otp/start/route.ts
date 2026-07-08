import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { startOtp, otpIsLive } from "@/lib/auth/otp";
import { rateLimitOr429 } from "@/lib/rateLimit";

const Body = z.object({
  to: z.string().min(4), // E.164 phone, or email when channel="email"
  channel: z.enum(["sms", "call", "email", "whatsapp"]).default("sms"),
});

// POST /api/auth/otp/start — send a one-time passcode to a phone (or email).
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { to, channel } = parsed.data;

  // SMS-pumping / spam guard: a few sends per destination per window, keyed by
  // IP + destination so one attacker can't burn a victim's budget from afar.
  const limited = rateLimitOr429(req, "otp.start", { limit: 5, windowMs: 10 * 60_000 }, to);
  if (limited) return limited;

  // Basic E.164 sanity for phone channels before we spend a provider request.
  if (channel !== "email" && !/^\+\d{7,15}$/.test(to)) {
    return NextResponse.json({ error: "Phone must be in E.164 format, e.g. +14155550123" }, { status: 400 });
  }

  try {
    const result = await startOtp(to, channel);
    // devCode is only ever present in mock mode; surfaced so local testing works.
    return NextResponse.json({
      sent: result.sent,
      channel: result.channel,
      live: otpIsLive(),
      ...(result.devCode ? { devCode: result.devCode } : {}),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to send code" }, { status: 502 });
  }
}
