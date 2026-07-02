// Email sending — mock-safe. If RESEND_API_KEY is set, sends via Resend's HTTP
// API (no SDK dependency needed); otherwise logs to the server console so the
// app runs with zero credentials. Configure EMAIL_FROM and, in production,
// DKIM/SPF/DMARC on the sending domain.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "Furlpay <hello@furlpay.com>";

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export type SendResult = { ok: true; id?: string; mocked?: boolean } | { ok: false; error: string };

/** Send an email. No-ops to a console log when RESEND_API_KEY is absent. */
export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  if (!RESEND_API_KEY) {
    const to = Array.isArray(msg.to) ? msg.to.join(", ") : msg.to;
    console.log(`[email:mock] → ${to} · "${msg.subject}"`);
    return { ok: true, mocked: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        reply_to: msg.replyTo,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `Resend ${res.status}: ${await res.text()}` };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ── Templates ──────────────────────────────────────────────────────────────

const shell = (title: string, body: string) => `
<!doctype html><html><body style="margin:0;background:#000;color:#fff;font-family:Inter,system-ui,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="font-size:20px;font-weight:800;letter-spacing:-.02em;color:#00E599">Furlpay</div>
    <h1 style="font-size:22px;margin:24px 0 8px">${title}</h1>
    ${body}
    <hr style="border:none;border-top:1px solid #222;margin:28px 0"/>
    <p style="font-size:11px;color:#888">Furlpay · The on-chain financial operating system ·
      <a href="https://furlpay.com/newsletter/unsubscribe" style="color:#888">Unsubscribe</a></p>
  </div>
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
