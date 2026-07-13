import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { mnemonicToSeedSync } from "@scure/bip39";
import { HDKey } from "@scure/bip32";
import { concatBytes, utf8ToBytes } from "@noble/hashes/utils";
import { computeAuthorizationDigest, deriveAddress, signMessage, type Authorization } from "../wallet";

// Feed signMessage a known key so we can test its real output (it reads the
// mnemonic from SecureStore). The canonical Hardhat test mnemonic.
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => "test test test test test test test test test test test junk"),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "whenUnlockedThisDeviceOnly",
}));

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

describe("signMessage (EIP-191 proof-of-control)", () => {
  // Recover an EIP-191 personal_sign signature the same way viem /
  // recoverMessageAddress and the wallet-link verify route do.
  function recoverEip191(message: string, sig: string): string {
    const msg = utf8ToBytes(message);
    const prefix = utf8ToBytes(`\x19Ethereum Signed Message:\n${msg.length}`);
    const digest = keccak_256(concatBytes(prefix, msg));
    const r = BigInt("0x" + sig.slice(2, 66));
    const s = BigInt("0x" + sig.slice(66, 130));
    const v = parseInt(sig.slice(130, 132), 16);
    const signature = new (secp256k1.Signature as any)(r, s).addRecoveryBit(v - 27);
    const pub = signature.recoverPublicKey(digest).toRawBytes(false);
    return "0x" + bytesToHex(keccak_256(pub.slice(1)).slice(-20));
  }

  it("produces an EIP-191 signature that recovers to the wallet address", async () => {
    const message = "FurlPay: link this wallet to your account\nnonce: 0xabc123";
    const sig = await signMessage(message);
    expect(/^0x[0-9a-fA-F]{130}$/.test(sig)).toBe(true);
    expect(recoverEip191(message, sig).toLowerCase()).toBe(ORACLE_ADDRESS.toLowerCase());
  });

  it("binds the signature to the exact message (tamper breaks recovery)", async () => {
    const sig = await signMessage("original message");
    expect(recoverEip191("tampered message", sig).toLowerCase()).not.toBe(ORACLE_ADDRESS.toLowerCase());
  });

  it("is interop-compatible with viem/server recoverMessageAddress", () => {
    // Signature produced by viem's account.signMessage over this exact message
    // (the algorithm the wallet-link verify route uses server-side). Our EIP-191
    // recovery must agree, proving native signatures will verify on the server.
    const message = "FurlPay interop test\nnonce: 0xdeadbeef";
    const viemSig =
      "0x231d1f465e7ad13243d057667747e7ccd87b350b14ccf58ecf5149b2ed34a72227f232d714d7458307c30594f4e22f1726c54d52e0bf76ef911cf177b1e134aa1b";
    expect(recoverEip191(message, viemSig).toLowerCase()).toBe(ORACLE_ADDRESS.toLowerCase());
  });
});
