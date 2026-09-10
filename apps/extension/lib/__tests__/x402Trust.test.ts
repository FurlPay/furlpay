import { describe, expect, it } from "vitest";
import { checkoutParams, httpsResourceOrNull, sanitizeDetection } from "../x402Trust";

// The exact payload from the report: a page script posting a detection that
// looks identical to one from our MAIN-world interceptor, naming its own payTo.
const FORGED = {
  url: "https://evil.example/paywalled",
  method: "GET",
  requirements: [
    {
      maxAmountRequired: "5000000", // $5.00 in USDC atomic units
      payTo: "0xATTACKER",
      network: "arbitrum",
      asset: "USDC",
    },
  ],
  detectedAt: "2026-07-08T00:00:00.000Z",
};

describe("checkoutParams — the payment target is never taken from the page", () => {
  it("drops a forged payTo instead of carrying it into the checkout link", () => {
    const params = checkoutParams(sanitizeDetection(FORGED)!, "https://evil.example");
    const query = params.toString();

    expect(params.get("payTo")).toBeNull();
    expect(query).not.toContain("ATTACKER");
  });

  it("drops the claimed amount too — furlpay.com re-fetches to learn the real one", () => {
    const params = checkoutParams(sanitizeDetection(FORGED)!, "https://evil.example");

    expect(params.get("amount")).toBeNull();
    expect(params.toString()).not.toContain("5000000");
  });

  it("carries the resource so the 402 can be re-fetched and verified", () => {
    const params = checkoutParams(sanitizeDetection(FORGED)!, "https://evil.example");

    expect(params.get("resource")).toBe("https://evil.example/paywalled");
  });

  it("carries the real page origin, which the browser sets and the page cannot forge", () => {
    const params = checkoutParams(sanitizeDetection(FORGED)!, "https://evil.example");

    expect(params.get("origin")).toBe("https://evil.example");
  });

  it("omits origin rather than inventing one when it could not be determined", () => {
    const params = checkoutParams(sanitizeDetection(FORGED)!, null);

    expect(params.has("origin")).toBe(false);
  });
});

describe("httpsResourceOrNull", () => {
  it("accepts HTTPS only", () => {
    expect(httpsResourceOrNull("https://api.example/thing")).toBe("https://api.example/thing");
    expect(httpsResourceOrNull("http://api.example/thing")).toBeNull();
  });

  it("rejects schemes that would execute or embed rather than fetch", () => {
    expect(httpsResourceOrNull("javascript:alert(1)")).toBeNull();
    expect(httpsResourceOrNull("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(httpsResourceOrNull("file:///etc/passwd")).toBeNull();
  });

  it("rejects non-strings, empties and anything unparseable", () => {
    expect(httpsResourceOrNull(undefined)).toBeNull();
    expect(httpsResourceOrNull(42)).toBeNull();
    expect(httpsResourceOrNull({ toString: () => "https://x.example" })).toBeNull();
    expect(httpsResourceOrNull("")).toBeNull();
    expect(httpsResourceOrNull("not a url")).toBeNull();
  });

  it("bounds the length so a page cannot push an unbounded string into a tab URL", () => {
    expect(httpsResourceOrNull(`https://x.example/${"a".repeat(4000)}`)).toBeNull();
  });
});

describe("sanitizeDetection", () => {
  it("keeps a genuine server 402 intact, so the overlay still appears", () => {
    const genuine = sanitizeDetection({
      url: "https://api.example/premium",
      method: "POST",
      requirements: [{ maxAmountRequired: "10000", payTo: "0xMERCHANT", network: "base" }],
      detectedAt: "2026-07-08T00:00:00.000Z",
    });

    expect(genuine).not.toBeNull();
    expect(genuine!.url).toBe("https://api.example/premium");
    expect(genuine!.method).toBe("POST");
    expect(genuine!.requirements).toHaveLength(1);
  });

  it("rejects a detection whose URL is not a fetchable web resource", () => {
    expect(sanitizeDetection({ ...FORGED, url: "javascript:alert(1)" })).toBeNull();
    expect(sanitizeDetection({ ...FORGED, url: 123 })).toBeNull();
    expect(sanitizeDetection(null)).toBeNull();
    expect(sanitizeDetection("https://evil.example")).toBeNull();
  });

  it("caps requirements — a real server does not advertise hundreds of prices", () => {
    const flood = sanitizeDetection({ ...FORGED, requirements: Array(500).fill({ payTo: "0x1" }) });

    expect(flood!.requirements).toHaveLength(8);
  });

  it("keeps only bounded, display-safe requirement fields from the page", () => {
    const detection = sanitizeDetection({
      ...FORGED,
      requirements: [{ maxAmountRequired: "9".repeat(500), nested: { unbounded: true }, description: "x".repeat(500) }],
    });

    expect(detection!.requirements).toEqual([{}]);
  });

  it("allows only known request methods and bounds detectedAt", () => {
    const long = sanitizeDetection({
      ...FORGED,
      method: "M".repeat(500),
      detectedAt: "D".repeat(500),
    });

    expect(long!.method).toBe("GET");
    expect(long!.detectedAt).toHaveLength(64);
  });

  it("defaults missing fields instead of propagating undefined into the sheet", () => {
    const bare = sanitizeDetection({ url: "https://api.example/x" });

    expect(bare!.method).toBe("GET");
    expect(bare!.requirements).toEqual([]);
    expect(bare!.detectedAt).toBeTruthy();
  });
});
