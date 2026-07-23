import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { z } from "zod";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { redactSecrets } from "@/lib/redact";
import { answerSupportQuestion } from "@/lib/support/answer";

// POST /api/support/ask — AI tier-1 deflection. Retrieves FurlPay help articles
// and answers grounded ONLY in them (RAG), citing sources, escalating to a human
// instead of guessing. Public: strict limits + IP rate limit. The question and
// history pass secret redaction — visitors paste card numbers and seed phrases
// no matter what the form says.

const Body = z
  .object({
    message: z.string().trim().min(1).max(2000),
    history: z
      .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) }))
      .max(10)
      .optional(),
  })
  .strip();

export async function POST(req: NextRequest) {
  // AI calls cost money and hit an upstream model; keep the budget tight.
  const limited = await rateLimitOr429(req, "support.ask", { limit: 15, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;

  const message = redactSecrets(body.message).text;
  const history = (body.history ?? []).map((m) => ({ role: m.role, content: redactSecrets(m.content).text }));

  const result = await answerSupportQuestion(message, history);
  return NextResponse.json(result);
}
