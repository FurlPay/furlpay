import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";

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
});
afterEach(() => vi.unstubAllEnvs());

describe("public event routes — anonymous visitor", () => {
  it.each([
    "/events",
    "/events/token2049-singapore-2026",
    "/token2049",
    "/talk-to-us",
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
