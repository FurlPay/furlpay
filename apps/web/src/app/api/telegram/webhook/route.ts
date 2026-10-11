import { createHash, timingSafeEqual } from "crypto";
import { readJsonBody } from "@/lib/validate";
import { NextRequest, NextResponse } from "next/server";
import { handleUpdate, type TgUpdate } from "@/lib/telegram";

// Constant-time: `!==` on the secret leaked how many leading characters
// matched (SEC-P3-001). Hashing first gives equal-length inputs, so neither a
// mismatch nor a length difference shows up in timing.
function secretMatches(presented: string | null, secret: string): boolean {
  if (!presented) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/telegram/webhook — Telegram delivers every update here. Auth is a
// shared secret: setWebhook is registered with a secret_token, which Telegram
// echoes in the X-Telegram-Bot-Api-Secret-Token header on every call. We reject
// anything without the matching secret, then reply inline in the HTTP response
// (Telegram executes the returned method — one round trip, no token needed).
export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !secretMatches(req.headers.get("x-telegram-bot-api-secret-token"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = await readJsonBody(req);
  } catch {
    return NextResponse.json({ ok: true }); // ignore malformed, don't retry
  }

  const reply = await handleUpdate(update);
  // Returning the method object makes Telegram send it; empty 200 = no reply.
  return NextResponse.json(reply ?? { ok: true });
}
