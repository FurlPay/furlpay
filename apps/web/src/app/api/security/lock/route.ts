import { NextRequest, NextResponse } from "next/server";
import { getAccountDurable, persistAccount } from "@/lib/store";
import { verifyLockToken } from "@/lib/lockLink";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { securityAlertEmail } from "@/lib/emailTemplates";

export const dynamic = "force-dynamic";

// GET /api/security/lock?u=<userId>&e=<expiry>&t=<hmac> — one-click account
// lock from transactional emails. Session-less by design (an ATO victim may
// be locked out of login); the HMAC token authorizes exactly one restrictive
// action. GET because email clients follow links — the action is idempotent
// and only ever narrows access. Unlock requires a full authenticated session
// (PATCH /api/profile).
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "security.lock", { limit: 10, windowMs: 600_000 });
  if (limited) return limited;

  const url = new URL(req.url);
  const u = url.searchParams.get("u") ?? "";
  const e = Number(url.searchParams.get("e"));
  const t = url.searchParams.get("t") ?? "";

  if (!verifyLockToken(u, e, t)) {
    return NextResponse.json({ error: "Invalid or expired lock link" }, { status: 401 });
  }
  const account = await getAccountDurable(u);
  if (!account) {
    return NextResponse.json({ error: "Invalid or expired lock link" }, { status: 401 });
  }

  const alreadyLocked = account.user.security.accountLocked;
  account.user.security.accountLocked = true;
  // Awaited: the lock must be durable before we tell the victim it's done.
  await persistAccount(u);
  audit("account.locked", u, { via: "email_lock_link", alreadyLocked });

  if (!alreadyLocked && account.user.email) {
    void sendEmail({
      to: account.user.email,
      category: "security",
      idempotencyKey: `lock-${u}-${new Date().toISOString().slice(0, 10)}`,
      ...securityAlertEmail({
        name: account.user.name,
        event: "Account locked",
        detail: "Locked via the emergency link in a transaction email.",
        dateIso: new Date().toISOString(),
      }),
    });
  }

  // Human-readable confirmation — this lands in a browser tab from an email.
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Account locked</title></head>
<body style="margin:0;background:#000;color:#fff;font-family:Inter,system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="max-width:420px;padding:32px;text-align:center">
<h1 style="font-size:22px;margin:0 0 12px">Your account is locked.</h1>
<p style="color:#bbb;font-size:14px;line-height:1.6;margin:0 0 20px">All money movement is suspended. To restore access, sign in with your passkey and unlock from Security settings, or contact support@furlpay.com.</p>
<a href="https://furlpay.com/login" style="display:inline-block;background:#00E599;color:#000;font-weight:700;font-size:14px;text-decoration:none;padding:12px 24px;border-radius:24px">Sign in to review</a>
</div></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
