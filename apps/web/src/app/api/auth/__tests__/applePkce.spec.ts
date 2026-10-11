import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { POST as callback } from "@/app/api/auth/apple/callback/route";
import { POST as exchange } from "@/app/api/auth/native/exchange/route";
import { mintNativeCode, redeemNativeCode, s256Challenge } from "@/lib/nativeSession";

// ---------------------------------------------------------------------------
// Audit P1-2 (2026-10-05): the native Apple sign-in handed the app a one-time
// code on a furlpay:// deep link, and /api/auth/native/exchange accepted the
// code alone. Custom schemes are not exclusive on Android, so any app that
// declared the same intent filter could receive the redirect and redeem it:
// account takeover. The code is now PKCE-bound (S256) end to end, and the
// Apple id_token's nonce must equal the challenge.
//
// Runs in mock Apple mode (non-production), where the id_token is decoded
// without a signature — the PKCE and nonce checks under test are identical in
// live mode (lib/auth/apple.ts assertNonce runs on both paths).
// ---------------------------------------------------------------------------

const b64url = (b: Buffer) => b.toString("base64url");
const newVerifier = () => b64url(crypto.randomBytes(32)); // 43 chars, RFC 7636 alphabet

function fakeIdToken(claims: Record<string, unknown>): string {
  const enc = (o: unknown) => b64url(Buffer.from(JSON.stringify(o)));
  return `${enc({ alg: "none" })}.${enc(claims)}.sig`;
}

let ip = 0;
function form(fields: Record<string, string>): NextRequest {
  const body = new URLSearchParams(fields).toString();
  return new NextRequest("https://furlpay.com/api/auth/apple/callback", {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": `10.9.0.${++ip % 250}` },
  });
}

function exchangeReq(body: unknown): NextRequest {
  return new NextRequest("https://furlpay.com/api/auth/native/exchange", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": `10.8.0.${++ip % 250}` },
  });
}

/** Run the callback the way Apple would and return the deep link's params. */
async function signIn(opts: { verifier: string; nonce?: string; state?: string; sub?: string }) {
  const challenge = s256Challenge(opts.verifier);
  const state = opts.state ?? `${crypto.randomUUID()}.${challenge}`;
  const res = await callback(
    form({
      state,
      id_token: fakeIdToken({ sub: opts.sub ?? "apple-sub-1", email: "pkce@example.com", nonce: opts.nonce ?? challenge }),
    })
  );
  expect(res.status).toBe(303);
  const loc = new URL(res.headers.get("location")!);
  expect(loc.protocol).toBe("furlpay:");
  return { code: loc.searchParams.get("code"), error: loc.searchParams.get("error"), state: loc.searchParams.get("state") };
}

beforeEach(() => {
  (globalThis as unknown as { __furlpayKv?: Map<string, unknown> }).__furlpayKv?.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Apple native handoff — PKCE binding", () => {
  it("happy path: the app holding the verifier gets a session", async () => {
    const verifier = newVerifier();
    const { code, error } = await signIn({ verifier });
    expect(error).toBeNull();
    const res = await exchange(exchangeReq({ code, code_verifier: verifier }));
    expect(res.status).toBe(200);
    expect(typeof (await res.json()).token).toBe("string");
  });

  it("MISSING verifier: an intercepted code alone is refused (400, schema)", async () => {
    const { code } = await signIn({ verifier: newVerifier() });
    const res = await exchange(exchangeReq({ code }));
    expect(res.status).toBe(400);
  });

  it("MISMATCHED verifier: refused, and the code is burned so the real app cannot be raced", async () => {
    const real = newVerifier();
    const { code } = await signIn({ verifier: real });
    const attacker = await exchange(exchangeReq({ code, code_verifier: newVerifier() }));
    expect(attacker.status).toBe(401);
    // The legitimate app now also fails: the code is single-use, a wrong
    // verifier consumes it. The user signs in again; the attacker gets nothing.
    const legit = await exchange(exchangeReq({ code, code_verifier: real }));
    expect(legit.status).toBe(401);
  });

  it("REPLAYED code: the second redemption with the right verifier is refused", async () => {
    const verifier = newVerifier();
    const { code } = await signIn({ verifier });
    expect((await exchange(exchangeReq({ code, code_verifier: verifier }))).status).toBe(200);
    expect((await exchange(exchangeReq({ code, code_verifier: verifier }))).status).toBe(401);
  });

  it("EXPIRED code: refused after the 60s TTL", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T10:00:00Z"));
    const verifier = newVerifier();
    const { code } = await signIn({ verifier });
    vi.setSystemTime(new Date("2026-10-05T10:01:05Z"));
    expect((await exchange(exchangeReq({ code, code_verifier: verifier }))).status).toBe(401);
  });

  it("MISSING challenge in state: no code is minted at all", async () => {
    const r = await signIn({ verifier: newVerifier(), state: crypto.randomUUID() });
    expect(r.code).toBeNull();
    expect(r.error).toBe("pkce_required");
  });

  it("SUBSTITUTED id_token: a token whose nonce belongs to another session is refused", async () => {
    const victimVerifier = newVerifier();
    const otherSessionNonce = s256Challenge(newVerifier());
    const r = await signIn({ verifier: victimVerifier, nonce: otherSessionNonce });
    expect(r.code).toBeNull();
    expect(r.error).toBe("invalid_apple_token");
  });

  it("an id_token with NO nonce is refused", async () => {
    const verifier = newVerifier();
    const challenge = s256Challenge(verifier);
    const res = await callback(
      form({ state: `${crypto.randomUUID()}.${challenge}`, id_token: fakeIdToken({ sub: "s", email: "e@example.com" }) })
    );
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_apple_token");
  });

  it("malformed verifier (not RFC 7636) is refused before touching the code", async () => {
    const { code } = await signIn({ verifier: newVerifier() });
    expect((await exchange(exchangeReq({ code, code_verifier: "short" }))).status).toBe(400);
  });
});

describe("lib/nativeSession", () => {
  it("refuses to mint a code without an S256 challenge", async () => {
    await expect(
      mintNativeCode({ sub: "u1", provider: "apple", codeChallenge: "" })
    ).rejects.toThrow(/code_challenge/);
  });

  it("reports distinct internal reasons (the route collapses them to one message)", async () => {
    const verifier = newVerifier();
    const code = await mintNativeCode({ sub: "u1", provider: "apple", codeChallenge: s256Challenge(verifier) });
    expect(await redeemNativeCode(code, newVerifier())).toEqual({ ok: false, reason: "pkce_mismatch" });
    expect(await redeemNativeCode(code, verifier)).toEqual({ ok: false, reason: "used" });
    expect(await redeemNativeCode("x".repeat(43), "bad")).toEqual({ ok: false, reason: "invalid_request" });
  });
});
