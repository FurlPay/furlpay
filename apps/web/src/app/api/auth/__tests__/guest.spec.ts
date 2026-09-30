import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/guest/route";

// ---------------------------------------------------------------------------
// /api/auth/guest is an INTENTIONAL authentication bypass: it mints a signed
// session for the seeded demo user with no credential at all. It exists so the
// app can be clicked through on a device, and for Play review access.
//
// Something that hands out sessions for free needs its "off" switch pinned by
// a test, not by a comment. Until this file existed the route had neither — a
// refactor that dropped the production check, or inverted the VERCEL_ENV
// comparison, would have shipped green.
//
// The two gates under test:
//
//   1. the deployment gate — production builds are refused unless Vercel
//      reports the deployment itself as a preview, and
//   2. the opt-in — ALLOW_GUEST_LOGIN=1, server-side.
//
// The preview carve-out is deliberate and is asserted rather than removed:
// preview deploys ARE production builds, so without it the endpoint could not
// do the job it exists for. What matters is that furlpay.com (where
// VERCEL_ENV is "production") can never reach it.
// ---------------------------------------------------------------------------

function req() {
  return new NextRequest("https://furlpay.com/api/auth/guest", { method: "POST" });
}

beforeEach(() => {
  // The route rate-limits at 10/min/IP and every case here shares an IP, so a
  // leftover counter from a previous case would turn a 403 assertion into a
  // 429 and the gate would look like it was working when it was not.
  const g = globalThis as unknown as { __furlpayKv?: Map<string, unknown> };
  g.__furlpayKv?.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("guest login — deployment gate", () => {
  it("refuses on a production deployment even when the opt-in is set", () => {
    // The case that matters: furlpay.com with a misconfigured dashboard
    // variable. The opt-in is ON and it must still be refused.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALLOW_GUEST_LOGIN", "1");

    return POST(req()).then(async (res) => {
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("Guest login disabled");
    });
  });

  it("refuses on a production build with VERCEL_ENV unset", () => {
    // Any production-like host that is not a Vercel preview — a self-hosted
    // build, a container, a misconfigured CI deploy.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("ALLOW_GUEST_LOGIN", "1");

    return POST(req()).then((res) => expect(res.status).toBe(403));
  });

  it("does not mint a session on a production deployment", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALLOW_GUEST_LOGIN", "1");

    const res = await POST(req());
    // The real damage would be a Set-Cookie riding along with the error.
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("guest login — opt-in", () => {
  it("refuses on a preview deployment that has not opted in", () => {
    // Past the deployment gate, but no ALLOW_GUEST_LOGIN — still closed.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("ALLOW_GUEST_LOGIN", "");
    vi.stubEnv("NEXT_PUBLIC_ALLOW_GUEST", "1"); // UI flag alone authorizes nothing

    return POST(req()).then((res) => expect(res.status).toBe(403));
  });

  it("allows a preview deployment that has opted in", async () => {
    // The carve-out this endpoint exists for. Asserted so nobody "hardens" it
    // away by accident and silently breaks device testing / Play review.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("ALLOW_GUEST_LOGIN", "1");
    // Signing needs a real secret once NODE_ENV is "production" — a separate
    // fail-closed control in session.ts, and a preview deploy sets one too.
    // Without it this case fails on the secret rather than exercising the gate.
    vi.stubEnv("FURLPAY_SESSION_SECRET", "t".repeat(48));

    const res = await POST(req());
    expect(res.status).not.toBe(403);
  });

  it("never mints a privileged role, whatever the demo seed carries", async () => {
    // The demo seed has roles ["user", "compliance_officer", "admin"]. They
    // used to be copied into the guest token, so an unauthenticated guest on a
    // preview deployment got an admin-labelled session.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("ALLOW_GUEST_LOGIN", "1");
    vi.stubEnv("FURLPAY_SESSION_SECRET", "t".repeat(48));

    const res = await POST(
      new NextRequest("https://furlpay.com/api/auth/guest", {
        method: "POST",
        headers: { "x-furlpay-client": "mobile-android" },
      })
    );
    const { token } = await res.json();
    const claims = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
    expect(claims.roles).toEqual(["user"]);
    expect(claims.guest).toBe(true);
  });
});
