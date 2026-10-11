import { describe, expect, it } from "vitest";
import { resolveSameOrigin, safeRedirectPath, safeRedirectUrl } from "../safeRedirect";

const O = "https://furlpay.com";

// Every one of these resolves to another host (or a path a caller could turn
// into one) under the WHATWG URL parser, so each must fall back.
const HOSTILE = [
  "//evil.com",
  "/\\evil.com",
  "/\\/evil.com",
  "/\t/evil.com",
  "/\n/evil.com",
  "/\r/evil.com",
  "/\t\\evil.com",
  "/.//evil.com",
  "/x/..//evil.com",
  "https://evil.com",
  "http://furlpay.com/",
  "https://furlpay.com.evil.com/",
  "javascript:alert(1)",
  "data:text/html,hi",
  "evil.com",
  "",
  "/" + "a".repeat(600),
];

describe("safe redirect", () => {
  it.each(HOSTILE)("rejects %j", (raw) => {
    expect(resolveSameOrigin(raw, O)).toBeNull();
    expect(safeRedirectPath(raw, O, "/dashboard")).toBe("/dashboard");
    expect(safeRedirectUrl(raw, O, "/login").href).toBe("https://furlpay.com/login");
  });

  it("the resolved path can never be re-read as another host", () => {
    for (const raw of HOSTILE) {
      const p = safeRedirectPath(raw, O, "/dashboard");
      expect(new URL(p, O).host).toBe("furlpay.com");
    }
  });

  it("keeps ordinary in-app targets, query and hash intact", () => {
    expect(safeRedirectPath("/settlement/onboarding/review", O)).toBe("/settlement/onboarding/review");
    expect(safeRedirectPath("/pay/x402?resource=https%3A%2F%2Fapi.example.com&x=1#top", O)).toBe("/pay/x402?resource=https%3A%2F%2Fapi.example.com&x=1#top");
    expect(safeRedirectPath("/a/../b", O)).toBe("/b");
  });

  it("encoded slashes stay encoded (never decoded into a scheme-relative path)", () => {
    expect(safeRedirectPath("/%2F%2Fevil.com", O)).toBe("/%2F%2Fevil.com");
    expect(new URL(safeRedirectPath("/%2F%2Fevil.com", O), O).host).toBe("furlpay.com");
    expect(safeRedirectPath("/%5Cevil.com", O)).toBe("/%5Cevil.com");
  });

  it("non-string and missing input fall back", () => {
    expect(safeRedirectPath(null, O, "/x")).toBe("/x");
    expect(safeRedirectPath(undefined, O, "/x")).toBe("/x");
    expect(resolveSameOrigin("/ok", "not a url")).toBeNull();
  });

  it("works against another trusted host (support SSO)", () => {
    const Z = "https://furlpay.zendesk.com";
    expect(safeRedirectUrl("/hc/en-us/requests", Z).href).toBe("https://furlpay.zendesk.com/hc/en-us/requests");
    expect(safeRedirectUrl("/\t/evil.com", Z, "/").href).toBe("https://furlpay.zendesk.com/");
  });
});

describe("no hand-rolled redirect checks remain", () => {
  it("every next/return_to check goes through lib/safeRedirect", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(process.cwd(), "src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== "__tests__" && name !== "node_modules") walk(p);
        } else if (/\.(ts|tsx)$/.test(name) && !p.endsWith("safeRedirect.ts")) {
          const src = readFileSync(p, "utf8");
          if (/startsWith\("\/"\)\s*&&\s*![\w.]*startsWith\("\/\/"\)/.test(src)) offenders.push(p.slice(root.length + 1));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
