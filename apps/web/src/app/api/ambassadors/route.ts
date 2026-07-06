import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";

// POST /api/ambassadors — FurlPay Creator Program applications. Public.
// Mock-safe: records in memory + emails the team (logs without RESEND).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Application {
  name: string;
  email: string;
  platform: string;
  handle: string;
  audience: string;
  niche?: string;
  wallet?: string;
  at: string;
}

const g = globalThis as unknown as { __ambassadors?: Application[] };
const applicants = g.__ambassadors ?? (g.__ambassadors = []);

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = str(body.name);
  const email = str(body.email);
  const platform = str(body.platform);
  const handle = str(body.handle).slice(0, 200);
  const audience = str(body.audience);
  const niche = str(body.niche).slice(0, 500);
  const wallet = str(body.wallet).slice(0, 100);

  if (!name || !email || !platform || !handle) {
    return NextResponse.json(
      { ok: false, error: "Name, email, platform and handle are required." },
      { status: 400 }
    );
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "Please enter a valid email." }, { status: 400 });
  }

  const entry: Application = { name, email, platform, handle, audience, niche, wallet, at: new Date().toISOString() };
  applicants.unshift(entry);
  if (applicants.length > 1000) applicants.length = 1000;

  void sendEmail({
    to: process.env.AMBASSADORS_INBOX || "hello@furlpay.com",
    replyTo: email,
    subject: `Creator application: ${name} · ${platform} @${handle}`,
    html: `<p><b>${name}</b> (${email}) applied to the Furlpay Creator Program.</p>
<ul>
<li>Platform: ${platform} — @${handle}</li>
<li>Audience: ${audience || "n/a"}</li>
<li>Niche: ${niche || "n/a"}</li>
<li>Payout wallet: ${wallet || "not provided"}</li>
</ul>`,
    text: `${name} <${email}> · ${platform} @${handle} · audience ${audience} · ${niche}`,
  });
  console.log(`[ambassadors] application: ${name} <${email}> · ${platform} @${handle}`);

  return NextResponse.json({ ok: true });
}
