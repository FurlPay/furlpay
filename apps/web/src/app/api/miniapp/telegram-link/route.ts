import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import {
  claimFreshFurlPayAuth,
  linkedTelegramAccount,
  linkTelegramAccount,
  privateHeaders,
  telegramUnavailable,
  unlinkTelegramAccount,
  verifiedTelegramRequest,
} from "@/lib/telegram-mini-app/auth";
import { TelegramAuthError } from "@/lib/telegram-mini-app/verify";

const REAUTH = {
  error: "Sign in with a FurlPay passkey or email/phone code to confirm account ownership, then try again.",
  code: "reauth_required",
} as const;

// POST /api/miniapp/telegram-link — bind the verified Telegram identity in the
// request (raw initData, HMAC-checked server-side) to the signed-in FurlPay
// account. Requires a fresh FurlPay sign-in or step-up; a plain INSERT against
// two unique constraints means neither side can ever be claimed twice, even by
// concurrent requests.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "miniapp.telegram-link", { limit: 5, windowMs: 600_000 }, auth.account.user.id);
  if (limited) return limited;
  try {
    const identity = await verifiedTelegramRequest(req);
    if (identity instanceof NextResponse) return identity;
    const owner = await linkedTelegramAccount(identity.user.id);
    if (owner === auth.account.user.id) return NextResponse.json({ status: "linked" }, { headers: privateHeaders });
    if (owner) {
      return NextResponse.json({ error: "One of these accounts is already linked. Contact support to change the link." }, { status: 409, headers: privateHeaders });
    }
    if (!(await claimFreshFurlPayAuth(auth.account.user.id, auth.claims))) return NextResponse.json(REAUTH, { status: 403, headers: privateHeaders });
    if (!(await linkTelegramAccount(identity.user.id, auth.account.user.id))) {
      return NextResponse.json({ error: "One of these accounts is already linked. Contact support to change the link." }, { status: 409, headers: privateHeaders });
    }
    return NextResponse.json({ status: "linked" }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof TelegramAuthError) return NextResponse.json({ error: error.message }, { status: 401, headers: privateHeaders });
    return telegramUnavailable();
  }
}

// DELETE /api/miniapp/telegram-link — the signed-in account removes ITS OWN
// Telegram link. Same fresh-authentication rule as linking: a stolen session
// must not be able to detach the owner's sign-in method quietly. Sessions
// already issued are not revoked here; the FurlPay sign-out does that.
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "miniapp.telegram-link", { limit: 5, windowMs: 600_000 }, auth.account.user.id);
  if (limited) return limited;
  try {
    if (!(await claimFreshFurlPayAuth(auth.account.user.id, auth.claims))) return NextResponse.json(REAUTH, { status: 403, headers: privateHeaders });
    await unlinkTelegramAccount(auth.account.user.id);
    return NextResponse.json({ status: "unlinked" }, { headers: privateHeaders });
  } catch {
    return telegramUnavailable();
  }
}
