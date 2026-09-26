// Market-impact scoring.
//
// The design constraint here comes straight from the literature, and it is the
// most important thing in this file:
//
//   Presto Research tested large exchange deposits against subsequent BTC, ETH
//   and SOL price action across 12 scenarios and found R² between 0.0017 and
//   0.0537 — no usable predictive power, even when narrowed to VC and market-
//   maker deposits. The Philadelphia Fed (WP 26-24) found whale alerts move
//   *participation* and *short-horizon volatility* in Bitcoin, with materially
//   different behaviour on Ethereum and WBTC.
//
// So: this module scores how *significant* an observed transfer is relative to
// the market it happened in. It does NOT forecast direction, and no function
// here returns anything resembling a buy or sell recommendation. "Impact" means
// "how much of this market did this move represent", which is measurable from
// data we already hold — not "what happens next", which is not.
//
// Every component is a ratio against an observed quantity, and each one is
// returned alongside the score so a reader can see exactly why it landed where
// it did.

import { metrics, prices, wallets, whales } from "../db/index.js";
import type { ChainRow, WhaleEvent } from "../types/index.js";

export interface ImpactComponent {
  key: string;
  label: string;
  /** 0..100 for this component. */
  score: number;
  /** Weight within the total, 0..1. */
  weight: number;
  /** Plain-language statement of the measurement behind the score. */
  basis: string;
}

export interface ImpactResult {
  score: number;
  band: "low" | "moderate" | "high" | "extreme";
  components: ImpactComponent[];
  /** How much of the score rests on data we actually had. */
  coverage: number;
}

/** Map a ratio onto 0..100 with a log curve so one huge value cannot saturate. */
function ratioScore(value: number, reference: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(reference) || reference <= 0 || value <= 0) {
    return 0;
  }
  const r = value / reference;
  // r = 1 (equal to reference) lands at 50; 10x lands near 100.
  const s = (Math.log10(1 + r * 9) / Math.log10(10)) * 50 + (r >= 1 ? 25 : 0);
  return Math.max(0, Math.min(100, s));
}

export function impactBand(score: number): ImpactResult["band"] {
  if (score >= 85) return "extreme";
  if (score >= 65) return "high";
  if (score >= 40) return "moderate";
  return "low";
}

/**
 * Score one transfer's significance.
 *
 * Components are only included when the underlying reference figure exists.
 * A missing reference lowers `coverage` rather than being silently treated as
 * zero, because "we could not measure this" and "this measured zero" are
 * different claims.
 */
export function scoreImpact(event: WhaleEvent, chain: ChainRow): ImpactResult {
  const parts: ImpactComponent[] = [];

  /* 1. Size against the asset's own 24h traded volume. -------------- */
  const q = chain.coingeckoId ? prices.get(chain.coingeckoId) : null;
  const assetQuote = prices.bySymbol(event.tokenSymbol);
  const vol24h = q?.volume24hUsd ?? null;
  if (vol24h && vol24h > 0) {
    // 1% of a day's volume in one transfer is already large.
    parts.push({
      key: "volume_share",
      label: "Share of 24h volume",
      score: ratioScore(event.amountUsd, vol24h * 0.01),
      weight: 0.3,
      basis: `${((event.amountUsd / vol24h) * 100).toFixed(3)}% of ${chain.symbol ?? event.tokenSymbol} 24h volume`,
    });
  }

  /* 2. Size against recent comparable transfers on this chain. ------ */
  const recent = whales.recent(chain.slug, 200);
  const comparable = recent
    .filter((r) => r.tokenSymbol === event.tokenSymbol && r.txHash !== event.txHash)
    .map((r) => r.amountUsd)
    .sort((a, b) => a - b);
  if (comparable.length >= 10) {
    const rank = comparable.filter((v) => v < event.amountUsd).length;
    const percentile = (rank / comparable.length) * 100;
    parts.push({
      key: "size_percentile",
      label: "Size vs recent transfers",
      score: percentile,
      weight: 0.25,
      basis: `larger than ${percentile.toFixed(0)}% of the last ${comparable.length} ${event.tokenSymbol} transfers on ${chain.name}`,
    });
  }

  /* 3. Counterparty significance. ----------------------------------- */
  const from = wallets.get(chain.slug, event.fromAddress);
  const to = wallets.get(chain.slug, event.toAddress);
  const known = [from, to].filter((w) => w?.label);
  if (known.length) {
    // A move involving a named entity is more interpretable, hence more
    // significant to a reader — not more bullish.
    const best = Math.max(...known.map((w) => (w!.confidence ?? 0.5) * 100));
    parts.push({
      key: "counterparty",
      label: "Counterparty identifiability",
      score: best,
      weight: 0.15,
      basis: known.map((w) => w!.label).join(" / "),
    });
  }

  /* 4. Chain liquidity context. ------------------------------------- */
  const m = metrics.get(chain.slug);
  if (m?.tvlUsd && m.tvlUsd > 0) {
    parts.push({
      key: "tvl_share",
      label: "Share of chain TVL",
      score: ratioScore(event.amountUsd, m.tvlUsd * 0.001),
      weight: 0.15,
      basis: `${((event.amountUsd / m.tvlUsd) * 100).toFixed(3)}% of ${chain.name} TVL`,
    });
  }

  /* 5. Clustering — is this one move or part of a run? -------------- */
  const windowMs = 60 * 60 * 1000;
  const related = recent.filter(
    (r) =>
      r.tokenSymbol === event.tokenSymbol &&
      Math.abs(r.timestamp - event.timestamp) <= windowMs &&
      (r.fromAddress === event.fromAddress || r.toAddress === event.toAddress),
  ).length;
  if (related > 0) {
    parts.push({
      key: "clustering",
      label: "Related transfers (1h)",
      score: Math.min(100, related * 20),
      weight: 0.15,
      basis: `${related} transfer${related === 1 ? "" : "s"} involving the same address within an hour`,
    });
  }

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  const score = totalWeight
    ? parts.reduce((s, p) => s + p.score * p.weight, 0) / totalWeight
    : 0;

  return {
    score: Math.round(score * 10) / 10,
    band: impactBand(score),
    components: parts,
    // Full weight available is 1.0; anything missing is uncovered.
    coverage: Math.round(totalWeight * 100),
  };
}

/**
 * The standing caveat attached to every signal surface.
 *
 * This is not boilerplate — it is the finding. Stating it next to the number
 * is what keeps the product honest, and it is short enough to actually be read.
 */
export const PREDICTIVE_CAVEAT =
  "Impact measures how large this move is relative to its market — not what price will do next. " +
  "Presto Research found large exchange deposits had R² of 0.002–0.054 against subsequent returns " +
  "across BTC, ETH and SOL, i.e. no reliable directional edge.";
