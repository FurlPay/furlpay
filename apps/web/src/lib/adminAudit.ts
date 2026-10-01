import { audit } from "@/lib/audit";
import { raiseFinancialAlert } from "@/lib/ops/financialAlerts";

// ---------------------------------------------------------------------------
// Admin event semantics (audit P2-10, revised).
//
// The original rule — "every request that passes requireRole('admin') is an
// audited, ANNOUNCED privileged action" — made a dashboard that polls every 15
// seconds page the on-call channel four times a minute, which teaches people to
// mute the channel that also carries the alerts that matter. Four categories
// now, each with the response its risk deserves:
//
//   ADMIN_READ            GET/HEAD/OPTIONS by an admin. Audited (who looked at
//                         what), throttled to one record per admin, path and
//                         5-minute window per instance. NOT alerted.
//   ADMIN_MUTATION        Any other method by an admin. Audited every time AND
//                         alerted (role changes, freezes, rail pauses, refunds,
//                         KYC decisions all arrive here).
//   ADMIN_AUTHORIZATION   A signed-in non-admin refused by the admin gate.
//                         Audited (throttled). Not alerted: probing a URL is
//                         common and harmless once refused.
//   ADMIN_SECURITY_EVENT  An account HOLDING the admin role that is not the
//                         bootstrap admin, or a guest token asking for admin in
//                         production. The role check refused it, but a role
//                         present where it should not be means the role store
//                         was written by something that should not have — that
//                         is alerted.
// ---------------------------------------------------------------------------

export type AdminEventCategory = "ADMIN_READ" | "ADMIN_MUTATION" | "ADMIN_AUTHORIZATION" | "ADMIN_SECURITY_EVENT";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const THROTTLE_MS = 5 * 60_000;
const MAX_MARKS = 10_000;
const marks = new Map<string, number>();

export function classifyAdminRequest(method: string): "ADMIN_READ" | "ADMIN_MUTATION" {
  return READ_METHODS.has(method.toUpperCase()) ? "ADMIN_READ" : "ADMIN_MUTATION";
}

/** true the first time a key is seen in its window (per instance). */
function firstInWindow(key: string, now: number): boolean {
  const last = marks.get(key);
  if (last !== undefined && now - last < THROTTLE_MS) return false;
  if (marks.size >= MAX_MARKS) marks.clear();
  marks.set(key, now);
  return true;
}

export function recordAdminAccess(userId: string, method: string, path: string, now = Date.now()): AdminEventCategory {
  const category = classifyAdminRequest(method);
  if (category === "ADMIN_MUTATION") {
    audit("admin.action", userId, { method, path, category });
    void raiseFinancialAlert("admin_action", { userId, method, path });
  } else if (firstInWindow(`read|${userId}|${path}`, now)) {
    audit("admin.read", userId, { method, path, category });
  }
  return category;
}

export function recordAdminDenied(
  userId: string,
  method: string,
  path: string,
  reason: "missing_role" | "role_without_bootstrap_email" | "guest_in_production",
  now = Date.now()
): AdminEventCategory {
  if (reason === "missing_role") {
    if (firstInWindow(`deny|${userId}|${path}`, now)) {
      audit("admin.access_denied", userId, { method, path, reason, category: "ADMIN_AUTHORIZATION" });
    }
    return "ADMIN_AUTHORIZATION";
  }
  audit("admin.access_denied", userId, { method, path, reason, category: "ADMIN_SECURITY_EVENT" });
  void raiseFinancialAlert("auth_anomaly", { userId, method, path, reason });
  return "ADMIN_SECURITY_EVENT";
}

export function __resetAdminAuditForTests(): void {
  marks.clear();
}
