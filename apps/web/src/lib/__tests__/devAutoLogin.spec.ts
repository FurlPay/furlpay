import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { devAutoLoginEnabled, safeNextPath } from "../devAutoLogin";
import { middleware } from "../../middleware";
import { GET as devSession } from "@/app/api/auth/dev-session/route";

// Local-development auto sign-in: open in development with the flag, closed
// (404, and /login as usual) in every production build whatever the flag says.

afterEach(() => vi.unstubAllEnvs());

let ip = 0;
const req = (path: string) =>
  new NextRequest(`http://localhost${path}`, { headers: { "x-real-ip": `198.51.100.${(ip++ % 200) + 1}` } });

describe("devAutoLoginEnabled", () => {
  it.each([
    [{ NODE_ENV: "development", FURLPAY_DEV_AUTO_LOGIN: "1" }, true],
    [{ NODE_ENV: "development" }, false],
    [{ NODE_ENV: "development", FURLPAY_DEV_AUTO_LOGIN: "true" }, false],
    [{ NODE_ENV: "production", FURLPAY_DEV_AUTO_LOGIN: "1" }, false],
  ])("%j → %s", (env, want) => expect(devAutoLoginEnabled(env)).toBe(want));
});

describe("safeNextPath never redirects off-site", () => {
  it.each([
    ["/analytics", "/analytics"],
    ["/analytics/users?range=7d", "/analytics/users?range=7d"],
    ["https://evil.example/x", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    [null, "/"],
  ])("%s → %s", (raw, want) => expect(safeNextPath(raw)).toBe(want));
});

describe("GET /api/auth/dev-session", () => {
  it("is 404 in a production build even with the flag set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FURLPAY_DEV_AUTO_LOGIN", "1");
    const res = await devSession(req("/api/auth/dev-session?next=/analytics"));
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("is 404 in development without the flag", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FURLPAY_DEV_AUTO_LOGIN", "");
    expect((await devSession(req("/api/auth/dev-session"))).status).toBe(404);
  });

  it("development + flag: sets a session cookie and redirects to the same-origin next", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FURLPAY_DEV_AUTO_LOGIN", "1");
    const res = await devSession(req("/api/auth/dev-session?next=/analytics"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/analytics");
    expect(res.headers.get("set-cookie")).toMatch(/furlpay_session=/);
  });

  it("an off-site next is replaced by /", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FURLPAY_DEV_AUTO_LOGIN", "1");
    const res = await devSession(req("/api/auth/dev-session?next=//evil.example"));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.host).toBe("localhost");
    expect(loc.pathname).toBe("/");
  });
});

describe("middleware: where an unauthenticated /analytics request goes", () => {
  it("production: /login, flag or not", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FURLPAY_DEV_AUTO_LOGIN", "1");
    const res = await middleware(req("/analytics"));
    expect(new URL(res!.headers.get("location")!).pathname).toBe("/login");
  });

  it("development with the flag: the dev auto sign-in", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FURLPAY_DEV_AUTO_LOGIN", "1");
    const loc = new URL((await middleware(req("/analytics")))!.headers.get("location")!);
    expect(loc.pathname).toBe("/api/auth/dev-session");
    expect(loc.searchParams.get("next")).toBe("/analytics");
  });
});
