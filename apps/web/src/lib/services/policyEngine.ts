import { PaymentCard, PolicyDecision, Transaction } from "../types";
import { screenAddress } from "./compliance";

// ---------------------------------------------------------------------------
// Off-chain policy engine (Playbook Gap 1: Hybrid MPC + real-time policy).
// Before the platform's HSM key-share co-signs a spend, run these checks:
//   - velocity  (rolling spend window)
//   - sanctions (destination address screening)
//   - MCC       (merchant category allow-list)
//   - limit     (per-purchase + daily card limits)
// Only if ALL pass does the 2-of-2 MPC signature get generated.
// ---------------------------------------------------------------------------

const VELOCITY_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const VELOCITY_CAP_USD = 3000;
const BLOCKED_MCCS = new Set<string>(["7995", "6051"]); // gambling, quasi-cash (illustrative)

interface SpendRequest {
  card: PaymentCard;
  amountUsd: number;
  mcc?: string;
  destinationAddress?: string;
  /** The CARD OWNER's transaction history for the velocity window. REQUIRED:
   *  it used to fall back to the seeded demo account, so a caller that forgot it
   *  computed velocity limits from a stranger's spending. */
  transactions: Transaction[];
}

export function evaluateSpend(req: SpendRequest): PolicyDecision {
  const reasons: string[] = [];

  // 1. Limit check
  const withinPerPurchase = req.amountUsd <= req.card.limits.perPurchase;
  const withinDaily =
    req.card.limits.dailySpent + req.amountUsd <= req.card.limits.daily;
  const limitOk = withinPerPurchase && withinDaily && !req.card.frozen;
  if (req.card.frozen) reasons.push("Card is frozen");
  if (!withinPerPurchase) reasons.push(`Exceeds per-purchase limit ($${req.card.limits.perPurchase})`);
  if (!withinDaily) reasons.push("Exceeds remaining daily limit");

  // 2. Velocity check (last hour of card spend across the account).
  // Only money that actually moved counts: a declined authorization spent
  // nothing, and counting it would let an attacker (or one fat-fingered
  // amount) lock the card by stacking declines.
  const since = Date.now() - VELOCITY_WINDOW_MS;
  const recentSpend = req.transactions
    .filter(
      (t) =>
        t.category === "card" &&
        t.direction === "out" &&
        t.status !== "declined" &&
        new Date(t.timestamp).getTime() >= since
    )
    .reduce((sum, t) => sum + t.amountUsd, 0);
  const velocityOk = recentSpend + req.amountUsd <= VELOCITY_CAP_USD;
  if (!velocityOk) reasons.push(`Velocity cap exceeded (>$${VELOCITY_CAP_USD}/hr)`);

  // 3. MCC allow-list
  const mccOk = !req.mcc || !BLOCKED_MCCS.has(req.mcc);
  if (!mccOk) reasons.push(`Merchant category ${req.mcc} is not permitted`);

  // 4. Sanctions / AML screening on destination
  let sanctionsOk = true;
  if (req.destinationAddress) {
    const screen = screenAddress(req.destinationAddress);
    sanctionsOk = !screen.sanctioned && screen.risk !== "severe";
    if (!sanctionsOk) reasons.push(`Destination flagged: ${screen.reasons[0]}`);
  }

  const approved = limitOk && velocityOk && mccOk && sanctionsOk;
  if (approved) reasons.push("All policy checks passed — MPC co-sign authorized");

  return {
    approved,
    reasons,
    checks: { velocity: velocityOk, sanctions: sanctionsOk, mcc: mccOk, limit: limitOk },
  };
}
