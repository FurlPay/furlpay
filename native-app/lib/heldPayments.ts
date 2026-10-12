// ---------------------------------------------------------------------------
// Held payments — agent payments the control plane stopped for a human.
//
// Server: GET  /api/control-plane/approvals       (the queue)
//         POST /api/control-plane/approvals/:id   { decision: APPROVE | DENY }
//
// THE SERVER DECIDES EVERYTHING. This module only reads what it sent and
// classifies what it answered:
//   - Amounts are shown in the major units the server computed (amountMajor).
//     When it could not compute them (an asset it does not know) the atomic
//     amount is shown as atomic, never re-scaled by a guess here.
//   - Every decision needs a fresh step-up bound to this session, and the
//     server spends it on the attempt. One ceremony, one decision.
//   - A request that never got an answer (timeout, dropped connection) may
//     still have landed. The caller refreshes the queue; it never assumes
//     either outcome.
// ---------------------------------------------------------------------------

import { ApiError, NetworkError, TimeoutError } from "./api";
import { isStepUpRequired } from "./stepUp";

export type Decision = "APPROVE" | "DENY";

export interface HeldPayment {
  id: string;
  authorizationId: string;
  approverRole: string;
  requestedAt: string;
  deadline: string | null;
  /** What the server does when nobody answers: keep holding, or deny. */
  onTimeout: "HOLD" | "DENY";
  payment: {
    phase: string;
    amount: string;
    amountMajor: string | null;
    asset: string;
    currency: string | null;
    network: string | null;
    rail: string | null;
    recipientId: string | null;
    recipientDestination: string | null;
    merchantDomain: string | null;
    agentId: string | null;
    mandateId: string | null;
    reason: string | null;
  };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/**
 * Validate the queue response. An entry missing what a person needs to judge
 * the payment (id, amount, asset) is dropped rather than shown half-empty: an
 * approval card with no amount is one nobody should be asked to tap.
 */
export function parseQueue(raw: unknown): HeldPayment[] {
  const list = (raw as { approvals?: unknown } | null)?.approvals;
  if (!Array.isArray(list)) return [];
  const out: HeldPayment[] = [];
  for (const item of list) {
    const a = item as Record<string, unknown>;
    const p = (a?.payment ?? {}) as Record<string, unknown>;
    const id = str(a?.id);
    const authorizationId = str(a?.authorizationId);
    const amount = str(p.amount);
    const asset = str(p.asset);
    if (!id || !authorizationId || !amount || !/^\d+$/.test(amount) || !asset) continue;
    out.push({
      id,
      authorizationId,
      approverRole: str(a.approverRole) ?? "approver",
      requestedAt: str(a.requestedAt) ?? "",
      deadline: str(a.deadline),
      onTimeout: a.onTimeout === "HOLD" ? "HOLD" : "DENY",
      payment: {
        phase: str(p.phase) ?? "PENDING_APPROVAL",
        amount,
        amountMajor: str(p.amountMajor),
        asset,
        currency: str(p.currency),
        network: str(p.network),
        rail: str(p.rail),
        recipientId: str(p.recipientId),
        recipientDestination: str(p.recipientDestination),
        merchantDomain: str(p.merchantDomain),
        agentId: str(p.agentId),
        mandateId: str(p.mandateId),
        reason: str(p.reason),
      },
    });
  }
  return out;
}

/** "1,250.50 USDC", or "1250500000 atomic units (FOO)" when the server had no scale. */
export function amountLabel(p: HeldPayment["payment"]): string {
  if (p.amountMajor === null) return `${p.amount} atomic units (${p.asset})`;
  const [whole, fraction = ""] = p.amountMajor.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  // Trim trailing zeros past the cents; never round — this is display of an
  // exact server amount, and rounding would show a number nobody authorized.
  let shown = fraction.replace(/0+$/, "");
  if (shown.length < 2) shown = fraction.slice(0, 2);
  return `${grouped}${shown ? `.${shown}` : ""} ${p.asset}`;
}

/** Who gets the money, in the most specific form the server gave. */
export function payeeLabel(p: HeldPayment["payment"]): string {
  return p.recipientDestination ?? p.merchantDomain ?? p.recipientId ?? "Unknown recipient";
}

/** Seconds until the deadline; null when the server sent none. */
export function secondsLeft(deadline: string | null, now = Date.now()): number | null {
  if (!deadline) return null;
  const t = Date.parse(deadline);
  return Number.isFinite(t) ? Math.max(0, Math.floor((t - now) / 1000)) : null;
}

export type DecideFailure =
  /** Re-verify, then decide again. Nothing changed server-side. */
  | { kind: "step_up" }
  /** Someone or something already settled it, or it can no longer be decided. */
  | { kind: "conflict"; message: string }
  /** No answer. It may have been decided. Refresh before doing anything else. */
  | { kind: "uncertain"; message: string }
  | { kind: "failed"; message: string };

const CONFLICT_MESSAGES: Record<string, string> = {
  already_decided: "This payment was already decided.",
  not_awaiting_approval: "This payment is no longer waiting for approval.",
  approval_timed_out: "The approval window closed. The payment was not released.",
  phase_changed: "The payment changed while you were reviewing it. Review it again.",
};

export function classifyDecideError(e: unknown): DecideFailure {
  if (isStepUpRequired(e)) return { kind: "step_up" };
  if (e instanceof TimeoutError || e instanceof NetworkError) {
    return {
      kind: "uncertain",
      message: "No answer from FurlPay. The decision may have gone through, so the list was refreshed.",
    };
  }
  if (e instanceof ApiError) {
    const code = (e.data as { error?: string } | null)?.error ?? "";
    if (e.status === 409) {
      return { kind: "conflict", message: CONFLICT_MESSAGES[code] ?? "This payment can no longer be decided." };
    }
    if (e.status === 404) return { kind: "conflict", message: "This approval no longer exists." };
    const server = (e.data as { message?: string } | null)?.message;
    return { kind: "failed", message: server ?? e.message };
  }
  return { kind: "failed", message: (e as Error)?.message ?? "Something went wrong." };
}

/** Empty-state copy for a queue that could not be read, by the server's code. */
export function queueUnavailable(e: unknown): { title: string; subtitle: string } {
  const data = e instanceof ApiError ? (e.data as { error?: string; message?: string } | null) : null;
  switch (data?.error) {
    case "no_organization":
      return {
        title: "No organization",
        subtitle: "Held payments belong to a FurlPay organization. This account does not own one.",
      };
    case "organization_inactive":
      return { title: "Organization inactive", subtitle: data.message ?? "This organization is not active." };
    case "control_plane_unavailable":
      return { title: "Approvals unavailable", subtitle: "The approval service is not reachable right now." };
    default:
      return { title: "Couldn't load held payments", subtitle: (e as Error)?.message ?? "Try again." };
  }
}
