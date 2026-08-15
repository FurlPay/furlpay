// Unified address validation, plus the parseQrPayload weaknesses it closes.
//
// A "valid" verdict here is what tells the user their scan succeeded, so the
// interesting cases are the near-misses: strings with the right alphabet and
// roughly the right length that are not addresses at all.

import { describe, it, expect } from "vitest";
import {
  classifyAddress,
  isEvmAddress,
  isSolanaAddress,
  isValidForChainKind,
  shortenAddress,
} from "@/lib/addressValidation";
import { parseQrPayload } from "@/lib/qrPayload";

const EVM = "0x7045E4f6C1B5EDf8b0C6b9d3D6bE9E4E1FAAa31e";
const SOL = "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs";

describe("isEvmAddress", () => {
  it("accepts 0x + 40 hex in any casing", () => {
    expect(isEvmAddress(EVM)).toBe(true);
    expect(isEvmAddress(EVM.toLowerCase())).toBe(true);
    expect(isEvmAddress(`  ${EVM}  `)).toBe(true);
  });

  it("rejects wrong length or non-hex", () => {
    expect(isEvmAddress("0xdead")).toBe(false);
    expect(isEvmAddress("0x" + "a".repeat(41))).toBe(false);
    expect(isEvmAddress("0x" + "g".repeat(40))).toBe(false);
    expect(isEvmAddress(EVM.slice(2))).toBe(false); // missing 0x
  });
});

describe("isSolanaAddress", () => {
  it("accepts a real 32-byte base58 key", () => {
    expect(isSolanaAddress(SOL)).toBe(true);
    expect(isSolanaAddress(`  ${SOL}  `)).toBe(true);
  });

  it("rejects base58-alphabet strings that do not decode to 32 bytes", () => {
    // Right alphabet, right length range, wrong decoded size — exactly what a
    // regex-only check waves through.
    expect(isSolanaAddress("1".repeat(44))).toBe(false);
    expect(isSolanaAddress("z".repeat(44))).toBe(false);
  });

  it("rejects characters outside the base58 alphabet", () => {
    // 0, O, I and l are excluded from base58 precisely to avoid confusion.
    expect(isSolanaAddress(SOL.slice(0, -1) + "0")).toBe(false);
    expect(isSolanaAddress(SOL.slice(0, -1) + "O")).toBe(false);
    expect(isSolanaAddress(SOL.slice(0, -1) + "l")).toBe(false);
  });

  it("rejects out-of-range lengths without decoding", () => {
    expect(isSolanaAddress("abc")).toBe(false);
    expect(isSolanaAddress("z".repeat(500))).toBe(false);
  });

  it("does not classify an EVM address as Solana", () => {
    expect(isSolanaAddress(EVM)).toBe(false);
  });
});

describe("classifyAddress / isValidForChainKind", () => {
  it("labels each family and rejects junk", () => {
    expect(classifyAddress(EVM)).toBe("evm");
    expect(classifyAddress(SOL)).toBe("solana");
    expect(classifyAddress("hello world")).toBeNull();
    expect(classifyAddress("")).toBeNull();
  });

  it("gates an address against a specific chain kind", () => {
    expect(isValidForChainKind(EVM, "evm")).toBe(true);
    expect(isValidForChainKind(EVM, "solana")).toBe(false);
    expect(isValidForChainKind(SOL, "solana")).toBe(true);
    expect(isValidForChainKind(SOL, "evm")).toBe(false);
  });
});

describe("shortenAddress", () => {
  it("elides the middle and leaves short strings alone", () => {
    expect(shortenAddress(EVM)).toBe("0x7045…a31e");
    expect(shortenAddress("0xabc")).toBe("0xabc");
  });
});

describe("parseQrPayload — validation tightening", () => {
  it("still accepts the real payload shapes", () => {
    expect(parseQrPayload(EVM)).toEqual({ address: EVM });
    expect(parseQrPayload(SOL)).toEqual({ address: SOL });
    expect(parseQrPayload(`ethereum:${EVM}?value=25`)).toEqual({ address: EVM, amount: 25 });
    expect(parseQrPayload(`solana:${SOL}?amount=10`)).toEqual({ address: SOL, amount: 10 });
    expect(parseQrPayload(JSON.stringify({ address: EVM, amount: 25, token: "USDC" }))).toEqual({
      address: EVM,
      amount: 25,
      token: "USDC",
    });
  });

  // Was `j.address.length >= 20`: any 20-character string scanned "successfully"
  // and only failed server-side at submit.
  it("rejects a JSON payload whose address is not an address", () => {
    expect(parseQrPayload(JSON.stringify({ address: "not-a-real-address-at-all" }))).toBeNull();
    expect(parseQrPayload(JSON.stringify({ address: "0xdead" }))).toBeNull();
  });

  // The old character class unioned base58 and hex, so a base58 string parsed
  // as an Ethereum address purely because the alphabets overlap.
  it("rejects a URI whose address does not match its scheme", () => {
    expect(parseQrPayload(`ethereum:${SOL}`)).toBeNull();
    expect(parseQrPayload(`solana:${EVM}`)).toBeNull();
  });

  it("accepts either family under the furlpay scheme", () => {
    expect(parseQrPayload(`furlpay:${EVM}`)).toEqual({ address: EVM, amount: undefined });
    expect(parseQrPayload(`furlpay:${SOL}`)).toEqual({ address: SOL, amount: undefined });
  });

  it("rejects garbage", () => {
    expect(parseQrPayload("hello world")).toBeNull();
    expect(parseQrPayload("")).toBeNull();
    expect(parseQrPayload("{not json")).toBeNull();
  });
});
