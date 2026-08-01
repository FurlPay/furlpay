import { SELECTORS, encodeApprove } from "../evm/erc20";

// ---------------------------------------------------------------------------
// The selectors are computed at runtime from their signatures. These tests pin
// them against the PUBLISHED four-byte values — external ground truth, so the
// computation is checked rather than merely reproduced.
//
// Worth stating why it matters: a wrong selector is not a crash. It is a call
// to a different function, or to none — and on a token with a payable fallback,
// "to none" can mean the calldata is accepted and silently does nothing while
// the swap that follows fails for reasons that look unrelated.
// ---------------------------------------------------------------------------

describe("ERC-20 selectors", () => {
  it("matches the published four-byte signatures", () => {
    expect(SELECTORS.allowance).toBe("0xdd62ed3e"); // allowance(address,address)
    expect(SELECTORS.approve).toBe("0x095ea7b3"); // approve(address,uint256)
  });
});

describe("encodeApprove", () => {
  const spender = "0xAbC0000000000000000000000000000000000123";

  it("lays out selector + padded address + padded amount", () => {
    const data = encodeApprove(spender, 1000000n);
    expect(data.slice(0, 10)).toBe("0x095ea7b3");
    // 4-byte selector + two 32-byte words.
    expect(data.length).toBe(2 + 8 + 64 + 64);
    // Address is left-padded to 32 bytes and lower-cased.
    expect(data.slice(10, 74)).toBe("000000000000000000000000abc0000000000000000000000000000000000123");
    expect(BigInt("0x" + data.slice(74))).toBe(1000000n);
  });

  it("approves an exact amount, never an unlimited one", () => {
    // Infinite approval is the common default and it is a standing grant that
    // outlives the swap. If this ever starts emitting 2^256-1, that is a
    // deliberate policy change and should fail here first.
    const max = (1n << 256n) - 1n;
    const data = encodeApprove(spender, 500n);
    expect(BigInt("0x" + data.slice(74))).toBe(500n);
    expect(BigInt("0x" + data.slice(74))).not.toBe(max);
  });

  it("rejects a malformed spender instead of encoding a padded truncation", () => {
    expect(() => encodeApprove("0x123", 1n)).toThrow(/address/i);
    expect(() => encodeApprove("not-an-address", 1n)).toThrow(/address/i);
  });

  it("refuses a negative or oversized amount", () => {
    expect(() => encodeApprove(spender, -1n)).toThrow();
    expect(() => encodeApprove(spender, 1n << 256n)).toThrow(/uint256/i);
  });
});
