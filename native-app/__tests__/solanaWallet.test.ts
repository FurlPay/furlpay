import { bytesToHex } from "@noble/hashes/utils";
import { mnemonicToSeedSync } from "@scure/bip39";
import { derivePath } from "../lib/solana/slip10";
import {
  deriveSolanaKey,
  deriveSolanaAddress,
  solanaPath,
  signWithSolanaKey,
  verifySolanaSignature,
  isValidSolanaAddress,
  shortenSolanaAddress,
} from "../lib/solana/wallet";

// ---------------------------------------------------------------------------
// Solana account derivation.
//
// THE ADDRESSES BELOW WERE CROSS-CHECKED AGAINST @solana/web3.js, not produced
// by this implementation and then written down. The 32-byte derived seeds were
// fed to `Keypair.fromSeed(seed).publicKey.toBase58()` in the furl-token
// workspace and matched exactly. Combined with __tests__/slip10.test.ts (which
// checks the path derivation against the official SLIP-0010 spec vectors), the
// whole chain — mnemonic → seed → SLIP-0010 path → ed25519 → base58 — is
// verified against outside references at both halves.
//
// This matters more than usual: a derivation bug produces a perfectly valid key
// at the WRONG address. Nothing errors. The user restores their phrase in
// Phantom, sees a different account, and believes their money is gone.
//
// Test mnemonic: the standard all-`abandon` BIP-39 vector. It is public, it
// holds nothing, and it must never be used for real funds.
// ---------------------------------------------------------------------------

const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

/** Verified against @solana/web3.js Keypair.fromSeed on 2026-09-13. */
const EXPECTED = [
  {
    account: 0,
    seed: "37df573b3ac4ad5b522e064e25b63ea16bcbe79d449e81a0268d1047948bb445",
    address: "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk",
  },
  {
    account: 1,
    seed: "ba5e7b6e3680b4eb81db8e54c8e466b2e9a899355888403355d858ab985d2fc4",
    address: "Hh8QwFUA6MtVu1qAoq12ucvFHNwCcVTV7hpWjeY1Hztb",
  },
];

describe("Solana derivation — cross-checked against @solana/web3.js", () => {
  for (const { account, seed, address } of EXPECTED) {
    it(`account ${account} derives the expected 32-byte seed`, () => {
      const node = derivePath(solanaPath(account), mnemonicToSeedSync(TEST_MNEMONIC));
      expect(bytesToHex(node.key)).toBe(seed);
    });

    it(`account ${account} derives the expected base58 address`, () => {
      expect(deriveSolanaAddress(TEST_MNEMONIC, account)).toBe(address);
    });
  }

  it("uses the Phantom/Solflare/Backpack path so the phrase restores elsewhere", () => {
    // Deviating here strands the user's funds behind this app alone.
    expect(solanaPath(0)).toBe("m/44'/501'/0'/0'");
    expect(solanaPath(7)).toBe("m/44'/501'/7'/0'");
  });

  it("rejects an invalid account index rather than deriving something odd", () => {
    for (const bad of [-1, 1.5, NaN, 0x80000000]) {
      expect(() => solanaPath(bad)).toThrow();
    }
  });
});

describe("key material handling", () => {
  it("produces a 32-byte secret and 32-byte public key", () => {
    const key = deriveSolanaKey(TEST_MNEMONIC, 0);
    try {
      expect(key.secret).toHaveLength(32);
      expect(key.publicKey).toHaveLength(32);
      expect(key.address).toBe(EXPECTED[0].address);
    } finally {
      key.secret.fill(0);
    }
  });

  it("deriveSolanaAddress leaves no key material behind for the caller to leak", () => {
    // It zeroes internally; the address it returns carries no secret.
    const address = deriveSolanaAddress(TEST_MNEMONIC, 0);
    expect(address).toBe(EXPECTED[0].address);
    expect(address).not.toMatch(/[^1-9A-HJ-NP-Za-km-z]/);
  });

  it("is deterministic across calls", () => {
    expect(deriveSolanaAddress(TEST_MNEMONIC, 0)).toBe(deriveSolanaAddress(TEST_MNEMONIC, 0));
  });

  it("different accounts give different addresses", () => {
    expect(deriveSolanaAddress(TEST_MNEMONIC, 0)).not.toBe(
      deriveSolanaAddress(TEST_MNEMONIC, 1),
    );
  });
});

describe("signing", () => {
  const message = new TextEncoder().encode("furlpay solana signing test");

  it("produces a 64-byte signature that verifies against the address", () => {
    const sig = signWithSolanaKey(TEST_MNEMONIC, message, 0);
    expect(sig).toHaveLength(64);
    expect(verifySolanaSignature(EXPECTED[0].address, message, sig)).toBe(true);
  });

  it("does NOT verify against a different account's address", () => {
    const sig = signWithSolanaKey(TEST_MNEMONIC, message, 0);
    expect(verifySolanaSignature(EXPECTED[1].address, message, sig)).toBe(false);
  });

  it("does NOT verify a tampered message", () => {
    const sig = signWithSolanaKey(TEST_MNEMONIC, message, 0);
    const tampered = new TextEncoder().encode("furlpay solana signing tesT");
    expect(verifySolanaSignature(EXPECTED[0].address, tampered, sig)).toBe(false);
  });

  it("does NOT verify a tampered signature", () => {
    const sig = signWithSolanaKey(TEST_MNEMONIC, message, 0);
    sig[0] ^= 0xff;
    expect(verifySolanaSignature(EXPECTED[0].address, message, sig)).toBe(false);
  });

  it("verification fails closed on a malformed address", () => {
    const sig = signWithSolanaKey(TEST_MNEMONIC, message, 0);
    for (const bad of ["", "not-base58-0OIl", "abc"]) {
      expect(verifySolanaSignature(bad, message, sig)).toBe(false);
    }
  });
});

describe("address validation", () => {
  it("accepts real Solana addresses", () => {
    // The live FURL mint and the Token-2022 program — both real mainnet accounts.
    expect(isValidSolanaAddress("FYatJq71zqvaQNLLtbBy4hQcsV25dMATYfCSVBzV3gY1")).toBe(true);
    expect(isValidSolanaAddress("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")).toBe(true);
    expect(isValidSolanaAddress(EXPECTED[0].address)).toBe(true);
  });

  it("rejects anything that does not decode to 32 bytes", () => {
    // A regex on length would accept several of these.
    for (const bad of [
      "",
      "abc",
      "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl", // base58-illegal characters
      "0x71C7656EC7ab88b098defB751B7401B5f6d8976F", // EVM address
      "FYatJq71zqvaQNLLtbBy4hQcsV25dMATYfCSVBzV3gY1FYatJq71", // too long
    ]) {
      expect(isValidSolanaAddress(bad)).toBe(false);
    }
  });

  it("shortens for display without claiming to be the full address", () => {
    expect(shortenSolanaAddress(EXPECTED[0].address)).toBe("HAgk…Kpqk");
    expect(shortenSolanaAddress("short")).toBe("short");
  });
});
