import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// FURLPAY_EXTENSION_ID controls which browser extension may assert a
// furlpay.com passkey (Chrome 122+ lets an extension pass an rpID for any
// domain in its host_permissions; the RP sees `chrome-extension://<id>` as the
// origin and must trust it explicitly).
//
// This is an AUTHENTICATION TRUST BOUNDARY: every accepted origin is a surface
// that can approve payments. These tests pin the two properties that keep it
// safe — fail closed when unset, and never trust anything but an exact,
// well-formed extension id.
// ---------------------------------------------------------------------------

const ORIGINAL = process.env;

async function loadOrigins(env: Record<string, string | undefined>): Promise<string[]> {
  vi.resetModules();
  process.env = { ...ORIGINAL, ...env } as NodeJS.ProcessEnv;
  const mod = await import("../webauthn");
  return mod.EXPECTED_ORIGINS;
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  process.env = ORIGINAL;
});

const VALID_ID = "abcdefghijklmnopabcdefghijklmnop"; // 32 chars, a-p

describe("extension WebAuthn origin", () => {
  it("trusts no extension when FURLPAY_EXTENSION_ID is unset (fails closed)", async () => {
    const origins = await loadOrigins({
      FURLPAY_ORIGIN: "https://furlpay.com",
      FURLPAY_EXTENSION_ID: undefined,
      FURLPAY_ANDROID_CERT_SHA256: undefined,
    });
    expect(origins.some((o) => o.startsWith("chrome-extension://"))).toBe(false);
    expect(origins).toContain("https://furlpay.com");
  });

  it("adds the extension origin alongside the web origin when configured", async () => {
    const origins = await loadOrigins({
      FURLPAY_ORIGIN: "https://furlpay.com",
      FURLPAY_EXTENSION_ID: VALID_ID,
      FURLPAY_ANDROID_CERT_SHA256: undefined,
    });
    expect(origins).toContain(`chrome-extension://${VALID_ID}`);
    // The web origin must survive — the site is still the primary surface.
    expect(origins).toContain("https://furlpay.com");
  });

  it("accepts an id given with the scheme already attached", async () => {
    const origins = await loadOrigins({
      FURLPAY_ORIGIN: "https://furlpay.com",
      FURLPAY_EXTENSION_ID: `chrome-extension://${VALID_ID}`,
    });
    expect(origins).toContain(`chrome-extension://${VALID_ID}`);
  });

  it("supports several published ids (stable + beta channel)", async () => {
    const second = "ponmlkjihgfedcbaponmlkjihgfedcba";
    const origins = await loadOrigins({
      FURLPAY_ORIGIN: "https://furlpay.com",
      FURLPAY_EXTENSION_ID: `${VALID_ID},${second}`,
    });
    expect(origins).toContain(`chrome-extension://${VALID_ID}`);
    expect(origins).toContain(`chrome-extension://${second}`);
  });

  it("REJECTS malformed ids rather than trusting them", async () => {
    for (const bad of [
      "*",                                   // wildcard — would trust every extension
      "abc",                                 // too short
      "abcdefghijklmnopabcdefghijklmnopq",   // 33 chars
      "abcdefghijklmnopabcdefghijklmno1",    // digit: ids are a-p only
      "ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP",    // uppercase
      "../../etc/passwd",
    ]) {
      const origins = await loadOrigins({
        FURLPAY_ORIGIN: "https://furlpay.com",
        FURLPAY_EXTENSION_ID: bad,
      });
      expect(origins.some((o) => o.startsWith("chrome-extension://"))).toBe(false);
    }
  });

  it("keeps a valid id and drops an invalid one from the same list", async () => {
    const origins = await loadOrigins({
      FURLPAY_ORIGIN: "https://furlpay.com",
      FURLPAY_EXTENSION_ID: `${VALID_ID},not-an-id`,
    });
    expect(origins).toContain(`chrome-extension://${VALID_ID}`);
    expect(origins.filter((o) => o.startsWith("chrome-extension://"))).toHaveLength(1);
  });

  it("does not disturb the Android apk-key-hash origin", async () => {
    const origins = await loadOrigins({
      FURLPAY_ORIGIN: "https://furlpay.com",
      FURLPAY_EXTENSION_ID: VALID_ID,
      FURLPAY_ANDROID_CERT_SHA256: "15:92:F6:8B:BE:16:5A:EF:47:EB:51:30:39:A2:64:EF:41:95:6E:52:77:CB:8A:29:9B:9E:AD:E4:C1:13:29:13",
    });
    expect(origins.some((o) => o.startsWith("android:apk-key-hash:"))).toBe(true);
    expect(origins).toContain(`chrome-extension://${VALID_ID}`);
    expect(origins).toContain("https://furlpay.com");
  });

  it("leaves the rpID as the registrable domain, never the extension", async () => {
    vi.resetModules();
    process.env = { ...ORIGINAL, FURLPAY_RP_ID: "furlpay.com", FURLPAY_EXTENSION_ID: VALID_ID } as NodeJS.ProcessEnv;
    const mod = await import("../webauthn");
    // The credential stays bound to furlpay.com — the extension is only an
    // additional CALLER, never a new relying party.
    expect(mod.RP_ID).toBe("furlpay.com");
    expect(mod.EXPECTED_RPIDS.some((r: string) => r.includes("chrome-extension"))).toBe(false);
  });
});
