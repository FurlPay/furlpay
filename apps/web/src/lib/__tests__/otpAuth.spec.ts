// ---------------------------------------------------------------------------
// Email-OTP authentication matrix. Exercises the REAL lib/auth/otp.ts against
// the in-memory KV backend, with only the Resend HTTP transport stubbed — the
// stub captures the outbound email so tests read the code the user would read,
// exactly as the product delivers it. Nothing about generation, hashing,
// expiry, single-use, or the attempt counter is mocked.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { startOtp, checkOtp } from "@/lib/auth/otp";
import { kvGet } from "@/lib/kv";
import { POST as otpStartPOST } from "@/app/api/auth/otp/start/route";
import { POST as otpCheckPOST } from "@/app/api/auth/otp/check/route";
import { findUserByIdentity, listAccounts } from "@/lib/store";
import { verifySession } from "@/lib/session";

const realFetch = global.fetch;

/** The most recent code captured from the stubbed Resend send. */
let lastEmail: { to: string; html: string; text: string; subject: string } | null = null;

function extractCode(email: { text: string }): string {
  const m = email.text.match(/\b(\d{6})\b/);
  if (!m) throw new Error("no 6-digit code found in the email");
  return m[1];
}

beforeEach(() => {
  // Turn the Resend-backed email path on, and give the HMAC a real pepper so we
  // can assert the stored value is a hash, not the code.
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.FURLPAY_SESSION_SECRET = "test-session-secret-at-least-32-chars-long";
  lastEmail = null;

  global.fetch = (async (url: string, init: { body?: string }) => {
    if (String(url).includes("api.resend.com")) {
      const body = JSON.parse(init.body ?? "{}");
      lastEmail = { to: body.to, html: body.html, text: body.text, subject: body.subject };
      return { ok: true, status: 200, json: async () => ({ id: "email_test" }) };
    }
    return realFetch(url as string, init as RequestInit);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

const email = () => `otp-${crypto.randomUUID()}@furlpay.test`;

describe("email OTP — generation & delivery", () => {
  it("sends a branded 6-digit code via Resend and returns nothing revealing", async () => {
    const to = email();
    const res = await startOtp(to, "email");
    expect(res.sent).toBe(true);
    expect(res.devCode).toBeUndefined(); // live path never echoes the code
    expect(lastEmail?.to).toBe(to);
    expect(lastEmail?.subject).toBe("Your FurlPay verification code");
    expect(extractCode(lastEmail!)).toMatch(/^\d{6}$/);
    // Anti-phishing / single-use language required by the spec.
    expect(lastEmail!.text.toLowerCase()).toContain("once");
    expect(lastEmail!.text.toLowerCase()).toContain("never");
  });

  it("stores an HMAC, NEVER the raw code", async () => {
    const to = email();
    await startOtp(to, "email");
    const code = extractCode(lastEmail!);
    const rec = await kvGet<{ hash: string }>(`otp:email:${to}`);
    expect(rec).not.toBeNull();
    expect(JSON.stringify(rec)).not.toContain(code); // no plaintext at rest
    expect(rec!.hash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });
});

describe("email OTP — verification", () => {
  it("accepts the correct code exactly once (single-use)", async () => {
    const to = email();
    await startOtp(to, "email");
    const code = extractCode(lastEmail!);

    expect((await checkOtp(to, code)).approved).toBe(true);
    // Replaying the same code fails — it was consumed.
    expect((await checkOtp(to, code)).approved).toBe(false);
  });

  it("rejects a wrong code", async () => {
    const to = email();
    await startOtp(to, "email");
    const code = extractCode(lastEmail!);
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
    const r = await checkOtp(to, wrong);
    expect(r.approved).toBe(false);
    expect(r.reason).toBe("mismatch");
  });

  it("rejects a code after its TTL", async () => {
    const to = email();
    await startOtp(to, "email");
    const code = extractCode(lastEmail!);
    // Fast-forward past the 10-minute expiry. Both the record's logical
    // expiresAt AND the KV TTL are exceeded (they share the same value), so the
    // code is rejected either as "expired" (logical guard) or "not_found" (KV
    // eviction) — both mean the same thing: the code no longer works.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60_000);
    const r = await checkOtp(to, code);
    expect(r.approved).toBe(false);
    expect(["expired", "not_found"]).toContain(r.reason);
  });

  it("blocks after too many wrong attempts", async () => {
    const to = email();
    await startOtp(to, "email");
    const code = extractCode(lastEmail!);
    const wrong = String((Number(code) + 7) % 1_000_000).padStart(6, "0");
    for (let i = 0; i < 5; i++) await checkOtp(to, wrong);
    // The 6th attempt is locked out — even the CORRECT code no longer works.
    const r = await checkOtp(to, code);
    expect(r.approved).toBe(false);
    expect(r.reason).toBe("too_many_attempts");
  });

  it("only ONE of two concurrent redemptions of the same code succeeds", async () => {
    const to = email();
    await startOtp(to, "email");
    const code = extractCode(lastEmail!);
    const [a, b] = await Promise.all([checkOtp(to, code), checkOtp(to, code)]);
    expect([a.approved, b.approved].filter(Boolean)).toHaveLength(1);
  });

  it("issuing a new code invalidates the previous one", async () => {
    const to = email();
    await startOtp(to, "email");
    const first = extractCode(lastEmail!);
    // Bypass the resend cooldown for the test by advancing time 31s.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
    await startOtp(to, "email");
    const second = extractCode(lastEmail!);
    expect(second).not.toBe(first);
    expect((await checkOtp(to, first)).approved).toBe(false); // old code dead
    expect((await checkOtp(to, second)).approved).toBe(true);
  });
});

describe("email OTP — resend cooldown", () => {
  it("refuses a second send inside the cooldown window", async () => {
    const to = email();
    await startOtp(to, "email");
    await expect(startOtp(to, "email")).rejects.toThrow(/just sent|wait/i);
  });
});

describe("POST /api/auth/otp/start — enumeration resistance", () => {
  function startReq(to: string) {
    return new NextRequest("https://furlpay.com/api/auth/otp/start", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify({ to, channel: "email" }),
    });
  }

  it("returns the same generic shape whether or not the account exists", async () => {
    // Seed an account for one address directly (not via OTP, so no cooldown is
    // set on it) — then the two /start calls are each a first send.
    const existing = email();
    const { findOrCreateUserByIdentity } = await import("@/lib/store");
    findOrCreateUserByIdentity({ email: existing });

    const brandNew = email();
    const r1 = await otpStartPOST(startReq(existing));
    const r2 = await otpStartPOST(startReq(brandNew));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const [b1, b2] = [await r1.json(), await r2.json()];
    // No field reveals account existence.
    expect(Object.keys(b1).sort()).toEqual(Object.keys(b2).sort());
    expect(b1.sent).toBe(b2.sent);
  });
});

describe("POST /api/auth/otp/check — account lifecycle + session", () => {
  function checkReq(to: string, code: string, mobile = false) {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-forwarded-for": `10.1.0.${Math.floor(Math.random() * 250)}`,
    };
    if (mobile) headers["x-furlpay-client"] = "mobile-android/2.1.0";
    return new NextRequest("https://furlpay.com/api/auth/otp/check", {
      method: "POST",
      headers,
      body: JSON.stringify({ to, code, channel: "email", login: true }),
    });
  }

  it("a brand-new email creates EXACTLY ONE account and issues a session", async () => {
    const to = email();
    await startOtp(to, "email");
    const code = extractCode(lastEmail!);

    expect(findUserByIdentity({ email: to })).toBeUndefined(); // none yet
    const res = await otpCheckPOST(checkReq(to, code, true));
    expect(res.status).toBe(200);

    const account = findUserByIdentity({ email: to });
    expect(account).toBeDefined();
    expect(listAccounts().filter((a) => a.user.email?.toLowerCase() === to)).toHaveLength(1);

    // Mobile client gets the JWT in the body, scoped to the new user.
    const body = await res.json();
    expect(body.verified).toBe(true);
    const claims = await verifySession(body.token);
    expect(claims?.sub).toBe(account!.user.id);
  });

  it("an existing email reuses the SAME account — no duplicate", async () => {
    const to = email();
    // First sign-in.
    await startOtp(to, "email");
    await otpCheckPOST(checkReq(to, extractCode(lastEmail!)));
    const firstId = findUserByIdentity({ email: to })!.user.id;

    // Second sign-in with a fresh code (advance past cooldown).
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
    await startOtp(to, "email");
    await otpCheckPOST(checkReq(to, extractCode(lastEmail!)));

    expect(findUserByIdentity({ email: to })!.user.id).toBe(firstId);
    expect(listAccounts().filter((a) => a.user.email?.toLowerCase() === to)).toHaveLength(1);
  });

  it("rejects an incorrect code with 401 and no session", async () => {
    const to = email();
    await startOtp(to, "email");
    const code = extractCode(lastEmail!);
    const wrong = String((Number(code) + 3) % 1_000_000).padStart(6, "0");
    const res = await otpCheckPOST(checkReq(to, wrong, true));
    expect(res.status).toBe(401);
    expect((await res.json()).token).toBeUndefined();
  });
});

// A capitalised address must verify. /otp/start used to store the code under
// the address exactly as typed while /otp/check looked it up canonicalised, so
// "John@Example.com" (what phone keyboards produce) always got "No pending code".
// Found by the e2e suite, whose fixture email is "e2e-userA-…".
describe("OTP routes — one canonical destination for start and check", () => {
  const req = (path: string, body: unknown, ip = `10.9.0.${Math.floor(Math.random() * 250)}`) =>
    new NextRequest(`https://furlpay.com/api/auth/otp/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    });

  it("a mixed-case email verifies through the routes (Resend path)", async () => {
    const typed = `Mixed.Case-${Date.now()}@Example.COM`;
    expect((await otpStartPOST(req("start", { to: typed, channel: "email" }))).status).toBe(200);
    const code = extractCode(lastEmail!);
    const res = await otpCheckPOST(req("check", { to: typed, code, channel: "email", login: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).verified).toBe(true);
  });

  it("the code is delivered to the canonical mailbox", async () => {
    const typed = `Deliver-${Date.now()}@Example.COM`;
    await otpStartPOST(req("start", { to: typed, channel: "email" }));
    expect(lastEmail!.to).toBe(typed.toLowerCase());
  });

  it("capitalisations of one mailbox share one rate-limit budget", async () => {
    // The per-destination limit is 5 per 10 minutes, keyed on IP + destination.
    // Before the fix each capitalisation was a separate destination.
    const base = `budget-${Date.now()}@example.com`;
    const ip = "10.9.9.9";
    const variants = [base, base.toUpperCase(), `B${base.slice(1)}`, base, base.toUpperCase(), base];
    const statuses: number[] = [];
    for (const v of variants) statuses.push((await otpStartPOST(req("start", { to: v, channel: "email" }, ip))).status);
    expect(statuses).toContain(429);
  });
});

// The case the e2e suite actually hit: the MOCK store (no RESEND_API_KEY, the
// dev / e2e configuration) keyed pending codes on the raw address, so a
// capitalised email could never verify there. The Resend path normalises in
// its own key and was not affected.
describe("OTP routes — mock store (dev / e2e) with a capitalised email", () => {
  it("start returns a devCode and check verifies it for the same typed address", async () => {
    delete process.env.RESEND_API_KEY;
    const typed = `e2e-userA-${Date.now()}@example.test`;
    const start = await otpStartPOST(
      new NextRequest("https://furlpay.com/api/auth/otp/start", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.8.0.1" },
        body: JSON.stringify({ to: typed, channel: "email" }),
      }),
    );
    const { devCode } = (await start.json()) as { devCode?: string };
    expect(devCode).toMatch(/^\d{6}$/);
    const check = await otpCheckPOST(
      new NextRequest("https://furlpay.com/api/auth/otp/check", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.8.0.1" },
        body: JSON.stringify({ to: typed, code: devCode, channel: "email", login: true }),
      }),
    );
    expect(check.status).toBe(200);
  });
});
