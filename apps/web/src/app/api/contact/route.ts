import { NextRequest, NextResponse } from "next/server";

// POST /api/contact — "Talk to us" lead capture. Public (unauthenticated).
// Mock/demo: validates and records the lead in memory; a live build forwards it
// to the CRM / a Slack webhook / an email (Resend).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX = 5000;

interface Lead {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  message?: string;
  at: string;
}

const g = globalThis as unknown as { __leads?: Lead[] };
const leads = g.__leads ?? (g.__leads = []);

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const firstName = str(body.firstName);
  const lastName = str(body.lastName);
  const email = str(body.email);
  const phone = str(body.phone);
  const company = str(body.company);
  const message = str(body.message).slice(0, MAX);

  const missing = [];
  if (!firstName) missing.push("firstName");
  if (!lastName) missing.push("lastName");
  if (!email) missing.push("email");
  if (!phone) missing.push("phone");
  if (!company) missing.push("company");
  if (missing.length) {
    return NextResponse.json({ ok: false, error: "Please fill in all required fields." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "Please enter a valid email address." }, { status: 400 });
  }

  const lead: Lead = { firstName, lastName, email, phone, company, message, at: new Date().toISOString() };
  leads.unshift(lead);
  if (leads.length > 500) leads.length = 500;

  // Live: await forwardToCrm(lead) / postToSlack(lead) / sendEmail(lead)
  console.log(`[contact] new lead: ${firstName} ${lastName} <${email}> · ${company}`);

  return NextResponse.json({ ok: true });
}
