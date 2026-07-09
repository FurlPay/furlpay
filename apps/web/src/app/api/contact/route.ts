import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { contactNotification, sendEmail } from "@/lib/email";

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
  const limited = await rateLimitOr429(req, "contact", { limit: 5, windowMs: 600_000 });
  if (limited) return limited;

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

  // Notify the team (mock-logs without RESEND_API_KEY). Live: also CRM/Slack.
  const note = contactNotification(lead);
  void sendEmail({ to: process.env.CONTACT_INBOX || "hello@furlpay.com", replyTo: email, ...note });
  console.log(`[contact] new lead: ${firstName} ${lastName} <${email}> · ${company}`);

  return NextResponse.json({ ok: true });
}
