import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { trustedClientIp } from "@/lib/clientIp";
import { publicOrigin } from "@/lib/publicOrigin";
import { audit } from "@/lib/audit";
import {
  normalizeHandle,
  bindHandleToUser,
  WALLET_GRANT_SCOPES,
  HANDLE_MAX,
} from "@/lib/walletHandles";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/wallet/authorize — the consent step of the FurlPay Wallet
// reservation. The signed-in user authorizes the "FurlPay Wallet" client to
// read their account (profile / balances / transactions) and, in the same
// action, binds the reserved handle to their account.
//
// Security:
//   * requireUser — a handle is bound to a *verified* account, never anonymous.
//     An unauthenticated caller gets 401 (the consent UI then routes to login).
//   * Same-origin — a cross-site POST cannot ride the session cookie to claim a
//     handle on the user's behalf.
//   * Zod body + rate limit; the bind itself is atomic (kvSetNx), so a handle
//     is owned by exactly one account and a race resolves to a single winner.
// ---------------------------------------------------------------------------

const AuthorizeSchema = z.object({
  tag: z.string().min(1).max(HANDLE_MAX + 8),
});

export async function POST(req: NextRequest) {
  // Tighter than the mutating baseline: authorizing is a write and one account
  // only ever needs a handful.
  const limited = await rateLimitOr429(req, "wallet.authorize", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  // CSRF: this session-cookie write must originate from our own origin. A
  // browser sends Origin on POST; reject anything that isn't us. Compared with
  // the PUBLIC origin: on ECS req.nextUrl.host is the bind address.
  const origin = req.headers.get("origin");
  if (origin && !sameHost(origin, publicOrigin(req))) {
    return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  }

  const body = await validateBody(req, AuthorizeSchema);
  if (body instanceof NextResponse) return body;

  const v = normalizeHandle(body.tag);
  if (!v.ok || !v.normalized) {
    return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
  }

  const userId = auth.account.user.id;
  let result;
  try {
    result = await bindHandleToUser({
      normalized: v.normalized,
      userId,
      scopes: WALLET_GRANT_SCOPES,
      ip: trustedClientIp(req),
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not reserve that name. Try again." },
      { status: 503 }
    );
  }

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: `@${v.normalized} is already reserved.` },
      { status: 409 }
    );
  }

  audit("wallet.handle_reserved", userId, { handle: v.normalized, scopes: WALLET_GRANT_SCOPES });
  return NextResponse.json({ ok: true, handle: v.normalized, scopes: WALLET_GRANT_SCOPES });
}

/** Origin header vs our public origin, by host; a malformed Origin is not us. */
function sameHost(origin: string, ours: string): boolean {
  try {
    return new URL(origin).host === new URL(ours).host;
  } catch {
    return false;
  }
}
