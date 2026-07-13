import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { z } from "zod";
import { redeemNativeCode } from "@/lib/nativeSession";
import { signSession } from "@/lib/session";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";

const Body = z.object({ code: z.string().min(16).max(256) });

// POST /api/auth/native/exchange — the native app trades a one-time handoff code
// (delivered to it via a furlpay:// deep link) for a session JWT.
//
// Public by necessity: the caller has no session yet — the code IS the
// credential. It is single-use and expires in 60s, so a leaked one is inert.
// Rate-limited because it is an unauthenticated endpoint that mints sessions.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "auth.native.exchange", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;

  const payload = await redeemNativeCode(body.code);
  if (!payload) {
    return NextResponse.json({ error: "Code is invalid, expired, or already used." }, { status: 401 });
  }

  const token = await signSession({
    sub: payload.sub,
    safe: payload.safe,
    roles: payload.roles ?? ["user"],
  });
  audit("auth.handoff_redeemed", payload.sub, { direction: "web_to_native", provider: payload.provider });
  return NextResponse.json({ token });
}
