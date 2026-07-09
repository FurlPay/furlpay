import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sendEmail } from "@/lib/email";
import { supportChatNotification } from "@/lib/emailTemplates";
import { rateLimitOr429 } from "@/lib/rateLimit";

// POST /api/support/message — forwards a support chat-bubble message to the
// support mailbox so nothing a visitor types is lost, even while the in-chat
// assistant is a demo. Public endpoint: strict payload limits + IP rate limit.

const Body = z.object({
  message: z.string().min(1).max(2000),
  email: z.string().email().max(320).optional(),
  page: z.string().max(500).optional(),
  transcript: z
    .array(z.object({ from: z.enum(["user", "bot"]), text: z.string().max(2000) }))
    .max(12)
    .optional(),
});

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "support.message", { limit: 5, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { message, email, page, transcript } = parsed.data;

  const result = await sendEmail({
    to: process.env.SUPPORT_INBOX || "support@furlpay.com",
    category: "support",
    replyTo: email,
    ...supportChatNotification({ message, transcript, visitorEmail: email, page }),
  });

  // The visitor gets a clean ack either way — a full mailbox or exhausted
  // budget is an ops problem, not something to surface in the chat widget.
  return NextResponse.json({ received: true, forwarded: result.ok });
}
