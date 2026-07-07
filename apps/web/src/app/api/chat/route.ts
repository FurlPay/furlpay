import { NextRequest, NextResponse } from "next/server";
import { runCopilot, type ChatMessage } from "@/lib/copilot";

export const dynamic = "force-dynamic";

// POST /api/chat — the FurlPay AI Co-Pilot. Body: { messages: ChatMessage[] }.
// Returns a grounded reply plus the tool calls it made and, for any money
// movement, a `requiresConfirmation` descriptor the client must confirm before
// calling the guarded route. The co-pilot itself NEVER moves money — HITL by
// construction. Session-gated by middleware.
export async function POST(req: NextRequest) {
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

  const result = await runCopilot(clean);
  return NextResponse.json(result);
}
