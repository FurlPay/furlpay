import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { recentStepUp, consumeStepUp } from "@/lib/stepup";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { linkedTelegramAccount, linkTelegramAccount, privateHeaders, telegramUnavailable, verifiedTelegramRequest } from "@/lib/telegram-mini-app/auth";
import { TelegramAuthError } from "@/lib/telegram-mini-app/verify";

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "miniapp.telegram-link", { limit: 5, windowMs: 600_000 }, auth.account.user.id);
  if (limited) return limited;
  try {
    const identity = await verifiedTelegramRequest(req);
    if (identity instanceof NextResponse) return identity;
    if (auth.claims.guest || !await recentStepUp(auth.account.user.id, auth.claims.jti, 300_000)) return NextResponse.json({ error: "Sign in with a FurlPay passkey or email/phone code to confirm account ownership, then reopen Telegram and link your account.", code: "reauth_required" }, { status: 403, headers: privateHeaders });
    const owner = await linkedTelegramAccount(identity.user.id);
    if (owner === auth.account.user.id) return NextResponse.json({ status: "linked" }, { headers: privateHeaders });
    if (owner || !await linkTelegramAccount(identity.user.id, auth.account.user.id)) return NextResponse.json({ error: "One of these accounts is already linked. Contact support to change the link." }, { status: 409, headers: privateHeaders });
    await consumeStepUp(auth.account.user.id, auth.claims.jti);
    return NextResponse.json({ status: "linked" }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof TelegramAuthError) return NextResponse.json({ error: error.message }, { status: 401, headers: privateHeaders });
    return telegramUnavailable();
  }
}
