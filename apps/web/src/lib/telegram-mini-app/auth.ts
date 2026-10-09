import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateBody } from "@/lib/validate";
import { publicOrigin } from "@/lib/publicOrigin";
import { sbInsert, sbSelect, supabaseBackend } from "@/lib/supabase";
import { kvBackend } from "@/lib/kv";
import { telegramAuthMaxAge, verifyTelegramInitData } from "./verify";

const Body = z.object({ initData: z.string().min(1).max(16_384) }).strict();
export const privateHeaders = { "Cache-Control": "no-store, private" };
export function telegramUnavailable() {
  return NextResponse.json({ error: "Telegram sign-in is temporarily unavailable. You can still explore or sign in with FurlPay." }, { status: 503, headers: privateHeaders });
}
export async function verifiedTelegramRequest(req: NextRequest) {
  // Also enforced before a cookie exists: prevents login CSRF/account swapping.
  if (req.headers.get("origin") !== publicOrigin(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers: privateHeaders });
  if (!process.env.TELEGRAM_BOT_TOKEN || supabaseBackend !== "supabase" || (process.env.NODE_ENV === "production" && kvBackend !== "redis")) return telegramUnavailable();
  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;
  return verifyTelegramInitData(body.initData, process.env.TELEGRAM_BOT_TOKEN, telegramAuthMaxAge());
}
export async function linkedTelegramAccount(telegramId: number): Promise<string | null> {
  const rows = await sbSelect<{ user_id: string }>("telegram_account_links", `telegram_id=eq.${telegramId}&select=user_id&limit=1`);
  return rows[0]?.user_id ?? null;
}
export async function linkTelegramAccount(telegramId: number, userId: string): Promise<boolean> {
  // Plain INSERT, never UPSERT. Both unique constraints enforce ownership across concurrent requests.
  try { await sbInsert("telegram_account_links", { telegram_id: telegramId, user_id: userId }); return true; }
  catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 409) return false;
    throw error;
  }
}
