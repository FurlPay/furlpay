import { describe, it, expect } from "vitest";
import {
  ALWAYS_RETAINED_INTERNALLY,
  availablePrivacyModes,
  hidesTransaction,
  PAYMENT_PRIVACY_MODES,
  PRIVACY_MODES,
  resolvePrivacyMode,
  UnavailablePrivacyMode,
} from "../privacy";

// ---------------------------------------------------------------------------
// Payment privacy modes.
//
// This module ships NO privacy capability. It exists to stop FurlPay claiming
// one it does not have, so the tests are almost entirely about refusal:
//
//   1. An unavailable mode THROWS. It must never fall back to `direct` — a
//      silent fallback settles a payment publicly while the caller believes it
//      was shielded, which is a disclosure decision made on a false premise.
//   2. `direct` — the only real mode — claims none of the six privacy
//      properties. Including wallet isolation, which x402's facilitator is
//      routinely mistaken for.
//   3. Internal records survive every mode. On-chain privacy hides data from
//      the public, never from FurlPay's own audit trail.
//
// The availability list is a RATCHET. Flipping a mode to available fails this
// suite until someone updates it, which forces the conversation about whether
// the capability genuinely exists.
// ---------------------------------------------------------------------------

describe("availability is a closed set", () => {
  it("offers exactly one mode today: direct", () => {
    // If this fails, a mode was marked available. Verify the infrastructure
    // actually exists before relaxing it — see each spec's blockedBy.
    expect(availablePrivacyModes()).toEqual(["direct"]);
  });

  it("declares every unavailable mode with a concrete reason", () => {
    for (const mode of PAYMENT_PRIVACY_MODES) {
      const spec = PRIVACY_MODES[mode];
      if (spec.available) {
        expect(spec.blockedBy, mode).toEqual([]);
      } else {
        // "Not implemented" is not a reason. Each entry names a missing
        // primitive a reader can go and check.
        expect(spec.blockedBy.length, mode).toBeGreaterThan(0);
        expect(spec.blockedBy.join(" ").length, mode).toBeGreaterThan(40);
      }
    }
  });

  it("keeps the mode list and the spec table in step", () => {
    expect(Object.keys(PRIVACY_MODES).sort()).toEqual([...PAYMENT_PRIVACY_MODES].sort());
  });
});

describe("unavailable modes fail closed", () => {
  it("throws rather than silently settling in the clear", () => {
    // The failure this whole module exists to prevent.
    for (const mode of ["isolated_wallet", "deposit_address", "private_pool"]) {
      expect(() => resolvePrivacyMode(mode), mode).toThrow(UnavailablePrivacyMode);
    }
  });

  it("never returns direct for an unavailable mode", () => {
    let fellBack = false;
    try {
      const spec = resolvePrivacyMode("private_pool");
      fellBack = spec.mode === "direct";
    } catch {
      /* expected */
    }
    expect(fellBack).toBe(false);
  });

  it("names what is missing in the error", () => {
    try {
      resolvePrivacyMode("private_pool");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UnavailablePrivacyMode);
      expect((e as UnavailablePrivacyMode).blockedBy.join(" ")).toMatch(/custody/i);
    }
  });

  it("rejects an unknown mode", () => {
    expect(() => resolvePrivacyMode("shielded")).toThrow(UnavailablePrivacyMode);
    expect(() => resolvePrivacyMode("../../etc")).toThrow(UnavailablePrivacyMode);
  });

  it("treats an absent mode as direct", () => {
    // Omitting privacy is not requesting privacy.
    expect(resolvePrivacyMode(undefined).mode).toBe("direct");
    expect(resolvePrivacyMode(null).mode).toBe("direct");
    expect(resolvePrivacyMode("").mode).toBe("direct");
  });

  it("accepts direct explicitly", () => {
    expect(resolvePrivacyMode("direct").mode).toBe("direct");
  });
});

describe("direct claims nothing", () => {
  it("provides none of the six properties", () => {
    const p = PRIVACY_MODES.direct.properties;
    expect(Object.values(p).every((v) => v === false)).toBe(true);
  });

  it("does not claim wallet isolation from the x402 facilitator", () => {
    // The facilitator SUBMITS the transaction and pays gas, but the ERC-20
    // Transfer event carries payer -> recipient because the payer signed an
    // EIP-3009 authorization naming themselves. Gas abstraction is not
    // isolation, and it is certainly not privacy.
    expect(PRIVACY_MODES.direct.properties.walletIsolation).toBe(false);
    expect(PRIVACY_MODES.direct.observable).toMatch(/facilitator is a gas payer, not a sender/i);
  });

  it("hides no transaction", () => {
    expect(hidesTransaction("direct")).toBe(false);
  });
});

describe("the six properties stay distinct", () => {
  it("does not let isolation imply transaction privacy", () => {
    // The most common conflation: a different sending address is still a
    // fully public transfer.
    const p = PRIVACY_MODES.isolated_wallet.properties;
    expect(p.walletIsolation).toBe(true);
    expect(p.transactionPrivacy).toBe(false);
    expect(p.amountPrivacy).toBe(false);
    expect(p.unlinkability).toBe(false);
  });

  it("does not let address privacy imply unlinkability", () => {
    const p = PRIVACY_MODES.deposit_address.properties;
    expect(p.addressPrivacy).toBe(true);
    expect(p.unlinkability).toBe(false);
  });

  it("marks only the shielded pool as hiding the transaction", () => {
    const hiding = PAYMENT_PRIVACY_MODES.filter(hidesTransaction);
    expect(hiding).toEqual(["private_pool"]);
  });

  it("never claims identity privacy for any mode", () => {
    // FurlPay knows who its customer is under every mode, and must. A chain
    // privacy layer hides data from the public, not from the operator.
    for (const mode of PAYMENT_PRIVACY_MODES) {
      expect(PRIVACY_MODES[mode].properties.identityPrivacy, mode).toBe(false);
    }
  });
});

describe("internal records survive every mode", () => {
  it("retains identity, screening and the audit trail", () => {
    for (const field of ["customer identity (KYC)", "sanctions/screening result", "audit events"]) {
      expect(ALWAYS_RETAINED_INTERNALLY).toContain(field);
    }
  });

  it("retains the destination even when the chain link is hidden", () => {
    expect(ALWAYS_RETAINED_INTERNALLY).toContain("destination address");
  });
});
