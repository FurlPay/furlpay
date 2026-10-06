import { NextRequest, NextResponse } from "next/server";
import { recordProductEvent } from "@/lib/analytics/events";
import { tokenFromRequest, verifySession, revokeSession, clearSessionCookie } from "@/lib/session";
import { audit } from "@/lib/audit";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { bumpSessionEpoch } from "@/lib/sessionEpoch";
import { log } from "@/lib/log";

// POST /api/auth/logout — revoke the session token (by jti) AND clear the
// cookie. Revocation matters: without it a stolen token stays valid until
// expiry even after the user "logs out".
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "auth.logout", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const claims = await verifySession(tokenFromRequest(req));
  if (claims) {
    const durable = await revokeSession(claims.jti);
    if (!durable) {
      // kv could not record the revocation, so other instances would keep
      // honouring this session (SEC-P2-002). Fall back to the account's session
      // epoch, stored with the account rather than in kv: it ends every session
      // for this user, more than they asked for, but it is the only revocation
      // that survives the outage.
      try {
        await bumpSessionEpoch(claims.sub);
        audit("auth.logout.epoch_fallback", claims.sub);
      } catch (e) {
        audit("auth.logout.not_durable", claims.sub);
        log.error("logout: revocation not durable and epoch bump failed", { userId: claims.sub, error: (e as Error).message });
      }
    }
    audit("auth.logout", claims.sub);
    recordProductEvent({ name: "logout", eventId: `${claims.sub}:${claims.jti ?? Date.now()}`, userId: claims.sub, route: "/api/auth/logout" });
  }
  const res = NextResponse.json({ success: true });
  clearSessionCookie(res);
  return res;
}
