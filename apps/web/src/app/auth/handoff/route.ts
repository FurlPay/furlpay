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
 *  to an attacker's host just because they controlled `next`.
 *
 *  String-prefix checks are NOT enough here: the WHATWG URL parser strips ASCII
 *  tab/newline/CR and folds backslashes into slashes for http(s), so raw inputs
 *  that don't literally start with "//" ("/\\evil.com", "/<TAB>/evil.com")
 *  still resolve cross-origin. We instead resolve ONCE against the real origin,
 *  reject anything whose origin changed, and return the resolved URL object so
 *  the caller redirects to it verbatim — re-resolving an extracted path string
 *  (e.g. a normalized "//evil.com") would re-open the hole. */
function safeNextUrl(raw: string | null, origin: string): URL {
  const fallback = new URL("/travel", origin);
  if (!raw) return fallback;
  let u: URL;
  try {
    u = new URL(raw, origin);
  } catch {
    return fallback;
  }
  return u.origin === origin ? u : fallback;
}

function fail(req: NextRequest, reason: string): NextResponse {
  const url = new URL("/login", req.nextUrl.origin);
  url.searchParams.set("error", reason);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const nextUrl = safeNextUrl(req.nextUrl.searchParams.get("next"), req.nextUrl.origin);
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
