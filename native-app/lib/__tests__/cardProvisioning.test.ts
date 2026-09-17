import { isPlatformBase64 } from "@/lib/cards/provisioning";

// ---------------------------------------------------------------------------
// A simulated payload must never reach the device secure element.
//
// The server labels its development fixtures `simulated: true` and says in its
// own comment that the label "is not decoration". Until this change nothing on
// the client read it: both provisioning paths took whatever the API returned
// and handed it to `applePay.startPushProvisioning` / `googlePay.pushTokenize`.
//
// That is not a harmless no-op. Per the platform specifications the payload is
// forwarded to a Token Service Provider — Visa Token Service or Mastercard
// Digital Enablement Service — so a fabricated OPC becomes a failed
// provisioning attempt against the real TSP, against the user's real Google
// account, attributable to our issuer BIN. Google also persists the OPC to
// re-provision the card onto that user's future devices.
//
// These tests pin the encoding guard. The `simulated` short-circuits are
// covered by the route-level tests in apps/web, which own the flag.
// ---------------------------------------------------------------------------

describe("isPlatformBase64", () => {
  it("accepts standard Base64, with and without padding", () => {
    // Both platforms specify Base64: Apple for encryptedPassData /
    // ephemeralPublicKey / activationData, Google for the OPC.
    expect(isPlatformBase64("Zm9vYmFy")).toBe(true);
    expect(isPlatformBase64("Zm9vYmE=")).toBe(true);
    expect(isPlatformBase64("Zm9v")).toBe(true);
  });

  it("accepts the full standard alphabet", () => {
    expect(isPlatformBase64("ab+/CD90")).toBe(true);
  });

  it("rejects the URL-safe alphabet", () => {
    // The single subtlest failure here. Google's OPC is specified as
    // NON-url-safe Base64; a url-safe payload looks valid and decodes to
    // different bytes at the token service.
    expect(isPlatformBase64("ab-_CD90")).toBe(false);
  });

  it("rejects empty and whitespace", () => {
    expect(isPlatformBase64("")).toBe(false);
    expect(isPlatformBase64("   ")).toBe(false);
    expect(isPlatformBase64("Zm9v YmFy")).toBe(false);
  });

  it("rejects non-strings, including a missing field", () => {
    // An API response that omitted opcBase64 entirely must not slip through.
    expect(isPlatformBase64(undefined)).toBe(false);
    expect(isPlatformBase64(null)).toBe(false);
    expect(isPlatformBase64(42)).toBe(false);
    expect(isPlatformBase64({})).toBe(false);
  });

  it("rejects a JSON body mistaken for a payload", () => {
    // A server that returned an error object where the OPC belongs should
    // fail the guard rather than be pushed to the secure element.
    expect(isPlatformBase64('{"error":"unavailable"}')).toBe(false);
  });

  it("rejects the simulated fixture the server emits", () => {
    // The dev route base64-encodes a marker string. It IS valid base64, so the
    // encoding guard alone would pass it — which is exactly why the
    // `simulated` flag is checked FIRST and separately in provisioning.ts.
    const fixture = Buffer.from("furlpay-simulated-opc:card_1:wallet_1").toString("base64");
    expect(isPlatformBase64(fixture)).toBe(true);
    // Documented here so nobody removes the flag check believing this guard
    // covers it. It does not.
  });
});
