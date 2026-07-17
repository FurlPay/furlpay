// Auth handoff (native → in-app browser) security. Drives the REAL routes
// against the in-memory kv + store:
//   POST /api/auth/handoff  — mint a one-time code (auth required)
//   GET  /auth/handoff      — redeem it, set the web cookie, redirect to `next`
//
// The two properties that matter: the code is single-use/short-lived, and the
// `next` redirect can never leave furlpay.com (open-redirect / phishing on a
// trusted domain). The open-redirect matrix here is the regression guard for
// the tab/backslash bypass of the old string-prefix check.

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { POST as mintPOST } from "@/app/api/auth/handoff/route";
import { GET as redeemGET } from "@/app/auth/handoff/route";
import { signSession } from "@/lib/session";
import { findOrCreateUserByIdentity } from "@/lib/store";
import { deleteUserAccount } from "@/lib/accountDeletion";

const ORIGIN = "https://furlpay.com";

async function actor() {
  const email = `handoff-${randomUUID()}@furlpay.test`;
  const { account } = findOrCreateUserByIdentity({ email, name: "Handoff User" });
  const token = await signSession({ sub: account.user.id, safe: "0x0", roles: ["user"], jti: randomUUID() });
  return { id: account.user.id, token };
}

function mintReq(token: string | undefined) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `10.9.0.${Math.floor(Math.random() * 250)}`,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`${ORIGIN}/api/auth/handoff`, { method: "POST", headers });
}

/** Build a redemption request, using searchParams.set so a literal control char
 *  (tab/newline) in `next` is percent-encoded in the URL and decoded back by
 *  the route — exactly how an attacker would smuggle it past a prefix check. */
function redeemReq(code: string | null, next?: string | null) {
  const url = new URL(`${ORIGIN}/auth/handoff`);
  if (code !== null) url.searchParams.set("code", code);
  if (next !== undefined && next !== null) url.searchParams.set("next", next);
  return new NextRequest(url, { method: "GET" });
}

async function mintCode(token: string): Promise<string> {
  const res = await mintPOST(mintReq(token));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(typeof body.code).toBe("string");
  return body.code as string;
}

describe("POST /api/auth/handoff — minting", () => {
  it("401s an unauthenticated mint", async () => {
    expect((await mintPOST(mintReq(undefined))).status).toBe(401);
  });

  it("mints an opaque, non-guessable code bound to the caller", async () => {
    const a = await actor();
    const code = await mintCode(a.token);
    // 256-bit base64url ≈ 43 chars, no session material embedded.
    expect(code.length).toBeGreaterThanOrEqual(43);
    expect(code).not.toContain(a.id);
  });

  it("BLOCKS a deleted account's still-valid session (tombstone)", async () => {
    const a = await actor();
    await deleteUserAccount(a.id);
    expect((await mintPOST(mintReq(a.token))).status).toBe(401);
  });
});

describe("GET /auth/handoff — redemption", () => {
  it("redeems a fresh code, sets a session cookie, redirects to next", async () => {
    const a = await actor();
    const code = await mintCode(a.token);
    const res = await redeemGET(redeemReq(code, "/travel/hotels?city=Bali"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/travel/hotels?city=Bali`);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/=/); // a cookie was set
  });

  it("is SINGLE-USE — a replay of the same code is rejected", async () => {
    const a = await actor();
    const code = await mintCode(a.token);
    const first = await redeemGET(redeemReq(code, "/wallet"));
    expect(first.headers.get("location")).toBe(`${ORIGIN}/wallet`);
    const replay = await redeemGET(redeemReq(code, "/wallet"));
    expect(replay.headers.get("location")).toBe(`${ORIGIN}/login?error=code_already_used`);
  });

  it("rejects a missing code", async () => {
    const res = await redeemGET(redeemReq(null, "/travel"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?error=missing_code`);
  });

  it("rejects an unknown/expired code", async () => {
    const res = await redeemGET(redeemReq("not-a-real-code", "/travel"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?error=code_expired`);
  });

  it("defaults next to /travel when omitted", async () => {
    const a = await actor();
    const code = await mintCode(a.token);
    const res = await redeemGET(redeemReq(code));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/travel`);
  });
});

describe("GET /auth/handoff — next is open-redirect proof", () => {
  // Each of these MUST redeem to a location whose origin is furlpay.com. The
  // TAB and backslash cases are the ones that slipped past the old
  // `raw.startsWith("//")` string check.
  const malicious = [
    "//evil.com",
    "https://evil.com",
    "http://evil.com/x",
    "/\\evil.com", // backslash → // for special schemes
    "/\\/evil.com",
    "/\t/evil.com", // embedded TAB stripped by the URL parser → //
    "/\n/evil.com", // embedded newline
    "/\r/evil.com", // embedded CR
    "/..//evil.com", // dot-segment normalization → //evil.com pathname
    "javascript:alert(1)",
    "mailto:a@b.c",
    "data:text/html,x",
  ];

  it.each(malicious)("never leaves furlpay.com for next=%j", async (next) => {
    const a = await actor();
    const code = await mintCode(a.token);
    const res = await redeemGET(redeemReq(code, next));
    const loc = res.headers.get("location")!;
    expect(loc).toBeTruthy();
    expect(new URL(loc).origin).toBe(ORIGIN);
  });

  const benign = [
    ["/travel/hotels?city=Bali", `${ORIGIN}/travel/hotels?city=Bali`],
    ["/wallet", `${ORIGIN}/wallet`],
    ["/travel/flights?from=DEL", `${ORIGIN}/travel/flights?from=DEL`],
  ] as const;

  it.each(benign)("preserves a legitimate same-origin next=%j", async (next, expected) => {
    const a = await actor();
    const code = await mintCode(a.token);
    const res = await redeemGET(redeemReq(code, next));
    expect(res.headers.get("location")).toBe(expected);
  });
});
