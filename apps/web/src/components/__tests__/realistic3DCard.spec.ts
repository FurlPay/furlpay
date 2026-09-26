import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
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
    expect(code(CARD)).toMatch(/held\(expiry\) \?\? ["']••\/••["']/);
  });

  it("masks the CVV unless it is both revealed AND known", () => {
    // `isRevealed ? cvv : "•••"` renders the string "undefined" once the default
    // is gone — a successful step-up must not leave a blank where a number goes.
    expect(code(CARD)).toContain("isRevealed && held(cvv)");
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

describe("credential masking rejects every empty-ish value", () => {
  // `??` catches only null/undefined, so an API returning `{ cvv: "" }` would
  // have rendered a blank gap where a number belongs, and a template
  // interpolation upstream can produce the literal string "undefined".
  it("routes all three fields through one helper", () => {
    const body = code(CARD);
    expect(body).toContain("function held(");
    expect(body).toContain("held(cvv)");
    expect(body).toContain("held(fullPan)");
    expect(body).toContain("held(expiry)");
  });

  it("rejects empty, whitespace and stringified nullish values", () => {
    const helper = code(CARD).slice(code(CARD).indexOf("function held("));
    expect(helper).toContain("trim()");
    expect(helper).toContain('"undefined"');
    expect(helper).toContain('"null"');
  });

  it("never renders a raw credential without the helper", () => {
    const body = code(CARD);
    // A bare {cvv} / {expiry} / {fullPan} in JSX would bypass the masking.
    expect(body).not.toMatch(/\{\s*(cvv|expiry|fullPan)\s*\}/);
  });
});

describe("the card is operable by keyboard", () => {
  // role="button" + tabIndex={0} advertises a control to assistive tech. Without
  // a key handler a keyboard user could Tab to the card, press Enter, and have
  // nothing happen — focusable and inert, which is worse than not focusable.
  const body = code(CARD);

  it("handles Enter and Space", () => {
    expect(body).toContain("onKeyDown");
    expect(body).toMatch(/e\.key === "Enter" \|\| e\.key === " "/);
  });

  it("prevents Space from scrolling the page", () => {
    expect(body).toContain("e.preventDefault()");
  });

  it("announces state rather than naming an input device", () => {
    // "Click to flip" is wrong for exactly the users the label exists for.
    expect(body).not.toContain("Click to flip");
    expect(body).toContain("activate to turn over");
    // Frozen and face must be announced; neither was.
    expect(body).toContain('card.frozen ? "frozen"');
    expect(body).toContain('isFlipped ? "showing back"');
  });

  it("exposes pressed and busy state", () => {
    expect(body).toContain("aria-pressed={isFlipped}");
    expect(body).toContain("aria-busy={isAuthorizing}");
  });
});

describe("reduced motion removes movement, not meaning", () => {
  const body = code(CARD);

  it("consults the media query", () => {
    expect(body).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
  });

  it("watches for changes and cleans up the listener", () => {
    expect(body).toContain('mq.addEventListener("change"');
    expect(body).toContain('mq.removeEventListener("change"');
  });

  it("guards against a missing matchMedia", () => {
    // Absent during SSR and in jsdom without a shim; a throw would take down the
    // whole card rather than just the motion.
    expect(body).toMatch(/typeof window\.matchMedia !== "function"/);
  });

  it("suppresses tilt and glare, which carry no information", () => {
    const move = body.slice(body.indexOf("handlePointerMove"), body.indexOf("handlePointerLeave"));
    expect(move).toContain("if (reduceMotion) return;");
    // And the callback must depend on the flag, or it captures a stale value.
    expect(body).toContain("}, [reduceMotion]);");
  });

  it("KEEPS the flip, because the face change is the only way to see the back", () => {
    expect(body).toMatch(/reduceMotion\s*\?\s*"transform 0\.01s linear"/);
    // Not gated away entirely.
    const flip = body.slice(body.indexOf("const toggleFlip"), body.indexOf("<div"));
    expect(flip).not.toContain("if (reduceMotion) return");
  });

  it("KEEPS the haptics", () => {
    // Same invariant as the native WobbleView: reduced motion is about movement,
    // not about withholding feedback.
    const flip = body.slice(body.indexOf("const toggleFlip"), body.indexOf("<div"));
    expect(flip).toContain('triggerHaptic("error")');
    expect(flip).toContain('triggerHaptic("medium")');
  });
});

describe("the reveal fails closed", () => {
  const body = code(CARD);

  it("does not flip when authorization is refused", () => {
    const flip = body.slice(body.indexOf("const toggleFlip"), body.indexOf("<div"));
    // The early return must come BEFORE setIsFlipped, or a refusal still opens it.
    const refuseAt = flip.indexOf("if (!authorized)");
    const flipAt = flip.indexOf("setIsFlipped");
    expect(refuseAt).toBeGreaterThan(-1);
    expect(flipAt).toBeGreaterThan(refuseAt);
    expect(flip).toMatch(/if \(!authorized\) \{[\s\S]{0,120}return;/);
  });

  it("buzzes error on refusal", () => {
    const flip = body.slice(body.indexOf("const toggleFlip"), body.indexOf("<div"));
    expect(flip).toMatch(/if \(!authorized\) \{[\s\S]{0,80}triggerHaptic\("error"\)/);
  });

  it("only asks once — a revealed card does not re-prompt", () => {
    const flip = body.slice(body.indexOf("const toggleFlip"), body.indexOf("<div"));
    expect(flip).toContain("!isRevealed");
  });

  it("clears the authorizing flag even when refused", () => {
    // Otherwise a refusal leaves the card stuck in a busy state forever.
    const flip = body.slice(body.indexOf("const toggleFlip"), body.indexOf("<div"));
    const clearAt = flip.indexOf("setIsAuthorizing(false)");
    const refuseAt = flip.indexOf("if (!authorized)");
    expect(clearAt).toBeGreaterThan(-1);
    expect(clearAt).toBeLessThan(refuseAt);
  });
});

describe("VisaCard was consolidated away", () => {
  it("no longer exists", () => {
    // Two card visuals in one product drift. Realistic3DCard reached parity on
    // every feature VisaCard had — frozen overlay, gradient, settlement
    // currency, kind, label, network logo — and VisaCard had zero callers.
    const path = join(__dirname, "..", "VisaCard.tsx");
    expect(existsSync(path)).toBe(false);
  });

  it("nothing imports it", () => {
    expect(code(PAGE)).not.toContain("VisaCard");
  });

  it("the replacement keeps every feature it had", () => {
    const body = code(CARD);
    expect(body).toContain("card.frozen");
    expect(body).toContain("settlementCurrency");
    expect(body).toContain("CardNetworkLogo");
    expect(body).toContain("card.last4");
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
