import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../../../../middleware";

// Payers are anonymous. The preview of 2026-10-09 served /p/<slug> behind the
// login wall (307 → /login) while its API was public, so no payment link could
// ever be opened. Pins the hosted checkout as public, and that the "/p/" prefix
// does not widen to look-alike private paths or the merchant's own dashboard.
let ip = 1;
const anon = (path: string) => new NextRequest(`https://furlpay.com${path}`, { headers: { "x-real-ip": `203.0.113.${(ip++ % 200) + 1}`, accept: "text/html" } });
const toLogin = (res: Response) => {
  const loc = res.headers.get("location");
  return res.status >= 300 && res.status < 400 && !!loc && new URL(loc, "https://furlpay.com").pathname === "/login";
};
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("FURLPAY_DEV_AUTO_LOGIN", "");
  vi.stubEnv("FURLPAY_SESSION_SECRET", "test-fixture-session-secret-0123456789abcdef"); // fixture, not a secret
});
afterEach(() => vi.unstubAllEnvs());

describe("hosted merchant checkout routing", () => {
  it("an anonymous payer can open /p/<slug>", async () => {
    expect(toLogin(await middleware(anon("/p/AbCdEfGhIjKlMnOpQrStUvWx")))).toBe(false);
  });
  // Private pages that merely start with "p", bare /p, and the merchant dashboard stay gated.
  it.each(["/profile", "/portfolio", "/p", "/dashboard/payments", "/payroll/me", "/dashboard/payroll"])("%s stays behind the login", async (path) => {
    expect(toLogin(await middleware(anon(path)))).toBe(true);
  });
  // The invite page must survive a login round trip with its #t= fragment, so it is public;
  // only its API is authenticated.
  it("a contractor can open a payroll invite before signing in", async () => {
    expect(toLogin(await middleware(anon("/payroll/join")))).toBe(false);
    expect(toLogin(await middleware(anon("/payroll/joinx")))).toBe(true);
  });
});
