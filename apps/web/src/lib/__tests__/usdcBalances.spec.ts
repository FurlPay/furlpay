import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatUsdc,
  onChainReadsEnabled,
  sumAtomic,
  USDC_ADDRESS,
  USDC_DECIMALS,
} from "@/lib/services/usdcBalances";
import type { Balance } from "@/lib/custody";

const ORIGINAL_STAGE = process.env.FURLPAY_SELF_CUSTODY_STAGE;

afterEach(() => {
  process.env.FURLPAY_SELF_CUSTODY_STAGE = ORIGINAL_STAGE;
  vi.restoreAllMocks();
});

describe("verified contract constants", () => {
  // These were checked against live RPCs (decimals()==6, symbol()=="USDC" on
  // EVM; SPL mint decimals 6 on Solana). Pinning them here means a future edit
  // that "corrects" one to a bridged or test address fails loudly instead of
  // silently reading the wrong token.
  it("pins native USDC addresses", () => {
    expect(USDC_ADDRESS.base).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(USDC_ADDRESS.arbitrum).toBe("0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
    expect(USDC_ADDRESS.solana).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(USDC_DECIMALS).toBe(6);
  });

  it("uses EIP-55 checksummed EVM addresses", () => {
    // A lowercased constant would throw inside viem's getAddress at read time.
    expect(USDC_ADDRESS.base).not.toBe(USDC_ADDRESS.base.toLowerCase());
    expect(USDC_ADDRESS.arbitrum).not.toBe(USDC_ADDRESS.arbitrum.toLowerCase());
  });
});

describe("stage gate", () => {
  it("is off below stage 2", () => {
    for (const stage of ["0", "1", undefined]) {
      if (stage === undefined) delete process.env.FURLPAY_SELF_CUSTODY_STAGE;
      else process.env.FURLPAY_SELF_CUSTODY_STAGE = stage;
      expect(onChainReadsEnabled()).toBe(false);
    }
  });

  it("is on at stage 2 and above", () => {
    for (const stage of ["2", "3", "4"]) {
      process.env.FURLPAY_SELF_CUSTODY_STAGE = stage;
      expect(onChainReadsEnabled()).toBe(true);
    }
  });
});

describe("formatUsdc", () => {
  it("formats without float artefacts", () => {
    expect(formatUsdc("0")).toBe("0.000000");
    expect(formatUsdc("1")).toBe("0.000001");
    expect(formatUsdc("1000000")).toBe("1.000000");
    expect(formatUsdc("12340000")).toBe("12.340000");
    expect(formatUsdc("250000000")).toBe("250.000000");
  });

  it("stays exact past the range where a float would drift", () => {
    // 2^53 base units is ~9.007 billion USDC. Number(atomic)/1e6 loses the
    // low digits here; string slicing does not.
    const huge = "9007199254740993"; // 2^53 + 1
    expect(formatUsdc(huge)).toBe("9007199254.740993");
    expect(formatUsdc("123456789012345678901")).toBe("123456789012345.678901");
  });

  it("handles negatives (a reconciliation delta, never a wallet balance)", () => {
    expect(formatUsdc("-12340000")).toBe("-12.340000");
  });
});

describe("sumAtomic", () => {
  const bal = (chain: string, atomic: string, token = "USDC"): Balance => ({
    custody: "SELF_CUSTODIAL_ONCHAIN",
    token,
    chain,
    atomic,
    decimals: 6,
    spendable: true,
  });

  it("sums across chains exactly", () => {
    expect(sumAtomic([bal("base", "1000000"), bal("arbitrum", "2500000"), bal("solana", "1")])).toBe(
      "3500001",
    );
  });

  it("is exact beyond Number.MAX_SAFE_INTEGER", () => {
    expect(sumAtomic([bal("base", "9007199254740993"), bal("arbitrum", "1")])).toBe(
      "9007199254740994",
    );
  });

  it("returns 0 for no balances", () => {
    expect(sumAtomic([])).toBe("0");
  });

  it("refuses to sum different tokens into one number", () => {
    // The custody invariant in spirit: two different things are not one number.
    expect(() => sumAtomic([bal("base", "1000000"), bal("base", "1000000", "EURC")])).toThrow(
      /mixed tokens/,
    );
  });
});
