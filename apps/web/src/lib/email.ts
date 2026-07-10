// Email sending — mock-safe. If RESEND_API_KEY is set, sends via Resend's HTTP
// API (no SDK dependency needed); otherwise logs to the server console so the
// app runs with zero credentials. Configure EMAIL_FROM and, in production,
// DKIM/SPF/DMARC on the sending domain.
//
// Every send carries a category, and sends are budgeted per UTC day on the KV
// layer: Resend's free tier hard-stops at 100/day, so low-priority categories
// are throttled before they can starve a security alert. Critical categories
// (security, otp) skip their per-category cap but still respect the global one.

import { kvGet, kvIncr, kvSet } from "./kv";
import { trackCost } from "./costTracker";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "Furlpay <hello@furlpay.com>";

export type EmailCategory =
  | "security" // new device, lock/unlock, credential changes
  | "otp" // login/verification codes
  | "payment" // receipts: card, x402, swap
  | "booking" // travel confirmations
  | "deposit" // on-chain deposit credited
  | "kyc" // verification outcome
  | "welcome" // first-account onboarding
  | "developer" // API key / x402 registration
  | "support" // chat-bubble messages forwarded to the support mailbox
  | "ops"; // internal inboxes: contact, careers, HITL, swag

// Global cap sits under Resend's 100/day so a burst never hits the provider
// wall; category caps keep one chatty flow from draining the day's budget.
const DAILY_GLOBAL_CAP = 95;
const CATEGORY_CAPS: Record<EmailCategory, number> = {
  security: 25,
  otp: 25,
  payment: 15,
  booking: 10,
  deposit: 10,
  kyc: 5,
  welcome: 5,
  developer: 5,
  support: 15,
  ops: 20,
};
const CRITICAL: ReadonlySet<EmailCategory> = new Set(["security", "otp"]);

/** True when this send would exceed the day's budget. Counts on the KV layer
 *  (global across instances); errors fail open — budgeting must never take
 *  email down. A denied send still consumed a count unit, which under-reports
 *  capacity slightly — the safe direction. */
async function overBudget(category: EmailCategory): Promise<boolean> {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const total = await kvIncr(`email:sent:${day}`, 172_800);
    if (total > DAILY_GLOBAL_CAP) return true;
    const inCategory = await kvIncr(`email:sent:${category}:${day}`, 172_800);
    return inCategory > CATEGORY_CAPS[category] && !CRITICAL.has(category);
  } catch {
    return false;
  }
}

// --- Suppression list --------------------------------------------------------
// Fed by the Resend webhook (/api/webhooks/resend): hard bounces and spam
// complaints stop future sends to that address. Sending into known bounces is
// the fastest way to burn a new domain's reputation.

const SUPPRESS_KEY = (addr: string) => `email:suppress:${addr.toLowerCase()}`;

export async function suppressEmail(
  address: string,
  reason: "bounced" | "complained",
  ttlSeconds = 90 * 86_400
): Promise<void> {
  await kvSet(SUPPRESS_KEY(address), { reason, at: new Date().toISOString() }, ttlSeconds);
}

export async function isSuppressed(address: string): Promise<boolean> {
  try {
    return (await kvGet(SUPPRESS_KEY(address))) !== null;
  } catch {
    return false; // suppression is best-effort; KV trouble must not block sends
  }
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  /** Send budget bucket + Resend tag. Defaults to "ops" (internal traffic). */
  category?: EmailCategory;
  /** Extra Resend tags (ASCII letters/numbers/_/- only, per API docs). */
  tags?: { name: string; value: string }[];
  /** Dedupes retried sends at the provider (24h window, max 256 chars). */
  idempotencyKey?: string;
}

export type SendResult =
  | { ok: true; id?: string; mocked?: boolean }
  | { ok: false; error: string };

/** Send an email. No-ops to a console log when RESEND_API_KEY is absent. */
export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  const category = msg.category ?? "ops";
  if (!RESEND_API_KEY) {
    const to = Array.isArray(msg.to) ? msg.to.join(", ") : msg.to;
    console.log(`[email:mock] → ${to} · [${category}] "${msg.subject}"`);
    return { ok: true, mocked: true };
  }
  const recipients = Array.isArray(msg.to) ? msg.to : [msg.to];
  for (const addr of recipients) {
    if (await isSuppressed(addr)) {
      return { ok: false, error: `recipient suppressed (bounce/complaint): ${addr}` };
    }
  }
  if (await overBudget(category)) {
    return { ok: false, error: `daily email budget exceeded (category: ${category})` };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        reply_to: msg.replyTo,
        tags: [{ name: "category", value: category }, ...(msg.tags ?? [])],
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `Resend ${res.status}: ${await res.text()}` };
    }
    const data = (await res.json()) as { id?: string };
    trackCost("resend", "email", recipients.length);
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ── Templates ──────────────────────────────────────────────────────────────

/** Shared layout for every outbound email: brand header, card body, and a
 *  footer that carries the anti-phishing notice on all categories. The logo is
 *  the deployed app icon (24 KB) — email clients need an absolute URL.
 *
 *  Client-compat rules (do not regress): table-based layout (Outlook's Word
 *  engine ignores max-width on divs), inline styles only, no flexbox, and a
 *  hidden preheader so inbox previews show `preheader` instead of the first
 *  body words. color-scheme meta stops Gmail/Apple Mail force-inverting the
 *  dark palette. */
export const shell = (title: string, body: string, preheader?: string) => `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="dark"/>
  <meta name="supported-color-schemes" content="dark"/>
</head>
<body style="margin:0;padding:0;background:#000;color:#fff;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif">
  ${preheader ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${preheader}${"&zwnj;&nbsp;".repeat(30)}</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
        <tr><td style="padding:0 8px 24px">
          <img src="https://furlpay.com/icon.png" width="36" height="36" alt="Furlpay" style="border-radius:9px;vertical-align:middle"/>
          <span style="font-size:20px;font-weight:800;letter-spacing:-.02em;color:#00E599;vertical-align:middle;margin-left:10px">Furlpay</span>
        </td></tr>
        <tr><td style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:28px">
          <h1 style="font-size:22px;line-height:1.3;margin:0 0 8px;color:#fff">${title}</h1>
          ${body}
        </td></tr>
        <tr><td style="padding:28px 8px 0">
          <hr style="border:none;border-top:1px solid #222;margin:0 0 20px"/>
          <p style="font-size:12px;color:#888;line-height:1.5;margin:0 0 8px">Furlpay will never ask for your password, seed phrase, or private keys by email.</p>
          <p style="font-size:11px;color:#888;line-height:1.5;margin:0">Furlpay · The on-chain financial operating system ·
            <a href="https://furlpay.com/legal/privacy" style="color:#888">Privacy</a> ·
            <a href="https://furlpay.com/legal/terms" style="color:#888">Terms</a> ·
            <a href="https://furlpay.com/newsletter/unsubscribe" style="color:#888">Unsubscribe</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

export function newsletterWelcome(categories: string[]): { subject: string; html: string; text: string } {
  const list = categories.map((c) => c.replace(/-/g, " ")).join(", ");
  return {
    subject: "You're subscribed to Furlpay updates",
    html: shell(
      "You're in.",
      `<p style="font-size:14px;line-height:1.6;color:#bbb">Thanks for subscribing. You'll receive: <b style="color:#fff">${list}</b>.
       No spam — one-click unsubscribe on every email. Explore the
       <a href="https://furlpay.com/blog" style="color:#00E599">blog</a> while you wait.</p>`
    ),
    text: `You're subscribed to Furlpay updates: ${list}. Unsubscribe anytime at https://furlpay.com/newsletter/unsubscribe`,
  };
}

export function contactNotification(lead: {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  message?: string;
}): { subject: string; html: string; text: string } {
  return {
    subject: `New lead: ${lead.firstName} ${lead.lastName} · ${lead.company}`,
    html: shell(
      "New contact request",
      `<p style="font-size:14px;line-height:1.7;color:#bbb">
        <b style="color:#fff">${lead.firstName} ${lead.lastName}</b> (${lead.email})<br/>
        Company: ${lead.company}<br/>${lead.message ? `Message: ${lead.message}` : ""}</p>`
    ),
    text: `New lead: ${lead.firstName} ${lead.lastName} <${lead.email}> · ${lead.company}\n${lead.message ?? ""}`,
  };
}

export function creatorWelcome(
  name: string,
  email: string,
  opts?: { tier?: string; commission?: number; referralCode?: string; travelShopUrl?: string }
): { subject: string; html: string; text: string } {
  const tier = opts?.tier || "Explorer";
  const commission = opts?.commission ?? 6;
  const dashboardUrl = `https://furlpay.com/ambassadors/dashboard?email=${encodeURIComponent(email)}`;
  const shopUrl = opts?.travelShopUrl || "https://furlpay.com/travel";
  const code = opts?.referralCode;

  // 2026 best practice: one primary CTA (open the dashboard); details follow.
  return {
    subject: "You're in — welcome to the Furlpay Creator Program",
    html: shell(
      "You're enrolled.",
      `<p style="font-size:14px;line-height:1.6;color:#bbb">Hi ${name},</p>
       <p style="font-size:14px;line-height:1.6;color:#bbb">Welcome to the <b>Furlpay Creator Program</b>. You're enrolled in the <b>${tier}</b> tier — <b>${commission}% commission</b>, paid weekly in USDC, plus <b>2% cashback</b> for your followers.</p>
       ${code ? `<p style="font-size:14px;line-height:1.6;color:#bbb">Your referral code: <b style="color:#00E599">${code}</b></p>` : ""}
       <p style="margin:24px 0">
         <a href="${dashboardUrl}" style="display:inline-block;background:#00E599;color:#000;font-weight:700;font-size:14px;text-decoration:none;padding:12px 24px;border-radius:24px">Open your dashboard</a>
       </p>
       <p style="font-size:14px;line-height:1.6;color:#bbb">Your dashboard is live now — track clicks, bookings and weekly USDC payouts on-chain, and launch your Travel Shop (<a href="${shopUrl}" style="color:#00E599">${shopUrl.replace(/^https?:\/\//, "")}</a>) to start earning.</p>
       <p style="font-size:13px;line-height:1.6;color:#888;margin-top:16px">One quick step before your first payout: complete identity verification (Persona) from your dashboard. Questions? Just reply to this email or join our Discord.</p>`
    ),
    text: `Hi ${name},\n\nWelcome to the Furlpay Creator Program! You're enrolled in the ${tier} tier (${commission}% commission, weekly USDC, 2% follower cashback).${code ? `\n\nReferral code: ${code}` : ""}\n\nOpen your dashboard: ${dashboardUrl}\nYour Travel Shop: ${shopUrl}\n\nOne step before your first payout: complete identity verification (Persona) from your dashboard.\n\nHappy traveling,\nFurlpay Team`,
  };
}

