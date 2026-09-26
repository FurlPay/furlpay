import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Realistic3DCard — no invented card details, and the right gate on the flip.
//
// THE DEFECT THESE PIN. The component shipped with `cvv = "842"` and
// `expiry = "08/29"` as DEFAULT PARAMETER VALUES. Any caller that rendered a card
// without passing credentials therefore displayed those two invented values as
// that card's real details, and a successful reveal showed them as fact. A user
// could copy them into a checkout and watch the payment fail, with nothing on
// screen suggesting the numbers were made up.
//
// app/cards/page.tsx already states the correct policy for this exact data:
// FurlPay never holds the PAN, the reveal endpoint answers 503 while no issuer is
// contracted, and that is rendered as "unavailable" because "an honest empty
// state beats a convincing fake number".
//
// Source-level assertions: the property is "no literal credential exists in this
// file", which only reading the file can establish.
// ---------------------------------------------------------------------------

const CARD = readFileSync(join(__dirname, "..", "Realistic3DCard.tsx"), "utf8");
const PAGE = readFileSync(join(__dirname, "..", "..", "app", "cards", "page.tsx"), "utf8");

/** Comments explain the removed defaults by name; strip them before matching. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("no fabricated card credentials", () => {
  it("has no default CVV, PAN or expiry", () => {
    const body = code(CARD);
    expect(body).not.toMatch(/cvv\s*=\s*["']/);
    expect(body).not.toMatch(/expiry\s*=\s*["']/);
    expect(body).not.toMatch(/fullPan\s*=\s*["']/);
  });

  it("contains no literal that could pass for a real card number or CVV", () => {
    const body = code(CARD);
    // The specific values that shipped, plus any bare 3-digit or 16-digit literal.
    expect(body).not.toContain('"842"');
    expect(body).not.toContain('"08/29"');
    expect(body).not.toMatch(/["']\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}["']/);
  });

  it("masks an unknown expiry rather than printing undefined", () => {
    expect(code(CARD)).toMatch(/expiry \?\? ["']••\/••["']/);
  });

  it("masks the CVV unless it is both revealed AND known", () => {
    // `isRevealed ? cvv : "•••"` renders the string "undefined" once the default
    // is gone — a successful step-up must not leave a blank where a number goes.
    expect(code(CARD)).toContain("isRevealed && cvv ? cvv");
  });

  it("falls back to last4 for the PAN, which is data we genuinely have", () => {
    expect(code(CARD)).toContain("card.last4");
  });
});

describe("the reveal gate is a step-up, not a payment", () => {
  it("does not drive the biometric-PAYMENT endpoints", () => {
    // Those mint a proof bound to H(amount|asset|recipient|chain|nonce) for ONE
    // payment. Using them here would fabricate a payment intent for something
    // that is not a payment, prompt the user about a transfer they are not
    // making, and put a card id in the recipient field.
    expect(code(CARD)).not.toContain("biometric-pay");
    expect(code(PAGE)).not.toContain("biometric-pay");
    expect(code(PAGE)).not.toContain("useFingerprintPay");
  });

  it("uses the passkey assertion, which the server records as a step-up", () => {
    expect(code(PAGE)).toContain("authenticateFingerprint()");
    expect(code(PAGE)).toContain("isFingerprintAvailable()");
  });

  it("fails closed on refusal, unsupported hardware, or a throw", () => {
    const fn = code(PAGE).slice(
      code(PAGE).indexOf("const requestCardStepUp"),
      code(PAGE).indexOf("const loadTxs")
    );
    // Unsupported -> false, thrown -> false. Neither may open the card.
    expect(fn).toMatch(/isFingerprintAvailable\(\)\)\) return false;/);
    expect(fn).toMatch(/catch \{\s*return false;/);
  });
});

describe("the carousel passes no credentials", () => {
  it("renders the card without cvv, fullPan or expiry props", () => {
    const usage = code(PAGE).match(/<Realistic3DCard[^/]*\/>/)?.[0] ?? "";
    expect(usage).toContain("card={c}");
    expect(usage).toContain("onRevealRequest=");
    expect(usage).not.toContain("cvv=");
    expect(usage).not.toContain("fullPan=");
    expect(usage).not.toContain("expiry=");
  });

  it("leaves the real reveal flow to the endpoint that owns it", () => {
    // ViewModal still calls the lifecycle reveal route, which mints a single-use
    // grant the client exchanges with the issuer's PCI vault.
    expect(PAGE).toContain("/api/cards/lifecycle/");
    expect(PAGE).toContain("reveal");
  });
});

describe("performance and accessibility claims hold", () => {
  it("animates only transform and opacity", () => {
    // Anything else would recalculate layout every pointer move.
    const body = code(CARD);
    expect(body).toContain("transform");
    expect(body).not.toMatch(/transition:\s*["'`][^"'`]*\b(width|height|top|left|margin)\b/);
  });

  it("keeps decorative overlays out of the hit path", () => {
    expect(code(CARD)).toContain("pointer-events-none");
  });

  it("is reachable by keyboard", () => {
    const body = code(CARD);
    expect(body).toContain('role="button"');
    expect(body).toContain("tabIndex");
    expect(body).toContain("aria-label");
  });

  it("uses no 3D runtime dependency", () => {
    const body = code(CARD);
    for (const dep of ["three", "@react-three", "babylon", "gsap"]) {
      expect(body).not.toContain(`from "${dep}`);
    }
  });
});
