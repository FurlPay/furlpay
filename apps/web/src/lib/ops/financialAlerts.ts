import { createHash } from "crypto";
import { log } from "@/lib/log";
import { deliverSecurityAlert, type DeliveryOutcome } from "@/lib/ops/alertSink";
import type { SecuritySeverity } from "@/lib/ops/events";

// ---------------------------------------------------------------------------
// Financial and platform alerts (audit P1-10). The catalog from the audit,
// wired to the signed alert sink (lib/ops/alertSink.ts). Each kind has a
// routing class:
//
//   page    — someone must look now (money may be wrong, or will be)
//   ticket  — degraded, needs attention within the day
//   notify  — informational, every occurrence recorded (admin actions)
//
// NOTHING SENSITIVE LEAVES THE PROCESS. Context is scrubbed before delivery:
// keys that could carry secrets or personal data are dropped, emails masked,
// long values truncated. A raising site passes identifiers (provider, event id,
// user id), never payloads.
//
// NEVER THROWS, NEVER BLOCKS the path that raised it: the alert is dispatched
// asynchronously and a delivery failure is logged, not propagated.
// ---------------------------------------------------------------------------

export type AlertRoute = "page" | "ticket" | "notify";

export const FINANCIAL_ALERTS = {
  webhook_ack_failed: { route: "page", severity: "high", title: "Webhook acknowledgement failed after a successful handler" },
  webhook_failed_stale: { route: "page", severity: "high", title: "Webhook event stuck in failed state" },
  webhook_payload_mismatch: { route: "page", severity: "critical", title: "Same webhook event id delivered with a different body (possible forgery)" },
  webhook_5xx_rate: { route: "page", severity: "high", title: "Webhook 5xx rate above threshold" },
  account_flush_failed: { route: "page", severity: "high", title: "Account snapshot flush failed" },
  financial_effect_failed: { route: "page", severity: "critical", title: "A financial effect was refused by the database" },
  ledger_imbalance: { route: "page", severity: "critical", title: "Ledger does not balance / disagrees with provider" },
  origin_misconfigured: { route: "page", severity: "critical", title: "Origin verification misconfigured — serving 503" },
  cron_dlq: { route: "page", severity: "high", title: "Scheduled job dead-lettered" },
  recipient_lookup_failed: { route: "ticket", severity: "medium", title: "Deposit recipient lookup failed (provider will retry)" },
  onchain_ledger_mismatch: { route: "ticket", severity: "high", title: "On-chain activity disagrees with the ledger (reconciliation required)" },
  kms_signing_refused: { route: "ticket", severity: "medium", title: "KMS refused to sign" },
  rpc_failure: { route: "ticket", severity: "medium", title: "Chain RPC failures above threshold" },
  kyc_provider_failure: { route: "ticket", severity: "medium", title: "KYC provider failures above threshold" },
  auth_anomaly: { route: "ticket", severity: "medium", title: "Authentication anomaly" },
  admin_action: { route: "notify", severity: "high", title: "Privileged (admin) action" },
} as const satisfies Record<string, { route: AlertRoute; severity: SecuritySeverity; title: string }>;

export type FinancialAlertKind = keyof typeof FINANCIAL_ALERTS;

const DROP_KEY = /secret|token|password|passwd|mnemonic|seed|private|priv_?key|api_?key|authorization|cookie|jwt|session|signature|pan\b|card_?number|cvv|otp|totp|ssn|passport|iban|account_?number/i;
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const LONG_HEX = /\b0x[0-9a-fA-F]{64,}\b/g; // raw signatures / key material

export function scrubAlertContext(ctx: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (DROP_KEY.test(k)) continue;
    if (v === undefined || v === null) continue;
    let s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "[object]";
    s = s.replace(EMAIL, "$1***@$2").replace(LONG_HEX, "0x[redacted]");
    out[k] = s.length > 200 ? `${s.slice(0, 200)}…` : s;
  }
  return out;
}

/** Deterministic per (kind, context, minute): one incident, one page. */
function alertId(kind: string, ctx: Record<string, string>, now: Date): string {
  const minute = now.toISOString().slice(0, 16);
  return createHash("sha256").update(`${kind}|${JSON.stringify(ctx)}|${minute}`).digest("hex").slice(0, 32);
}

export function buildFinancialAlert(kind: FinancialAlertKind, ctx: Record<string, unknown>, now = new Date()) {
  const def = FINANCIAL_ALERTS[kind];
  const clean = scrubAlertContext(ctx);
  const detail = `[${def.route}] ${def.title}${Object.keys(clean).length ? " — " + Object.entries(clean).map(([k, v]) => `${k}=${v}`).join(" ") : ""}`;
  return {
    id: alertId(kind, clean, now),
    kind: `financial.${kind}`,
    severity: def.severity as SecuritySeverity,
    detail,
    actor: typeof clean.userId === "string" ? clean.userId : "system",
    ts: now.toISOString(),
  };
}

/** Fire-and-forget. Returns the delivery promise for tests; callers ignore it. */
export function raiseFinancialAlert(kind: FinancialAlertKind, ctx: Record<string, unknown> = {}): Promise<DeliveryOutcome | undefined> {
  let alert;
  try {
    alert = buildFinancialAlert(kind, ctx);
  } catch (e) {
    log.error("financial alert could not be built", { kind, error: (e as Error).message });
    return Promise.resolve(undefined);
  }
  log.error(`ALERT ${alert.kind}`, { route: FINANCIAL_ALERTS[kind].route, detail: alert.detail });
  return deliverSecurityAlert(alert).catch((e: Error) => {
    log.error("financial alert delivery threw", { kind, error: e.message });
    return undefined;
  });
}
