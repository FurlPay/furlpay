import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { kvSetNx } from "@/lib/kv";
import { requireUser } from "@/lib/authz";
import { getAccountDurable } from "@/lib/store";
import { isAccountDeleted } from "@/lib/accountDeletion";
import { currentEpoch } from "@/lib/sessionEpoch";
import { setSessionCookie, signSession, tokenFromRequest } from "@/lib/session";
import { linkedTelegramAccount, privateHeaders, telegramUnavailable, verifiedTelegramRequest } from "@/lib/telegram-mini-app/auth";
import { telegramStartRoute } from "@/lib/telegram-mini-app/config";
import { TelegramAuthError, telegramAuthMaxAge } from "@/lib/telegram-mini-app/verify";

export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "auth.telegram", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const identity = await verifiedTelegramRequest(req);
    if (identity instanceof NextResponse) return identity;
    const userId = await linkedTelegramAccount(identity.user.id);
    if (!userId) return NextResponse.json({ status: "link_required", name: identity.user.first_name }, { headers: privateHeaders });
    if (tokenFromRequest(req)) {
      const existing = await requireUser(req);
      if (existing.ok) {
        if (existing.account.user.id !== userId) return NextResponse.json({ error: "A different FurlPay account is signed in. Sign out before continuing." }, { status: 409, headers: privateHeaders });
        return NextResponse.json({ status: "active" }, { headers: privateHeaders });
      }
    }
    const account = await getAccountDurable(userId);
    if (!account || account.user.security.accountLocked || await isAccountDeleted(userId)) return NextResponse.json({ error: "This account is unavailable." }, { status: 403, headers: privateHeaders });
    // A launch can mint only one session. TTL covers future timestamp tolerance too.
    if (!await kvSetNx(`telegram:launch:${identity.hash}`, 1, telegramAuthMaxAge() + 60)) return NextResponse.json({ error: "This launch was already used. Close and reopen the mini app." }, { status: 401, headers: privateHeaders });
    const token = await signSession({ sub: userId, roles: ["user"], sepoch: await currentEpoch(userId), amr: ["telegram"] });
    const res = NextResponse.json({ status: "active", route: telegramStartRoute(identity.startParam) }, { headers: privateHeaders });
    setSessionCookie(res, token);
    // Use the existing session, revocation and account gates. No second token store.
    return res;
  } catch (error) {
    if (error instanceof TelegramAuthError) return NextResponse.json({ error: error.message }, { status: 401, headers: privateHeaders });
    return telegramUnavailable();
  }
}
