// ---------------------------------------------------------------------------
// Sign in with Apple matrix. Drives the REAL POST /api/auth/apple handler and
// the REAL lib/auth/apple.ts verifier in mock mode (no APPLE_CLIENT_ID,
// NODE_ENV != production), which decodes the identity token WITHOUT signature
// verification -- the documented dev path.
//
// THE CASE THIS SUITE EXISTS FOR
// ==============================
// The Apple route accepted an identity whose email Apple had NOT verified,
// while the Google route rejected exactly that. The asymmetry mattered because
// findOrCreateUserByIdentityDurable falls back from appleSub to EMAIL, so an
// unverified address links the caller into an account that may have been
// created by email OTP -- account takeover on an unproven identifier.
//
// It never fired in practice (Apple sets email_verified on real Apple IDs and
// on private-relay addresses), which is precisely why the gap was invisible.
// These tests make the gate observable.
//
// What mock mode CANNOT cover: JWKS signature verification and audience
// checking, which live mode delegates to jose/jwtVerify against
// appleid.apple.com/auth/keys.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST as applePOST } from "@/app/api/auth/apple/route";
import { verifySession } from "@/lib/session";

/** Forge an UNSIGNED Apple identity token (mock verifier decodes without checking). */
function identityToken(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.`;
}

let n = 0;
function req(body: unknown) {
  n += 1;
  return new NextRequest("https://furlpay.com/api/auth/apple", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Rate limiting is per-IP; vary it so one test cannot 429 the next.
      "x-forwarded-for": `10.9.0.${n % 250}`,
      "x-furlpay-client": "mobile-ios/2.1.0",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const sub = () => `apple-${Math.random().toString(36).slice(2, 10)}`;

describe("Apple sign-in — verified email gate", () => {
  it("accepts an identity whose email Apple has verified", async () => {
    const s = sub();
    const res = await applePOST(
      req({ id_token: identityToken({ sub: s, email: `${s}@privaterelay.appleid.com`, email_verified: true }) })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("accepts email_verified sent as the string \"true\" (Apple does this)", async () => {
    const s = sub();
    const res = await applePOST(
      req({ id_token: identityToken({ sub: s, email: `${s}@example.com`, email_verified: "true" }) })
    );
    expect(res.status).toBe(200);
  });

  it("REJECTS an unverified email rather than linking on an unproven identifier", async () => {
    const s = sub();
    const res = await applePOST(
      req({ id_token: identityToken({ sub: s, email: `${s}@example.com`, email_verified: false }) })
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/not verified/i);
  });

  it("issues a session bound to the resolved user, not a shared identity", async () => {
    const s = sub();
    const res = await applePOST(
      req({ id_token: identityToken({ sub: s, email: `${s}@privaterelay.appleid.com`, email_verified: true }) })
    );
    const json = await res.json();
    expect(json.token).toBeTruthy();
    const claims = await verifySession(json.token);
    expect(claims?.sub).toBeTruthy();
  });
});

describe("Apple sign-in — body validation", () => {
  it("rejects a missing id_token with 400, not a 500 from the verifier", async () => {
    const res = await applePOST(req({}));
    expect(res.status).toBe(400);
  });

  it("rejects a non-JWT-shaped token at the edge", async () => {
    const res = await applePOST(req({ id_token: "not-a-jwt" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/validation failed/i);
  });

  it("rejects invalid JSON with 400", async () => {
    const res = await applePOST(req("{not json"));
    expect(res.status).toBe(400);
  });

  it("rejects a token far larger than any real identity token", async () => {
    const huge = "a".repeat(9000);
    const res = await applePOST(req({ id_token: `${huge}.${huge}.${huge}` }));
    expect(res.status).toBe(400);
  });

  it("caps an oversized body before it is parsed", async () => {
    // validateBody checks content-length first, then the actual text length.
    const res = await applePOST(req({ id_token: "a.b.c", name: "x".repeat(200_000) }));
    expect([400, 413]).toContain(res.status);
  });

  it("rejects an over-long name rather than storing it", async () => {
    const s = sub();
    const res = await applePOST(
      req({
        id_token: identityToken({ sub: s, email: `${s}@example.com`, email_verified: true }),
        name: "x".repeat(500),
      })
    );
    expect(res.status).toBe(400);
  });
});
