import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  PERSONA_TIMESTAMP_TOLERANCE_SECONDS,
  verifyPersonaSignature,
} from "@/lib/kyc/persona";

// ---------------------------------------------------------------------------
// Persona webhook signature — replay window.
//
// Persona's header is `t=<unix>,v1=<hex>` with the signature taken over
// `${t}.${rawBody}`, and rotation sends several SPACE-separated pairs
// (docs.withpersona.com/quickstart-webhooks). Persona documents NO tolerance, so
// a validly signed delivery stayed replayable forever; the window is ours.
//
// The asymmetry these tests pin is deliberate. The window applies only to the
// `${t}.${body}` form, where `t` is INSIDE the HMAC and therefore authenticated.
// In the bare-body form `t` is not covered by the signature, so an attacker could
// rewrite it at will — enforcing a window there would be theatre, and would risk
// rejecting legitimate deliveries. Those rely on the route's idempotency guard.
// ---------------------------------------------------------------------------

const SECRET = "persona_test_secret_value";
const BODY = JSON.stringify({ data: { attributes: { name: "inquiry.completed" } } });

const hmac = (payload: string) =>
  crypto.createHmac("sha256", SECRET).update(payload).digest("hex");

/** The documented form: timestamp bound into the signature. */
const signedWithTimestamp = (t: number) => `t=${t},v1=${hmac(`${t}.${BODY}`)}`;

/** The compatibility form: HMAC over the bare body, `t` unauthenticated. */
const signedBareBody = (t?: number) =>
  t === undefined ? hmac(BODY) : `t=${t},v1=${hmac(BODY)}`;

const NOW_S = 1_800_000_000;
const NOW_MS = NOW_S * 1000;

describe("the tolerance constant", () => {
  it("is 5 minutes, matching the industry norm", () => {
    expect(PERSONA_TIMESTAMP_TOLERANCE_SECONDS).toBe(300);
  });
});

describe("timestamp-bound signatures are windowed", () => {
  it("accepts a fresh delivery", () => {
    expect(verifyPersonaSignature(BODY, signedWithTimestamp(NOW_S), SECRET, NOW_MS)).toBe(true);
  });

  it("accepts one at the edge of the window, so the bound is not off by one", () => {
    const t = NOW_S - PERSONA_TIMESTAMP_TOLERANCE_SECONDS;
    expect(verifyPersonaSignature(BODY, signedWithTimestamp(t), SECRET, NOW_MS)).toBe(true);
  });

  it("REFUSES a replay just outside the window", () => {
    // The finding: this signature is cryptographically valid and, before the
    // window existed, was accepted indefinitely.
    const t = NOW_S - PERSONA_TIMESTAMP_TOLERANCE_SECONDS - 1;
    expect(verifyPersonaSignature(BODY, signedWithTimestamp(t), SECRET, NOW_MS)).toBe(false);
  });

  it("REFUSES a captured delivery replayed a day later", () => {
    const t = NOW_S - 86_400;
    expect(verifyPersonaSignature(BODY, signedWithTimestamp(t), SECRET, NOW_MS)).toBe(false);
  });

  it("REFUSES a timestamp from the FUTURE beyond tolerance", () => {
    // Clock skew cuts both ways; a far-future `t` would otherwise buy an
    // attacker an arbitrarily long replay window.
    const t = NOW_S + PERSONA_TIMESTAMP_TOLERANCE_SECONDS + 60;
    expect(verifyPersonaSignature(BODY, signedWithTimestamp(t), SECRET, NOW_MS)).toBe(false);
  });

  it("does not let an attacker slide `t` forward to refresh a stale signature", () => {
    // `t` is inside the HMAC, so moving it invalidates the signature. This is
    // the property that makes the window meaningful rather than cosmetic.
    const stale = NOW_S - 86_400;
    const sig = hmac(`${stale}.${BODY}`);
    const forged = `t=${NOW_S},v1=${sig}`; // fresh timestamp, old signature
    expect(verifyPersonaSignature(BODY, forged, SECRET, NOW_MS)).toBe(false);
  });
});

describe("bare-body signatures are deliberately NOT windowed", () => {
  it("accepts a bare-hex header regardless of age", () => {
    // No `t` at all. Nothing to check, and the route's idempotency guard is what
    // protects this path.
    expect(verifyPersonaSignature(BODY, signedBareBody(), SECRET, NOW_MS)).toBe(true);
  });

  it("accepts a bare-body signature even with an old unauthenticated `t`", () => {
    // `t` is present but NOT covered by this signature, so it carries no
    // authority and must not be used to reject. Enforcing it here would let a
    // hostile `t` value cause a denial of legitimate deliveries.
    expect(verifyPersonaSignature(BODY, signedBareBody(NOW_S - 86_400), SECRET, NOW_MS)).toBe(true);
  });
});

describe("the existing guarantees still hold", () => {
  it("fails closed with no secret", () => {
    expect(verifyPersonaSignature(BODY, signedWithTimestamp(NOW_S), "", NOW_MS)).toBe(false);
  });

  it("fails closed with no header", () => {
    expect(verifyPersonaSignature(BODY, null, SECRET, NOW_MS)).toBe(false);
  });

  it("rejects a tampered body", () => {
    const header = signedWithTimestamp(NOW_S);
    expect(verifyPersonaSignature(BODY + " ", header, SECRET, NOW_MS)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    const other = crypto.createHmac("sha256", "wrong").update(`${NOW_S}.${BODY}`).digest("hex");
    expect(verifyPersonaSignature(BODY, `t=${NOW_S},v1=${other}`, SECRET, NOW_MS)).toBe(false);
  });

  it("still accepts ANY pair during secret rotation", () => {
    // Rotation sends space-separated pairs. Code that reads only the first
    // rejects valid deliveries signed with the other secret.
    const bogus = `t=${NOW_S},v1=${"0".repeat(64)}`;
    const good = signedWithTimestamp(NOW_S);
    expect(verifyPersonaSignature(BODY, `${bogus} ${good}`, SECRET, NOW_MS)).toBe(true);
    expect(verifyPersonaSignature(BODY, `${good} ${bogus}`, SECRET, NOW_MS)).toBe(true);
  });

  it("refuses an unparseable timestamp rather than treating it as fresh", () => {
    const sig = hmac(`NaN.${BODY}`);
    expect(verifyPersonaSignature(BODY, `t=NaN,v1=${sig}`, SECRET, NOW_MS)).toBe(false);
  });
});
