import { createHmac, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";

// GET /api/support/sso[?return_to=/hc/...] — Zendesk JWT SSO handoff.
//
// Dormant until an enterprise help desk exists: 404s unless BOTH
// ZENDESK_SUBDOMAIN and ZENDESK_SHARED_SECRET are set (Zendesk admin →
// Account → Security → End users → JWT). Zendesk's /access/jwt only accepts a
// form POST (CORS blocks XHR), so this renders a self-submitting form.
//
// The JWT is HS256 with iat + a random jti (Zendesk's replay protection) and
// external_id = our user id, so a future email change doesn't fork the
// support identity. Signed here, server-side — the shared secret can mint a
// session for ANY user, so it must never reach a client.

const zendeskSubdomain = () => process.env.ZENDESK_SUBDOMAIN;
const zendeskSecret = () => process.env.ZENDESK_SHARED_SECRET;

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function signZendeskJwt(user: { id: string; name: string; email: string }, secret: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iat: Math.floor(Date.now() / 1000),
      jti: randomUUID(),
      name: user.name,
      email: user.email,
      external_id: user.id,
    })
  );
  const sig = b64url(createHmac("sha256", secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET(req: NextRequest) {
  const subdomain = zendeskSubdomain();
  const secret = zendeskSecret();
  if (!subdomain || !secret || !/^[a-z0-9-]+$/.test(subdomain)) {
    return NextResponse.json({ error: "Support SSO is not configured" }, { status: 404 });
  }

  // This endpoint MINTS A CREDENTIAL, and two things that normally bound a
  // route do not reach it: the middleware baseline covers MUTATING_METHODS
  // only, and check-route-security.mjs audits only mutating handlers — so a GET
  // is invisible to both. Nothing was limiting how fast sessions could be
  // minted. 20/min is far above a browser flow that runs once per visit to the
  // help centre, and far below anything worth automating.
  const limited = await rateLimitOr429(req, "support.sso", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) {
    // A help-center visitor without a session goes to login and comes back.
    const here = "/api/support/sso" + (req.nextUrl.search || "");
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(here)}`, req.url));
  }
  const user = auth.account.user;

  // return_to must be a PATH on the Zendesk host — anything absolute is an
  // open-redirect vector and is dropped.
  const rawReturn = req.nextUrl.searchParams.get("return_to") ?? "";
  const returnTo =
    rawReturn.startsWith("/") && !rawReturn.startsWith("//")
      ? `https://${subdomain}.zendesk.com${rawReturn}`
      : "";

  const jwt = signZendeskJwt({ id: user.id, name: user.name, email: user.email }, secret);

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Opening FurlPay Support…</title></head>
<body style="background:#000;color:#888;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">
  <p>Opening FurlPay Support…</p>
  <form id="sso" action="https://${subdomain}.zendesk.com/access/jwt" method="POST">
    <input type="hidden" name="jwt" value="${escapeAttr(jwt)}" />
    ${returnTo ? `<input type="hidden" name="return_to" value="${escapeAttr(returnTo)}" />` : ""}
  </form>
  <script>document.getElementById("sso").submit();</script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The page embeds a live credential — it must never be cached.
      "Cache-Control": "no-store",
    },
  });
}
