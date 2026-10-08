import { publicOrigin } from "@/lib/publicOrigin";
import { safeRedirectUrl } from "@/lib/safeRedirect";
import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { kvGet, kvDel, kvSetNx } from "@/lib/kv";
import { signSession, setSessionCookie } from "@/lib/session";
import { audit } from "@/lib/audit";
import type { HandoffPayload } from "@/app/api/auth/handoff/route";
import type { Role } from "@/lib/session";

// GET /auth/handoff?code=<one-time>&next=/travel
//
// Redeems a code minted by POST /api/auth/handoff, sets the normal HttpOnly
// session cookie, and redirects into the app. This is what the native app opens
// in a Custom Tab so the user is not asked to log in a second time.
//
// The code is burned atomically BEFORE it is read, so a replay (a second tab, a
// code scraped from a log) loses the race and gets nothing. It is worthless
// after 60s regardless.

/** Resolve `next` to a same-origin URL, or fall back to /travel — never bounce
 *  to an attacker's host just because they controlled `next`. The rules (control
 *  characters, backslashes, origin change, a resolved "//" path) live in
 *  lib/safeRedirect; the resolved URL object is redirected to verbatim. */
function safeNextUrl(raw: string | null, origin: string): URL {
  return safeRedirectUrl(raw, origin, "/travel");
}

function fail(req: NextRequest, reason: string): NextResponse {
  const url = new URL("/login", publicOrigin(req));
  url.searchParams.set("error", reason);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const nextUrl = safeNextUrl(req.nextUrl.searchParams.get("next"), publicOrigin(req));
  if (!code) return fail(req, "missing_code");

  // Burn first: whoever sets the `used` marker owns the redemption. A replay
  // finds the marker already present and is rejected, even if it races us.
  const won = await kvSetNx(`handoff:used:${code}`, "1", 300);
  if (!won) return fail(req, "code_already_used");

  const payload = await kvGet<HandoffPayload>(`handoff:${code}`);
  await kvDel(`handoff:${code}`);
  if (!payload?.sub) return fail(req, "code_expired");

  // Mint a fresh session for the browser rather than transporting the app's
  // token — the two are then independently revocable.
  const token = await signSession({
    sub: payload.sub,
    safe: payload.safe,
    roles: (payload.roles ?? ["user"]) as Role[],
  });

  const res = NextResponse.redirect(nextUrl);
  setSessionCookie(res, token);
  audit("auth.handoff_redeemed", payload.sub, { next: nextUrl.pathname });
  return res;
}
