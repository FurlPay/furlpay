import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";
import { SESSION_COOKIE, signSession } from "@/lib/session";

// The TOKEN2049 event page is public marketing content. Production served it
// behind a login wall (307 → /login?next=…) because the deployed middleware
// predated "/events" in PUBLIC_PAGE_PREFIXES (added in b9d3d27). This pins the
// anonymous behaviour of the event routes AND that private pages stay private,
// so making marketing pages public can never quietly widen to account pages.

let ip = 1;
const anon = (path: string) =>
  new NextRequest(`https://furlpay.com${path}`, {
    headers: { "x-real-ip": `203.0.113.${(ip++ % 200) + 1}`, accept: "text/html" },
  });

const isLoginRedirect = (res: Response) => {
  const loc = res.headers.get("location");
  return res.status >= 300 && res.status < 400 && !!loc && new URL(loc, "https://furlpay.com").pathname === "/login";
};

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("FURLPAY_DEV_AUTO_LOGIN", "");
  // Test fixture (production mode requires >= 32 chars); not a real secret.
  vi.stubEnv("FURLPAY_SESSION_SECRET", "test-fixture-session-secret-0123456789abcdef");
});
afterEach(() => vi.unstubAllEnvs());

describe("public event routes — anonymous visitor", () => {
  it.each([
    "/events",
    "/events/token2049-singapore-2026",
    "/token2049",
    "/talk-to-us",
    // Sitemap-listed glossary; was 307 → /login in production until 2026-10-02.
    "/learn",
    "/learn/usdc",
    "/learn/genius-act",
  ])("%s is NOT sent to /login", async (path) => {
    const res = await middleware(anon(path));
    expect(isLoginRedirect(res)).toBe(false);
    expect(res.status).toBeLessThan(400);
  });
});

describe("private pages — anonymous visitor", () => {
  it.each([
    "/dashboard",
    "/profile",
    "/notifications",
    "/circle-wallet",
    "/cards",
    "/portfolio",
  ])("%s still redirects to /login", async (path) => {
    const res = await middleware(anon(path));
    expect(isLoginRedirect(res)).toBe(true);
    expect(new URL(res.headers.get("location")!).searchParams.get("next")).toBe(path);
  });

  it("/token2049 is an exact public page, not a prefix: /token2049x stays private", async () => {
    expect(isLoginRedirect(await middleware(anon("/token2049x")))).toBe(true);
  });
});

describe("signed-in visitor — behaviour unchanged", () => {
  const signedIn = async (path: string) => {
    const token = await signSession({ sub: randomUUID(), safe: "0x0", roles: ["user"], jti: randomUUID() });
    return new NextRequest(`https://furlpay.com${path}`, {
      headers: {
        "x-real-ip": `198.51.100.${(ip++ % 200) + 1}`,
        accept: "text/html",
        cookie: `${SESSION_COOKIE}=${token}`,
      },
    });
  };

  it.each(["/events", "/events/token2049-singapore-2026", "/dashboard", "/profile", "/cards", "/portfolio"])(
    "%s is served, not sent to /login",
    async (path) => {
      const res = await middleware(await signedIn(path));
      expect(isLoginRedirect(res)).toBe(false);
      expect(res.status).toBeLessThan(400);
    }
  );
});
