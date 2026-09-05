import { authenticateDeviceOwner } from "../biometrics";

// ---------------------------------------------------------------------------
// Risk-sensitive action policy.
//
// ONE table decides what proof each action needs. Before this, each screen
// decided for itself whether to prompt, which meant the answer was inconsistent
// (freezing a card prompted; changing the withdrawal destination did not) and
// unauditable — there was no single place to read what the app protects.
//
// THIS IS A CLIENT-SIDE CONTROL AND IT IS NOT A SECURITY BOUNDARY.
// A rooted device can skip every prompt below. Its job is to stop the WRONG
// PERSON holding an unlocked phone, and to make the user's intent explicit
// before money moves. The server must independently authorize every one of
// these actions; nothing here replaces that.
// ---------------------------------------------------------------------------

export type RiskLevel = "low" | "medium" | "high";

/**
 * Every action the app performs that is worth classifying.
 *
 * Adding an action to this union without adding it to RISK below is a compile
 * error, which is the point: a new money-moving flow cannot silently default to
 * "no authentication required".
 */
export type RiskAction =
  // low — reading things the user already has access to
  | "view_balance"
  | "view_transactions"
  | "view_markets"
  | "view_trip"
  // medium — changes that are visible and reversible
  | "change_profile"
  | "change_notification_prefs"
  | "change_theme"
  | "add_contact"
  | "freeze_card"
  // high — money leaves, or the controls protecting money change
  | "send_funds"
  | "withdraw"
  | "swap"
  | "change_withdrawal_destination"
  | "create_card"
  | "reveal_card_details"
  | "change_card_limits"
  | "change_security_settings"
  | "add_passkey"
  | "remove_passkey"
  | "authorize_agent_spend"
  | "change_agent_policy"
  | "revoke_agent"
  | "approve_agent_transaction"
  | "bank_transfer"
  | "delete_account";

export const RISK: Record<RiskAction, RiskLevel> = {
  view_balance: "low",
  view_transactions: "low",
  view_markets: "low",
  view_trip: "low",

  change_profile: "medium",
  change_notification_prefs: "medium",
  change_theme: "medium",
  add_contact: "medium",
  // Freezing is medium, not high: it is the SAFE direction (it reduces what an
  // attacker can spend), and a prompt in front of it would slow down the one
  // action a user takes when they think their card is compromised. UNfreezing
  // goes through change_card_limits, which is high.
  freeze_card: "medium",

  send_funds: "high",
  withdraw: "high",
  swap: "high",
  change_withdrawal_destination: "high",
  create_card: "high",
  reveal_card_details: "high",
  change_card_limits: "high",
  change_security_settings: "high",
  add_passkey: "high",
  remove_passkey: "high",
  authorize_agent_spend: "high",
  change_agent_policy: "high",
  revoke_agent: "high",
  approve_agent_transaction: "high",
  bank_transfer: "high",
  delete_account: "high",
};

/**
 * How long a successful step-up is honoured before it must be repeated.
 *
 * Short on purpose. The window exists so that a user sending three payments in
 * a row is not prompted three times; it is not a session. A longer window would
 * mean an unlocked, unattended phone stays authorized for high-risk actions.
 */
const STEP_UP_TTL_MS = 120_000;

let lastStepUpAt = 0;

/** Called on sign-out and on app-lock so the grace window never outlives them. */
export function clearStepUp(): void {
  lastStepUpAt = 0;
}

export interface StepUpOptions {
  /**
   * Force a prompt even if a recent one would otherwise be honoured.
   *
   * Set for anything that changes the security controls THEMSELVES — an
   * attacker who got one prompt through should not be able to ride its grace
   * window into removing the passkey that would have stopped them.
   */
  force?: boolean;
  /** Shown in the OS prompt. Say what is being authorized, with the amount. */
  reason: string;
}

export type StepUpResult =
  | { ok: true }
  | { ok: false; reason: "rejected" | "no_device_lock" };

/** Actions that must never ride an existing grace window. */
const ALWAYS_PROMPT = new Set<RiskAction>([
  "change_security_settings",
  "add_passkey",
  "remove_passkey",
  "change_withdrawal_destination",
  "reveal_card_details",
  "delete_account",
  "change_agent_policy",
  "revoke_agent",
]);

/**
 * Gate an action.
 *
 * Returns `{ ok: true }` without prompting for low/medium actions — the app
 * lock already covered those at launch. High-risk actions prompt unless a
 * non-forced one succeeded inside the TTL.
 *
 * `no_device_lock` is surfaced rather than swallowed. A device with no PIN,
 * pattern or biometric cannot prove ownership, and the caller must refuse the
 * action rather than proceed unprotected.
 */
export async function requireAuthFor(
  action: RiskAction,
  opts: StepUpOptions,
  now: number = Date.now()
): Promise<StepUpResult> {
  if (RISK[action] !== "high") return { ok: true };

  const mustPrompt = opts.force || ALWAYS_PROMPT.has(action);
  if (!mustPrompt && now - lastStepUpAt < STEP_UP_TTL_MS) return { ok: true };

  const res = await authenticateDeviceOwner(opts.reason);
  if (res.ok) {
    lastStepUpAt = now;
    return { ok: true };
  }
  return { ok: false, reason: res.reason };
}

/** For UI that wants to show a lock glyph before the user commits. */
export function needsStepUp(action: RiskAction, now: number = Date.now()): boolean {
  if (RISK[action] !== "high") return false;
  if (ALWAYS_PROMPT.has(action)) return true;
  return now - lastStepUpAt >= STEP_UP_TTL_MS;
}
