import { readFurlBalance, formatFurl, FURL_DECIMALS } from "../lib/solana/furl";

// ---------------------------------------------------------------------------
// FURL balance handling on device.
//
// The property under test is the one a balance screen gets wrong by default:
// every failure must stay distinguishable from "you hold nothing". A timeout
// rendered as 0 FURL tells someone their money vanished.
// ---------------------------------------------------------------------------

describe("readFurlBalance — failures never become a zero balance", () => {
  it("reports no_account when the device has no Solana address yet", async () => {
    const res = await readFurlBalance(null);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("no_account");
    // Crucially NOT a zero balance: this wallet predates Solana support.
    expect(res.detail).toMatch(/Unlock your wallet/i);
  });

  it("rejects a malformed address without calling the network", async () => {
    const res = await readFurlBalance("not-a-real-address");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("invalid_address");
  });

  it("rejects an EVM address — right shape, wrong chain", async () => {
    const res = await readFurlBalance("0x71C7656EC7ab88b098defB751B7401B5f6d8976F");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("invalid_address");
  });
});

describe("formatFurl", () => {
  it("groups thousands", () => {
    expect(formatFurl("1000")).toBe("1,000");
    expect(formatFurl("1000000")).toBe("1,000,000");
    expect(formatFurl("1000000000")).toBe("1,000,000,000");
  });

  it("keeps significant fraction digits and trims trailing zeros", () => {
    expect(formatFurl("12.5")).toBe("12.5");
    expect(formatFurl("12.500000")).toBe("12.5");
    expect(formatFurl("0.000001")).toBe("0");
    expect(formatFurl("0.0001")).toBe("0.0001");
  });

  it("handles zero and whole numbers", () => {
    expect(formatFurl("0")).toBe("0");
    expect(formatFurl("7")).toBe("7");
  });

  it("does not lose precision on amounts past Number.MAX_SAFE_INTEGER", () => {
    // 9,007,199,254.740993 FURL — a float round-trip mangles this.
    expect(formatFurl("9007199254.740993", 6)).toBe("9,007,199,254.740993");
    // The whole supply.
    expect(formatFurl("1000000000")).toBe("1,000,000,000");
  });

  it("respects the requested fraction-digit cap", () => {
    expect(formatFurl("1.123456", 2)).toBe("1.12");
    expect(formatFurl("1.123456", 6)).toBe("1.123456");
  });
});

describe("FURL constants match the mint", () => {
  it("is 6 decimals, like the on-chain mint and USDC", () => {
    expect(FURL_DECIMALS).toBe(6);
  });
});
