// The Liquid data-access layer.
//
// This file is the ONLY place that knows Blockstream's Liquid Esplora exists.
// Everything above it consumes the normalised types at the bottom, so swapping
// in a self-hosted Elements node later means rewriting this file and nothing
// else.
//
// EVERY SCHEMA CLAIM BELOW WAS VERIFIED AGAINST LIVE RESPONSES on 2026-09-08,
// not read from documentation. What that verification established:
//
//   PEG-OUTS ARE A STRUCTURED FIELD, NOT AN INFERENCE. Esplora surfaces
//   `vout[].pegout` as an object carrying the parent-chain genesis hash and the
//   destination scriptPubKey already decoded to a Bitcoin address. Observed on
//   Liquid tx 2c350028…edb0:
//
//     vout[].pegout = {
//       genesis_hash:         "000000000019d668…60a8ce26f"   (Bitcoin mainnet)
//       scriptpubkey:         "0014ce4a25e4…"
//       scriptpubkey_asm:     "OP_0 OP_PUSHBYTES_20 ce4a…"
//       scriptpubkey_address: "bc1qee9ztepw867ufqdz8z2g93ntjfd93s9mkjmwpv"
//     }
//     value: 101569917   asset: 6f0279e9…   scriptpubkey_type: "op_return"
//
//   So "OP_RETURN means peg-out" is WRONG in both directions: peg-outs carry a
//   dedicated field, and plenty of OP_RETURN outputs are not peg-outs at all.
//   `isPegout` keys on the field, never on the script type.
//
//   PEG-OUT AMOUNTS ARE EXPLICIT. The value was readable on the peg-out output
//   while Liquid is a confidential-transaction chain. That matches the design:
//   the federation has to see the amount to authorise the withdrawal.
//
//   PEG-INS ARE A FLAG ON THE INPUT. `vin[].is_pegin === true`, with
//   `prevout: null` because the funding output lives on the other chain.
//
// WHAT WAS NOT VERIFIED, and is therefore not asserted: the field names Esplora
// uses for value and asset commitments on a confidential output. No
// confidential output was successfully retrieved before the host began
// rate-limiting. Visibility is therefore derived from whether `value` is
// PRESENT, which is correct regardless of what the commitment field is called.
//
// OPERATIONAL NOTE: there is one reachable Liquid host. blockstream.info
// throttles hard — sustained probing earned a long 429 — and liquid.network
// does not resolve from every network. Requests here are paced accordingly and
// a failure returns null rather than throwing, so a Liquid outage degrades the
// Liquid signals instead of stopping the Bitcoin pipeline.

import { RateLimiter, HttpError, withRetry, withTimeout } from "../../util/resilience.js";
import { makeLogger } from "../../util/logger.js";

const log = makeLogger("liquid-api");

/** The L-BTC asset id — Liquid's own bitcoin, not a configurable value. */
export const LBTC_ASSET_ID =
  "6f0279e9ed041c3d710a9f57d0c02928416460c4b722ae3457a11eec381c526d";

/** Bitcoin mainnet genesis hash, as it appears in a peg-out. */
export const BITCOIN_GENESIS_HASH =
  "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f";

export const DEFAULT_LIQUID_HOSTS = [
  "https://blockstream.info/liquid/api",
  // Kept as a candidate: it serves the same API but does not resolve from
  // every network, exactly like mempool.space on the Bitcoin side.
  "https://liquid.network/api",
];

export function liquidHostsFromEnv(): string[] {
  const raw = process.env.LIQUID_API_HOSTS?.trim();
  if (!raw) return DEFAULT_LIQUID_HOSTS;
  const list = raw.split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  return list.length ? list : DEFAULT_LIQUID_HOSTS;
}

/* ------------------------------------------------------------------ */
/* Raw shapes — exactly as observed                                    */
/* ------------------------------------------------------------------ */

interface RawPegout {
  genesis_hash?: string;
  scriptpubkey?: string;
  scriptpubkey_asm?: string;
  scriptpubkey_address?: string;
}

interface RawVout {
  scriptpubkey?: string;
  scriptpubkey_asm?: string;
  scriptpubkey_type?: string;
  scriptpubkey_address?: string;
  /** Absent when the output is confidential. */
  value?: number;
  /** Absent when the asset is blinded. */
  asset?: string;
  pegout?: RawPegout;
}

interface RawVin {
  txid?: string;
  vout?: number;
  is_coinbase?: boolean;
  is_pegin?: boolean;
  sequence?: number;
  prevout?: RawVout | null;
}

interface RawTx {
  txid: string;
  version?: number;
  locktime?: number;
  size?: number;
  weight?: number;
  discount_vsize?: number;
  fee?: number;
  vin: RawVin[];
  vout: RawVout[];
  status?: { confirmed: boolean; block_height?: number; block_hash?: string; block_time?: number };
}

interface RawAssetStats {
  tx_count?: number;
  peg_in_count?: number;
  peg_in_amount?: number;
  peg_out_count?: number;
  peg_out_amount?: number;
  burn_count?: number;
  burned_amount?: number;
}

/* ------------------------------------------------------------------ */
/* Normalised domain types                                             */
/* ------------------------------------------------------------------ */

/**
 * An amount that may legitimately be unreadable.
 *
 * The single most important type here. Liquid blinds amounts by design, and a
 * confidential value read as 0 would make every private transaction look like
 * it moved nothing — turning the chain's privacy feature into a silent stream
 * of false negatives. `visibility` forces every consumer to decide what to do
 * about not knowing, and the anomaly engine answers by dropping the amount
 * signal from its combination rather than scoring it zero.
 */
export interface LiquidAmount {
  /** Satoshis, or null when blinded. Never 0 as a stand-in for unknown. */
  value: bigint | null;
  visibility: "known" | "confidential" | "unknown";
}

export interface LiquidOutput {
  index: number;
  scriptType: string | null;
  address: string | null;
  amount: LiquidAmount;
  /** Asset id, or null when the asset commitment is blinded. */
  asset: string | null;
  isLbtc: boolean;
  scriptAsm: string | null;
  /** Present only on a genuine peg-out. */
  pegout: {
    genesisHash: string | null;
    /** Which parent chain this peg-out targets. */
    parentChain: "bitcoin" | "other" | "unknown";
    destinationAddress: string | null;
    destinationScript: string | null;
  } | null;
}

export interface LiquidInput {
  index: number;
  txid: string | null;
  vout: number | null;
  isCoinbase: boolean;
  /** Funds arriving from the parent chain. `prevout` is null on these. */
  isPegin: boolean;
  amount: LiquidAmount;
  address: string | null;
  asset: string | null;
}

export interface LiquidTransaction {
  txid: string;
  confirmed: boolean;
  blockHeight: number | null;
  blockTime: number | null;
  fee: number | null;
  size: number | null;
  weight: number | null;
  inputs: LiquidInput[];
  outputs: LiquidOutput[];
  /** Peg-out outputs, already filtered. Empty is the common case. */
  pegouts: LiquidOutput[];
  /** True when any input arrived from the parent chain. */
  hasPegin: boolean;
  /** Share of outputs whose amount is readable, 0..1. Feeds confidence. */
  amountVisibility: number;
}

/** Peg statistics for one asset, which is how backing is measured. */
export interface LiquidAssetStats {
  assetId: string;
  txCount: number | null;
  pegInCount: number | null;
  pegInSats: bigint | null;
  pegOutCount: number | null;
  pegOutSats: bigint | null;
  burnCount: number | null;
  burnedSats: bigint | null;
  /**
   * Supply outstanding on Liquid: pegged in, less pegged out, less burned.
   *
   * This is the figure a reserve must back. Comparing it against the bitcoin
   * actually held by the federation gives a backing ratio, and a ratio far
   * from 1 is the generic signature of an unbacked mint or a drained reserve —
   * derived from two public endpoints, with no incident-specific knowledge.
   */
  outstandingSats: bigint | null;
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

export class LiquidEsploraClient {
  private readonly limiter: RateLimiter;
  private hostIndex = 0;
  private consecutive429 = 0;
  ok = 0;
  failed = 0;

  constructor(
    private readonly hosts: string[] = liquidHostsFromEnv(),
    /** Measured: this host throttles well below one request per second. */
    rps = 0.5,
    private readonly timeoutMs = 20_000,
  ) {
    this.limiter = new RateLimiter("liquid", rps);
  }

  get host(): string {
    return this.hosts[this.hostIndex % this.hosts.length] ?? DEFAULT_LIQUID_HOSTS[0]!;
  }

  /**
   * GET, returning null on failure.
   *
   * Null rather than throwing because Liquid is an ENRICHMENT source. The
   * Bitcoin pipeline must keep running when Liquid is unreachable, with the
   * Liquid-derived signals marked unavailable — which the confidence model
   * already knows how to express.
   */
  private async get<T>(path: string, asText = false): Promise<T | null> {
    for (let attempt = 0; attempt < this.hosts.length; attempt++) {
      const base = this.host;
      try {
        await this.limiter.acquire();
        const res = await withRetry(
          async () => {
            const r = await withTimeout(
              fetch(base + path, { headers: { accept: asText ? "text/plain" : "application/json" } }),
              this.timeoutMs,
              `liquid ${path}`,
            );
            if (!r.ok) throw new HttpError(r.status, await r.text().catch(() => ""), path);
            return r;
          },
          { attempts: 2, baseMs: 3000, maxMs: 20_000 },
        );
        this.ok += 1;
        this.consecutive429 = 0;
        return (asText ? ((await res.text()).trim() as unknown as T) : ((await res.json()) as T));
      } catch (err) {
        this.failed += 1;
        const status = err instanceof HttpError ? err.status : 0;
        if (status === 429) {
          this.consecutive429 += 1;
          log.warn("liquid host throttling", { host: hostname(base), streak: this.consecutive429 });
        } else {
          log.debug("liquid request failed", {
            host: hostname(base), path, err: (err as Error).message.slice(0, 120),
          });
        }
        this.hostIndex += 1;
      }
    }
    return null;
  }

  async tipHeight(): Promise<number | null> {
    const t = await this.get<string>("/blocks/tip/height", true);
    return t !== null && /^\d+$/.test(t) ? Number(t) : null;
  }

  async tipHash(): Promise<string | null> {
    return this.get<string>("/blocks/tip/hash", true);
  }

  async blockHashAt(height: number): Promise<string | null> {
    return this.get<string>(`/block-height/${height}`, true);
  }

  async transaction(txid: string): Promise<LiquidTransaction | null> {
    const raw = await this.get<RawTx>(`/tx/${txid}`);
    return raw ? normaliseTx(raw) : null;
  }

  /** Transactions in a block, paged 25 at a time by Esplora. */
  async blockTxs(hash: string, startIndex = 0): Promise<LiquidTransaction[] | null> {
    const raw = await this.get<RawTx[]>(`/block/${hash}/txs/${startIndex}`);
    return Array.isArray(raw) ? raw.map(normaliseTx) : null;
  }

  async mempoolTxids(): Promise<string[] | null> {
    const raw = await this.get<string[]>("/mempool/txids");
    return Array.isArray(raw) ? raw : null;
  }

  /** Recent asset activity — the cheapest way to find peg-outs. */
  async assetTxs(assetId = LBTC_ASSET_ID): Promise<LiquidTransaction[] | null> {
    const raw = await this.get<RawTx[]>(`/asset/${assetId}/txs`);
    return Array.isArray(raw) ? raw.map(normaliseTx) : null;
  }

  async assetStats(assetId = LBTC_ASSET_ID): Promise<LiquidAssetStats | null> {
    const raw = await this.get<{ asset_id?: string; chain_stats?: RawAssetStats }>(`/asset/${assetId}`);
    if (!raw?.chain_stats) return null;
    return normaliseAssetStats(assetId, raw.chain_stats);
  }

  stats(): { ok: number; failed: number; host: string } {
    return { ok: this.ok, failed: this.failed, host: hostname(this.host) };
  }
}

/* ------------------------------------------------------------------ */
/* Normalisation — pure, and therefore testable without a network      */
/* ------------------------------------------------------------------ */

/**
 * Amount from a raw output.
 *
 * Presence of `value` is the test. Esplora omits it when the output is blinded,
 * and this deliberately does not depend on the name of whatever commitment
 * field appears instead — that name was never observed on a live response, so
 * asserting it would be documentation-driven guessing.
 */
export function readAmount(v: { value?: number } | null | undefined): LiquidAmount {
  if (!v) return { value: null, visibility: "unknown" };
  if (typeof v.value === "number" && Number.isFinite(v.value)) {
    return { value: BigInt(Math.round(v.value)), visibility: "known" };
  }
  return { value: null, visibility: "confidential" };
}

export function normaliseOutput(o: RawVout, index: number): LiquidOutput {
  // Peg-out identity comes from the dedicated field. An OP_RETURN without it
  // is ordinary embedded data, and a peg-out is a peg-out whatever its script
  // type happens to be.
  const pegoutRaw = o.pegout;
  const genesisHash = pegoutRaw?.genesis_hash ?? null;
  return {
    index,
    scriptType: o.scriptpubkey_type ?? null,
    address: o.scriptpubkey_address ?? null,
    amount: readAmount(o),
    asset: o.asset ?? null,
    isLbtc: o.asset === LBTC_ASSET_ID,
    scriptAsm: o.scriptpubkey_asm ?? null,
    pegout: pegoutRaw
      ? {
          genesisHash,
          parentChain:
            genesisHash === null ? "unknown"
            : genesisHash === BITCOIN_GENESIS_HASH ? "bitcoin"
            : "other",
          destinationAddress: pegoutRaw.scriptpubkey_address ?? null,
          destinationScript: pegoutRaw.scriptpubkey ?? null,
        }
      : null,
  };
}

export function normaliseInput(i: RawVin, index: number): LiquidInput {
  return {
    index,
    txid: i.txid ?? null,
    vout: typeof i.vout === "number" ? i.vout : null,
    isCoinbase: Boolean(i.is_coinbase),
    isPegin: Boolean(i.is_pegin),
    // A peg-in has no prevout on this chain, so the amount is genuinely
    // unknown here rather than confidential.
    amount: i.is_pegin && !i.prevout ? { value: null, visibility: "unknown" } : readAmount(i.prevout),
    address: i.prevout?.scriptpubkey_address ?? null,
    asset: i.prevout?.asset ?? null,
  };
}

export function normaliseTx(raw: RawTx): LiquidTransaction {
  const outputs = (raw.vout ?? []).map(normaliseOutput);
  const inputs = (raw.vin ?? []).map(normaliseInput);
  const known = outputs.filter((o) => o.amount.visibility === "known").length;
  return {
    txid: raw.txid,
    confirmed: Boolean(raw.status?.confirmed),
    blockHeight: raw.status?.block_height ?? null,
    blockTime: raw.status?.block_time ?? null,
    fee: Number.isFinite(raw.fee) ? (raw.fee as number) : null,
    size: raw.size ?? null,
    weight: raw.weight ?? null,
    inputs,
    outputs,
    pegouts: outputs.filter((o) => o.pegout !== null),
    hasPegin: inputs.some((i) => i.isPegin),
    // Feeds the confidence model directly: a transaction whose amounts are all
    // blinded supports far weaker conclusions than one where they are readable.
    amountVisibility: outputs.length ? known / outputs.length : 0,
  };
}

export function normaliseAssetStats(assetId: string, s: RawAssetStats): LiquidAssetStats {
  const big = (n: number | undefined): bigint | null =>
    typeof n === "number" && Number.isFinite(n) ? BigInt(Math.round(n)) : null;
  const pegIn = big(s.peg_in_amount);
  const pegOut = big(s.peg_out_amount);
  const burned = big(s.burned_amount);
  return {
    assetId,
    txCount: s.tx_count ?? null,
    pegInCount: s.peg_in_count ?? null,
    pegInSats: pegIn,
    pegOutCount: s.peg_out_count ?? null,
    pegOutSats: pegOut,
    burnCount: s.burn_count ?? null,
    burnedSats: burned,
    // Null unless all three components are readable — a partial subtraction
    // would produce a confident number from incomplete inputs.
    outstandingSats:
      pegIn !== null && pegOut !== null && burned !== null ? pegIn - pegOut - burned : null,
  };
}

/**
 * Backing ratio: bitcoin actually held against L-BTC outstanding.
 *
 * A fully backed peg sits at 1. Below 1 means supply exists that the reserve
 * cannot cover — the signature of an unbacked mint or a drained reserve. Above
 * 1 means bitcoin is held against supply that no longer exists, which is what
 * a return of stolen funds looks like before it is re-pegged.
 *
 * Returns null when either side is unreadable. The ratio is the finding; a
 * guess at it would be worse than no finding at all.
 */
export function backingRatio(
  heldSats: bigint | null,
  stats: LiquidAssetStats | null,
): { ratio: number; heldSats: bigint; outstandingSats: bigint } | null {
  if (heldSats === null || !stats?.outstandingSats || stats.outstandingSats <= 0n) return null;
  return {
    ratio: Number(heldSats) / Number(stats.outstandingSats),
    heldSats,
    outstandingSats: stats.outstandingSats,
  };
}

function hostname(u: string): string {
  try { return new URL(u).hostname; } catch { return u; }
}
