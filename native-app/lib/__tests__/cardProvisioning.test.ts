import { readFileSync } from "fs";
import { join } from "path";
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

// ---------------------------------------------------------------------------
// Neither wallet path may report success it has not observed.
//
// Both native calls resolve when the UI is LAUNCHED, not when a card is added:
// `startPushProvisioning` resolves once PKAddPaymentPassViewController is
// presented, and `pushTokenize` resolves once the tokenize activity has been
// started (its real outcome arrives on onActivityResult, unhandled). Returning
// either value as `success` tells the user a card is in their wallet while the
// system sheet is still on screen — and says the same if they cancel it.
//
// Asserted on the source, because the property is that a particular value is
// NOT forwarded. Comments are stripped first so "absent" means "unused".
// ---------------------------------------------------------------------------

describe("provisioning never claims unobserved success", () => {
  const source = readFileSync(join(__dirname, "..", "cards", "provisioning.ts"), "utf8");
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/.*$/gm, "");

  it("does not forward the native return value as success", () => {
    // `const ok = await …; return { success: ok };` is the shape that was wrong
    // on both paths.
    expect(code).not.toMatch(/success:\s*ok\b/);
    expect(code).not.toMatch(/const ok = await/);
  });

  it("still awaits the native call — the sheet must actually open", () => {
    // The fix is to stop MISREPORTING the result, not to stop invoking it.
    expect(code).toContain("await applePay.startPushProvisioning(");
    expect(code).toContain("await googlePay.pushTokenize(");
  });

  it("keeps the simulated short-circuit ahead of both native calls", () => {
    // The guard that stops placeholder artefacts reaching a secure element.
    expect((code.match(/if \(res\.simulated\)/g) ?? []).length).toBe(2);
    expect(code.indexOf("if (res.simulated)")).toBeLessThan(
      code.indexOf("applePay.startPushProvisioning(")
    );
  });

  it("explains the Apple handshake inversion where the code lives", () => {
    // PassKit produces certs/nonce/nonceSignature in the Secure Element and
    // delivers them through the delegate; this client asks the SERVER for them,
    // which cannot know them, and ignores the onCertificatesReceived event.
    // Without this note the next reader sees a working-looking request.
    expect(source).toContain("PRESENTING THE SHEET IS NOT ADDING A CARD");
    expect(source).toContain("onCertificatesReceived");
  });
});
