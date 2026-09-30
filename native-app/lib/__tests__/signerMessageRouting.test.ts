// ---------------------------------------------------------------------------
// Message and typed-data signing go through the signer abstraction.
//
// WalletConnect used to import signMessage/signTypedData from lib/wallet
// directly, so only the on-device key could ever answer a dApp's personal_sign
// or eth_signTypedData — a hardware signer would have needed the flow
// rewritten. It now calls signMessageWith/signTypedDataWith(defaultSigner()).
//
// Two properties pinned here:
//   1. NO SEMANTIC CHANGE: the device-key signer produces byte-identical
//      signatures to the lib/wallet functions it replaced.
//   2. FAIL CLOSED: a signer lacking the method (or EIP-712 support) refuses;
//      nothing falls back to a different key.
// ---------------------------------------------------------------------------

const TEST_MNEMONIC = "test test test test test test test test test test test junk";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) =>
    key === "furlpay.wallet.exists" ? "1" : "test test test test test test test test test test test junk"
  ),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "whenUnlockedThisDeviceOnly",
}));

import { signMessage, signTypedData } from "../wallet";
import { deviceKeySigner } from "../signing/deviceKeySigner";
import { defaultSigner } from "../signing/registry";
import {
  SignerUnavailable,
  signMessageWith,
  signTypedDataWith,
  type AccountSigner,
  type TypedDataPayload,
} from "../signing/types";

const PAYLOAD: TypedDataPayload = {
  domain: { name: "Test", version: "1", chainId: 42161, verifyingContract: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
  types: { Mail: [{ name: "contents", type: "string" }] },
  primaryType: "Mail",
  message: { contents: "hello" },
};

describe("device-key signer is a drop-in for the direct calls", () => {
  it("is the default signer", () => {
    expect(defaultSigner()).toBe(deviceKeySigner);
    expect(TEST_MNEMONIC.split(" ")).toHaveLength(12);
  });

  it("personal_sign output is byte-identical", async () => {
    const direct = await signMessage("Sign in to example.com");
    const viaSigner = await signMessageWith(defaultSigner(), "Sign in to example.com");
    expect(viaSigner).toBe(direct);
    expect(viaSigner).toMatch(/^0x[0-9a-f]{130}$/i);
  });

  it("typed-data output is byte-identical", async () => {
    const direct = await signTypedData(PAYLOAD);
    const viaSigner = await signTypedDataWith(defaultSigner(), PAYLOAD);
    expect(viaSigner).toBe(direct);
  });
});

describe("a signer that cannot, refuses", () => {
  function hardware(eip712: boolean, withMethods: boolean): AccountSigner {
    return {
      kind: "tangem",
      label: "Tangem card",
      capabilities: () => ({
        trustedDisplay: false,
        clearSigning: false,
        eip712,
        eip1559: true,
        prehashedOnly: true,
        presence: "tap",
        supportedChainIds: "all",
      }),
      getAddress: async () => "0x0000000000000000000000000000000000000001",
      signTransaction: async () => {
        throw new Error("not under test");
      },
      ...(withMethods
        ? { signMessage: async () => "0xsig", signTypedData: async () => "0xsig" }
        : {}),
    };
  }

  it("no signMessage method -> SignerUnavailable, never the device key", async () => {
    await expect(signMessageWith(hardware(true, false), "x")).rejects.toBeInstanceOf(SignerUnavailable);
  });

  it("no EIP-712 capability -> refuses even if the method exists", async () => {
    await expect(signTypedDataWith(hardware(false, true), PAYLOAD)).rejects.toBeInstanceOf(SignerUnavailable);
  });
});
