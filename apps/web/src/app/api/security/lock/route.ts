import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAccountDurable, persistAccount } from "@/lib/store";
import { verifyLockToken } from "@/lib/lockLink";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { securityAlertEmail } from "@/lib/emailTemplates";

export const dynamic = "force-dynamic";

// /api/security/lock?u=<userId>&e=<expiry>&t=<hmac> — the "lock my account"
// link in security emails.
//
// Session-less by design: the person using it may be the victim of a takeover
// and unable to sign in. The HMAC over (userId, expiry) in the URL is the
// authorization, and the only thing it authorizes is restricting that one
// account. Unlock needs a full authenticated session (PATCH /api/profile).
//
//   GET   shows a confirmation page. It changes NOTHING and reads no account.
//   POST  performs the lock, from the button on that page.
//
// WHY TWO STEPS. This used to lock on GET. Mail gateways, link-preview bots and
// "safe link" scanners fetch every URL in a message before a person sees it,
// so a locking GET locks the account of everyone whose mail is scanned, the
// moment the email is delivered. A scanner does not press a button. Viewing is
// GET; acting is POST.
//
// The token is deliberately NOT single-use: locking is idempotent and can only
// narrow access, so a replay does nothing a first use did not, and a
// consumed-token store would be one more thing that fails closed against the
// victim. The limits that matter are the expiry inside the HMAC and the rate
// limit below.

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  // The token is in the URL; never hand it to another origin.
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(title: string, body: string, status: number): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${esc(title)}</title></head>
<body style="margin:0;background:#000;color:#fff;font-family:Inter,system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="max-width:420px;padding:32px;text-align:center">${body}</div></body></html>`,
    { status, headers: HEADERS }
  );
}

const INVALID = () =>
  page(
    "Link expired",
    `<h1 style="font-size:22px;margin:0 0 12px">This link is invalid or has expired.</h1>
<p style="color:#bbb;font-size:14px;line-height:1.6;margin:0">To secure your account, sign in and lock it from Security settings, or contact support@furlpay.com.</p>`,
    401
  );

const TokenSchema = z.object({
  u: z.string().min(1).max(128),
  e: z.coerce.number().int().positive().max(99_999_999_999),
  t: z.string().min(16).max(128),
});

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "security.lock.view", { limit: 20, windowMs: 600_000 });
  if (limited) return limited;

  const q = new URL(req.url).searchParams;
  const token = TokenSchema.safeParse({ u: q.get("u") ?? "", e: q.get("e") ?? "", t: q.get("t") ?? "" });
  if (!token.success || !verifyLockToken(token.data.u, token.data.e, token.data.t)) return INVALID();

  // No account read and no write: a fetch of this URL has no effect.
  return page(
    "Lock your account",
    `<h1 style="font-size:22px;margin:0 0 12px">Lock your FurlPay account?</h1>
<p style="color:#bbb;font-size:14px;line-height:1.6;margin:0 0 20px">Locking suspends all money movement on the account straight away. To unlock it you will need to sign in with your passkey.</p>
<form method="post" action="/api/security/lock" style="margin:0">
<input type="hidden" name="u" value="${esc(token.data.u)}"/>
<input type="hidden" name="e" value="${token.data.e}"/>
<input type="hidden" name="t" value="${esc(token.data.t)}"/>
<button type="submit" style="background:#00E599;color:#000;font-weight:700;font-size:14px;border:0;padding:12px 24px;border-radius:24px;cursor:pointer">Lock my account</button>
</form>`,
    200
  );
}

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "security.lock", { limit: 10, windowMs: 600_000 });
  if (limited) return limited;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return INVALID();
  }
  const token = TokenSchema.safeParse({ u: form.get("u"), e: form.get("e"), t: form.get("t") });
  if (!token.success || !verifyLockToken(token.data.u, token.data.e, token.data.t)) return INVALID();
  const { u } = token.data;

  const account = await getAccountDurable(u);
  // Same answer as a bad token: the page must not confirm which ids exist.
  if (!account) return INVALID();

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

  return page(
    "Account locked",
    `<h1 style="font-size:22px;margin:0 0 12px">Your account is locked.</h1>
<p style="color:#bbb;font-size:14px;line-height:1.6;margin:0 0 20px">All money movement is suspended. To restore access, sign in with your passkey and unlock from Security settings, or contact support@furlpay.com.</p>
<a href="https://furlpay.com/login" style="display:inline-block;background:#00E599;color:#000;font-weight:700;font-size:14px;text-decoration:none;padding:12px 24px;border-radius:24px">Sign in to review</a>`,
    200
  );
}
