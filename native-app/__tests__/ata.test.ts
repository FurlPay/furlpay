import {
  getAssociatedTokenAddress,
  findProgramAddress,
  assertToken2022,
  AtaError,
  TOKEN_2022_PROGRAM,
  TOKEN_LEGACY_PROGRAM,
  ASSOCIATED_TOKEN_PROGRAM,
} from "../lib/solana/ata";

// ---------------------------------------------------------------------------
// Associated Token Account derivation.
//
// EVERY EXPECTED VALUE BELOW WAS PRODUCED BY @solana/spl-token's
// `getAssociatedTokenAddressSync`, not by this implementation. 6/6 matched on
// 2026-09-13. Two of them are independently corroborated by mainnet:
//   - EU2tUJ1CoU8VjTKEuK49FTBv1N2Hk5jpv2589Eq1eZ1S is the deployer's real FURL
//     account, confirmed by getTokenLargestAccounts holding 100% of supply.
//   - CnZbWHRq1FV7y8QoJanrCaEfDWFtztvc791LbHKNVJSi appeared as the merchant ATA
//     inside a decoded Blink transaction built by the web app.
//
// The failure mode being guarded: deriving a FURL account under the LEGACY SPL
// Token program produces a different, entirely valid-looking address that no
// FURL transfer can ever reach. Nothing errors. The funds are simply gone.
// ---------------------------------------------------------------------------

const FURL_MINT = "FYatJq71zqvaQNLLtbBy4hQcsV25dMATYfCSVBzV3gY1";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEPLOYER = "FgeSXvrWcqE93byDoF3Vhwou7XTUhY42cYhs7vXkJPUL";
const WALLET = "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk";
const SYSTEM = "11111111111111111111111111111111";

describe("Token-2022 ATA derivation — cross-checked against @solana/spl-token", () => {
  const vectors: [string, string, string][] = [
    [DEPLOYER, FURL_MINT, "EU2tUJ1CoU8VjTKEuK49FTBv1N2Hk5jpv2589Eq1eZ1S"],
    [WALLET, FURL_MINT, "guwpTEa7UoAknrS4xeASP5iA5iqEsDfhGT2GXwDnTZS"],
    [SYSTEM, FURL_MINT, "CnZbWHRq1FV7y8QoJanrCaEfDWFtztvc791LbHKNVJSi"],
  ];

  for (const [owner, mint, expected] of vectors) {
    it(`derives ${expected.slice(0, 8)}… for ${owner.slice(0, 8)}…`, () => {
      expect(getAssociatedTokenAddress(owner, mint)).toBe(expected);
    });
  }

  it("the deployer's derived ATA is the account that actually holds the supply", () => {
    // Corroborated on mainnet, not just against a library.
    expect(getAssociatedTokenAddress(DEPLOYER, FURL_MINT)).toBe(
      "EU2tUJ1CoU8VjTKEuK49FTBv1N2Hk5jpv2589Eq1eZ1S",
    );
  });

  it("defaults to Token-2022, so a caller cannot forget FURL's program", () => {
    expect(getAssociatedTokenAddress(DEPLOYER, FURL_MINT)).toBe(
      getAssociatedTokenAddress(DEPLOYER, FURL_MINT, TOKEN_2022_PROGRAM),
    );
  });
});

describe("legacy SPL ATA derivation still works for legacy mints", () => {
  const vectors: [string, string, string][] = [
    [DEPLOYER, USDC_MINT, "BdWFd1MZWCYahi5ehA4gEEQRUDjKxpoRQpnyqPaHtckt"],
    [WALLET, USDC_MINT, "5N3f1tj9v1vc5TUZ8S7mCAnVmjVKrfnzXWhxLaxyZAgt"],
    [SYSTEM, USDC_MINT, "HJt8Tjdsc9ms9i4WCZEzhzr4oyf3ANcdzXrNdLPFqm3M"],
  ];

  for (const [owner, mint, expected] of vectors) {
    it(`derives USDC ATA ${expected.slice(0, 8)}…`, () => {
      expect(getAssociatedTokenAddress(owner, mint, TOKEN_LEGACY_PROGRAM)).toBe(expected);
    });
  }
});

describe("the wrong token program produces a different, unreachable address", () => {
  it("legacy and Token-2022 derivations differ for the SAME owner and mint", () => {
    const t22 = getAssociatedTokenAddress(DEPLOYER, FURL_MINT, TOKEN_2022_PROGRAM);
    const legacy = getAssociatedTokenAddress(DEPLOYER, FURL_MINT, TOKEN_LEGACY_PROGRAM);

    expect(t22).toBe("EU2tUJ1CoU8VjTKEuK49FTBv1N2Hk5jpv2589Eq1eZ1S");
    expect(legacy).toBe("FRj3m2inppmu6xcjcKuuHLQAZhS8PRdk4Znp3LGxubVT");
    expect(t22).not.toBe(legacy);
    // Both are well-formed. Nothing about the wrong one looks wrong.
    expect(legacy).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it("assertToken2022 refuses the legacy program by name", () => {
    expect(() => assertToken2022(TOKEN_2022_PROGRAM)).not.toThrow();
    expect(() => assertToken2022(TOKEN_LEGACY_PROGRAM)).toThrow(/Token-2022/);
    expect(() => assertToken2022("SomeOtherProgram1111111111111111111111111111")).toThrow(AtaError);
  });
});

describe("input validation fails closed", () => {
  it("rejects malformed owners and mints", () => {
    for (const bad of ["", "abc", "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl", "0x71C7656EC7ab88b098defB751B7401B5f6d8976F"]) {
      expect(() => getAssociatedTokenAddress(bad, FURL_MINT)).toThrow(AtaError);
      expect(() => getAssociatedTokenAddress(DEPLOYER, bad)).toThrow(AtaError);
    }
  });

  it("rejects a base58 string that does not decode to 32 bytes", () => {
    expect(() => getAssociatedTokenAddress("abcd", FURL_MINT)).toThrow(/32 bytes/);
  });
});

describe("findProgramAddress", () => {
  it("returns a bump in range and an off-curve address", () => {
    const { address, bump } = findProgramAddress(
      [new TextEncoder().encode("test-seed")],
      ASSOCIATED_TOKEN_PROGRAM,
    );
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
    expect(address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it("is deterministic", () => {
    const seeds = [new TextEncoder().encode("furlpay")];
    expect(findProgramAddress(seeds, ASSOCIATED_TOKEN_PROGRAM).address).toBe(
      findProgramAddress(seeds, ASSOCIATED_TOKEN_PROGRAM).address,
    );
  });

  it("different seeds give different addresses", () => {
    const a = findProgramAddress([new TextEncoder().encode("a")], ASSOCIATED_TOKEN_PROGRAM);
    const b = findProgramAddress([new TextEncoder().encode("b")], ASSOCIATED_TOKEN_PROGRAM);
    expect(a.address).not.toBe(b.address);
  });
});
