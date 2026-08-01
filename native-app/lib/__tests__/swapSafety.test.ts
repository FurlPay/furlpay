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
//
// The rules now live in lib/swap/useSwap.ts and the screen is presentation
// only. That split is itself an invariant worth pinning — see the last block:
// if quoting or execution logic ever migrates back into the screen, these
// tripwires would be reading the wrong file and silently stop protecting
// anything, so the test asserts the separation directly.

const root = join(__dirname, "..", "..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const screenSrc = readFileSync(join(root, "app", "swap.tsx"), "utf8");
const hookSrc = readFileSync(join(root, "lib", "swap", "useSwap.ts"), "utf8");
// Comments explain WHY Number() is banned — only code counts.
const screenCode = strip(screenSrc);
const hookCode = strip(hookSrc);
const allCode = screenCode + "\n" + hookCode;

describe("swap screen money-path safety", () => {
  it("never validates the amount with Number()", () => {
    expect(allCode).not.toMatch(/Number\(\s*amount\s*\)/);
  });

  it("parses the amount through lib/money", () => {
    expect(hookSrc).toMatch(/from "@\/lib\/money"/);
    expect(hookCode).toMatch(/tryParseUsdcAmount\(amount\)/);
  });

  it("gates validity on a successful atomic parse, not a float comparison", () => {
    expect(hookCode).toMatch(/atomic !== null/);
  });

  it("bounds the amount input", () => {
    expect(screenCode).toMatch(/maxLength=\{AMOUNT_MAX_LENGTH\}/);
  });

  it("caps slippage client-side and blocks the control above the ceiling", () => {
    expect(hookCode).toMatch(/MAX_SLIPPAGE_PCT\s*=\s*\d/);
    expect(hookCode).toMatch(/slippagePct > MAX_SLIPPAGE_PCT/);
    // The confirm control must consult the block, not merely display it.
    expect(hookCode).toMatch(/slippageBlocked/);
    expect(screenCode).toMatch(/slippageBlocked/);
  });

  it("refuses to execute against a stale quote", () => {
    expect(hookCode).toMatch(/QUOTE_TTL_MS/);
    expect(hookCode).toMatch(/Date\.now\(\) - quotedAt > QUOTE_TTL_MS/);
  });

  it("re-prices a stale quote instead of executing it", () => {
    // The stale branch must return without reaching the execute request.
    const execFn = hookCode.slice(hookCode.indexOf("const execute = useCallback"));
    const staleAt = execFn.indexOf("QUOTE_TTL_MS");
    const requestAt = execFn.indexOf("execute: true");
    expect(staleAt).toBeGreaterThan(-1);
    expect(requestAt).toBeGreaterThan(staleAt);
    expect(execFn.slice(staleAt, requestAt)).toMatch(/return;/);
  });
});

describe("swap execution is authorized by a server-issued quote", () => {
  // The client no longer re-checks the executed quote's slippage, because it
  // no longer receives a re-quoted price to check: /api/swaps refuses to
  // ISSUE above the ceiling, and execution replays the stored quote. The
  // property to pin is that the client cannot execute without an id.

  it("holds the quoteId the server issued", () => {
    expect(hookCode).toMatch(/setQuoteId\(res\.quoteId\)/);
  });

  it("sends quoteId on execute", () => {
    expect(hookCode).toMatch(/execute: true,\s*quoteId/);
  });

  it("never sends execute:true without a quoteId", () => {
    // Any execute body in the money path must carry quoteId alongside it.
    const executeBodies = allCode.match(/body: \{[^}]*execute: true[^}]*\}/g) ?? [];
    expect(executeBodies.length).toBeGreaterThan(0);
    for (const body of executeBodies) expect(body).toMatch(/quoteId/);
  });

  it("cannot fire the action without an id in hand", () => {
    expect(hookCode).toMatch(/if \(!quote \|\| !quoteId/);
    expect(screenCode).toMatch(/disabled=\{[^}]*!q\.quoteId/);
  });

  it("re-quotes rather than erroring when the server rejects a spent id", () => {
    expect(hookCode).toMatch(/"expired" \|\| code === "already_used"/);
    expect(hookCode).toMatch(/requote\(/);
  });

  it("aborts superseded quote requests so a slow reply cannot repaint a newer price", () => {
    expect(hookCode).toMatch(/new AbortController\(\)/);
    // The controller's signal is threaded all the way into the request…
    expect(hookCode).toMatch(/fetchQuote\(ctrl\.signal\)/);
    expect(hookCode).toMatch(/signal,/);
    // …the effect cleanup aborts the superseded request…
    expect(hookCode).toMatch(/ctrl\.abort\(\)/);
    // …and an abort is swallowed rather than shown as a failure.
    expect(hookCode).toMatch(/instanceof AbortedError/);
  });

  it("guards against a second execution of the same quote while one is in flight", () => {
    expect(hookCode).toMatch(/inFlight/);
    expect(hookCode).toMatch(/inFlight\.current\)\s*return/);
  });

  it("requires a biometric confirmation before submitting", () => {
    const execFn = hookCode.slice(hookCode.indexOf("const execute = useCallback"));
    const confirmAt = execFn.indexOf("confirmWithBiometrics");
    const requestAt = execFn.indexOf("execute: true");
    expect(confirmAt).toBeGreaterThan(-1);
    expect(requestAt).toBeGreaterThan(confirmAt);
    // A declined prompt must abandon, not fall through.
    expect(execFn.slice(confirmAt, requestAt)).toMatch(/if \(!confirmed\)/);
  });
});

describe("the swap screen holds no money logic of its own", () => {
  // If quoting or execution ever moves back into the screen, the tripwires
  // above would be reading a file that no longer contains the rules. Rather
  // than fail mysteriously later, fail here and now.

  it("issues no swap requests directly", () => {
    expect(screenCode).not.toMatch(/api<[^>]*>\(\s*"\/swaps"/);
    expect(screenCode).not.toMatch(/execute: true/);
  });

  it("does not re-implement amount parsing", () => {
    expect(screenCode).not.toMatch(/parseUsdcAmount/);
  });

  it("delegates validation and quoting to the hooks", () => {
    expect(screenSrc).toMatch(/from "@\/lib\/swap\/useSwap"/);
    expect(screenCode).toMatch(/useSwapValidation\(/);
    expect(screenCode).toMatch(/useSwapQuote\(/);
    expect(screenCode).toMatch(/useSwapExecution\(/);
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
