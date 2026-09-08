import { decodeStringReturn, decodeUintReturn, sanitizeTokenText } from "../erc20Metadata";

// ---------------------------------------------------------------------------
// ABI return decoding.
//
// Every case here is a shape that exists on mainnet today. The bytes32 tests
// are not hypothetical: MKR, and several other tokens deployed before the
// standard settled, return bytes32 from symbol(). A decoder assuming `string`
// reads those as garbage, and a garbage symbol on a send screen is how the
// wrong asset gets transferred.
// ---------------------------------------------------------------------------

const word = (hex: string) => hex.padStart(64, "0");

/** ABI-encode a dynamic string the way solidity returns one. */
function encodeString(text: string): string {
  const bytes = Array.from(new TextEncoder().encode(text));
  const data = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  const padded = data.padEnd(Math.ceil(data.length / 64) * 64 || 64, "0");
  return `0x${word("20")}${word(bytes.length.toString(16))}${padded}`;
}

/** bytes32, left-aligned and right-padded — the pre-standard shape. */
function encodeBytes32(text: string): string {
  const bytes = Array.from(new TextEncoder().encode(text));
  return `0x${bytes.map((b) => b.toString(16).padStart(2, "0")).join("").padEnd(64, "0")}`;
}

describe("decodeStringReturn", () => {
  it("decodes an ABI dynamic string", () => {
    expect(decodeStringReturn(encodeString("USD Coin"))).toBe("USD Coin");
    expect(decodeStringReturn(encodeString("USDC"))).toBe("USDC");
  });

  // The reason this function is not a one-liner.
  it("decodes the bytes32 shape old tokens return", () => {
    expect(decodeStringReturn(encodeBytes32("MKR"))).toBe("MKR");
    expect(decodeStringReturn(encodeBytes32("Maker"))).toBe("Maker");
  });

  it("decodes a string longer than one word", () => {
    const long = "A Token With A Fairly Long Name Indeed";
    expect(decodeStringReturn(encodeString(long))).toBe(long);
  });

  it("handles non-ASCII names", () => {
    expect(decodeStringReturn(encodeString("Token日本"))).toBe("Token日本");
  });

  it("returns null rather than guessing on empty or malformed data", () => {
    expect(decodeStringReturn("0x")).toBeNull();
    expect(decodeStringReturn("")).toBeNull();
    // Two words: neither a bytes32 nor a complete dynamic string.
    expect(decodeStringReturn(`0x${word("20")}${word("4")}`)).toBeNull();
  });

  // A hostile contract can return an offset pointing outside the payload;
  // trusting it would read whatever bytes happened to follow.
  it("refuses an out-of-range offset", () => {
    const bad = `0x${word("ffffffff")}${word("4")}${word("41414141")}`;
    expect(decodeStringReturn(bad)).toBeNull();
  });

  it("refuses a length that overruns the payload", () => {
    const bad = `0x${word("20")}${word("ffff")}${word("41")}`;
    expect(decodeStringReturn(bad)).toBeNull();
  });

  it("refuses an absurd declared length", () => {
    const bad = `0x${word("20")}${word((10n ** 20n).toString(16))}${word("41")}`;
    expect(decodeStringReturn(bad)).toBeNull();
  });
});

describe("sanitizeTokenText", () => {
  it("leaves ordinary names alone", () => {
    expect(sanitizeTokenText("USD Coin")).toBe("USD Coin");
    expect(sanitizeTokenText("  Wrapped Ether  ")).toBe("Wrapped Ether");
  });

  // A right-to-left override makes rendered text differ from stored text, which
  // is the entire mechanism behind lookalike tokens in a list.
  it("strips bidirectional overrides", () => {
    expect(sanitizeTokenText("USDC\u202efake")).toBe("USDCfake");
    expect(sanitizeTokenText("\u202aUSDC\u202c")).toBe("USDC");
    expect(sanitizeTokenText("A\u2066B\u2069C")).toBe("ABC");
  });

  it("strips zero-width characters that make distinct tokens look identical", () => {
    expect(sanitizeTokenText("USD\u200bC")).toBe("USDC");
    expect(sanitizeTokenText("US\u200dDC")).toBe("USDC");
    expect(sanitizeTokenText("\ufeffUSDC")).toBe("USDC");
  });

  it("strips control characters", () => {
    expect(sanitizeTokenText("USD\u0000C")).toBe("USDC");
    expect(sanitizeTokenText("USD\u0007C")).toBe("USDC");
    // Newlines are control characters too: a multi-line "symbol" breaks every
    // row it is rendered in.
    expect(sanitizeTokenText("USD\nC")).toBe("USDC");
  });

  it("caps length, because a 4KB symbol is a layout attack", () => {
    expect(sanitizeTokenText("A".repeat(500)).length).toBe(64);
    expect(sanitizeTokenText("A".repeat(500), 10).length).toBe(10);
  });
});

describe("decodeUintReturn", () => {
  it("decodes a uint256", () => {
    expect(decodeUintReturn(`0x${word("6")}`)).toBe(6n);
    expect(decodeUintReturn(`0x${word("12")}`)).toBe(18n);
  });

  it("stays exact above 2^53", () => {
    const huge = (1n << 200n).toString(16);
    expect(decodeUintReturn(`0x${word(huge)}`)).toBe(1n << 200n);
  });

  it("returns null for empty or misaligned data", () => {
    expect(decodeUintReturn("0x")).toBeNull();
    expect(decodeUintReturn("0xabc")).toBeNull();
    expect(decodeUintReturn("")).toBeNull();
  });
});
