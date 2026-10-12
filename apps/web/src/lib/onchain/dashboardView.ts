// ---------------------------------------------------------------------------
// View logic for /onchain that does not need a browser. PURE.
//
//   systemStatus   the header pill, derived from every section's freshness.
//                  It says "operational" only when every CONNECTED source is
//                  healthy, and it names the sources that are not connected
//                  instead of folding them into a green light.
//   volumeLayers   raw on-chain vs FurlPay ledger volume, side by side. They
//                  measure different things over different windows and are
//                  never added together. Layers with no source say why.
//   viewParams     ?range=&chain= so a view can be shared; unknown values fall
//                  back to the defaults rather than reaching the API.
//   exportCsv /    what the page already shows, with its provenance, for
//   exportJson     download. Nothing here fetches more than the page has.
// ---------------------------------------------------------------------------

import type { Freshness, SectionFreshness } from "./freshness";
// Type-only: dashboard.ts reads Supabase and must not be bundled for the browser.
import type { ChainFilter, OnchainDashboard } from "./dashboard";

/** Same list as dashboard.ts CHAIN_FILTERS (pinned by dashboardView.spec.ts). */
export const VIEW_CHAINS: readonly ChainFilter[] = ["all", "ethereum", "base", "arbitrum", "solana", "polygon", "optimism", "avalanche"];

export type OnchainRangeKey = "24h" | "7d" | "30d" | "90d";
const RANGES: readonly OnchainRangeKey[] = ["24h", "7d", "30d", "90d"];

const SECTION_LABEL: Record<keyof OnchainDashboard["freshness"], string> = {
  ledger: "FurlPay ledger",
  risk: "Security events",
  market: "Stablecoin market",
  alliumDaily: "Allium daily activity",
  alliumChains: "Allium chain activity",
  corridors: "Allium corridors",
  holdings: "Treasury holdings",
};

const HEALTHY: ReadonlySet<Freshness> = new Set(["live", "updating", "delayed"]);

export interface SystemStatus {
  level: "operational" | "degraded" | "offline";
  label: string;
  healthy: number;
  connected: number;
  notConnected: number;
  sections: { key: string; label: string; state: Freshness; cadence: string; asOf: string | null; reason?: string }[];
}

export function systemStatus(freshness: OnchainDashboard["freshness"]): SystemStatus {
  const sections = (Object.keys(SECTION_LABEL) as (keyof typeof SECTION_LABEL)[])
    .filter((k) => freshness[k])
    .map((k) => {
      const f: SectionFreshness = freshness[k];
      return { key: k, label: SECTION_LABEL[k], state: f.state, cadence: f.cadence, asOf: f.asOf, ...(f.reason ? { reason: f.reason } : {}) };
    });
  const connected = sections.filter((s) => s.state !== "not_connected");
  const healthy = connected.filter((s) => HEALTHY.has(s.state)).length;
  const notConnected = sections.length - connected.length;
  const tail = notConnected ? ` · ${notConnected} not connected` : "";

  let level: SystemStatus["level"];
  let label: string;
  if (connected.length === 0 || healthy === 0) {
    level = "offline";
    label = connected.length === 0 ? "No sources connected" : "All connected sources offline";
  } else if (healthy === connected.length) {
    level = "operational";
    label = `All connected sources healthy${tail}`;
  } else {
    level = "degraded";
    label = `${connected.length - healthy} of ${connected.length} sources degraded${tail}`;
  }
  return { level, label, healthy, connected: connected.length, notConnected, sections };
}

export interface VolumeLayer {
  key: "raw" | "adjusted" | "ledger";
  label: string;
  /** What this layer counts, in one line. */
  measures: string;
  value: number | null;
  /** The window the value covers, which is not always the page's range. */
  window: string | null;
  source: string;
  unavailable?: string;
}

export function volumeLayers(d: OnchainDashboard): VolumeLayer[] {
  const raw: VolumeLayer =
    d.alliumDaily.status === "ok"
      ? {
          key: "raw",
          label: "Raw on-chain",
          measures: "Every stablecoin transfer, including exchange, DeFi and bot movement",
          value: d.alliumDaily.data.windowTotals.volumeUsd,
          window: `${d.alliumDaily.data.windowTotals.days} days to ${d.alliumDaily.data.latest?.day ?? "latest"}`,
          source: d.alliumDaily.source,
        }
      : {
          key: "raw",
          label: "Raw on-chain",
          measures: "Every stablecoin transfer, including exchange, DeFi and bot movement",
          value: null,
          window: null,
          source: d.alliumDaily.source,
          unavailable: d.alliumDaily.reason,
        };
  // No source on this deployment computes an adjusted or payment-classified
  // series. The card says so rather than estimating one from raw volume.
  const adjusted: VolumeLayer = {
    key: "adjusted",
    label: "Adjusted / economic",
    measures: "Transfers with bots, wash trading and intra-entity moves removed",
    value: null,
    window: null,
    source: "Allium stablecoins.metrics.volume_daily (adjusted_volume_usd)",
    unavailable: "Not ingested yet. Raw volume is not converted into an estimate.",
  };
  const ledger: VolumeLayer =
    d.ledger.status === "ok"
      ? {
          key: "ledger",
          label: "FurlPay ledger",
          measures: "Settled payments through FurlPay",
          value: d.ledger.data.kpis.volume.value,
          window: d.range.key,
          source: d.ledger.source,
        }
      : { key: "ledger", label: "FurlPay ledger", measures: "Settled payments through FurlPay", value: null, window: null, source: d.ledger.source, unavailable: d.ledger.reason };
  return [raw, adjusted, ledger];
}

export function viewParams(search: string): { range: OnchainRangeKey; chain: ChainFilter } {
  const p = new URLSearchParams(search);
  const r = p.get("range");
  const c = (p.get("chain") ?? "").toLowerCase();
  return {
    range: (RANGES as readonly string[]).includes(r ?? "") ? (r as OnchainRangeKey) : "30d",
    chain: (VIEW_CHAINS as readonly string[]).includes(c) ? (c as ChainFilter) : "all",
  };
}

/** The query string for a view; defaults are omitted so the plain URL stays plain. */
export function viewQuery(range: OnchainRangeKey, chain: string): string {
  const p = new URLSearchParams();
  if (range !== "30d") p.set("range", range);
  if (chain !== "all") p.set("chain", chain);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** RFC 4180 field. A leading = + - @ is prefixed so a spreadsheet does not run it as a formula. */
function csvField(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = (...xs: unknown[]) => xs.map(csvField).join(",");

export function exportCsv(d: OnchainDashboard): string {
  const lines: string[] = [
    row("FurlPay Onchain Intelligence export"),
    row("generated_at", d.generatedAt),
    row("range", d.range.key, d.range.from, d.range.to),
    row("chain", d.chain),
    "",
  ];
  lines.push(row("section", "metric", "value", "window", "source", "status"));
  for (const l of volumeLayers(d)) lines.push(row("volume_layer", l.label, l.value ?? "", l.window ?? "", l.source, l.unavailable ? `unavailable: ${l.unavailable}` : "ok"));
  if (d.ledger.status === "ok") {
    const k = d.ledger.data.kpis;
    for (const [name, kpi] of Object.entries(k)) lines.push(row("ledger_kpi", name, kpi.value, d.range.key, d.ledger.source, kpi.change === null ? "no prior period" : `change ${kpi.change}`));
    lines.push("", row("chain", "volume_usd", "count", "share"));
    for (const c of d.ledger.data.chains) lines.push(row(c.chain, c.volume, c.count, c.share));
    lines.push("", row("counterparty", "chain", "volume_usd", "count"));
    for (const c of d.ledger.data.counterparties) lines.push(row(c.address, c.chain ?? "", c.volume, c.count));
  } else {
    lines.push(row("ledger", "unavailable", "", "", d.ledger.source, d.ledger.reason));
  }
  lines.push("", row("source", "state", "cadence", "as_of", "reason"));
  for (const s of systemStatus(d.freshness).sections) lines.push(row(s.label, s.state, s.cadence, s.asOf ?? "", s.reason ?? ""));
  return lines.join("\r\n") + "\r\n";
}

export function exportJson(d: OnchainDashboard): string {
  return JSON.stringify({ exportedFrom: "FurlPay Onchain Intelligence", status: systemStatus(d.freshness), volumeLayers: volumeLayers(d), dashboard: d }, null, 2);
}
