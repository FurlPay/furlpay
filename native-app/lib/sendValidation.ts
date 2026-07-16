import { isValidDestination } from "./format";
import { parseUsdcAmount } from "./money";
import type { TokenBalance } from "./types";

// ---------------------------------------------------------------------------
// Validation for the main Send tab, extracted so it is testable and so money
// parsing goes through lib/money.ts like every other money entry point.
//
// The two bugs this closes:
//  1. The tab used `Number(amount) > 0`, which "0.0000001" passes and then
//     truncates to zero atomic units — exactly what parseUsdcAmount exists to
//     reject (the wallet SendSheet already used it; this tab did not).
//  2. The field is USD-denominated but was compared against the balance's
//     TOKEN amount: 2 SOL (~$350) vs a $100 entry read as "insufficient".
//     The comparison belongs against usdValue.
// ---------------------------------------------------------------------------

export type SendCheck =
  | { ok: false; error: string }
  | { ok: true; amountUsd: number };

export function validateSend(input: {
  destination: string;
  amount: string;
  balance: TokenBalance | null;
}): SendCheck {
  const { destination, amount, balance } = input;
  if (!destination.trim()) return { ok: false, error: "Enter a recipient address." };
  if (balance && !isValidDestination(destination.trim(), balance.chain)) {
    return {
      ok: false,
      error:
        balance.chain === "solana"
          ? "Recipient must be a Solana (base58) address."
          : "Recipient must be a 0x… EVM address.",
    };
  }
  if (!amount.trim()) return { ok: false, error: "Enter an amount." };

  // Authoritative parse — sub-atomic, >6dp, separators, negatives, scientific
  // notation all rejected with a user-facing message.
  let atomic: bigint;
  try {
    atomic = parseUsdcAmount(amount);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (!balance) return { ok: false, error: "No balance to send from." };

  // 6dp atomic → USD number. Safe: parseUsdcAmount caps at 9 whole digits,
  // far inside Number's exact-integer range.
  const amountUsd = Number(atomic) / 1_000_000;

  // USD amount against the balance's USD value — NOT its token amount.
  if (amountUsd > balance.usdValue) {
    return { ok: false, error: `Insufficient ${balance.token} balance.` };
  }
  return { ok: true, amountUsd };
}
