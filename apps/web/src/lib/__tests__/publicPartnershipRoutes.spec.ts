import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";

// /partnerships and its inquiry form are for prospective partners, who have no
// account. The submitted inquiries (names, emails, Telegram / WhatsApp handles)
// are not: they are readable only through the admin API. This pins both sides
// so opening one can never quietly open the other.

let ip = 1;
const anon = (path: string, init: { method?: string; accept?: string } = {}) =>
  new NextRequest(`https://furlpay.com${path}`, {
    method: init.method ?? "GET",
    headers: { "x-real-ip": `203.0.113.${(ip++ % 200) + 1}`, accept: init.accept ?? "text/html" },
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

describe("partnerships — anonymous visitor", () => {
  it.each(["/partnerships", "/partners"])("%s is served, not sent to /login", async (path) => {
    const res = await middleware(anon(path));
    expect(isLoginRedirect(res)).toBe(false);
    expect(res.status).toBeLessThan(400);
  });

  it("the inquiry endpoint reaches its handler without a session", async () => {
    const res = await middleware(anon("/api/partnerships/inquiries", { method: "POST", accept: "application/json" }));
    expect(isLoginRedirect(res)).toBe(false);
    expect(res.status).not.toBe(401);
  });

  it("the admin API is refused without a session", async () => {
    const res = await middleware(anon("/api/admin/partnerships", { accept: "application/json" }));
    expect(res.status).toBe(401);
  });

  it("there is no /dashboard/partnerships page", () => {
    expect(existsSync(join(__dirname, "../../app/dashboard/partnerships"))).toBe(false);
  });
});
