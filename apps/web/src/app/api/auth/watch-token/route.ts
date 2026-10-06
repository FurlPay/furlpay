import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { signSession } from "@/lib/session";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// POST /api/auth/watch-token — mint the Wear OS watch's credential (SEC-P2-004).
//
// The phone used to hand the watch its OWN session token, the same bearer that
// moves money. This mints a scoped one instead:
//   * `watch: true`: refused by verifySession() everywhere except requireUser(),
//     which confines it to lib/watchScope.ts (read-only plus card freeze);
//   * the phone session's jti and epoch: the phone's logout, a credential
//     change or "log out everywhere" ends it at the same moment;
//   * 1h like any session, and not refreshable (/api/auth/refresh is not in
//     the watch scope); the phone pushes a fresh one on each sync.
//
// Only a full phone session may call this: a watch token is already refused
// here by requireUser's scope check, and a connector (MCP) token is not mapped.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const { claims } = auth;
  if (claims.watch === true || (claims as { mcp?: boolean }).mcp === true || claims.guest) {
    return NextResponse.json({ error: "A phone session is required" }, { status: 403 });
  }

  const limited = await rateLimitOr429(req, "auth.watch_token", { limit: 30, windowMs: 60_000 }, claims.sub);
  if (limited) return limited;

  const token = await signSession({
    sub: claims.sub,
    jti: claims.jti,
    roles: ["user"], // never an elevated role, whatever the phone holds
    watch: true,
    auth_time: claims.auth_time ?? claims.iat,
    ...(claims.sepoch ? { sepoch: claims.sepoch } : {}),
  });
  audit("auth.watch_token_issued", claims.sub, {});
  return NextResponse.json({ token, expiresIn: 3600 }, { headers: { "Cache-Control": "no-store" } });
}
