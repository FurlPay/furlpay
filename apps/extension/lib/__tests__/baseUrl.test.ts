import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// The backend URL is allow-listed.
//
// `setBaseUrl` used to persist whatever string it was handed, straight from a
// free-text field in Settings — no scheme check, no host check. Host permissions
// bounded the damage (a fetch elsewhere fails CORS), so this was never a live
// exploit. It was a control with no floor: the failure mode of a mistyped or
// pasted value was silent breakage, and the only thing between a user talked
// into pasting a URL and their request bodies going elsewhere was a manifest
// they cannot see.
//
// import.meta.env.DEV is true under vitest, so the dev hosts are in scope here.
// The production-build case is covered by the manifest-parity test at the end.
// ---------------------------------------------------------------------------

const storage: Record<string, unknown> = {};

vi.stubGlobal("browser", {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(storage, items);
      }),
    },
  },
  runtime: { getManifest: () => ({ version: "0.0.0-test" }) },
});

const { normalizeBaseUrl, setBaseUrl, getBaseUrl, InvalidBaseUrlError } = await import("../api");

beforeEach(() => {
  for (const k of Object.keys(storage)) delete storage[k];
});

describe("normalizeBaseUrl accepts FurlPay backends", () => {
  it.each([
    "https://furlpay.com",
    "https://www.furlpay.com",
    "https://api.furlpay.com",
    "https://api-staging.furlpay.com",
    "https://api-dev.furlpay.com",
    "http://localhost:3000",
  ])("accepts %s", (url) => {
    expect(normalizeBaseUrl(url)).toBe(url);
  });

  it("strips trailing slashes so two spellings of one host cannot disagree", () => {
    expect(normalizeBaseUrl("https://furlpay.com///")).toBe("https://furlpay.com");
  });

  it("trims surrounding whitespace — pasted URLs carry it", () => {
    expect(normalizeBaseUrl("  https://furlpay.com  ")).toBe("https://furlpay.com");
  });
});

describe("normalizeBaseUrl rejects everything else", () => {
  it.each([
    ["a foreign origin", "https://evil.example"],
    ["a lookalike host", "https://furlpay.com.evil.example"],
    ["a host that merely contains the domain", "https://notfurlpay.com"],
    ["plaintext http to the real host", "http://furlpay.com"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:text/html,<script>1</script>"],
    ["a file: URL", "file:///etc/passwd"],
    ["not a URL at all", "furlpay.com"],
    ["an empty string", ""],
  ])("rejects %s", (_label, url) => {
    expect(() => normalizeBaseUrl(url)).toThrow(InvalidBaseUrlError);
  });

  it("rejects credentials smuggled into the authority", () => {
    // `https://furlpay.com@evil.example` parses with origin
    // https://evil.example — a prefix check on the raw string would have
    // accepted it. Comparing on ORIGIN is what makes this safe.
    expect(() => normalizeBaseUrl("https://furlpay.com@evil.example")).toThrow(
      InvalidBaseUrlError
    );
  });

  it("rejects a foreign host even when the path names the real one", () => {
    expect(() => normalizeBaseUrl("https://evil.example/furlpay.com")).toThrow(
      InvalidBaseUrlError
    );
  });
});

describe("storage round-trip", () => {
  it("persists an allowed URL", async () => {
    await setBaseUrl("https://api-staging.furlpay.com/");
    expect(await getBaseUrl()).toBe("https://api-staging.furlpay.com");
  });

  it("refuses to persist a rejected URL", async () => {
    await expect(setBaseUrl("https://evil.example")).rejects.toThrow(InvalidBaseUrlError);
    expect(storage.baseUrl).toBeUndefined();
  });

  it("ignores a disallowed value already in storage", async () => {
    // Extension storage is writable by anything with access to the profile
    // directory, and a value written by an older build predates this allowlist.
    // Validating only on write would honour both.
    storage.baseUrl = "https://evil.example";
    expect(await getBaseUrl()).not.toBe("https://evil.example");
  });
});

describe("the allowlist matches the manifest", () => {
  // Read as SOURCE rather than imported. `wxt.config.ts` imports `defineConfig`
  // from wxt, which pulls the whole build toolchain into the test process — it
  // takes seconds and brings in far more than this assertion needs. The
  // invariant is textual anyway: these two lists must name the same hosts.
  const config = readFileSync(new URL("../../wxt.config.ts", import.meta.url), "utf8");

  it.each([
    "https://furlpay.com",
    "https://www.furlpay.com",
    "https://api.furlpay.com",
    "https://api-staging.furlpay.com",
    "https://api-dev.furlpay.com",
    "http://localhost:3000",
  ])("%s is declared in host_permissions", (origin) => {
    // A host the user may select but the browser will not let us reach produces
    // a setting that appears to save and then fails every request on CORS, with
    // no error surfaced anywhere.
    expect(config).toContain(`"${origin}/*"`);
  });

  /** The host_permissions array body, and the offset of its production gate. */
  const hostPermissions = (() => {
    const start = config.indexOf("host_permissions:");
    const end = config.indexOf("],", start);
    const body = config.slice(start, end);
    return { body, gateAt: body.indexOf("isProduction") };
  })();

  it("gates dev and staging hosts behind the production check", () => {
    // Over-permissioning is the single most common Chrome Web Store rejection
    // reason, and dev/staging are unjustifiable permissions in a public
    // listing. Each must appear AFTER the `isProduction` gate, i.e. inside the
    // non-production branch.
    expect(hostPermissions.gateAt).toBeGreaterThan(-1);
    for (const host of ["api-staging.furlpay.com", "api-dev.furlpay.com", "localhost:3000"]) {
      expect(hostPermissions.body.indexOf(host)).toBeGreaterThan(hostPermissions.gateAt);
    }
  });

  it("keeps the production API host UNgated", () => {
    // api.furlpay.com is where a published listing actually talks, so it has to
    // sit before the gate — inside it, the store build would have no backend.
    const at = hostPermissions.body.indexOf('"https://api.furlpay.com/*"');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(hostPermissions.gateAt);
  });
});
