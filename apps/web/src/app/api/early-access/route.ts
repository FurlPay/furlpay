import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { kvGet, kvIncr, kvSet, kvSetNx } from "@/lib/kv";
import { sendEmail } from "@/lib/email";
import { earlyAccessWelcome } from "@/lib/emailTemplates";
import { rateLimitOr429 } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// POST /api/early-access — join the early-access list. Public route.
// Durable on the KV layer: one record per email (earlyaccess:member:*), a
// monotonically increasing position counter, and idempotent re-signups (the
// same email keeps its original position). GET returns the public count.

const Body = z.object({
  email: z.string().email().max(320),
  name: z.string().max(120).optional(),
  country: z.string().max(80).optional(),
  interest: z
    .enum(["cards", "payments", "travel", "agents", "developers", "everything"])
    .optional(),
});

interface Member {
  position: number;
  name?: string;
  country?: string;
  interest?: string;
  joinedAt: string;
}

const MEMBER_KEY = (email: string) => `earlyaccess:member:${email.toLowerCase()}`;
const COUNT_KEY = "earlyaccess:count";
// Counter and records never expire — a waitlist is permanent state. kvIncr
// requires a window; ~10 years is effectively forever and refreshes on use.
const FOREVER = 10 * 365 * 86_400;

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "early-access", { limit: 5, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }
  const { email, name, country, interest } = parsed.data;

  const existing = await kvGet<Member>(MEMBER_KEY(email));
  if (existing) {
    // Re-signup updates preferences but keeps the original position.
    const updated: Member = { ...existing, name: name ?? existing.name, country: country ?? existing.country, interest: interest ?? existing.interest };
    await kvSet(MEMBER_KEY(email), updated, FOREVER);
    return NextResponse.json({ success: true, position: existing.position, returning: true });
  }

  const position = await kvIncr(COUNT_KEY, FOREVER);
  const member: Member = { position, name, country, interest, joinedAt: new Date().toISOString() };
  // NX guards a double-submit race: the loser keeps the winner's record.
  const won = await kvSetNx(MEMBER_KEY(email), member, FOREVER);
  if (!won) {
    const record = await kvGet<Member>(MEMBER_KEY(email));
    return NextResponse.json({ success: true, position: record?.position ?? position, returning: true });
  }

  void sendEmail({ to: email, category: "welcome", ...earlyAccessWelcome(position) });

  return NextResponse.json({ success: true, position });
}

// GET /api/early-access — public membership count for social proof.
export async function GET() {
  const count = (await kvGet<number>(COUNT_KEY)) ?? 0;
  return NextResponse.json({ count: Number(count) || 0 });
}
