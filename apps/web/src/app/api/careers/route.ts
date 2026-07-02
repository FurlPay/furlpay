import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";

// POST /api/careers — talent-pipeline interest capture (no open roles yet).
// Public. Mock-safe: records in memory + emails the team (logs without RESEND).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Interest {
  name: string;
  email: string;
  role: string;
  links?: string;
  at: string;
}

const g = globalThis as unknown as { __careers?: Interest[] };
const pipeline = g.__careers ?? (g.__careers = []);

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = str(body.name);
  const email = str(body.email);
  const role = str(body.role);
  const links = str(body.links).slice(0, 2000);

  if (!name || !email || !role) {
    return NextResponse.json({ ok: false, error: "Name, email and role are required." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "Please enter a valid email." }, { status: 400 });
  }

  const entry: Interest = { name, email, role, links, at: new Date().toISOString() };
  pipeline.unshift(entry);
  if (pipeline.length > 500) pipeline.length = 500;

  void sendEmail({
    to: process.env.CAREERS_INBOX || "hello@furlpay.com",
    replyTo: email,
    subject: `Talent pipeline: ${name} · ${role}`,
    html: `<p>${name} (${email}) is interested in <b>${role}</b>.${links ? `<br/>Links: ${links}` : ""}</p>`,
    text: `${name} <${email}> · ${role}\n${links}`,
  });
  console.log(`[careers] interest: ${name} <${email}> · ${role}`);

  return NextResponse.json({ ok: true });
}
