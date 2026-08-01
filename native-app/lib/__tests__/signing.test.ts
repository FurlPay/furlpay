import {
  defaultSigner,
  getSigner,
  listSigners,
  registerSigner,
  resetSigners,
  unregisterSigner,
} from "../signing/registry";
import {
  requireOwnConfirmation,
  supportsChain,
  type AccountSigner,
  type SignerCapabilities,
} from "../signing/types";

// ---------------------------------------------------------------------------
// The abstraction that lets a Ledger, a Tangem or a Keystone drop in without
// the swap engine changing.
//
// These tests use a fake hardware signer on purpose. The real ones cannot be
// exercised without the physical device in hand, and a test that needs a Nano X
// plugged in is a test that never runs in CI — so what is pinned here is the
// CONTRACT every plugin must satisfy, and the behaviour the domain derives from
// it. A vendor plugin that passes these is wired correctly; whether its BLE
// bytes are right is a question only hardware can answer.
// ---------------------------------------------------------------------------

function fakeSigner(overrides: Partial<SignerCapabilities> = {}): AccountSigner & {
  signed: unknown[];
} {
  const signed: unknown[] = [];
  return {
    kind: "ledger",
    label: "Ledger Nano X",
    signed,
    capabilities: () => ({
      trustedDisplay: true,
      clearSigning: true,
      eip712: true,
      eip1559: true,
      prehashedOnly: false,
      presence: "button",
      supportedChainIds: [1, 42161, 8453],
      ...overrides,
    }),
    getAddress: async () => "0x2222222222222222222222222222222222222222",
    signTransaction: async (tx) => {
      signed.push(tx);
      return { raw: "0x02ff", hash: "0xledgerhash", from: "0x2222222222222222222222222222222222222222" };
    },
  };
}

afterEach(resetSigners);

describe("registry", () => {
  it("always has the on-device signer, with no plugin registered", () => {
    // A user with no hardware must still be able to sign, and the Jest suite
    // has no native runtime for a BLE module to load into.
    expect(defaultSigner().kind).toBe("device-key");
    expect(getSigner("device-key")).toBeDefined();
  });

  it("accepts a plugin and hands it back by kind", () => {
    registerSigner(fakeSigner());
    expect(getSigner("ledger")?.label).toBe("Ledger Nano X");
    expect(listSigners().map((s) => s.kind).sort()).toEqual(["device-key", "ledger"]);
  });

  it("refuses to unregister the on-device signer", () => {
    // Removing it would strand a user whose hardware is unpaired with no way to
    // sign anything — including the transaction that re-pairs it.
    expect(() => unregisterSigner("device-key")).toThrow();
    expect(getSigner("device-key")).toBeDefined();
  });

  it("does not silently promote hardware to the default", () => {
    registerSigner(fakeSigner());
    // The account picks the signer, never the reverse. Auto-routing would sign
    // from an address the user was not looking at.
    expect(defaultSigner().kind).toBe("device-key");
  });
});

describe("capabilities drive behaviour", () => {
  it("requires an app-side confirmation only when there is no trusted display", () => {
    // Ledger renders the transaction on hardware the phone cannot reach.
    expect(requireOwnConfirmation(fakeSigner({ trustedDisplay: true }))).toBe(false);

    // A Tangem card has no screen, and the on-device key IS the phone. In both
    // cases the app's confirmation is the only thing the user ever reads.
    expect(requireOwnConfirmation(fakeSigner({ trustedDisplay: false }))).toBe(true);
    expect(requireOwnConfirmation(defaultSigner())).toBe(true);
  });

  it("gates chains on firmware support, but not for a software key", () => {
    const ledger = fakeSigner();
    expect(supportsChain(ledger, 42161)).toBe(true);
    expect(supportsChain(ledger, 4663)).toBe(false); // Robinhood Chain

    // secp256k1 over a hash is valid on any EVM chain — no firmware has to know
    // about it.
    expect(supportsChain(defaultSigner(), 4663)).toBe(true);
  });

  it("records that a card signing a bare hash cannot inspect it", () => {
    // Tangem's model. Worth carrying explicitly so a caller can refuse it for
    // large amounts rather than discovering it at the counter.
    const tangem = fakeSigner({ prehashedOnly: true, trustedDisplay: false, presence: "tap" });
    expect(tangem.capabilities().prehashedOnly).toBe(true);
    expect(requireOwnConfirmation(tangem)).toBe(true);
  });
});

describe("the on-device signer is honest about itself", () => {
  it("does not claim a trusted display or clear signing", () => {
    const caps = defaultSigner().capabilities();
    // The phone draws the confirmation AND holds the key. Claiming otherwise
    // would be the app telling the user it is something it is not.
    expect(caps.trustedDisplay).toBe(false);
    expect(caps.clearSigning).toBe(false);
    expect(caps.presence).toBe("biometric");
    expect(caps.supportedChainIds).toBe("all");
  });
});
