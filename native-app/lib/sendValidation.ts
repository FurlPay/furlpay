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
//  3. The USD figure was then POSTed to /api/wallets/transfer as `amount`,
//     which that route spends in TOKEN units (`src.amount -= amount`, and the
//     web's ScanToPay sends token units). For a non-1:1 token — EURC, XSGD,
//     SOL — that debited the wrong quantity. The check now also returns
//     `amountTokens`, and the wire carries that.
// ---------------------------------------------------------------------------

export type SendCheck =
  | { ok: false; error: string }
  | {
      ok: true;
      /** What the user typed and approved, for display and risk copy. */
      amountUsd: number;
      /** What goes on the wire: the same value in the source token's units. */
      amountTokens: number;
    };

/**
 * The source token's USD unit price, taken from the balance snapshot the
 * server already priced — never a client-side price table.
 *
 * Returns null when the snapshot cannot imply a price (empty or unpriced
 * balance). A caller must not fall back to 1:1: for EURC that silently
 * under-debits by the FX spread, which is the bug this exists to prevent.
 */
export function unitPriceUsd(balance: TokenBalance): number | null {
  if (balance.amount <= 0 || balance.usdValue <= 0) return null;
  const price = balance.usdValue / balance.amount;
  return Number.isFinite(price) && price > 0 ? price : null;
}

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

  // USD → token units. Reaching here guarantees usdValue >= amountUsd > 0, so
  // a priceable balance is implied; if the snapshot still cannot imply one we
  // fail closed rather than send a number in the wrong denomination.
  const unitPrice = unitPriceUsd(balance);
  if (unitPrice === null) {
    return { ok: false, error: `${balance.token} has no price on this balance yet.` };
  }

  // Round to the 6dp the amount field itself is parsed at, then clamp: a
  // "send everything" entry must land on exactly the held quantity rather than
  // a float hair above it, which the server would reject as an overdraw.
  const amountTokens = Math.min(
    Math.round((amountUsd / unitPrice) * 1_000_000) / 1_000_000,
    balance.amount
  );
  if (!(amountTokens > 0)) {
    return { ok: false, error: "That amount rounds to zero in the source token." };
  }
  return { ok: true, amountUsd, amountTokens };
}
