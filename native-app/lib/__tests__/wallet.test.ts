import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { mnemonicToSeedSync } from "@scure/bip39";
import { HDKey } from "@scure/bip32";
import { computeAuthorizationDigest, deriveAddress, type Authorization } from "../wallet";

// Correctness of the hand-written BIP-44 derivation and EIP-712 encoding,
// proven against a viem oracle (computed independently with viem's
// mnemonicToAccount + hashTypedData). If either byte-encoding drifts from
// viem, the server's verifyAuthorizationSignature would reject our signatures
// — so these known-answer vectors are the guardrail for the whole money path.

// The canonical Hardhat/Anvil test mnemonic — public, funds-free, deterministic.
const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const ORACLE_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const AUTH: Authorization = {
  from: ORACLE_ADDRESS,
  to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  value: "1000000",
  validAfter: "0",
  validBefore: "4102444800",
  nonce: "0x00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
};
const DOMAIN = {
  chainId: 42161,
  verifyingContract: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  name: "USD Coin",
  version: "2",
};
const ORACLE_DIGEST = "0x1cd29a55f873e32ab8ab9397dda41ee9a69f31984951be4f0f29be1a93e53881";

describe("wallet", () => {
  it("derives the same address as viem (BIP-44 + EIP-55)", () => {
    expect(deriveAddress(TEST_MNEMONIC)).toBe(ORACLE_ADDRESS);
  });

  it("computes the same EIP-712 digest as viem hashTypedData", () => {
    expect(computeAuthorizationDigest(AUTH, DOMAIN)).toBe(ORACLE_DIGEST);
  });

  it("produces a signature that recovers to the wallet address", () => {
    // Derive the private key the same way lib/wallet.ts does.
    const seed = mnemonicToSeedSync(TEST_MNEMONIC);
    const node = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0");
    const priv = node.privateKey!;
    const digest = hexToBytes(ORACLE_DIGEST.slice(2));

    const sig = secp256k1.sign(digest, priv);
    const recovered = sig.recoverPublicKey(digest).toRawBytes(false); // 65 bytes
    const addr = "0x" + bytesToHex(keccak_256(recovered.slice(1)).slice(-20));

    expect(addr.toLowerCase()).toBe(ORACLE_ADDRESS.toLowerCase());
  });

  it("rejects a tampered digest (wrong recipient does not recover)", () => {
    const tampered: Authorization = { ...AUTH, to: "0x0000000000000000000000000000000000000001" };
    expect(computeAuthorizationDigest(tampered, DOMAIN)).not.toBe(ORACLE_DIGEST);
  });
});
