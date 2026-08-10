import { signTransferAuthorization, UntrustedQuoteError, type Authorization } from "../wallet";

// Security regression tests for the trust boundary between a SERVER-SUPPLIED
// quote and the device key.
//
// The threat: /transfers/gasless returns the network and the token contract, and
// those two values ARE the EIP-712 domain — they decide which token, on which
// chain, the user's biometric ends up authorising. A compromised or spoofed
// backend that can name the contract can make the device produce a valid
// EIP-3009 authorization against a contract the user never intended, while the
// UI still says "send USDC". The device must therefore pin the contract itself
// and treat the quote as untrusted input.
//
// The canonical Hardhat mnemonic — public, funds-free, deterministic.
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => "test test test test test test test test test test test junk"),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "whenUnlockedThisDeviceOnly",
}));

const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // the test mnemonic's address
const ARBITRUM_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

const AUTH: Authorization = {
  from: OWNER,
  to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  value: "1000000",
  validAfter: "0",
  validBefore: "4102444800",
  nonce: "0x00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
};

describe("signTransferAuthorization — contract/chain binding", () => {
  it("signs when the quote names the pinned USDC contract", async () => {
    const sig = await signTransferAuthorization(AUTH, {
      network: "arbitrum",
      verifyingContract: ARBITRUM_USDC,
    });
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("accepts the pinned contract regardless of case (EIP-55 vs lowercase)", async () => {
    const sig = await signTransferAuthorization(AUTH, {
      network: "arbitrum",
      verifyingContract: ARBITRUM_USDC.toLowerCase(),
    });
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });

  // The core attack: a hostile quote substitutes a different token contract.
  it("REFUSES to sign for a contract the device did not pin", async () => {
    await expect(
      signTransferAuthorization(AUTH, {
        network: "arbitrum",
        verifyingContract: "0x1111111111111111111111111111111111111111",
      })
    ).rejects.toThrow(UntrustedQuoteError);
  });

  // Chain substitution: the right token address on the wrong chain is still a
  // different asset, and the domain separator would bind to that chain.
  it("REFUSES the arbitrum contract when the quote claims a different network", async () => {
    await expect(
      signTransferAuthorization(AUTH, {
        network: "base",
        verifyingContract: ARBITRUM_USDC,
      })
    ).rejects.toThrow(UntrustedQuoteError);
  });

  // Fail closed: an unpinned network cannot be signed for at all, even though
  // CHAIN_IDS knows its chainId.
  it("REFUSES a network with no pinned contract (fails closed)", async () => {
    await expect(
      signTransferAuthorization(AUTH, {
        network: "base-sepolia",
        verifyingContract: ARBITRUM_USDC,
      })
    ).rejects.toThrow(UntrustedQuoteError);
  });

  it("still refuses to sign an authorization from another address", async () => {
    await expect(
      signTransferAuthorization(
        { ...AUTH, from: "0x0000000000000000000000000000000000000002" },
        { network: "arbitrum", verifyingContract: ARBITRUM_USDC }
      )
    ).rejects.toThrow(/does not match this wallet/i);
  });
});
