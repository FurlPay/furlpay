// ---------------------------------------------------------------------------
// CSRF Origin backstop (middleware.ts crossSiteCookieForgery). The middleware
// rejects mutating API requests that carry the session cookie but originate
// from a foreign http(s) origin. Complements SameSite=Lax — see the comment on
// the function for the exact threat model.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { crossSiteCookieForgery } from "../../middleware";

function reqWith(origin: string | null, host = "furlpay.com"): NextRequest {
  const headers = new Headers({ host });
  if (origin !== null) headers.set("origin", origin);
  return new NextRequest("https://furlpay.com/api/profile", { method: "POST", headers });
}

describe("crossSiteCookieForgery", () => {
  it("allows same-origin requests", () => {
    expect(crossSiteCookieForgery(reqWith("https://furlpay.com"))).toBe(false);
  });

  it("tolerates the www/apex pair in both directions", () => {
    expect(crossSiteCookieForgery(reqWith("https://www.furlpay.com"))).toBe(false);
    expect(crossSiteCookieForgery(reqWith("https://furlpay.com", "www.furlpay.com"))).toBe(false);
  });

  it("allows requests without an Origin header (non-browser clients)", () => {
    expect(crossSiteCookieForgery(reqWith(null))).toBe(false);
  });

  it("allows extension origins (installed extension is outside the CSRF model)", () => {
    expect(crossSiteCookieForgery(reqWith("chrome-extension://abcdefgh"))).toBe(false);
    expect(crossSiteCookieForgery(reqWith("moz-extension://uuid-here"))).toBe(false);
  });

  it("rejects foreign http(s) origins", () => {
    expect(crossSiteCookieForgery(reqWith("https://evil.example"))).toBe(true);
    expect(crossSiteCookieForgery(reqWith("https://furlpay.com.evil.example"))).toBe(true);
    expect(crossSiteCookieForgery(reqWith("http://furlpay.com.attacker.io"))).toBe(true);
  });

  it("rejects opaque and malformed origins", () => {
    expect(crossSiteCookieForgery(reqWith("null"))).toBe(true);
    expect(crossSiteCookieForgery(reqWith("not a url"))).toBe(true);
  });

  it("dev localhost matches itself", () => {
    expect(crossSiteCookieForgery(reqWith("http://localhost:3000", "localhost:3000"))).toBe(false);
    expect(crossSiteCookieForgery(reqWith("http://localhost:4000", "localhost:3000"))).toBe(true);
  });
});
