import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { runCopilot, type ChatMessage } from "@/lib/copilot";

export const dynamic = "force-dynamic";

// POST /api/chat — the FurlPay AI Co-Pilot. Body: { messages: ChatMessage[] }.
// Returns a grounded reply plus the tool calls it made and, for any money
// movement, a `requiresConfirmation` descriptor the client must confirm before
// calling the guarded route. The co-pilot itself NEVER moves money — HITL by
// construction.
export async function POST(req: NextRequest) {
  // requireUser, not just the middleware session gate: the co-pilot answers
  // from an account, and it has to be the CALLER's. It used to read the seeded
  // demo account for every user, so a real customer asking "what's my
  // balance?" was told the demo user's net worth, spending and holdings.
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "chat", { limit: 10, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  let body: { messages?: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const clean = messages
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
    .slice(-12) // cap history
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  if (clean.length === 0 || clean[clean.length - 1].role !== "user") {
    return NextResponse.json({ error: "expected_user_message" }, { status: 400 });
  }

  const result = await runCopilot(clean, auth.account);
  return NextResponse.json(result);
}
