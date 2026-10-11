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

//
// PKCE (RFC 7636, S256) — added 2026-10-05 (audit P1-2).
//
// The code travels back to the app on a furlpay:// deep link, and a custom
// scheme is NOT exclusive on Android: any installed app can declare the same
// intent filter and receive the redirect. Single-use alone did not help — the
// interceptor redeems first. So the code is now bound at mint time to the
// app's code_challenge, and redeeming it requires the code_verifier, which
// never leaves the app until the TLS exchange. An intercepted code is useless,
// and an attempt with a wrong verifier BURNS the code (the used-marker is
// claimed before the verifier is checked), so it cannot be retried either.
// A code minted without a challenge is not redeemable at all.
// ---------------------------------------------------------------------------

const TTL_SECONDS = 60;
const KEY = (code: string) => `native:handoff:${code}`;
const USED = (code: string) => `native:handoff:used:${code}`;

/** RFC 7636 §4.1 verifier alphabet and length. */
export const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
/** base64url(SHA-256(verifier)) — always 43 chars, no padding. */
export const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export interface NativeHandoff {
  sub: string;
  safe?: string;
  roles?: Role[];
  provider: string;
  /** S256 challenge the redeemer's verifier must hash to. Required. */
  codeChallenge: string;
}

/** base64url(SHA-256(verifier)). */
export function s256Challenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** Mint a one-time code for a session that was just established in a browser,
 *  bound to the app's PKCE challenge. */
export async function mintNativeCode(payload: NativeHandoff): Promise<string> {
  if (!CODE_CHALLENGE.test(payload.codeChallenge ?? "")) {
    throw new Error("mintNativeCode requires an S256 code_challenge");
  }
  const code = crypto.randomBytes(32).toString("base64url");
  await kvSet(KEY(code), payload, TTL_SECONDS);
  return code;
}

export type RedeemResult =
  | { ok: true; payload: NativeHandoff }
  | { ok: false; reason: "invalid_request" | "used" | "expired" | "pkce_mismatch" };

/**
 * Redeem a code exactly once, with its PKCE verifier. The "used" marker is
 * claimed BEFORE the payload is read and BEFORE the verifier is checked, so a
 * replay — a second tab, a code scraped from a log, a malicious app racing for
 * the same deep link — gets nothing, and a wrong verifier consumes the code.
 */
export async function redeemNativeCode(code: string, codeVerifier: string): Promise<RedeemResult> {
  if (!code || !CODE_VERIFIER.test(codeVerifier ?? "")) return { ok: false, reason: "invalid_request" };
  const won = await kvSetNx(USED(code), "1", 300);
  if (!won) return { ok: false, reason: "used" };
  const payload = await kvGet<NativeHandoff>(KEY(code));
  await kvDel(KEY(code));
  if (!payload?.sub) return { ok: false, reason: "expired" };
  const expected = payload.codeChallenge;
  if (typeof expected !== "string" || !CODE_CHALLENGE.test(expected)) return { ok: false, reason: "pkce_mismatch" };
  const actual = Buffer.from(s256Challenge(codeVerifier));
  const want = Buffer.from(expected);
  if (actual.length !== want.length || !crypto.timingSafeEqual(actual, want)) {
    return { ok: false, reason: "pkce_mismatch" };
  }
  return { ok: true, payload };
}
