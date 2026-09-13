import {
  deriveAccountAtIndex,
  defaultLabel,
  accountPaths,
  AccountError,
} from "../manager";
import { deriveAddress, ethPath } from "../../wallet";
import { deriveSolanaAddress, solanaPath } from "../../solana/wallet";

// ---------------------------------------------------------------------------
// Multi-account derivation.
//
// The property that matters most is BACKWARDS COMPATIBILITY: account 0 must
// derive exactly the address every existing wallet already has. A change there
// does not error — it silently shows an empty wallet to someone whose funds are
// at the old address, which is indistinguishable from theft from the user's
// side.
//
// Second: the account level is what varies (m/44'/60'/N'/0/0), matching
// MetaMask/Phantom/Ledger, so the same phrase restored elsewhere lists the same
// accounts. Deviating strands funds behind this app.
//
// Test mnemonic is the public all-`abandon` BIP-39 vector. It holds nothing.
// ---------------------------------------------------------------------------

const M = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("backwards compatibility — account 0 is unchanged", () => {
  it("EVM account 0 equals the pre-existing single-account derivation", () => {
    // deriveAddress() with no index is what every existing caller uses.
    expect(deriveAccountAtIndex(M, 0).evmAddress).toBe(deriveAddress(M));
  });

  it("Solana account 0 equals the pre-existing derivation", () => {
    expect(deriveAccountAtIndex(M, 0).solanaAddress).toBe(deriveSolanaAddress(M));
  });

  it("account 0 Solana address matches the vector pinned in solanaWallet.test.ts", () => {
    // Cross-checked against @solana/web3.js when that suite was written.
    expect(deriveAccountAtIndex(M, 0).solanaAddress).toBe(
      "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk",
    );
  });

  it("ethPath(0) is byte-identical to the original hardcoded path", () => {
    expect(ethPath(0)).toBe("m/44'/60'/0'/0/0");
  });
});

describe("derivation paths vary the ACCOUNT level", () => {
  it("uses m/44'/60'/N'/0/0 for EVM", () => {
    expect(ethPath(0)).toBe("m/44'/60'/0'/0/0");
    expect(ethPath(1)).toBe("m/44'/60'/1'/0/0");
    expect(ethPath(7)).toBe("m/44'/60'/7'/0/0");
  });

  it("uses m/44'/501'/N'/0' for Solana", () => {
    expect(solanaPath(0)).toBe("m/44'/501'/0'/0'");
    expect(solanaPath(1)).toBe("m/44'/501'/1'/0'");
  });

  it("accountPaths reports both for a given index", () => {
    expect(accountPaths(3)).toEqual({
      evm: "m/44'/60'/3'/0/0",
      solana: "m/44'/501'/3'/0'",
    });
  });
});

describe("three accounts from one phrase", () => {
  const accounts = [0, 1, 2].map((i) => deriveAccountAtIndex(M, i));

  it("produces six distinct addresses", () => {
    const all = accounts.flatMap((a) => [a.evmAddress, a.solanaAddress]);
    expect(all).toHaveLength(6);
    expect(new Set(all).size).toBe(6);
  });

  it("EVM addresses are all distinct and well-formed", () => {
    const evm = accounts.map((a) => a.evmAddress);
    expect(new Set(evm).size).toBe(3);
    for (const a of evm) expect(a).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("Solana addresses are all distinct and well-formed base58", () => {
    const sol = accounts.map((a) => a.solanaAddress);
    expect(new Set(sol).size).toBe(3);
    for (const a of sol) expect(a).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it("assigns 1-based default labels", () => {
    expect(accounts.map((a) => a.label)).toEqual(["Account 1", "Account 2", "Account 3"]);
    expect(defaultLabel(0)).toBe("Account 1");
    expect(defaultLabel(9)).toBe("Account 10");
  });

  it("records a creation timestamp", () => {
    for (const a of accounts) {
      expect(a.createdAt).toBeGreaterThan(0);
      expect(Number.isInteger(a.createdAt)).toBe(true);
    }
  });
});

describe("determinism", () => {
  it("the same mnemonic and index always give the same addresses", () => {
    for (const i of [0, 1, 5]) {
      const a = deriveAccountAtIndex(M, i);
      const b = deriveAccountAtIndex(M, i);
      expect(a.evmAddress).toBe(b.evmAddress);
      expect(a.solanaAddress).toBe(b.solanaAddress);
    }
  });

  it("a different mnemonic gives different addresses at the same index", () => {
    const other =
      "legal winner thank year wave sausage worth useful legal winner thank yellow";
    expect(deriveAccountAtIndex(other, 0).evmAddress).not.toBe(
      deriveAccountAtIndex(M, 0).evmAddress,
    );
    expect(deriveAccountAtIndex(other, 0).solanaAddress).not.toBe(
      deriveAccountAtIndex(M, 0).solanaAddress,
    );
  });

  it("account N is stable across a large index", () => {
    const big = deriveAccountAtIndex(M, 100);
    expect(big.evmAddress).toBe(deriveAccountAtIndex(M, 100).evmAddress);
    expect(big.index).toBe(100);
  });
});

describe("index validation fails closed", () => {
  it("rejects negative, fractional, and out-of-range indices", () => {
    for (const bad of [-1, 1.5, NaN, 0x80000000, Infinity]) {
      expect(() => deriveAccountAtIndex(M, bad)).toThrow(AccountError);
      expect(() => accountPaths(bad)).toThrow(AccountError);
    }
  });

  it("rejects an out-of-range index at the path level too", () => {
    for (const bad of [-1, 1.5, 0x80000000]) {
      expect(() => ethPath(bad)).toThrow();
      expect(() => solanaPath(bad)).toThrow();
    }
  });
});

describe("the mnemonic never reaches persisted metadata", () => {
  it("a derived account carries only public fields", () => {
    const a = deriveAccountAtIndex(M, 0);
    expect(Object.keys(a).sort()).toEqual([
      "createdAt",
      "evmAddress",
      "index",
      "label",
      "solanaAddress",
    ]);
    // No field contains any word of the phrase.
    const serialized = JSON.stringify(a);
    expect(serialized).not.toContain("abandon");
    expect(serialized).not.toContain("about");
  });
});
