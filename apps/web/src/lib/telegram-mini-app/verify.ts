import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Telegram IDs have at most 52 significant bits; match the database CHECK in 0050.
export const TELEGRAM_USER_ID_MAX = 4_503_599_627_370_495;
const User = z.object({ id: z.number().int().positive().max(TELEGRAM_USER_ID_MAX), first_name: z.string().max(256), is_bot: z.boolean().optional() });
export class TelegramAuthError extends Error {}

export function telegramAuthMaxAge(): number {
  const n = Number(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS || 300);
  if (!Number.isInteger(n) || n < 30 || n > 600) throw new Error("Invalid Telegram authentication configuration");
  return n;
}

/** Telegram's bot-token HMAC flow includes every field except hash (including signature). */
export function verifyTelegramInitData(raw: string, token: string, maxAge = 300, now = Math.floor(Date.now() / 1000)) {
  if (!token) throw new Error("Telegram authentication is not configured");
  const reject = (): never => { throw new TelegramAuthError("Invalid or expired Telegram session. Reopen the mini app."); };
  if (!raw || raw.length > 16_384 || /%(?![0-9a-fA-F]{2})/.test(raw)) return reject();
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length || keys.some(k => !/^[a-z_]+$/.test(k))) return reject();
  const hash = params.get("hash");
  if (!hash || !/^[a-fA-F0-9]{64}$/.test(hash)) return reject();
  const check = [...params.entries()].filter(([k]) => k !== "hash").sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const expected = createHmac("sha256", secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) return reject();
  const date = params.get("auth_date");
  if (!date || !/^\d{1,12}$/.test(date)) return reject();
  const authDate = Number(date);
  if (authDate > now + 30 || now - authDate > maxAge) return reject();
  let user;
  try { user = User.parse(JSON.parse(params.get("user") || "null")); } catch { return reject(); }
  if (user.is_bot) return reject();
  return { user, authDate, hash: hash.toLowerCase(), startParam: params.get("start_param") };
}
