import { usd, shortAddress, timeAgo, isValidDestination, EVM_ADDRESS_RE, SOLANA_ADDRESS_RE } from "../format";

describe("usd", () => {
  it("formats positive amounts", () => {
    expect(usd(1250.5)).toBe("$1,250.50");
    expect(usd(0)).toBe("$0.00");
  });
  it("keeps the sign on negatives", () => {
    expect(usd(-42)).toBe("-$42.00");
  });
  it("adds explicit +/- with sign option", () => {
    expect(usd(10, { sign: true })).toBe("+$10.00");
    expect(usd(-10, { sign: true })).toBe("-$10.00");
  });
});

describe("shortAddress", () => {
  const addr = "0x7045E4f6C1B5EDf8b0C6b9d3D6bE9E4E1FAAa31e";
  it("truncates long addresses", () => {
    expect(shortAddress(addr)).toBe("0x7045E4…a31e");
  });
  it("passes short strings through", () => {
    expect(shortAddress("0xabc")).toBe("0xabc");
  });
  it("handles null/undefined", () => {
    expect(shortAddress(null)).toBe("");
    expect(shortAddress(undefined)).toBe("");
  });
});

describe("timeAgo", () => {
  it("says just now for fresh timestamps", () => {
    expect(timeAgo(Date.now())).toBe("just now");
  });
  it("reports minutes and hours", () => {
    expect(timeAgo(Date.now() - 5 * 60_000)).toBe("5m ago");
    expect(timeAgo(Date.now() - 3 * 3_600_000)).toBe("3h ago");
  });
});

describe("address validation", () => {
  const evm = "0x" + "a".repeat(40);
  const sol = "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs";

  it("EVM regex accepts checksummed and rejects malformed", () => {
    expect(EVM_ADDRESS_RE.test(evm)).toBe(true);
    expect(EVM_ADDRESS_RE.test("0x123")).toBe(false);
    expect(EVM_ADDRESS_RE.test(evm + "ff")).toBe(false);
  });

  it("Solana regex accepts base58 and rejects 0/O/I/l chars", () => {
    expect(SOLANA_ADDRESS_RE.test(sol)).toBe(true);
    expect(SOLANA_ADDRESS_RE.test("O0Il" + "a".repeat(30))).toBe(false);
  });

  it("isValidDestination keys off the chain", () => {
    expect(isValidDestination(evm, "arbitrum")).toBe(true);
    expect(isValidDestination(sol, "arbitrum")).toBe(false);
    expect(isValidDestination(sol, "solana")).toBe(true);
    expect(isValidDestination(evm, "solana")).toBe(false);
  });
});
