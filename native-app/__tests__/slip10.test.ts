import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { masterKeyFromSeed, deriveChild, derivePath } from "../lib/solana/slip10";

// ---------------------------------------------------------------------------
// SLIP-0010 ed25519 derivation, checked against the OFFICIAL spec vectors.
//
// These values were taken from the SLIP-0010 specification itself, not from
// memory. That distinction has cost this codebase before: a hand-written
// "BLAKE3" once passed its own tests and was not BLAKE3 at all, because the
// expected values were invented alongside the implementation.
//
// A derivation bug here does not crash. It silently produces a VALID key at the
// WRONG address — the user restores their phrase in another wallet, sees a
// different account, and concludes the money is gone.
//
// Source: https://github.com/satoshilabs/slips/blob/master/slip-0010.md
// ---------------------------------------------------------------------------

const VECTOR_1_SEED = hexToBytes("000102030405060708090a0b0c0d0e0f");

describe("SLIP-0010 ed25519 — official test vector 1", () => {
  it("derives chain m", () => {
    const node = masterKeyFromSeed(VECTOR_1_SEED);
    expect(bytesToHex(node.chainCode)).toBe(
      "90046a93de5380a72b5e45010748567d5ea02bbf6522f979e05c0d8d8ca9fffb",
    );
    expect(bytesToHex(node.key)).toBe(
      "2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7",
    );
  });

  it("derives chain m/0'", () => {
    const node = derivePath("m/0'", VECTOR_1_SEED);
    expect(bytesToHex(node.chainCode)).toBe(
      "8b59aa11380b624e81507a27fedda59fea6d0b779a778918a2fd3590e16e9c69",
    );
    expect(bytesToHex(node.key)).toBe(
      "68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3",
    );
  });

  it("derivePath('m/0') and one manual hardened step agree", () => {
    const manual = deriveChild(masterKeyFromSeed(VECTOR_1_SEED), 0 + 0x80000000);
    const viaPath = derivePath("m/0'", VECTOR_1_SEED);
    expect(bytesToHex(manual.key)).toBe(bytesToHex(viaPath.key));
    expect(bytesToHex(manual.chainCode)).toBe(bytesToHex(viaPath.chainCode));
  });

  it("accepts 'h' as the hardened marker, identically to apostrophe", () => {
    expect(bytesToHex(derivePath("m/0h", VECTOR_1_SEED).key)).toBe(
      bytesToHex(derivePath("m/0'", VECTOR_1_SEED).key),
    );
  });
});

describe("hardened-only enforcement", () => {
  it("REFUSES a non-hardened segment instead of silently hardening it", () => {
    // Coercing this would derive a different key than Phantom/Solflare, and the
    // user would see an empty wallet rather than an error.
    expect(() => derivePath("m/44'/501'/0'/0", VECTOR_1_SEED)).toThrow(/hardened-only/);
    expect(() => derivePath("m/0", VECTOR_1_SEED)).toThrow(/hardened-only/);
  });

  it("refuses a non-hardened index at the child level", () => {
    const master = masterKeyFromSeed(VECTOR_1_SEED);
    expect(() => deriveChild(master, 0)).toThrow(/hardened/);
    expect(() => deriveChild(master, 0x7fffffff)).toThrow(/hardened/);
  });

  it("rejects malformed paths", () => {
    for (const bad of ["", "x/44'", "44'/501'", "m/-1'", "m//0'", "m/abc'"]) {
      expect(() => derivePath(bad, VECTOR_1_SEED)).toThrow();
    }
  });
});

describe("derivation is deterministic and path-sensitive", () => {
  it("same seed + same path ⇒ same key", () => {
    const a = derivePath("m/44'/501'/0'/0'", VECTOR_1_SEED);
    const b = derivePath("m/44'/501'/0'/0'", VECTOR_1_SEED);
    expect(bytesToHex(a.key)).toBe(bytesToHex(b.key));
  });

  it("different account index ⇒ different key", () => {
    const a = derivePath("m/44'/501'/0'/0'", VECTOR_1_SEED);
    const b = derivePath("m/44'/501'/1'/0'", VECTOR_1_SEED);
    expect(bytesToHex(a.key)).not.toBe(bytesToHex(b.key));
  });

  it("different seed ⇒ different key", () => {
    const other = hexToBytes("0f0e0d0c0b0a09080706050403020100");
    expect(bytesToHex(derivePath("m/44'/501'/0'/0'", VECTOR_1_SEED).key)).not.toBe(
      bytesToHex(derivePath("m/44'/501'/0'/0'", other).key),
    );
  });

  it("returns 32-byte key and chain code at every depth", () => {
    for (const path of ["m/44'", "m/44'/501'", "m/44'/501'/0'", "m/44'/501'/0'/0'"]) {
      const node = derivePath(path, VECTOR_1_SEED);
      expect(node.key).toHaveLength(32);
      expect(node.chainCode).toHaveLength(32);
    }
  });
});
