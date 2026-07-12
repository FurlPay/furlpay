import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { kvIncrBy } from "@/lib/kv";
import { DOC_ORDER } from "@/lib/docs/nav";

export const dynamic = "force-dynamic";

// POST /api/docs/feedback — anonymous "was this page helpful" counters.
// Path is validated against the docs nav (no arbitrary key writes), and the
// per-IP rate limit keeps a bored script from skewing the numbers much.
const Feedback = z
  .object({
    path: z.string().max(200),
    helpful: z.boolean(),
  })
  .strict();

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "docs-feedback", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, Feedback);
  if (body instanceof NextResponse) return body;

  if (!DOC_ORDER.some((d) => d.href === body.path)) {
    return NextResponse.json({ error: "unknown_page" }, { status: 400 });
  }

  await kvIncrBy(`docs:feedback:${body.helpful ? "up" : "down"}:${body.path}`, 1, 60 * 60 * 24 * 365);
  return NextResponse.json({ ok: true });
}
