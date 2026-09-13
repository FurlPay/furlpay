import {
  getAssociatedTokenAddress,
  buildTransferInstruction,
  buildTransferCheckedInstruction,
  buildCreateAtaInstruction,
  encodeU64LE,
  decodeU64LE,
  tokenProgramForMint,
  SplError,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ATA_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  FURL_MINT,
  FURL_DECIMALS,
  FURL_TOKEN_PROGRAM_ID,
  USDC_MINT_SOL,
  U64_MAX,
} from "../spl";

// ---------------------------------------------------------------------------
// SPL Token instruction construction.
//
// EVERY EXPECTED VALUE HERE WAS PRODUCED BY @solana/spl-token IN A SCRATCH
// SCRIPT AND PINNED — the SDK is deliberately NOT imported by this test or by
// the code under test. Checking a hand-rolled implementation against itself
// proves nothing; these vectors come from outside it.
//
// The failure mode being guarded is silent and total: an instruction built
// against the wrong token program derives a valid-looking ATA that no FURL
// transfer can reach, and a wrong decimals byte moves 1,000x the intended
// amount. Neither errors at construction time.
// ---------------------------------------------------------------------------

const OWNER = "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk";

/** Reference values from @solana/spl-token, 2026-09-13. */
const VECTORS = {
  furlAtaToken2022: "guwpTEa7UoAknrS4xeASP5iA5iqEsDfhGT2GXwDnTZS",
  furlAtaLegacy: "4fs97QfwrLkkBRjhjondcMRqydGETPfzoCXnk69FkKtC",
  usdcAtaLegacy: "5N3f1tj9v1vc5TUZ8S7mCAnVmjVKrfnzXWhxLaxyZAgt",
  /** createTransferCheckedInstruction(1_500_000n, decimals 6) */
  transferCheckedHex: "0c60e316000000000006",
  /** createTransferInstruction(1_500_000n) */
  transferHex: "0360e3160000000000",
};

const hex = (b: Uint8Array) =>
  Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");

describe("FURL constants match the live mint", () => {
  it("is the mainnet mint at 6 decimals under Token-2022", () => {
    expect(FURL_MINT).toBe("FYatJq71zqvaQNLLtbBy4hQcsV25dMATYfCSVBzV3gY1");
    expect(FURL_DECIMALS).toBe(6);
    expect(FURL_TOKEN_PROGRAM_ID).toBe(TOKEN_2022_PROGRAM_ID);
    expect(FURL_TOKEN_PROGRAM_ID).not.toBe(TOKEN_PROGRAM_ID);
  });

  it("routes FURL to Token-2022 and USDC to the legacy program", () => {
    expect(tokenProgramForMint(FURL_MINT)).toBe(TOKEN_2022_PROGRAM_ID);
    expect(tokenProgramForMint(USDC_MINT_SOL)).toBe(TOKEN_PROGRAM_ID);
  });
});

describe("ATA derivation — matches @solana/spl-token", () => {
  it("derives the FURL ATA under Token-2022", () => {
    expect(getAssociatedTokenAddress(OWNER, FURL_MINT, TOKEN_2022_PROGRAM_ID)).toBe(
      VECTORS.furlAtaToken2022,
    );
  });

  it("derives the USDC ATA under the legacy program", () => {
    expect(getAssociatedTokenAddress(OWNER, USDC_MINT_SOL, TOKEN_PROGRAM_ID)).toBe(
      VECTORS.usdcAtaLegacy,
    );
  });

  it("the WRONG program gives a different, unreachable address", () => {
    const right = getAssociatedTokenAddress(OWNER, FURL_MINT, TOKEN_2022_PROGRAM_ID);
    const wrong = getAssociatedTokenAddress(OWNER, FURL_MINT, TOKEN_PROGRAM_ID);

    expect(right).toBe(VECTORS.furlAtaToken2022);
    expect(wrong).toBe(VECTORS.furlAtaLegacy);
    expect(right).not.toBe(wrong);
    // Both are well-formed. Nothing about the wrong one looks wrong.
    expect(wrong).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });
});

describe("u64 little-endian encoding", () => {
  it("encodes the documented boundary values", () => {
    expect(hex(encodeU64LE(0n))).toBe("0000000000000000");
    expect(hex(encodeU64LE(1n))).toBe("0100000000000000");
    expect(hex(encodeU64LE(U64_MAX))).toBe("ffffffffffffffff");
  });

  it("encodes FURL amounts at 6 decimals", () => {
    expect(hex(encodeU64LE(1_000_000n))).toBe("40420f0000000000"); // 1 FURL
    expect(hex(encodeU64LE(1_500_000n))).toBe("60e3160000000000"); // 1.5 FURL
    expect(hex(encodeU64LE(1n))).toBe("0100000000000000"); // smallest unit
  });

  it("round-trips", () => {
    for (const v of [0n, 1n, 1_000_000n, 1_000_000_000_000_000n, U64_MAX]) {
      expect(decodeU64LE(encodeU64LE(v))).toBe(v);
    }
  });

  it("REFUSES a number — a float cannot represent every u64", () => {
    expect(() => encodeU64LE(1_000_000 as unknown as bigint)).toThrow(SplError);
  });

  it("refuses negative and over-u64 amounts", () => {
    expect(() => encodeU64LE(-1n)).toThrow(SplError);
    expect(() => encodeU64LE(U64_MAX + 1n)).toThrow(/u64 maximum/);
  });
});

describe("Transfer instruction (discriminator 3)", () => {
  const ix = buildTransferInstruction({
    sourceAta: VECTORS.furlAtaToken2022,
    destinationAta: VECTORS.usdcAtaLegacy,
    owner: OWNER,
    amount: 1_500_000n,
    tokenProgramId: TOKEN_2022_PROGRAM_ID,
  });

  it("is exactly 9 bytes and matches the SDK's encoding", () => {
    expect(ix.data).toHaveLength(9);
    expect(ix.data[0]).toBe(3);
    expect(hex(ix.data)).toBe(VECTORS.transferHex);
  });

  it("has the documented three accounts, with only the owner signing", () => {
    expect(ix.keys).toHaveLength(3);
    expect(ix.keys[0]).toEqual({ pubkey: VECTORS.furlAtaToken2022, isSigner: false, isWritable: true });
    expect(ix.keys[1]).toEqual({ pubkey: VECTORS.usdcAtaLegacy, isSigner: false, isWritable: true });
    expect(ix.keys[2]).toEqual({ pubkey: OWNER, isSigner: true, isWritable: false });
  });

  it("targets the token program it was given", () => {
    expect(ix.programId).toBe(TOKEN_2022_PROGRAM_ID);
  });

  it("refuses a zero or negative amount", () => {
    for (const bad of [0n, -1n]) {
      expect(() =>
        buildTransferInstruction({
          sourceAta: VECTORS.furlAtaToken2022,
          destinationAta: VECTORS.usdcAtaLegacy,
          owner: OWNER,
          amount: bad,
          tokenProgramId: TOKEN_2022_PROGRAM_ID,
        }),
      ).toThrow(SplError);
    }
  });
});

describe("TransferChecked instruction (discriminator 12) — preferred", () => {
  const ix = buildTransferCheckedInstruction({
    sourceAta: VECTORS.furlAtaToken2022,
    mint: FURL_MINT,
    destinationAta: VECTORS.usdcAtaLegacy,
    owner: OWNER,
    amount: 1_500_000n,
    decimals: FURL_DECIMALS,
    tokenProgramId: TOKEN_2022_PROGRAM_ID,
  });

  it("is exactly 10 bytes and matches the SDK's encoding", () => {
    expect(ix.data).toHaveLength(10);
    expect(ix.data[0]).toBe(12);
    expect(ix.data[9]).toBe(6); // decimals byte
    expect(hex(ix.data)).toBe(VECTORS.transferCheckedHex);
  });

  it("carries the mint, so the runtime can reject a wrong-mint transfer", () => {
    expect(ix.keys).toHaveLength(4);
    expect(ix.keys[1]).toEqual({ pubkey: FURL_MINT, isSigner: false, isWritable: false });
  });

  it("refuses impossible decimals", () => {
    for (const bad of [-1, 10, 1.5, NaN]) {
      expect(() =>
        buildTransferCheckedInstruction({
          sourceAta: VECTORS.furlAtaToken2022,
          mint: FURL_MINT,
          destinationAta: VECTORS.usdcAtaLegacy,
          owner: OWNER,
          amount: 1n,
          decimals: bad,
          tokenProgramId: TOKEN_2022_PROGRAM_ID,
        }),
      ).toThrow(SplError);
    }
  });
});

describe("CreateAta instruction", () => {
  const ix = buildCreateAtaInstruction({
    payer: OWNER,
    owner: OWNER,
    mint: FURL_MINT,
    tokenProgramId: TOKEN_2022_PROGRAM_ID,
  });

  it("targets the associated-token program", () => {
    expect(ix.programId).toBe(ATA_PROGRAM_ID);
  });

  it("is idempotent by default (discriminator 1, not 0)", () => {
    // Plain Create fails when the account exists, turning a harmless race into
    // a failed payment.
    expect(ix.data).toEqual(new Uint8Array([1]));
    const plain = buildCreateAtaInstruction({
      payer: OWNER,
      owner: OWNER,
      mint: FURL_MINT,
      tokenProgramId: TOKEN_2022_PROGRAM_ID,
      idempotent: false,
    });
    expect(plain.data).toEqual(new Uint8Array([0]));
  });

  it("lists payer, the derived ATA, owner, mint, system and token programs", () => {
    expect(ix.keys).toHaveLength(6);
    expect(ix.keys[0]).toEqual({ pubkey: OWNER, isSigner: true, isWritable: true });
    expect(ix.keys[1].pubkey).toBe(VECTORS.furlAtaToken2022);
    expect(ix.keys[1].isWritable).toBe(true);
    expect(ix.keys[3].pubkey).toBe(FURL_MINT);
    expect(ix.keys[4].pubkey).toBe(SYSTEM_PROGRAM_ID);
    expect(ix.keys[5].pubkey).toBe(TOKEN_2022_PROGRAM_ID);
  });

  it("derives the ATA itself rather than trusting a caller-supplied one", () => {
    expect(ix.keys[1].pubkey).toBe(
      getAssociatedTokenAddress(OWNER, FURL_MINT, TOKEN_2022_PROGRAM_ID),
    );
  });
});

describe("address validation fails closed", () => {
  const base = {
    sourceAta: VECTORS.furlAtaToken2022,
    destinationAta: VECTORS.usdcAtaLegacy,
    owner: OWNER,
    amount: 1n,
    tokenProgramId: TOKEN_2022_PROGRAM_ID,
  };

  it("rejects malformed addresses in every position", () => {
    for (const bad of ["", "abc", "0x71C7656EC7ab88b098defB751B7401B5f6d8976F", "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl"]) {
      expect(() => buildTransferInstruction({ ...base, sourceAta: bad })).toThrow(SplError);
      expect(() => buildTransferInstruction({ ...base, destinationAta: bad })).toThrow(SplError);
      expect(() => buildTransferInstruction({ ...base, owner: bad })).toThrow(SplError);
    }
  });

  it("rejects an unknown token program", () => {
    expect(() =>
      buildTransferInstruction({ ...base, tokenProgramId: SYSTEM_PROGRAM_ID }),
    ).toThrow(/Unknown token program/);
  });
});
