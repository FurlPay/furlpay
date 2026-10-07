import { sbRpc, supabaseBackend } from "@/lib/supabase";
import { alliumKeyConfigured, alliumQuery } from "@/lib/onchain/allium";
import { touchSource } from "@/lib/onchain/ingest";

// ---------------------------------------------------------------------------
// Continuous refresh of the tokenized-assets dataset.
//
// The CSV export (scripts/data/import-rwa-snapshot.mjs) is the BOOTSTRAP: one
// immutable historical snapshot. From then on, today's snapshot is replaced
// from the saved Allium Explorer query named by ALLIUM_RWA_QUERY_ID (same
// seven columns as the CSV), via rwa_replace_snapshot (migration 0033): one
// transaction, today's UTC date only, history never rewritten, a date owned
// by another source never overwritten. The latest snapshot therefore moves
// forward daily while every earlier one stays queryable by date.
//
// Cadence: the daily cron (with onchain reconciliation) and the admin
// POST /api/ops/onchain/sync {kind:"rwa"}. Allium's Explorer re-runs a stale
// saved query on read (lib/onchain/allium.ts), so a daily call keeps it fresh.
// ---------------------------------------------------------------------------

export const RWA_REFRESH_SOURCE = "allium_query";

/** Same rules as scripts/data/rwa-csv.mjs normalizeMoney (parity is tested). */
export function normalizeMoney(raw: string): string | null {
  const s = raw.trim();
  let int: string, frac: string;
  const exp = /^(\d+)(?:\.(\d+))?e([-+]?\d+)$/i.exec(s);
  if (exp) {
    const digits = exp[1] + (exp[2] ?? "");
    const point = exp[1].length + Number(exp[3]);
    if (point <= 0) {
      int = "0";
      frac = "0".repeat(-point) + digits;
    } else if (point >= digits.length) {
      int = digits + "0".repeat(point - digits.length);
      frac = "";
    } else {
      int = digits.slice(0, point);
      frac = digits.slice(point);
    }
  } else if (/^\d{1,22}(\.\d{1,30})?$/.test(s)) {
    const parts = s.split(".");
    int = parts[0];
    frac = parts[1] ?? "";
  } else return null;
  int = int.replace(/^0+(?=\d)/, "") || "0";
  if (int.length > 22) return null;
  if (frac.length > 8) {
    const up = Number(frac[8]) >= 5;
    const keep = BigInt(int + frac.slice(0, 8)) + (up ? 1n : 0n);
    const str = keep.toString().padStart(9, "0");
    int = str.slice(0, -8).replace(/^0+(?=\d)/, "") || "0";
    frac = str.slice(-8);
  }
  frac = frac.replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

export interface RwaRefreshReport {
  status: "ok" | "not_configured" | "failed";
  reason?: string;
  snapshot?: string;
  rows?: number;
  changed?: number;
  removed?: number;
  totalUsd?: string;
}

export async function refreshRwaSnapshot(now = Date.now()): Promise<RwaRefreshReport> {
  if (!alliumKeyConfigured() || !(process.env.ALLIUM_RWA_QUERY_ID ?? "").trim()) {
    return { status: "not_configured", reason: "Set ALLIUM_API_KEY and ALLIUM_RWA_QUERY_ID to refresh tokenized assets daily." };
  }
  if (supabaseBackend !== "supabase") return { status: "not_configured", reason: "No durable store configured." };
  const q = await alliumQuery("rwaAssets", now);
  if (q.status !== "ok") {
    await touchSource("allium:rwa", false, { error: q.reason });
    return { status: "failed", reason: q.reason };
  }
  // Validate every row before writing anything (all-or-nothing, as the CSV path).
  const seen = new Set<string>();
  const rows = [];
  for (const r of q.data) {
    const money = normalizeMoney(r.market_cap_usd);
    const key = `${r.chain}|${r.product_name}|${r.token_symbol}`;
    if (money === null || seen.has(key)) {
      await touchSource("allium:rwa", false, { error: money === null ? "invalid market_cap_usd" : "duplicate (chain, product, symbol)" });
      return { status: "failed", reason: money === null ? `Invalid market_cap_usd "${r.market_cap_usd}" for ${r.product_name}; nothing written.` : `Duplicate ${key}; nothing written.` };
    }
    seen.add(key);
    rows.push({ ...r, market_cap_usd: money });
  }
  if (rows.length === 0) return { status: "failed", reason: "The Allium tokenized-assets query returned no rows; nothing written." };
  const snapshot = new Date(now).toISOString().slice(0, 10);
  try {
    const r = await sbRpc<{ inserted_or_changed: number; removed: number; rows: number; total_usd: string }>("rwa_replace_snapshot", { p_snapshot: snapshot, p_source: RWA_REFRESH_SOURCE, p_rows: rows });
    await touchSource("allium:rwa", true, { dataAt: q.asOf });
    return { status: "ok", snapshot, rows: r.rows, changed: r.inserted_or_changed, removed: r.removed, totalUsd: r.total_usd };
  } catch (e) {
    const reason = e instanceof Error ? e.message.slice(0, 200) : "refresh failed";
    await touchSource("allium:rwa", false, { error: reason });
    return { status: "failed", reason };
  }
}
