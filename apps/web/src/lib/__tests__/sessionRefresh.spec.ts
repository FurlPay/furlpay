import { describe, expect, it } from "vitest";
import {
  canRefreshSession,
  MAX_SESSION_LIFETIME_SECONDS,
  signSession,
  verifySession,
  type SessionClaims,
} from "@/lib/session";

// ---------------------------------------------------------------------------
// Sliding sessions. The invariant: exp slides, auth_time does not — so a
// session extends only within MAX_SESSION_LIFETIME of the real login.
// ---------------------------------------------------------------------------

describe("auth_time anchoring", () => {
  it("a fresh login mints auth_time = now", async () => {
    const before = Math.floor(Date.now() / 1000);
    const claims = await verifySession(await signSession({ sub: "user_1" }));
    expect(claims?.auth_time).toBeGreaterThanOrEqual(before);
    expect(claims?.auth_time).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 1);
  });

  it("a refresh-shaped mint CARRIES the original auth_time instead of resetting it", async () => {
    const originalAuthTime = Math.floor(Date.now() / 1000) - 3600; // logged in an hour ago
    const refreshed = await verifySession(
      await signSession({ sub: "user_1", auth_time: originalAuthTime })
    );
    expect(refreshed?.auth_time).toBe(originalAuthTime);
  });
});

describe("canRefreshSession", () => {
  const now = Date.now();
  const claims = (authTimeSecondsAgo: number): SessionClaims =>
    ({ sub: "user_1", auth_time: Math.floor(now / 1000) - authTimeSecondsAgo } as SessionClaims);

  it("allows sliding within the 30-day ceiling", () => {
    expect(canRefreshSession(claims(60), now)).toBe(true);
    expect(canRefreshSession(claims(MAX_SESSION_LIFETIME_SECONDS - 60), now)).toBe(true);
  });

  it("refuses once the original login is older than the ceiling", () => {
    expect(canRefreshSession(claims(MAX_SESSION_LIFETIME_SECONDS + 60), now)).toBe(false);
  });

  it("falls back to iat when auth_time is absent (pre-rollout tokens)", () => {
    const legacy = { sub: "user_1", iat: Math.floor(now / 1000) - 120 } as SessionClaims;
    expect(canRefreshSession(legacy, now)).toBe(true);
  });

  it("refuses a token with neither auth_time nor iat — never extend an unanchored session", () => {
    expect(canRefreshSession({ sub: "user_1" } as SessionClaims, now)).toBe(false);
  });
});
