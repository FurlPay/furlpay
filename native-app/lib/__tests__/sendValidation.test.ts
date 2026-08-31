import { validateSend } from "../sendValidation";
import type { TokenBalance } from "../types";

// Regressions for the two Send-tab bugs:
//  B1 — `Number(amount) > 0` let "0.0000001" through (truncates to 0 atomic);
//       validateSend must go through parseUsdcAmount and reject it.
//  B2 — the USD-denominated field was compared against the balance's TOKEN
//       amount: 2 SOL (~$350) vs "$100" read as insufficient. It must compare
//       against usdValue.
//  B3 — that same USD figure was then POSTed to /api/wallets/transfer, which
//       spends it in TOKEN units. Sending $100 of a $175 token debited 100 of
//       them. The check must also hand back `amountTokens`.

const EVM = "0x52908400098527886E0F7030069857D2E4169EE7";
const SOL_ADDR = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";

const usdc = (over: Partial<TokenBalance> = {}): TokenBalance =>
  ({ token: "USDC", chain: "arbitrum", amount: 500, usdValue: 500, ...over }) as TokenBalance;

describe("validateSend — B1: money goes through the atomic parser", () => {
  it("rejects a sub-atomic amount instead of truncating it to zero", () => {
    const r = validateSend({ destination: EVM, amount: "0.0000001", balance: usdc() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/6 decimal/i);
  });

  it("rejects zero, negatives, separators and scientific notation with parser messages", () => {
    for (const bad of ["0", "-5", "1,000", "1e3"]) {
      const r = validateSend({ destination: EVM, amount: bad, balance: usdc() });
      expect({ input: bad, ok: r.ok }).toEqual({ input: bad, ok: false });
    }
  });

  it("accepts a plain valid amount and returns it as a number", () => {
    const r = validateSend({ destination: EVM, amount: "12.50", balance: usdc() });
    expect(r).toEqual({ ok: true, amountUsd: 12.5, amountTokens: 12.5 });
  });
});

describe("validateSend — B2: USD amount vs USD value, not token units", () => {
  // 2 SOL worth $350: the old `amount > balance.amount` comparison read
  // "$100 > 2 SOL" and rejected an affordable send.
  const sol = (): TokenBalance =>
    ({ token: "SOL", chain: "solana", amount: 2, usdValue: 350, ...{} }) as TokenBalance;

  it("allows a $100 send from a 2-SOL (~$350) balance", () => {
    const r = validateSend({ destination: SOL_ADDR, amount: "100", balance: sol() });
    // $100 at $175/SOL — the token figure is the one that goes on the wire.
    expect(r).toEqual({ ok: true, amountUsd: 100, amountTokens: 0.571429 });
  });

  it("still rejects a send above the balance's USD value", () => {
    const r = validateSend({ destination: SOL_ADDR, amount: "400", balance: sol() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Insufficient SOL/);
  });
});

describe("validateSend — address & presence checks", () => {
  it("requires a destination and validates it per chain", () => {
    expect(validateSend({ destination: "", amount: "5", balance: usdc() }).ok).toBe(false);
    const wrongChain = validateSend({ destination: SOL_ADDR, amount: "5", balance: usdc() });
    expect(wrongChain.ok).toBe(false);
    if (!wrongChain.ok) expect(wrongChain.error).toMatch(/EVM/);
  });

  it("errors when there is no balance to send from", () => {
    const r = validateSend({ destination: EVM, amount: "5", balance: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/No balance/);
  });
});

describe("validateSend — B3: the wire amount is denominated in tokens", () => {
  // A stablecoin off par. EURC at $1.08 is the exact case the old code got
  // wrong: it put the dollar figure on the wire and the route spent it as
  // euros, over-debiting by the FX spread on every send.
  const eurc = (): TokenBalance =>
    ({ token: "EURC", chain: "base", amount: 1000, usdValue: 1080 }) as TokenBalance;

  it("converts USD to token units at the balance's own unit price", () => {
    const r = validateSend({ destination: EVM, amount: "108", balance: eurc() });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.amountUsd).toBe(108);
      expect(r.amountTokens).toBe(100); // $108 / $1.08 = 100 EURC
    }
  });

  it("leaves a 1:1 stablecoin's two figures identical", () => {
    const r = validateSend({ destination: EVM, amount: "250", balance: usdc() });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amountTokens).toBe(r.amountUsd);
  });

  it("never emits more tokens than the balance holds on a max send", () => {
    // Rounding a max-value send up by a float hair would make the server
    // reject the user's own full balance as an overdraw.
    const b = eurc();
    const r = validateSend({ destination: EVM, amount: String(b.usdValue), balance: b });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amountTokens).toBeLessThanOrEqual(b.amount);
  });

  it("refuses rather than guessing 1:1 when the balance implies no price", () => {
    // usdValue 0 against a held amount: the snapshot cannot price this token,
    // and par is a guess that silently mis-denominates the transfer.
    const unpriced = { token: "USDC", chain: "base", amount: 10, usdValue: 0 } as TokenBalance;
    const r = validateSend({ destination: EVM, amount: "5", balance: unpriced });
    expect(r.ok).toBe(false);
  });
});
