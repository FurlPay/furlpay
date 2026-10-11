import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/validate";
import { z } from "zod";
import { startOtp, otpIsLive } from "@/lib/auth/otp";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { recordSignupStartedIfNew } from "@/lib/analytics/events";
import { canonicalEmail } from "@/lib/identity";
import { findUserByIdentity } from "@/lib/store";
import { findUserIdByIdentity } from "@/lib/storeDb";
import { supabaseBackend } from "@/lib/supabase";

const Body = z.object({
  to: z.string().min(4), // E.164 phone, or email when channel="email"
  channel: z.enum(["sms", "call", "email", "whatsapp"]).default("sms"),
});

// POST /api/auth/otp/start — send a one-time passcode to a phone (or email).
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await readJsonBody(req).catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { channel } = parsed.data;
  // ONE canonical destination for everything below, the same form
  // /api/auth/otp/check derives before it looks the code up. This route used to
  // store the code under the address exactly as typed while check looked it up
  // canonicalised, so any email with a capital letter ("John@x.com", which
  // phone keyboards produce by default) could never verify: "No pending code".
  // It also gave each capitalisation of one mailbox its own rate-limit budget.
  const to = channel === "email" ? canonicalEmail(parsed.data.to) : parsed.data.to.trim();

  // SMS-pumping / spam guard: a few sends per destination per window, keyed by
  // IP + destination so one attacker can't burn a victim's budget from afar.
  const limited = await rateLimitOr429(req, "otp.start", { limit: 5, windowMs: 10 * 60_000 }, to);
  if (limited) return limited;

  // Basic E.164 sanity for phone channels before we spend a provider request.
  if (channel !== "email" && !/^\+\d{7,15}$/.test(to)) {
    return NextResponse.json({ error: "Phone must be in E.164 format, e.g. +14155550123" }, { status: 400 });
  }

  try {
    const result = await startOtp(to, channel);
    if (result.sent) {
      const identifier = to;
      const lookup = channel === "email" ? { email: identifier } : { phone: identifier };
      recordSignupStartedIfNew(identifier, channel, async () =>
        supabaseBackend === "supabase" ? Boolean(await findUserIdByIdentity(lookup)) : Boolean(findUserByIdentity(lookup))
      );
    }
    // devCode is only ever present in mock mode; surfaced so local testing works.
    return NextResponse.json({
      sent: result.sent,
      channel: result.channel,
      live: otpIsLive(),
      ...(result.devCode ? { devCode: result.devCode } : {}),
    });
  } catch (e: any) {
    // The SMS/email provider error stays in the log; it can name the provider
    // account state, which an unauthenticated caller must not learn.
    console.error("[otp/start] send failed:", e?.message);
    return NextResponse.json({ error: "Failed to send code" }, { status: 502 });
  }
}
