import React from "react";
import TestRenderer, {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { SigningSheet, type SigningRequest } from "@/components/signing/SigningSheet";
import { SignerPicker } from "@/components/signing/SignerPicker";
import type { AccountSigner, SignerCapabilities } from "@/lib/signing/types";
import { registerSigner, resetSigners } from "@/lib/signing/registry";

// ---------------------------------------------------------------------------
// The signing UI, checked for the things that would mislead a user about who
// verified what.
//
// A hardware wallet's whole value is that its screen — not the phone's — is
// authoritative. If the app tells someone "verified on device" when it is the
// phone drawing the text, the hardware has been reduced to a slow biometric.
// So the copy is derived from capabilities and asserted here.
// ---------------------------------------------------------------------------

function signer(
  kind: AccountSigner["kind"],
  label: string,
  caps: Partial<SignerCapabilities> = {}
): AccountSigner {
  return {
    kind,
    label,
    capabilities: () => ({
      trustedDisplay: false,
      clearSigning: false,
      eip712: true,
      eip1559: true,
      prehashedOnly: false,
      presence: "biometric",
      supportedChainIds: "all",
      ...caps,
    }),
    getAddress: async () => "0x" + "1".repeat(40),
    signTransaction: async () => ({ raw: "0x02", hash: "0xabc", from: "0x" + "1".repeat(40) }),
  };
}

const request: SigningRequest = {
  summary: "Swap 100 USDC for DAI",
  network: "Arbitrum One",
  details: [
    { label: "You send", value: "100 USDC" },
    { label: "You receive", value: "~99.4 DAI" },
    { label: "Network fee", value: "$0.04" },
  ],
};

/** Same shape as the helper in accountDrawer.test.tsx — the local type shim
 *  exposes `findAll`, not a children walk. */
function textOf(tree: ReactTestRenderer): string {
  const out: string[] = [];
  tree.root.findAll(() => true).forEach((n: ReactTestInstance) => {
    const c = n.props?.children;
    if (typeof c === "string") out.push(c);
    else if (
      Array.isArray(c) &&
      c.every((x: unknown) => typeof x === "string" || typeof x === "number")
    ) {
      out.push(c.join(""));
    }
  });
  return out.join(" ");
}

function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(element);
  });
  return tree;
}

afterEach(resetSigners);

describe("SigningSheet — who verified what", () => {
  it("points at the hardware screen when the signer has a trusted display", () => {
    const ledger = signer("ledger", "Ledger Nano X", { trustedDisplay: true, presence: "button" });
    const tree = render(
      <SigningSheet
        open
        signer={ledger}
        request={request}
        phase="confirming"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    const text = textOf(tree);
    // The device's screen is authoritative; ours is a courtesy.
    expect(text).toMatch(/its screen is the one that counts/i);
    // And the action defers to the device rather than claiming to sign here.
    expect(text).toMatch(/Continue on Ledger Nano X/);
  });

  it("says the phone is the only screen when there is no trusted display", () => {
    const tree = render(
      <SigningSheet
        open
        signer={signer("device-key", "This phone")}
        request={request}
        phase="confirming"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    const text = textOf(tree);
    expect(text).toMatch(/shown on this phone/i);
    expect(text).toMatch(/Confirm and sign/);
    // Must never imply a device verified anything.
    expect(text).not.toMatch(/its screen is the one that counts/i);
  });

  it("warns explicitly when the signer cannot see what it signs", () => {
    // Tangem's model: the card signs a bare hash. Saying so is the difference
    // between informed consent and a shrug.
    const tangem = signer("tangem", "Tangem card", { prehashedOnly: true, presence: "tap" });
    const tree = render(
      <SigningSheet
        open
        signer={tangem}
        request={request}
        phase="confirming"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(textOf(tree)).toMatch(/signs without showing you the transaction/i);
  });

  it("always shows the network — a right transaction on a wrong chain is wrong", () => {
    const tree = render(
      <SigningSheet
        open
        signer={signer("device-key", "This phone")}
        request={request}
        phase="confirming"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(textOf(tree)).toContain("Arbitrum One");
  });

  it("renders every detail row it was given", () => {
    const tree = render(
      <SigningSheet
        open
        signer={signer("device-key", "This phone")}
        request={request}
        phase="confirming"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const text = textOf(tree);
    for (const d of request.details) {
      expect(text).toContain(d.value);
    }
  });

  it("reports a failure rather than closing silently", () => {
    const tree = render(
      <SigningSheet
        open
        signer={signer("device-key", "This phone")}
        request={request}
        phase="failed"
        error="The swap was mined but reverted on-chain."
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(textOf(tree)).toMatch(/reverted on-chain/);
  });

  it("renders nothing without a signer or a request", () => {
    // Half a confirmation sheet is worse than none.
    const noSigner = render(
      <SigningSheet
        open
        signer={null}
        request={request}
        phase="idle"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(noSigner.toJSON()).toBeNull();
  });
});

describe("SignerPicker — offers only what exists", () => {
  it("lists the registry, not a menu of vendors", () => {
    // The tempting version hardcodes Ledger/Trezor/Tangem so the screen looks
    // finished. Every row would be a dead end with no plugin registered.
    const tree = render(<SignerPicker selected={null} onSelect={() => {}} />);
    const text = textOf(tree);

    expect(text).toContain("This phone");
    for (const absent of ["Ledger", "Trezor", "Tangem", "Keystone"]) {
      expect(text).not.toContain(absent);
    }
  });

  it("shows a registered plugin the moment it exists", () => {
    registerSigner(signer("ledger", "Ledger Nano X", { trustedDisplay: true, presence: "button" }));
    const tree = render(<SignerPicker selected={null} onSelect={() => {}} />);
    const text = textOf(tree);

    expect(text).toContain("Ledger Nano X");
    // The reason to prefer it is stated, not left for the user to know.
    expect(text).toMatch(/Verifies on device/);
    expect(text).toMatch(/Confirm on device/);
  });

  it("describes what the user will do, not the transport", () => {
    registerSigner(signer("tangem", "Tangem card", { presence: "tap" }));
    const text = textOf(render(<SignerPicker selected={null} onSelect={() => {}} />));

    expect(text).toMatch(/Tap your card/);
    // "BLE" and "NFC" are trivia; the physical action is the useful part.
    expect(text).not.toMatch(/\bNFC\b|\bBLE\b/);
  });

  it("does not claim a trusted display for the phone", () => {
    const text = textOf(render(<SignerPicker selected={null} onSelect={() => {}} />));
    expect(text).not.toMatch(/Verifies on device/);
  });
});
