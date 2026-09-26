// Behaviour classification: what an address or a market is actually doing.
//
// Everything here is DESCRIPTIVE. "Accumulation" means we observed more value
// arriving at an address than leaving it over a window — a statement about the
// past, verifiable from the rows we hold. It is not a forecast, and the
// vocabulary is chosen to keep that distinction visible: "accumulated", not
// "bullish"; "net outflow from exchanges", not "supply shock".
//
// Confidence answers "how well-evidenced is this classification", never "how
// likely is the price to move".

import { getDb, prices, wallets, whales } from "../db/index.js";
import type { AddressCategory, ChainRow } from "../types/index.js";

export type Behavior =
  | "accumulating"
  | "distributing"
  | "cycling"
  | "routing"
  | "idle"
  | "unknown";

export interface WalletBehavior {
  chainSlug: string;
  address: string;
  label: string | null;
  category: AddressCategory;
  windowDays: number;
  inflowUsd: number;
  outflowUsd: number;
  netUsd: number;
  transfers: number;
  counterparties: number;
  behavior: Behavior;
  /** 0..100 — evidence strength, driven by sample size and flow asymmetry. */
  confidence: number;
  evidence: string[];
}

/**
 * Classify one address from its observed transfers.
 *
 * The "cycling" class matters: an address whose inflow and outflow are both
 * large and nearly equal is a router or a bot, not an accumulator, and calling
 * it an accumulator because net happens to be slightly positive would be
 * actively misleading.
 */
export function classifyWallet(
  chainSlug: string,
  address: string,
  windowDays = 7,
): WalletBehavior {
  const since = Date.now() - windowDays * 86_400_000;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT amount_usd, from_address, to_address FROM whale_transactions
       WHERE chain_slug=? AND ts>=? AND (lower(from_address)=lower(?) OR lower(to_address)=lower(?))`,
    )
    .all(chainSlug, since, address, address) as Array<{
    amount_usd: number;
    from_address: string;
    to_address: string;
  }>;

  const w = wallets.get(chainSlug, address);
  let inflow = 0;
  let outflow = 0;
  const peers = new Set<string>();
  for (const r of rows) {
    const isIn = r.to_address.toLowerCase() === address.toLowerCase();
    if (isIn) {
      inflow += r.amount_usd;
      peers.add(r.from_address.toLowerCase());
    } else {
      outflow += r.amount_usd;
      peers.add(r.to_address.toLowerCase());
    }
  }
  const net = inflow - outflow;
  const gross = inflow + outflow;

  let behavior: Behavior = "unknown";
  const evidence: string[] = [];

  if (rows.length === 0) {
    behavior = "idle";
    evidence.push(`no transfers above threshold in ${windowDays}d`);
  } else if (gross > 0) {
    const asymmetry = Math.abs(net) / gross; // 0 = perfectly balanced
    if (asymmetry < 0.15) {
      // Money in ≈ money out: a conduit, not a holder.
      behavior = w?.category === "dex" || w?.category === "bridge" ? "routing" : "cycling";
      evidence.push(
        `inflow and outflow within ${(asymmetry * 100).toFixed(0)}% of each other — value passes through rather than settling`,
      );
    } else if (net > 0) {
      behavior = "accumulating";
      evidence.push(`net +$${fmt(net)} received over ${windowDays}d across ${rows.length} transfers`);
    } else {
      behavior = "distributing";
      evidence.push(`net -$${fmt(-net)} sent over ${windowDays}d across ${rows.length} transfers`);
    }
  }

  if (w?.label) evidence.push(`address is labelled: ${w.label}`);
  if (peers.size > 1) evidence.push(`${peers.size} distinct counterparties`);

  // Confidence rises with sample size and flow asymmetry, and is capped low
  // when we have only one or two observations to go on.
  const sampleFactor = Math.min(1, rows.length / 8);
  const asymFactor = gross > 0 ? Math.min(1, Math.abs(net) / gross / 0.5) : 0;
  const confidence =
    behavior === "idle" || behavior === "unknown"
      ? 0
      : Math.round(Math.min(95, 25 + sampleFactor * 45 + asymFactor * 30));

  return {
    chainSlug,
    address,
    label: w?.label ?? null,
    category: w?.category ?? "unknown",
    windowDays,
    inflowUsd: inflow,
    outflowUsd: outflow,
    netUsd: net,
    transfers: rows.length,
    counterparties: peers.size,
    behavior,
    confidence,
    evidence,
  };
}

/** Persist a classification so it can be trended later. */
export function saveBehavior(b: WalletBehavior): void {
  getDb()
    .prepare(
      `INSERT INTO wallet_behavior
        (chain_slug,address,window_days,inflow_usd,outflow_usd,net_usd,transfers,counterparties,classification,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(chain_slug,address,window_days) DO UPDATE SET
         inflow_usd=excluded.inflow_usd, outflow_usd=excluded.outflow_usd,
         net_usd=excluded.net_usd, transfers=excluded.transfers,
         counterparties=excluded.counterparties, classification=excluded.classification,
         updated_at=excluded.updated_at`,
    )
    .run(
      b.chainSlug, b.address, b.windowDays, b.inflowUsd, b.outflowUsd, b.netUsd,
      b.transfers, b.counterparties, b.behavior, Date.now(),
    );
}

/** Addresses with the largest net accumulation or distribution in a window. */
export function topMovers(
  chainSlug: string | null,
  windowDays: number,
  limit = 5,
): { accumulating: WalletBehavior[]; distributing: WalletBehavior[] } {
  const since = Date.now() - windowDays * 86_400_000;
  const db = getDb();
  const sql = chainSlug
    ? `SELECT chain_slug, addr FROM (
         SELECT chain_slug, from_address AS addr FROM whale_transactions WHERE chain_slug=? AND ts>=?
         UNION SELECT chain_slug, to_address AS addr FROM whale_transactions WHERE chain_slug=? AND ts>=?
       )`
    : `SELECT chain_slug, addr FROM (
         SELECT chain_slug, from_address AS addr FROM whale_transactions WHERE ts>=?
         UNION SELECT chain_slug, to_address AS addr FROM whale_transactions WHERE ts>=?
       )`;
  const rows = (
    chainSlug
      ? db.prepare(sql).all(chainSlug, since, chainSlug, since)
      : db.prepare(sql).all(since, since)
  ) as Array<{ chain_slug: string; addr: string }>;

  const classified = rows
    .map((r) => classifyWallet(r.chain_slug, r.addr, windowDays))
    // Exchanges and routers are excluded: their flow is other people's money,
    // so calling a hot wallet an "accumulator" would misattribute it.
    .filter(
      (b) =>
        b.confidence > 0 &&
        b.behavior !== "cycling" &&
        b.behavior !== "routing" &&
        b.category !== "cex" &&
        b.category !== "exchange" &&
        b.category !== "dex" &&
        b.category !== "burn",
    );

  return {
    accumulating: classified
      .filter((b) => b.behavior === "accumulating")
      .sort((a, b) => b.netUsd - a.netUsd)
      .slice(0, limit),
    distributing: classified
      .filter((b) => b.behavior === "distributing")
      .sort((a, b) => a.netUsd - b.netUsd)
      .slice(0, limit),
  };
}

/* ------------------------------------------------------------------ */
/* Exchange pressure                                                   */
/* ------------------------------------------------------------------ */

export interface ExchangePressure {
  chainSlug: string;
  inflowUsd: number;
  outflowUsd: number;
  netUsd: number;
  /** Positive = net leaving exchanges. */
  direction: "outflow" | "inflow" | "balanced";
  /** How far this window sits from the chain's own recent baseline. */
  deviation: number | null;
  baselineNetUsd: number | null;
  sampleDays: number;
  confidence: number;
  evidence: string[];
}

/**
 * Exchange flow for one chain, with a baseline so a reader can tell a normal
 * day from an unusual one. Deviation is null until enough history exists —
 * quoting a multiple against a one-day baseline would be noise dressed as
 * signal.
 */
export function exchangePressure(
  chain: ChainRow,
  windowHours = 24,
  baselineDays = 7,
): ExchangePressure {
  const now = Date.now();
  const windowMs = windowHours * 3_600_000;
  const current = whales.exchangeFlow(chain.slug, now - windowMs);
  const net = current.outUsd - current.inUsd;

  // Baseline: same-length windows across the preceding period.
  const db = getDb();
  const baselineStart = now - baselineDays * 86_400_000;
  const hist = db
    .prepare(
      `SELECT event_type, amount_usd, ts FROM whale_transactions
       WHERE chain_slug=? AND ts>=? AND ts < ?
         AND event_type IN ('exchange_deposit','exchange_withdrawal')`,
    )
    .all(chain.slug, baselineStart, now - windowMs) as Array<{
    event_type: string;
    amount_usd: number;
    ts: number;
  }>;

  let baselineNet: number | null = null;
  let deviation: number | null = null;
  const spanMs = now - windowMs - baselineStart;
  const windows = spanMs / windowMs;
  if (hist.length >= 5 && windows >= 2) {
    let hIn = 0;
    let hOut = 0;
    for (const h of hist) {
      if (h.event_type === "exchange_deposit") hIn += h.amount_usd;
      else hOut += h.amount_usd;
    }
    baselineNet = (hOut - hIn) / windows;
    const scale = Math.max(Math.abs(baselineNet), 1);
    deviation = Math.round(((net - baselineNet) / scale) * 10) / 10;
  }

  const evidence: string[] = [];
  const total = current.inUsd + current.outUsd;
  if (total === 0) {
    evidence.push("no transfers touched a labelled exchange address in this window");
  } else {
    evidence.push(
      `$${fmt(current.outUsd)} withdrawn from, $${fmt(current.inUsd)} deposited to labelled exchange addresses`,
    );
  }
  if (baselineNet === null) {
    evidence.push(
      `baseline not established yet — needs at least 5 exchange transfers over ${baselineDays}d`,
    );
  } else {
    evidence.push(`${baselineDays}d baseline net is $${fmt(baselineNet)} per ${windowHours}h`);
  }

  // Coverage is the honest limiter: we only see flow through addresses we have
  // labelled, so a small label set means low confidence regardless of volume.
  const labelled = wallets.byCategory(chain.slug, "cex", 500).length;
  const labelFactor = Math.min(1, labelled / 10);
  const sampleFactor = Math.min(1, (hist.length + 1) / 20);
  const confidence =
    total === 0 ? 0 : Math.round(Math.min(90, 20 + labelFactor * 40 + sampleFactor * 30));

  return {
    chainSlug: chain.slug,
    inflowUsd: current.inUsd,
    outflowUsd: current.outUsd,
    netUsd: net,
    direction: total === 0 ? "balanced" : net > 0 ? "outflow" : net < 0 ? "inflow" : "balanced",
    deviation,
    baselineNetUsd: baselineNet,
    sampleDays: baselineDays,
    confidence,
    evidence,
  };
}

function fmt(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

export { fmt as formatUsdShort };
export { prices };
