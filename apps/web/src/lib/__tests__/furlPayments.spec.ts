import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import {
  buildPaymentTransaction,
  furlPaymentsEnabled,
  furlUsdPrice,
  usdToTokenBaseUnits,
  USDC_MINT,
  USDC_DECIMALS,
  type PayAsset,
} from "@/lib/actions/solana";
import { FURL_MINT, FURL_DECIMALS } from "@/lib/token/furl";

// ---------------------------------------------------------------------------
// FURL payment construction.
//
// The properties asserted here are the ones whose failure moves the wrong
// amount, moves it to an unreachable account, or moves it at all when it should
// not have been offered:
//
//   * every FURL instruction carries the TOKEN-2022 program id — under the
//     legacy program the derived ATA is a different address and the transfer is
//     lost;
//   * transferChecked carries the mint AND 6 decimals, so the runtime rejects a
//     wrong-scale transfer instead of settling it;
//   * FURL cannot be paid at all without a configured price — no invented rate;
//   * SOL and USDC behave exactly as before (regression).
// ---------------------------------------------------------------------------

const PAYER = Keypair.generate().publicKey;
const MERCHANT = Keypair.generate().publicKey;

/** transferChecked's data layout: [instruction(1), amount(8 LE), decimals(1)]. */
function decodeTransferChecked(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    instruction: data[0],
    amount: view.getBigUint64(1, true),
    decimals: data[9],
  };
}

function env(overrides: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const ORIGINAL = { ...process.env };

beforeEach(() => {
  env({
    MERCHANT_SOLANA_WALLET: MERCHANT.toBase58(),
    FURL_USD_PRICE: undefined,
    PLATFORM_FEE_BPS: undefined,
    PLATFORM_FEE_SOLANA_WALLET: undefined,
    SOLANA_SOL_USD_PRICE: "150",
  });
  // No network in unit tests: the SOL path's Pyth fetch must not be attempted.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllGlobals();
});

async function build(asset: PayAsset, amountUsd = 25) {
  return buildPaymentTransaction({ payer: PAYER, amountUsd, asset });
}

describe("FURL payment gating", () => {
  it("is disabled when no price is configured", () => {
    expect(furlPaymentsEnabled()).toBe(false);
    expect(() => furlUsdPrice()).toThrow(/not enabled/);
  });

  it("refuses to build a FURL transaction without a price — no invented rate", async () => {
    await expect(build("FURL")).rejects.toThrow(/not enabled/);
  });

  it("is enabled once a real price is set", () => {
    env({ FURL_USD_PRICE: "0.01" });
    expect(furlPaymentsEnabled()).toBe(true);
    expect(furlUsdPrice()).toBe(0.01);
  });

  it("rejects an absurd price rather than sizing a transfer from a typo", () => {
    env({ FURL_USD_PRICE: "0.0000000001" });
    expect(furlPaymentsEnabled()).toBe(false);
    expect(() => furlUsdPrice()).toThrow(/outside the sane range/);

    env({ FURL_USD_PRICE: "999999999" });
    expect(furlPaymentsEnabled()).toBe(false);
    expect(() => furlUsdPrice()).toThrow(/outside the sane range/);
  });

  it("rejects a non-numeric or non-positive price", () => {
    for (const bad of ["abc", "0", "-1", ""]) {
      env({ FURL_USD_PRICE: bad });
      expect(furlPaymentsEnabled()).toBe(false);
      expect(() => furlUsdPrice()).toThrow();
    }
  });
});

describe("FURL transaction construction", () => {
  beforeEach(() => env({ FURL_USD_PRICE: "0.01" }));

  it("uses the Token-2022 program for EVERY instruction", async () => {
    const tx = await build("FURL");
    expect(tx.instructions.length).toBeGreaterThan(0);
    for (const ix of tx.instructions) {
      // The associated-token-program instruction is the ATA creation; the rest
      // are Token-2022. Neither may be the legacy SPL Token program.
      expect(ix.programId.equals(TOKEN_PROGRAM_ID)).toBe(false);
    }
    const transfer = tx.instructions.find((ix) => ix.programId.equals(TOKEN_2022_PROGRAM_ID));
    expect(transfer).toBeDefined();
  });

  it("addresses the canonical FURL mint, and derives ATAs under Token-2022", async () => {
    const tx = await build("FURL");
    const mint = new PublicKey(FURL_MINT);
    const expectedPayerAta = getAssociatedTokenAddressSync(
      mint,
      PAYER,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    const legacyAta = getAssociatedTokenAddressSync(mint, PAYER, false, TOKEN_PROGRAM_ID);
    // The two derivations differ — which is exactly why the program id matters.
    expect(expectedPayerAta.equals(legacyAta)).toBe(false);

    const keys = tx.instructions.flatMap((ix) => ix.keys.map((k) => k.pubkey.toBase58()));
    expect(keys).toContain(expectedPayerAta.toBase58());
    expect(keys).toContain(mint.toBase58());
    expect(keys).not.toContain(legacyAta.toBase58());
  });

  it("creates the merchant token account idempotently before transferring", async () => {
    const tx = await build("FURL");
    const merchantAta = getAssociatedTokenAddressSync(
      new PublicKey(FURL_MINT),
      MERCHANT,
      true,
      TOKEN_2022_PROGRAM_ID,
    );
    const ataIx = tx.instructions[0];
    // Idempotent ATA creation is instruction 1 of the associated-token program.
    expect(ataIx.keys.some((k) => k.pubkey.equals(merchantAta))).toBe(true);
    expect(ataIx.data[0]).toBe(1);
  });

  it("sends transferChecked with the mint and 6 decimals", async () => {
    const tx = await build("FURL");
    const transfer = tx.instructions.find(
      (ix) => ix.programId.equals(TOKEN_2022_PROGRAM_ID) && ix.data[0] === 12,
    );
    expect(transfer).toBeDefined();
    const decoded = decodeTransferChecked(transfer!.data);
    expect(decoded.instruction).toBe(12); // TransferChecked
    expect(decoded.decimals).toBe(FURL_DECIMALS);
    // $25 at $0.01/FURL = 2,500 FURL = 2,500,000,000 base units.
    expect(decoded.amount).toBe(2_500_000_000n);
  });

  it("scales the amount by the configured price, not by a hardcoded rate", async () => {
    env({ FURL_USD_PRICE: "0.5" });
    const tx = await build("FURL", 10);
    const transfer = tx.instructions.find(
      (ix) => ix.programId.equals(TOKEN_2022_PROGRAM_ID) && ix.data[0] === 12,
    )!;
    // $10 at $0.50/FURL = 20 FURL.
    expect(decodeTransferChecked(transfer.data).amount).toBe(20_000_000n);
  });

  it("splits the platform fee in FURL, in the same transaction", async () => {
    const feeWallet = Keypair.generate().publicKey;
    env({ PLATFORM_FEE_BPS: "250", PLATFORM_FEE_SOLANA_WALLET: feeWallet.toBase58() });
    const tx = await build("FURL");

    const transfers = tx.instructions
      .filter((ix) => ix.programId.equals(TOKEN_2022_PROGRAM_ID) && ix.data[0] === 12)
      .map((ix) => decodeTransferChecked(ix.data).amount);

    expect(transfers).toHaveLength(2);
    // 2.5% of 2,500,000,000 = 62,500,000; merchant gets the remainder, and the
    // two legs must sum to the full quoted amount — no value left unaccounted.
    expect(transfers.reduce((a, b) => a + b, 0n)).toBe(2_500_000_000n);
    expect(transfers).toContain(62_500_000n);
    expect(transfers).toContain(2_437_500_000n);
  });

  it("sets the payer as fee payer and leaves a replaceable blockhash", async () => {
    const tx = await build("FURL");
    expect(tx.feePayer?.equals(PAYER)).toBe(true);
    expect(tx.recentBlockhash).toBe("11111111111111111111111111111111");
  });
});

describe("amount conversion guards", () => {
  it("rejects a zero/negative/NaN USD amount", () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(() => usdToTokenBaseUnits(bad, 1, 6)).toThrow();
    }
  });

  it("rejects an amount that rounds to zero token units", () => {
    // $0.0000001 of a $1 token is 0 base units at 6dp — a no-op transfer that
    // would look like a successful payment.
    expect(() => usdToTokenBaseUnits(0.0000001, 1, 6)).toThrow(/rounds to 0/);
  });

  it("rejects an amount that would overflow u64", () => {
    // A tiny price is the realistic route to this: the guard is the backstop
    // behind furlUsdPrice()'s range check.
    expect(() => usdToTokenBaseUnits(1e12, 1e-12, 6)).toThrow(/u64/);
  });

  it("is exact at 6 decimals (no float scaling error)", () => {
    expect(usdToTokenBaseUnits(0.07, 1, 6)).toBe(70_000n);
    expect(usdToTokenBaseUnits(1.1, 1, 6)).toBe(1_100_000n);
    expect(usdToTokenBaseUnits(29.97, 1, 6)).toBe(29_970_000n);
    expect(usdToTokenBaseUnits(1, 3, 6)).toBe(333_333n); // 1/3 rounds at 6dp
  });
});

describe("SOL and USDC are unchanged (regression)", () => {
  it("USDC still transfers under the LEGACY SPL Token program", async () => {
    const tx = await build("USDC");
    const transfer = tx.instructions.find(
      (ix) => ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data[0] === 12,
    );
    expect(transfer).toBeDefined();
    const decoded = decodeTransferChecked(transfer!.data);
    expect(decoded.decimals).toBe(USDC_DECIMALS);
    // USDC is quoted 1:1 with USD, so $25 = 25,000,000 base units.
    expect(decoded.amount).toBe(25_000_000n);
    const keys = transfer!.keys.map((k) => k.pubkey.toBase58());
    expect(keys).toContain(USDC_MINT);
    expect(keys).not.toContain(FURL_MINT);
  });

  it("USDC does not require FURL pricing", async () => {
    expect(furlPaymentsEnabled()).toBe(false);
    await expect(build("USDC")).resolves.toBeDefined();
  });

  it("SOL still uses a System transfer sized by the SOL price", async () => {
    const tx = await build("SOL");
    expect(tx.instructions).toHaveLength(1);
    expect(tx.instructions[0].programId.equals(SystemProgram.programId)).toBe(true);
    // $25 at the $150 fallback = 0.1666… SOL.
    const lamports = new DataView(
      tx.instructions[0].data.buffer,
      tx.instructions[0].data.byteOffset,
      tx.instructions[0].data.byteLength,
    ).getBigUint64(4, true);
    expect(lamports).toBe(BigInt(Math.round((25 / 150) * 1_000_000_000)));
  });

  it("SOL does not require FURL pricing either", async () => {
    expect(furlPaymentsEnabled()).toBe(false);
    await expect(build("SOL")).resolves.toBeDefined();
  });
});
