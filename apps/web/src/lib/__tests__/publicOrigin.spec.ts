import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { configuredPublicOrigin, PublicOriginConfigError, publicOrigin, publicRequestUrl } from "../publicOrigin";
import { crossSiteCookieForgery } from "../../middleware";

// On ECS the standalone server builds the request URL from its bind address
// (verified on next 15.5.26: req.url = https://0.0.0.0:3000/…, whatever Host or
// X-Forwarded-Host say), and Host is the ALB origin hostname. The public origin
// comes from deploy configuration there; see CLIENT_IP_TRUST_MODEL.md §Host.

const AWS = { PUBLIC_API_ORIGIN: "https://api.furlpay.com" };
/** What an ECS task's route handler actually receives. */
const ecsRequest = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`https://0.0.0.0:3000${path}`, {
    method: "POST",
    headers: { host: "origin-api.furlpay.com", ...headers },
  });

afterEach(() => vi.unstubAllEnvs());

describe("publicOrigin", () => {
  it("AWS: the configured origin, not the bind address or the Host header", () => {
    expect(publicOrigin(ecsRequest("/x"), AWS)).toBe("https://api.furlpay.com");
  });

  it("X-Forwarded-Host / Host injection cannot move it", () => {
    const r = ecsRequest("/x", { host: "evil.example", "x-forwarded-host": "evil.example" });
    expect(publicOrigin(r, AWS)).toBe("https://api.furlpay.com");
    expect(publicOrigin(r, {})).not.toContain("evil.example"); // unset: platform URL, never the header
  });

  it("Vercel / dev (unset): the platform-routed origin", () => {
    expect(publicOrigin(new NextRequest("https://furlpay.com/x"), {})).toBe("https://furlpay.com");
  });

  it("the public request URL keeps path and query, for DPoP htu and signatures", () => {
    expect(publicRequestUrl(ecsRequest("/api/oauth/token?a=1"), AWS).toString()).toBe("https://api.furlpay.com/api/oauth/token?a=1");
  });

  it.each(["http://api.furlpay.com", "https://api.furlpay.com/v1", "https://api.furlpay.com?x=1", "https://u:p@api.furlpay.com", "api.furlpay.com", "not a url"])(
    "refuses a malformed configuration %j",
    (bad) => {
      expect(() => configuredPublicOrigin({ PUBLIC_API_ORIGIN: bad })).toThrow(PublicOriginConfigError);
    }
  );

  it("accepts a trailing slash and an explicit port", () => {
    expect(configuredPublicOrigin({ PUBLIC_API_ORIGIN: "https://api.furlpay.com/" })).toBe("https://api.furlpay.com");
    expect(configuredPublicOrigin({ PUBLIC_API_ORIGIN: "https://api.furlpay.com:8443" })).toBe("https://api.furlpay.com:8443");
  });
});

describe("CSRF origin backstop behind CloudFront", () => {
  it("same-site browser POST passes even though Host is the ALB origin name", () => {
    vi.stubEnv("PUBLIC_API_ORIGIN", AWS.PUBLIC_API_ORIGIN);
    expect(crossSiteCookieForgery(ecsRequest("/api/profile", { origin: "https://api.furlpay.com" }))).toBe(false);
  });

  it("a cross-site POST is still refused", () => {
    vi.stubEnv("PUBLIC_API_ORIGIN", AWS.PUBLIC_API_ORIGIN);
    expect(crossSiteCookieForgery(ecsRequest("/api/profile", { origin: "https://evil.example" }))).toBe(true);
    // An attacker Origin that matches the (non-public) ALB hostname earns nothing.
    expect(crossSiteCookieForgery(ecsRequest("/api/profile", { origin: "https://origin-api.furlpay.com" }))).toBe(true);
  });
});
