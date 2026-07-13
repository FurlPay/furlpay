import crypto from "crypto";
import { kvGet, kvDel, kvSetNx, kvSet } from "./kv";
import type { Role } from "./session";

// ---------------------------------------------------------------------------
// Web → app session handoff.
//
// The mirror image of /api/auth/handoff (which hands an app session TO a
// browser). This hands a session earned IN a browser back to the native app.
//
// It exists because Apple Sign In cannot talk to a native Android app directly:
// Apple only redirects to https redirect_uris registered in the developer
// portal — custom schemes like furlpay:// are rejected outright. So the app
// opens Apple in a Custom Tab, Apple form_posts to our https callback, and the
// callback needs a way to get the resulting session back across the browser/app
// boundary.
//
// It does NOT do that by putting the session JWT in the redirect URL. A URL is
// not a secret — it lands in browser history, CDN and server logs, and the
// Referer sent to third parties — and our JWT is bearer-equivalent spend
// authority. Instead this is the OAuth authorization-code shape: an opaque
// 256-bit code, single-use, 60-second TTL, carrying no authority of its own,
// which the app exchanges over TLS for the real token.
// ---------------------------------------------------------------------------

const TTL_SECONDS = 60;
const KEY = (code: string) => `native:handoff:${code}`;
const USED = (code: string) => `native:handoff:used:${code}`;

export interface NativeHandoff {
  sub: string;
  safe?: string;
  roles?: Role[];
  provider: string;
}

/** Mint a one-time code for a session that was just established in a browser. */
export async function mintNativeCode(payload: NativeHandoff): Promise<string> {
  const code = crypto.randomBytes(32).toString("base64url");
  await kvSet(KEY(code), payload, TTL_SECONDS);
  return code;
}

/**
 * Redeem a code exactly once. The "used" marker is claimed BEFORE the payload is
 * read, so a replay — a second tab, a code scraped from a log, a malicious app
 * racing for the same deep link — loses the race and gets nothing.
 */
export async function redeemNativeCode(code: string): Promise<NativeHandoff | null> {
  if (!code) return null;
  const won = await kvSetNx(USED(code), "1", 300);
  if (!won) return null;
  const payload = await kvGet<NativeHandoff>(KEY(code));
  await kvDel(KEY(code));
  return payload?.sub ? payload : null;
}
