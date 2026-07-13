import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import crypto from "crypto";
import { requireUser } from "@/lib/authz";
import { kvSet } from "@/lib/kv";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";

// POST /api/auth/handoff — mint a one-time code that hands the caller's session
// to a browser (the native app opening furlpay.com/travel in a Custom Tab).
//
// Why not just put the session JWT in the URL? Because a URL is not a secret:
// it lands in browser history, server and CDN access logs, and — since the
// travel pages hotlink remote images — in the `Referer` sent to third parties.
// Our session token is bearer-equivalent spend authority, so leaking one is
// account takeover. Worse, a URL that logs you in is a session-fixation
// primitive: a link with the ATTACKER'S token silently signs the victim into
// the attacker's account, where their next booking or card lands.
//
// So this is the OAuth authorization-code shape instead: an opaque 256-bit code
// that is single-use, expires in 60s, carries no authority itself, and is
// exchanged server-side for a normal HttpOnly cookie (see /auth/handoff).
const TTL_SECONDS = 60;

export interface HandoffPayload {
  sub: string;
  safe?: string;
  roles: string[];
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "auth.handoff", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const code = crypto.randomBytes(32).toString("base64url");
  const payload: HandoffPayload = {
    sub: auth.account.user.id,
    safe: auth.account.user.safeAddress,
    roles: auth.claims.roles ?? ["user"],
  };
  await kvSet(`handoff:${code}`, payload, TTL_SECONDS);

  audit("auth.handoff_minted", auth.account.user.id, {});
  return NextResponse.json({ code, expiresInSeconds: TTL_SECONDS });
}
