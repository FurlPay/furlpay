import { NextRequest, NextResponse } from "next/server";
import { recordProductEvent } from "@/lib/analytics/events";
import { tokenFromRequest, verifySession, revokeSession, clearSessionCookie } from "@/lib/session";
import { audit } from "@/lib/audit";
import { rateLimitOr429 } from "@/lib/rateLimit";

// POST /api/auth/logout — revoke the session token (by jti) AND clear the
// cookie. Revocation matters: without it a stolen token stays valid until
// expiry even after the user "logs out".
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "auth.logout", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const claims = await verifySession(tokenFromRequest(req));
  if (claims) {
    await revokeSession(claims.jti); // durable — dead on every instance, not just this one
    audit("auth.logout", claims.sub);
    recordProductEvent({ name: "logout", eventId: `${claims.sub}:${claims.jti ?? Date.now()}`, userId: claims.sub, route: "/api/auth/logout" });
  }
  const res = NextResponse.json({ success: true });
  clearSessionCookie(res);
  return res;
}
