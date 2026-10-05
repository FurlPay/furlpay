import { currentEpoch } from "@/lib/sessionEpoch";
import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { z } from "zod";
import { CODE_VERIFIER, redeemNativeCode } from "@/lib/nativeSession";
import { signSession } from "@/lib/session";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";

const Body = z
  .object({
    code: z.string().min(16).max(256),
    // PKCE (RFC 7636). Required: a code is only redeemable by the app instance
    // that holds the verifier for the challenge it was minted against.
    code_verifier: z.string().regex(CODE_VERIFIER),
  })
  .strict();

// POST /api/auth/native/exchange — the native app trades a one-time handoff code
// (delivered to it via a furlpay:// deep link) plus its PKCE code_verifier for a
// session JWT.
//
// Public by necessity: the caller has no session yet. The code alone is NOT a
// credential any more — a custom-scheme deep link can be intercepted by another
// app on Android, so possession of the code proves nothing. The verifier never
// left the app. Single-use (a failed verifier burns the code), 60s TTL.
// Rate-limited because it is an unauthenticated endpoint that mints sessions.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "auth.native.exchange", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;

  const result = await redeemNativeCode(body.code, body.code_verifier);
  if (!result.ok) {
    // One message for every failure: telling a caller "wrong verifier" versus
    // "already used" would help someone probing intercepted codes.
    return NextResponse.json({ error: "Code is invalid, expired, or already used." }, { status: 401 });
  }
  const payload = result.payload;

  const token = await signSession({
    sub: payload.sub,
    safe: payload.safe,
    roles: payload.roles ?? ["user"],
    sepoch: await currentEpoch(payload.sub),
  });
  audit("auth.handoff_redeemed", payload.sub, { direction: "web_to_native", provider: payload.provider });
  return NextResponse.json({ token });
}
