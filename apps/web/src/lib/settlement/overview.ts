// Settlement overview metrics, derived ONLY from the authenticated account's
// ledger (balances + transactions). Pure functions: no I/O, no defaults that
// could pass for data. Anything the ledger does not record (finality, fees,
// hashes, history of balances) is absent here — the UI renders "—" for it.

export type Range = "24h" | "7d" | "30d" | "90d";
export const RANGES: Range[] = ["24h", "7d", "30d", "90d"];

export type LedgerBalance = { asset: string; network: string; amount: number; usd: number; custody: "ledger" | "fiat" };
export type LedgerTx = {
  id: string;
  category: string;
  direction: "in" | "out";
  amountUsd: number;
  status: string;
  timestamp: string;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Window length and bucket size per range. Buckets are UTC-aligned. */
const SHAPE: Record<Range, { span: number; bucket: number }> = {
  "24h": { span: DAY, bucket: HOUR },
  "7d": { span: 7 * DAY, bucket: 6 * HOUR },
  "30d": { span: 30 * DAY, bucket: DAY },
  "90d": { span: 90 * DAY, bucket: DAY },
};

const STABLECOINS = new Set(["USDC", "EURC", "USDT", "PYUSD", "XSGD", "XUSD", "USDG"]);
const round2 = (n: number) => Math.round(n * 100) / 100;
const settled = (t: LedgerTx) => t.status === "settled";
const failed = (t: LedgerTx) => t.status === "declined" || t.status === "failed";
const moving = (t: LedgerTx) => t.status === "pending" || t.status === "escrow";

export function treasury(balances: LedgerBalance[]) {
  const total = round2(balances.reduce((s, b) => s + b.usd, 0));
  const stable = balances.filter((b) => b.custody === "ledger" && STABLECOINS.has(b.asset.toUpperCase()));
  const byAsset = new Map<string, { asset: string; amount: number; usd: number; custody: LedgerBalance["custody"] }>();
  for (const b of balances) {
    const cur = byAsset.get(b.asset) ?? { asset: b.asset, amount: 0, usd: 0, custody: b.custody };
    cur.amount += b.amount;
    cur.usd += b.usd;
    byAsset.set(b.asset, cur);
  }
  const byRail = new Map<string, number>();
  for (const b of balances) {
    const rail = b.custody === "fiat" ? "bank" : b.network;
    byRail.set(rail, (byRail.get(rail) ?? 0) + b.usd);
  }
  return {
    total,
    /** On-chain stablecoin balances: the part that can settle without a bank rail. */
    stablecoinUsd: round2(stable.reduce((s, b) => s + b.usd, 0)),
    assets: [...byAsset.values()]
      .map((a) => ({ ...a, amount: round2(a.amount), usd: round2(a.usd) }))
      .sort((a, b) => b.usd - a.usd),
    rails: [...byRail.entries()]
      .map(([rail, usd]) => ({ rail, usd: round2(usd), share: total > 0 ? usd / total : 0 }))
      .sort((a, b) => b.usd - a.usd),
  };
}

export function inTransit(txs: LedgerTx[]) {
  const rows = txs.filter(moving);
  return { usd: round2(rows.reduce((s, t) => s + Math.abs(t.amountUsd), 0)), count: rows.length };
}

function windowStats(txs: LedgerTx[], from: number, to: number) {
  const inWin = txs.filter((t) => {
    const at = Date.parse(t.timestamp);
    return at >= from && at < to;
  });
  const done = inWin.filter(settled);
  const bad = inWin.filter(failed).length;
  return {
    settledUsd: round2(done.reduce((s, t) => s + Math.abs(t.amountUsd), 0)),
    settledCount: done.length,
    /** Settled ÷ (settled + failed). Null when nothing reached an outcome. */
    successRate: done.length + bad > 0 ? done.length / (done.length + bad) : null,
  };
}

const change = (cur: number | null, prev: number | null) => (cur === null || prev === null || prev === 0 ? null : (cur - prev) / prev);

export function activity(txs: LedgerTx[], range: Range, now = Date.now()) {
  const { span, bucket } = SHAPE[range];
  const end = Math.ceil(now / bucket) * bucket;
  const start = end - span;
  const series: { t: string; usd: number }[] = [];
  for (let at = start; at < end; at += bucket) series.push({ t: new Date(at).toISOString(), usd: 0 });
  for (const t of txs) {
    if (!settled(t)) continue;
    const at = Date.parse(t.timestamp);
    if (!(at >= start && at < end)) continue;
    const i = Math.floor((at - start) / bucket);
    series[i].usd = round2(series[i].usd + Math.abs(t.amountUsd));
  }
  const cur = windowStats(txs, now - span, now);
  const prev = windowStats(txs, now - 2 * span, now - span);
  return {
    range,
    bucketMs: bucket,
    series,
    settledUsd: cur.settledUsd,
    settledCount: cur.settledCount,
    successRate: cur.successRate,
    settledChange: change(cur.settledUsd, prev.settledUsd),
    successRateChange: cur.successRate !== null && prev.successRate !== null ? cur.successRate - prev.successRate : null,
  };
}

// ---- Transaction list (server-side filter + cursor pagination) -------------

export const TX_TYPES = ["all", "payins", "payouts", "settlements", "refunds"] as const;
export type TxType = (typeof TX_TYPES)[number];

/** Swaps move value between the account's own assets: an internal settlement. */
export const isInternal = (t: { category: string }) => t.category === "swap";

export function matchesType(t: LedgerTx, type: TxType) {
  switch (type) {
    case "all":
      return true;
    case "payins":
      return t.direction === "in" && !isInternal(t);
    case "payouts":
      return t.direction === "out" && !isInternal(t);
    case "settlements":
      return isInternal(t);
    case "refunds":
      // The ledger has no refund category yet; nothing is a refund until one is recorded.
      return t.category === "refund";
  }
}

export type Cursor = { ts: string; id: string };
export const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString("base64url");
export function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    return typeof c.ts === "string" && typeof c.id === "string" ? c : null;
  } catch {
    return null;
  }
}

/** Newest first; ties broken by id so the cursor is stable. */
export function page<T extends LedgerTx>(rows: T[], cursor: Cursor | null, limit: number) {
  const sorted = rows.slice().sort((a, b) => (b.timestamp === a.timestamp ? (b.id < a.id ? -1 : 1) : b.timestamp < a.timestamp ? -1 : 1));
  const after = cursor ? sorted.filter((r) => r.timestamp < cursor.ts || (r.timestamp === cursor.ts && r.id < cursor.id)) : sorted;
  const items = after.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: after.length > limit && last ? encodeCursor({ ts: last.timestamp, id: last.id }) : null, total: rows.length };
}
