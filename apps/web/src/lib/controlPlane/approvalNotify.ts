import { atomicToMajor, decimalsFor } from "@furlpay/control-plane";
import { log } from "@/lib/log";
import { sendPushToUser } from "@/lib/push";
import { sbSelect } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Tell the person who can decide that a payment is waiting on them.
//
// Without this the phone and the extension only learn about a hold by polling,
// and an approval with onTimeout DENY can expire unseen.
//
// WHAT THE PUSH CARRIES. The amount and asset, nothing else: no recipient
// address, no agent, no reason. A notification is readable on a lock screen
// and is stored by the platform's push service; the address is exactly the
// detail a person must check on a screen that has authenticated them, so it
// stays behind the review sheet.
//
// WHAT THE PUSH CANNOT DO. Open the queue. Tapping it navigates; the decision
// still needs a fresh step-up on that device's session.
//
// FAILS SOFT. A push outage must never fail or delay an authorization, which
// is already durably recorded when this runs.
// ---------------------------------------------------------------------------

/** Where the web dashboard reviews held payments. */
export const HELD_PAYMENTS_URL = "/settlement/payouts/approvals";

/** Native routing key (native-app/lib/push.ts routeFor). */
export const HELD_PAYMENT_PUSH_KIND = "control-plane-approval";

export interface HeldPaymentNotice {
  organizationId: string;
  approvalId: string;
  amountAtomic: string;
  asset: string;
}

/** Push copy, kept pure for tests. */
export function heldPaymentPush(n: HeldPaymentNotice) {
  const decimals = decimalsFor(n.asset);
  let amount: string;
  try {
    amount = decimals === null ? `${n.amountAtomic} atomic units of ${n.asset}` : `${trimMajor(atomicToMajor(n.amountAtomic, decimals))} ${n.asset}`;
  } catch {
    amount = n.asset;
  }
  return {
    title: "Payment waiting for your approval",
    body: `An agent payment of ${amount} is on hold until you review it.`,
    url: HELD_PAYMENTS_URL,
    tag: n.approvalId,
    data: { kind: HELD_PAYMENT_PUSH_KIND, approvalId: n.approvalId },
  };
}

/** "1250.500000" → "1250.50": trailing zeros past the cents, never rounded. */
function trimMajor(major: string): string {
  const [whole = "", fraction = ""] = major.split(".");
  let shown = fraction.replace(/0+$/, "");
  if (shown.length < 2) shown = fraction.slice(0, 2);
  return shown ? `${whole}.${shown}` : whole;
}

export async function notifyApprovalHeld(n: HeldPaymentNotice): Promise<void> {
  try {
    const rows = await sbSelect<{ owner_user_id: string }>(
      "cp_organizations",
      `id=eq.${encodeURIComponent(n.organizationId)}&select=owner_user_id&limit=1`
    );
    const owner = rows[0]?.owner_user_id;
    if (!owner) return;
    const devices = await sendPushToUser(owner, heldPaymentPush(n));
    log.info("control-plane approval push", { approvalId: n.approvalId, devices });
  } catch (e) {
    log.warn("control-plane approval push failed", {
      approvalId: n.approvalId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
