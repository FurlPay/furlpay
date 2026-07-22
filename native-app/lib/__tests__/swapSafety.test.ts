import { readFileSync } from "fs";
import { join } from "path";
import { tryParseUsdcAmount } from "../money";

// Source-level regression tripwire for the Swap screen's money path.
//
// The Send tab shipped `Number(amount) > 0` and had to be fixed (see
// lib/sendValidation.ts); the Swap screen carried the identical bug for
// longer because nothing tested it. These assertions pin the three properties
// that make a swap safe to put behind a biometric prompt:
//   1. the amount is parsed to atomic units, never floated through Number()
//   2. a quote the user is executing against is fresh
//   3. the slippage the server returns is capped client-side
// A render test would exercise one path; reading the source that ships is what
// catches a re-introduced `Number(amount)`.

const swapSrc = readFileSync(join(__dirname, "..", "..", "app", "swap.tsx"), "utf8");
// Comments explain WHY Number() is banned — only code counts.
const swapCode = swapSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("swap screen money-path safety", () => {
  it("never validates the amount with Number()", () => {
    expect(swapCode).not.toMatch(/Number\(\s*amount\s*\)/);
  });

  it("parses the amount through lib/money", () => {
    expect(swapSrc).toMatch(/from "@\/lib\/money"/);
    expect(swapCode).toMatch(/tryParseUsdcAmount\(amount\)/);
  });

  it("gates validity on a successful atomic parse, not a float comparison", () => {
    expect(swapCode).toMatch(/atomic !== null/);
  });

  it("bounds the amount input", () => {
    expect(swapCode).toMatch(/maxLength=\{AMOUNT_MAX_LENGTH\}/);
  });

  it("caps slippage client-side and blocks the button above the ceiling", () => {
    expect(swapCode).toMatch(/MAX_SLIPPAGE_PCT\s*=\s*\d/);
    expect(swapCode).toMatch(/slippagePct > MAX_SLIPPAGE_PCT/);
    expect(swapCode).toMatch(/disabled=\{[^}]*slippageBlocked/);
  });

  it("re-checks slippage on the executed quote, not only the displayed one", () => {
    expect(swapCode).toMatch(/res\.quote\.slippagePct > MAX_SLIPPAGE_PCT/);
  });

  it("refuses to execute against a stale quote", () => {
    expect(swapCode).toMatch(/QUOTE_TTL_MS/);
    expect(swapCode).toMatch(/Date\.now\(\) - quotedAt > QUOTE_TTL_MS/);
  });

  it("aborts superseded quote requests so a slow reply cannot repaint a newer price", () => {
    expect(swapCode).toMatch(/new AbortController\(\)/);
    expect(swapCode).toMatch(/signal: ctrl\.signal/);
    expect(swapCode).toMatch(/ctrl\.abort\(\)/);
    expect(swapCode).toMatch(/instanceof AbortedError/);
  });
});

describe("the amounts the swap screen must reject", () => {
  // The exact inputs `Number(x) > 0` waves through. Each truncates to zero
  // atomic USDC, i.e. a zero-value swap the user biometrically approved.
  it.each(["0.0000001", "0.0000000001", "0.000000499"])(
    "rejects sub-atomic %s",
    (input) => {
      expect(Number(input) > 0).toBe(true); // the old check passed it
      expect(tryParseUsdcAmount(input)).toBeNull(); // the new one does not
    }
  );

  it.each(["0", "", "  ", "-5", "1e-7", "1,000", "abc"])("rejects %p", (input) => {
    expect(tryParseUsdcAmount(input)).toBeNull();
  });

  it("accepts ordinary amounts at full 6dp precision", () => {
    expect(tryParseUsdcAmount("100")).toBe(100_000_000n);
    expect(tryParseUsdcAmount("0.000001")).toBe(1n);
    expect(tryParseUsdcAmount("12.50")).toBe(12_500_000n);
  });
});
