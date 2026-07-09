import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { sendEmail, creatorWelcome } from "@/lib/email";
import {
  buildCreatorView,
  tierFor,
  referralCode,
  travelShopUrl,
  applicationFromEmail,
  type CreatorApplication,
} from "@/lib/creator";

// /api/ambassadors — FurlPay Creator Program.
//   POST  → submit an application (public). Records it, emails the team, and
//           sends the applicant their welcome + dashboard link.
//   GET   ?email= → the creator's dashboard view (tier, earnings, links, payouts).
//   PATCH ?email= → update editable profile fields (name, bio, avatar, …).
// Mock-safe: records in memory; emails log to console without RESEND_API_KEY.

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const g = globalThis as unknown as { __ambassadors?: CreatorApplication[] };
const applicants = g.__ambassadors ?? (g.__ambassadors = []);

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "ambassadors", { limit: 5, windowMs: 600_000 });
  if (limited) return limited;

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

  const entry: CreatorApplication = { name, email, platform, handle, audience, niche, wallet, at: new Date().toISOString() };
  // De-dupe by email so re-applying refreshes rather than stacks.
  const existing = applicants.findIndex((a) => a.email.toLowerCase() === email.toLowerCase());
  if (existing !== -1) applicants.splice(existing, 1);
  applicants.unshift(entry);
  if (applicants.length > 1000) applicants.length = 1000;

  const tier = tierFor(audience);
  const code = referralCode(name, email);

  // Notify the team.
  void sendEmail({
    to: process.env.AMBASSADORS_INBOX || "hello@furlpay.com",
    replyTo: email,
    subject: `Creator application: ${name} · ${platform} @${handle} · ${tier.name}`,
    html: `<p><b>${name}</b> (${email}) applied to the Furlpay Creator Program.</p>
<ul>
<li>Platform: ${platform} — @${handle}</li>
<li>Audience: ${audience || "n/a"}</li>
<li>Tier: ${tier.name} (${tier.commission}%)</li>
<li>Niche: ${niche || "n/a"}</li>
<li>Payout wallet: ${wallet || "not provided"}</li>
<li>Referral code: ${code}</li>
</ul>`,
    text: `${name} <${email}> · ${platform} @${handle} · ${tier.name} · audience ${audience} · ${niche}`,
  });

  // Welcome the creator with their dashboard link.
  void sendEmail({
    to: email,
    ...creatorWelcome(name, email, {
      tier: tier.name,
      commission: tier.commission,
      referralCode: code,
      travelShopUrl: travelShopUrl(code),
    }),
  });

  console.log(`[ambassadors] application: ${name} <${email}> · ${platform} @${handle} · ${tier.name}`);

  return NextResponse.json({ ok: true, tier: tier.name, referralCode: code });
}

export async function GET(req: NextRequest) {
  const email = str(req.nextUrl.searchParams.get("email"));
  const viewerEmail = str(req.nextUrl.searchParams.get("viewerEmail"));
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "A valid ?email= is required." }, { status: 400 });
  }

  // Prefer the stored application; fall back to an email-derived one so the
  // emailed dashboard link never dead-ends after a serverless cold start.
  const stored = applicants.find((a) => a.email.toLowerCase() === email.toLowerCase());
  const app = stored ?? applicationFromEmail(email);

  return NextResponse.json({ ok: true, found: !!stored, creator: buildCreatorView(app, viewerEmail) });
}


// Max size for an inline avatar data URL (~300 KB encoded — a 256px WebP is far
// smaller, so this is a generous upper bound that still blocks abuse).
const MAX_AVATAR_LEN = 400_000;

export async function PATCH(req: NextRequest) {
  const email = str(req.nextUrl.searchParams.get("email")) || str((await req.clone().json().catch(() => ({}))).email);
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "A valid ?email= is required." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));

  // Validate each field before applying anything.
  const patch: Partial<CreatorApplication> = {};

  if (body.name !== undefined) {
    const name = str(body.name);
    if (name.length < 1 || name.length > 80) {
      return NextResponse.json({ ok: false, error: "Name must be 1–80 characters." }, { status: 400 });
    }
    patch.name = name;
  }
  if (body.bio !== undefined) {
    const bio = str(body.bio);
    if (bio.length > 150) {
      return NextResponse.json({ ok: false, error: "Bio must be 150 characters or fewer." }, { status: 400 });
    }
    patch.bio = bio;
  }
  if (body.country !== undefined) patch.country = str(body.country).slice(0, 56);
  if (body.website !== undefined) {
    const website = str(body.website).slice(0, 200);
    if (website && !/^https?:\/\/|^[\w-]+\.[\w.-]+/.test(website)) {
      return NextResponse.json({ ok: false, error: "Enter a valid website URL." }, { status: 400 });
    }
    patch.website = website;
  }
  if (body.wallet !== undefined) patch.wallet = str(body.wallet).slice(0, 100);
  if (body.avatarUrl !== undefined) {
    const avatarUrl = str(body.avatarUrl);
    if (avatarUrl && !avatarUrl.startsWith("data:image/")) {
      return NextResponse.json({ ok: false, error: "Avatar must be an image." }, { status: 400 });
    }
    if (avatarUrl.length > MAX_AVATAR_LEN) {
      return NextResponse.json({ ok: false, error: "Avatar image is too large." }, { status: 413 });
    }
    patch.avatarUrl = avatarUrl || undefined;
  }

  // Upsert: patch the stored record, or create one from the email so edits
  // work even after a cold start (persists for the process lifetime).
  let record = applicants.find((a) => a.email.toLowerCase() === email.toLowerCase());
  if (!record) {
    record = applicationFromEmail(email);
    applicants.unshift(record);
  }
  Object.assign(record, patch, { updatedAt: new Date().toISOString() });

  console.log(`[ambassadors] profile updated: <${email}> · ${Object.keys(patch).join(", ") || "no-op"}`);
  return NextResponse.json({ ok: true, creator: buildCreatorView(record) });
}
