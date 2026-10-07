import { NextRequest, NextResponse } from "next/server";
import { recordProductEvent } from "@/lib/analytics/events";
import { tokenFromRequest, verifySession, revokeSession, clearSessionCookie } from "@/lib/session";
import { audit } from "@/lib/audit";
import { bumpSessionEpoch } from "@/lib/sessionEpoch";
import { rateLimitOr429 } from "@/lib/rateLimit";

// POST /api/auth/logout — revoke the session token (by jti) AND clear the
// cookie. Revocation matters: without it a stolen token stays valid until
// expiry even after the user "logs out".
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "auth.logout", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const claims = await verifySession(tokenFromRequest(req));
  if (claims) {
    const durable = await revokeSession(claims.jti); // dead on every instance, not just this one
    if (!durable && claims.sub) {
      // The cross-instance denylist (KV) did not take the write, so on other
      // instances this token would live until expiry. Fall back to the session
      // epoch, which is persisted in Postgres: every token for this account
      // dies on its next request. Other devices sign in again — the price of a
      // logout that actually holds while KV is down.
      try {
        await bumpSessionEpoch(claims.sub);
        audit("auth.logout.epoch_fallback", claims.sub);
      } catch {
        audit("auth.logout.not_durable", claims.sub);
      }
    }
    audit("auth.logout", claims.sub);
    recordProductEvent({ name: "logout", eventId: `${claims.sub}:${claims.jti ?? Date.now()}`, userId: claims.sub, route: "/api/auth/logout" });
  }
  const res = NextResponse.json({ success: true });
  clearSessionCookie(res);
  return res;
}
