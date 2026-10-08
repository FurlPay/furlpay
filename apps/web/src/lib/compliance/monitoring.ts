// ---------------------------------------------------------------------------
// Transaction monitoring — deterministic rule engine (pure).
//
// Input is the account's own ledger rows (UserAccount.transactions, the same
// source /api/settlement/transactions reads). There is no second ledger: the
// engine only READS transactions and emits alerts; it never changes a balance or
// holds a payment. An alert becomes a compliance case; any hold goes through the
// existing payment controls.
//
// Rules are versioned constants. A threshold change is a code change, reviewed
// and approved in a pull request — that review is the approval record. Rules
// that need data the ledger does not record (counterparty address, country,
// counterparty screening) are declared but DISABLED with the missing field
// named, so nothing appears to be monitored that is not.
//
// Every alert has a stable key (rule@version + the transactions or window it
// covers), so evaluating the same history twice produces the same alerts and
// the case store opens each one once.
// ---------------------------------------------------------------------------

export type MonitoredTx = {
  id: string;
  direction: "in" | "out";
  amountUsd: number;
  status: string;
  timestamp: string;
  category?: string;
  chain?: string;
};

export type RuleSeverity = "low" | "medium" | "high" | "critical";

export type MonitoringRule = {
  id: string;
  name: string;
  description: string;
  version: number;
  enabled: boolean;
  severity: RuleSeverity;
  action: "open_case";
  params: Record<string, number>;
  /** Why the rule cannot run, when disabled. */
  disabledReason?: string;
};

export const RULES: readonly MonitoringRule[] = [
  { id: "high_value", name: "High-value transaction", description: "A single settled or pending transaction at or above the threshold.", version: 1, enabled: true, severity: "high", action: "open_case", params: { thresholdUsd: 10_000 } },
  { id: "velocity", name: "Velocity", description: "Count or value of transactions in a rolling window above the limit.", version: 1, enabled: true, severity: "medium", action: "open_case", params: { windowHours: 24, maxCount: 20, maxValueUsd: 50_000 } },
  { id: "structuring", name: "Structuring", description: "Several transactions just under the high-value threshold within a window.", version: 1, enabled: true, severity: "high", action: "open_case", params: { windowHours: 72, minCount: 3, lowerPct: 80, thresholdUsd: 10_000 } },
  { id: "failed_anomaly", name: "Repeated failures", description: "Many declined transactions in a short window.", version: 1, enabled: true, severity: "medium", action: "open_case", params: { windowHours: 1, minCount: 5 } },
  { id: "new_wallet_exposure", name: "New-wallet exposure", description: "High-value transfer to a recently first-seen wallet.", version: 1, enabled: false, severity: "high", action: "open_case", params: { newWithinDays: 7, thresholdUsd: 5_000 }, disabledReason: "Ledger rows do not record the counterparty address." },
  { id: "geographic_risk", name: "Geographic risk", description: "Counterparty in a FATF high-risk jurisdiction.", version: 1, enabled: false, severity: "high", action: "open_case", params: {}, disabledReason: "Ledger rows do not record the counterparty country." },
  { id: "counterparty_risk", name: "Counterparty risk", description: "Counterparty with an adverse screening result.", version: 1, enabled: false, severity: "critical", action: "open_case", params: {}, disabledReason: "Ledger rows do not link to a counterparty screening result." },
];

export type MonitoringAlert = {
  key: string;
  ruleId: string;
  ruleVersion: number;
  severity: RuleSeverity;
  title: string;
  explanation: string;
  transactionIds: string[];
  /** Total USD across the transactions involved. */
  amountUsd: number;
  at: string;
};

const LIVE = new Set(["settled", "pending", "escrow"]);
const H = 3_600_000;

function clean(rows: readonly MonitoredTx[]): MonitoredTx[] {
  return rows
    .filter((t) => typeof t.id === "string" && Number.isFinite(t.amountUsd) && t.amountUsd >= 0 && Number.isFinite(Date.parse(t.timestamp)))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || (a.id < b.id ? -1 : 1));
}

/** The earliest window [start, start+windowHours) per start transaction that breaches; one alert per breaching cluster. */
function windows(rows: MonitoredTx[], windowHours: number, breach: (w: MonitoredTx[]) => boolean): MonitoredTx[][] {
  const out: MonitoredTx[][] = [];
  let i = 0;
  while (i < rows.length) {
    const start = Date.parse(rows[i].timestamp);
    const w = rows.filter((t, j) => j >= i && Date.parse(t.timestamp) < start + windowHours * H);
    if (breach(w)) {
      out.push(w);
      i += w.length; // the next alert starts after this cluster — no overlapping duplicates
    } else i++;
  }
  return out;
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const sum = (w: MonitoredTx[]) => Math.round(w.reduce((s, t) => s + t.amountUsd, 0) * 100) / 100;

export function evaluate(subjectId: string, input: readonly MonitoredTx[], rules: readonly MonitoringRule[] = RULES): MonitoringAlert[] {
  const rows = clean(input);
  const live = rows.filter((t) => LIVE.has(t.status));
  const alerts: MonitoringAlert[] = [];
  const add = (r: MonitoringRule, w: MonitoredTx[], title: string, explanation: string) =>
    alerts.push({ key: `monitoring:${subjectId}:${r.id}@v${r.version}:${w.map((t) => t.id).join("+")}`, ruleId: r.id, ruleVersion: r.version, severity: r.severity, title, explanation, transactionIds: w.map((t) => t.id), amountUsd: sum(w), at: w[w.length - 1].timestamp });

  for (const r of rules) {
    if (!r.enabled) continue;
    const p = r.params;
    switch (r.id) {
      case "high_value":
        for (const t of live) if (t.amountUsd >= p.thresholdUsd) add(r, [t], `High-value ${t.direction === "in" ? "receipt" : "payment"} ${usd(t.amountUsd)}`, `${usd(t.amountUsd)} ≥ threshold ${usd(p.thresholdUsd)} (rule ${r.id} v${r.version}).`);
        break;
      case "velocity":
        for (const w of windows(live, p.windowHours, (w) => w.length > p.maxCount || sum(w) > p.maxValueUsd))
          add(r, w, `Velocity: ${w.length} transactions, ${usd(sum(w))} in ${p.windowHours}h`, `${w.length} transactions (limit ${p.maxCount}) totalling ${usd(sum(w))} (limit ${usd(p.maxValueUsd)}) within ${p.windowHours}h (rule ${r.id} v${r.version}).`);
        break;
      case "structuring": {
        const near = live.filter((t) => t.amountUsd >= (p.thresholdUsd * p.lowerPct) / 100 && t.amountUsd < p.thresholdUsd);
        for (const w of windows(near, p.windowHours, (w) => w.length >= p.minCount))
          add(r, w, `Possible structuring: ${w.length} transactions just under ${usd(p.thresholdUsd)}`, `${w.length} transactions between ${usd((p.thresholdUsd * p.lowerPct) / 100)} and ${usd(p.thresholdUsd)} within ${p.windowHours}h (rule ${r.id} v${r.version}).`);
        break;
      }
      case "failed_anomaly": {
        const failed = rows.filter((t) => t.status === "declined");
        for (const w of windows(failed, p.windowHours, (w) => w.length >= p.minCount))
          add(r, w, `${w.length} declined transactions in ${p.windowHours}h`, `${w.length} declined transactions (threshold ${p.minCount}) within ${p.windowHours}h (rule ${r.id} v${r.version}).`);
        break;
      }
    }
  }
  return alerts;
}

/** Restrict a history to a [from, to) window for back-testing. */
export function inWindow(rows: readonly MonitoredTx[], from?: string, to?: string): MonitoredTx[] {
  const f = from ? Date.parse(from) : -Infinity;
  const t = to ? Date.parse(to) : Infinity;
  return rows.filter((r) => {
    const x = Date.parse(r.timestamp);
    return x >= f && x < t;
  });
}
