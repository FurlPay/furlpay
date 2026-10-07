import { getChain } from "@/lib/services/chainRegistry";
import { evmRpcFor, solanaRpc } from "./balances";
import { getLogsAdaptive, nodeRpc, tokenMeta } from "./nodeIndexer";
import { formatUnits, TRANSFER_TOPIC, type RpcLog } from "./normalize";
import { assetRegistry, getAsset } from "./assets";
import { chainHealth, readIndexState, type ChainHealth } from "./usdcHealth";

// ---------------------------------------------------------------------------
// USDC, network-wide, straight from each chain's own node.
//
// Unlike the ingestion pipeline (which stores only activity touching
// addresses FurlPay tracks), this reads the WHOLE USDC contract on every
// configured chain, live, and keeps nothing:
//
//   supply   totalSupply() at the node's latest AND finalized blocks (EVM);
//            getTokenSupply at confirmed AND finalized (Solana). Exact
//            integers, formatted with the decimals the contract reports.
//   window   every USDC Transfer log in the last N seconds of blocks
//            (eth_getLogs on the USDC contract): transfer count and volume,
//            mints (from 0x0) and burns (to 0x0) — USDC's own supply events —
//            unique senders/recipients, events per second, largest transfers.
//            N seconds is converted to blocks with the block time MEASURED
//            from the node's own headers, never a table.
//
// Scope is native USDC only (the registry's `usdc.native`); bridged USDC.e is
// a different token and is not summed in. A chain with no RPC URL is reported
// as not configured; a chain whose node fails is reported unavailable with
// the reason — never as zero. Solana JSON-RPC cannot enumerate every transfer
// of a mint (that needs a Geyser stream), so its window is null with that
// reason, while its supply and slots are exact.
// ---------------------------------------------------------------------------

export const USDC_CHAINS = ["ethereum", "base", "arbitrum", "polygon", "solana"] as const;

/**
 * Chains whose last 1/5 minutes of USDC logs are scanned from the RPC on each
 * (cached) read. Explicit opt-in: on a metered RPC plan this is the most
 * expensive call the page makes, so nothing scans unless an operator says so.
 */
export function liveWindowChains(): string[] {
  return (process.env.ONCHAIN_LIVE_WINDOW_CHAINS ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}
export const WINDOWS = [60, 300] as const;
export type UsdcWindow = (typeof WINDOWS)[number];
const MAX_WINDOW_BLOCKS = 2_000;
const LARGEST = 5;
const ZERO = "0x0000000000000000000000000000000000000000";

export interface UsdcWindowStats {
  fromBlock: number;
  toBlock: number;
  /** Seconds actually covered, from the first to the last block header. */
  seconds: number;
  transfers: number;
  volume: string;
  mints: number;
  mintVolume: string;
  burns: number;
  burnVolume: string;
  /** mintVolume - burnVolume, signed. */
  netSupplyChange: string;
  uniqueSenders: number;
  uniqueRecipients: number;
  activeAddresses: number;
  eventsPerSecond: number | null;
  largest: { txHash: string; block: number; from: string; to: string; amount: string }[];
}

export interface UsdcChain {
  chain: string;
  status: "ok" | "unavailable" | "not_configured";
  reason: string | null;
  token: string | null;
  /** Block explorer base URL from the chain registry, for linking transactions. */
  explorer: string | null;
  decimals: number | null;
  latestBlock: number | null;
  finalizedBlock: number | null;
  /** Seconds between the node's newest block timestamp and when it was read. */
  headAgeSeconds: number | null;
  supply: { latest: string; finalized: string | null } | null;
  window: UsdcWindowStats | null;
  windowReason: string | null;
  rpcLatencyMs: number | null;
  readAt: string;
}

export interface UsdcNetwork {
  generatedAt: string;
  windowSeconds: UsdcWindow;
  source: string;
  chains: UsdcChain[];
  /** Per-chain state (LIVE / INDEXING / DEGRADED / UNAVAILABLE / NOT_CONFIGURED) and indexer health. */
  health: Record<string, ChainHealth>;
  /** Whether the stored network index could be read, and why not. */
  index: { available: boolean; reason: string | null };
  /** Assets recognised but deliberately not counted, with the reason (USDC.e). */
  excluded: { symbol: string; name: string; reason: string; contracts: Record<string, string> }[];
  totals: {
    /** Chains whose supply is included; the total is never silently partial. */
    supplyChains: string[];
    supply: string | null;
    windowChains: string[];
    transfers: number;
    volume: string;
    mintVolume: string;
    burnVolume: string;
    netSupplyChange: string;
    /** Sum of per-chain unique counts (an address active on two chains counts twice). */
    uniqueSenders: number;
    uniqueRecipients: number;
    eventsPerSecond: number | null;
  };
}

const big = (s: string) => {
  const neg = s.startsWith("-");
  const [i, f = ""] = s.replace("-", "").split(".");
  return { neg, i, f };
};
/** Exact decimal-string addition (amounts already scaled by the same decimals). */
export function addDec(a: string, b: string, decimals: number): string {
  const toRaw = (s: string) => {
    const { neg, i, f } = big(s);
    const raw = BigInt(i + f.padEnd(decimals, "0").slice(0, decimals));
    return neg ? -raw : raw;
  };
  const r = toRaw(a) + toRaw(b);
  return (r < 0n ? "-" : "") + formatUnits((r < 0n ? -r : r).toString(), decimals);
}

/** Pure: USDC Transfer logs -> window statistics. `seconds` is the measured span. */
export function aggregateUsdcLogs(logs: RpcLog[], decimals: number, span: { fromBlock: number; toBlock: number; seconds: number }): UsdcWindowStats {
  let transfers = 0;
  let mints = 0;
  let burns = 0;
  let volume = 0n;
  let mintVolume = 0n;
  let burnVolume = 0n;
  const senders = new Set<string>();
  const recipients = new Set<string>();
  const moves: { txHash: string; block: number; from: string; to: string; raw: bigint }[] = [];
  const seen = new Set<string>();
  for (const l of logs) {
    if (l.removed || (l.topics?.[0] ?? "").toLowerCase() !== TRANSFER_TOPIC || l.topics.length !== 3 || !/^0x[0-9a-fA-F]{64}$/.test(l.data ?? "")) continue;
    const id = `${l.transactionHash}:${l.logIndex}`.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const from = `0x${l.topics[1].slice(26)}`.toLowerCase();
    const to = `0x${l.topics[2].slice(26)}`.toLowerCase();
    const raw = BigInt(l.data);
    if (from === ZERO) {
      mints++;
      mintVolume += raw;
      recipients.add(to);
    } else if (to === ZERO) {
      burns++;
      burnVolume += raw;
      senders.add(from);
    } else {
      transfers++;
      volume += raw;
      senders.add(from);
      recipients.add(to);
      moves.push({ txHash: String(l.transactionHash).toLowerCase(), block: Number(BigInt(l.blockNumber ?? "0x0")), from, to, raw });
    }
  }
  const net = mintVolume - burnVolume;
  const fmt = (r: bigint) => formatUnits(r.toString(), decimals);
  return {
    ...span,
    transfers,
    volume: fmt(volume),
    mints,
    mintVolume: fmt(mintVolume),
    burns,
    burnVolume: fmt(burnVolume),
    netSupplyChange: (net < 0n ? "-" : "") + fmt(net < 0n ? -net : net),
    uniqueSenders: senders.size,
    uniqueRecipients: recipients.size,
    activeAddresses: new Set([...senders, ...recipients]).size,
    eventsPerSecond: span.seconds > 0 ? (transfers + mints + burns) / span.seconds : null,
    largest: moves
      .sort((a, b) => (b.raw > a.raw ? 1 : b.raw < a.raw ? -1 : 0))
      .slice(0, LARGEST)
      .map((m) => ({ txHash: m.txHash, block: m.block, from: m.from, to: m.to, amount: fmt(m.raw) })),
  };
}

interface Block {
  number: string;
  timestamp: string;
}

function empty(chain: string, status: UsdcChain["status"], reason: string): UsdcChain {
  return { chain, status, reason, token: null, explorer: getChain(chain)?.explorer ?? null, decimals: null, latestBlock: null, finalizedBlock: null, headAgeSeconds: null, supply: null, window: null, windowReason: null, rpcLatencyMs: null, readAt: new Date().toISOString() };
}

async function readEvm(chain: string, windowSeconds: number): Promise<UsdcChain> {
  const cfg = getChain(chain);
  // Native USDC only, from the asset registry (USDC.e is a different contract and never read here).
  const token = getAsset("usdc")?.deployments[chain];
  if (!cfg || !token) return empty(chain, "not_configured", `${chain} has no native USDC in the chain registry.`);
  const url = evmRpcFor(chain);
  if (!url) return empty(chain, "not_configured", `No RPC URL for ${chain} (${chain.toUpperCase()}_RPC_URL).`);
  const t0 = Date.now();
  try {
    const id = Number(BigInt(await nodeRpc<string>(url, "eth_chainId", [])));
    const rpcLatencyMs = Date.now() - t0;
    if (id !== cfg.chainId) throw new Error(`endpoint answered chain id ${id}, expected ${cfg.chainId}`);
    const [head, fin, meta] = await Promise.all([
      nodeRpc<Block>(url, "eth_getBlockByNumber", ["latest", false]),
      nodeRpc<Block | null>(url, "eth_getBlockByNumber", ["finalized", false]).catch(() => null),
      tokenMeta(url, chain, token),
    ]);
    if (meta.decimals === null) throw new Error("USDC contract did not report decimals()");
    const decimals = meta.decimals;
    const supplyAt = async (tag: string) => {
      // A load-balanced endpoint can report a head that the backend answering
      // the next call has not imported yet ("header not found", verified on a
      // public Polygon endpoint 2026-10-07). Same block, one short retry.
      const call = () => nodeRpc<string>(url, "eth_call", [{ to: token, data: "0x18160ddd" }, tag]);
      const r = await call().catch(async (e: Error) => {
        if (!/header not found|unknown block|block not found/i.test(e.message)) throw e;
        await new Promise((res) => setTimeout(res, 400));
        return call();
      });
      if (!/^0x[0-9a-f]{64}$/i.test(r)) throw new Error("totalSupply() returned a malformed word");
      return formatUnits(BigInt(r).toString(), decimals);
    };
    // One supply read per chain per refresh (eth_call = 26 CU on Alchemy); the
    // finalized supply is recorded by the indexer, not re-read per page view.
    const supplyLatest = await supplyAt(head.number);
    const supplyFinal: string | null = null;
    const headN = BigInt(head.number);
    const headTs = Number(BigInt(head.timestamp));

    // Block time measured from the node: the header 100 blocks back.
    let window: UsdcWindowStats | null = null;
    let windowReason: string | null = null;
    if (!liveWindowChains().includes(chain)) {
      windowReason = "Live window off for this chain: scanning its logs on every page view would exhaust the RPC plan (Alchemy Free: 10-block eth_getLogs, 30M CU/month). Activity comes from the indexer; opt in with ONCHAIN_LIVE_WINDOW_CHAINS.";
    } else try {
      const probeN = headN > 100n ? headN - 100n : 0n;
      const probe = await nodeRpc<Block>(url, "eth_getBlockByNumber", [`0x${probeN.toString(16)}`, false]);
      const msPerBlock = ((headTs - Number(BigInt(probe.timestamp))) * 1000) / Number(headN - probeN || 1n);
      const nBlocks = BigInt(Math.min(MAX_WINDOW_BLOCKS, Math.max(1, Math.ceil((windowSeconds * 1000) / Math.max(msPerBlock, 1)))));
      const fromN = headN - nBlocks + 1n;
      const [logs, first] = await Promise.all([getLogsAdaptive(url, { address: [token], topics: [TRANSFER_TOPIC] }, fromN, headN), nodeRpc<Block>(url, "eth_getBlockByNumber", [`0x${fromN.toString(16)}`, false])]);
      // A block's timestamp marks its end, so the first block's own interval counts too.
      const seconds = Math.max(1, headTs - Number(BigInt(first.timestamp)) + msPerBlock / 1000);
      window = aggregateUsdcLogs(logs, decimals, { fromBlock: Number(fromN), toBlock: Number(headN), seconds: Math.round(seconds * 10) / 10 });
    } catch (e) {
      windowReason = `Transfer window unavailable: ${(e as Error).message.slice(0, 160)}`;
    }
    return {
      chain,
      status: "ok",
      reason: null,
      token,
      explorer: cfg.explorer,
      decimals,
      latestBlock: Number(headN),
      finalizedBlock: fin ? Number(BigInt(fin.number)) : null,
      headAgeSeconds: Math.max(0, Math.round(Date.now() / 1000 - headTs)),
      supply: { latest: supplyLatest, finalized: supplyFinal },
      window,
      windowReason,
      rpcLatencyMs,
      readAt: new Date().toISOString(),
    };
  } catch (e) {
    return { ...empty(chain, "unavailable", (e as Error).message.slice(0, 200)), rpcLatencyMs: Date.now() - t0 };
  }
}

async function readSolana(): Promise<UsdcChain> {
  const mint = getAsset("usdc")?.deployments.solana;
  const url = solanaRpc();
  if (!mint) return empty("solana", "not_configured", "solana has no native USDC in the chain registry.");
  if (!url) return empty("solana", "not_configured", "No RPC URL for solana (SOLANA_RPC_URL).");
  const t0 = Date.now();
  try {
    const confirmed = await nodeRpc<number>(url, "getSlot", [{ commitment: "confirmed" }]);
    const rpcLatencyMs = Date.now() - t0;
    type Supply = { value: { amount: string; decimals: number } };
    const [finalized, sC, sF, blockTime] = await Promise.all([
      nodeRpc<number>(url, "getSlot", [{ commitment: "finalized" }]),
      nodeRpc<Supply>(url, "getTokenSupply", [mint, { commitment: "confirmed" }]),
      nodeRpc<Supply>(url, "getTokenSupply", [mint, { commitment: "finalized" }]).catch(() => null),
      nodeRpc<number | null>(url, "getBlockTime", [confirmed]).catch(() => null),
    ]);
    const decimals = sC.value.decimals;
    if (!/^\d+$/.test(sC.value.amount)) throw new Error("getTokenSupply returned a non-integer amount");
    return {
      chain: "solana",
      status: "ok",
      reason: null,
      token: mint,
      explorer: getChain("solana")?.explorer ?? null,
      decimals,
      latestBlock: confirmed,
      finalizedBlock: finalized,
      headAgeSeconds: blockTime ? Math.max(0, Math.round(Date.now() / 1000 - blockTime)) : null,
      supply: { latest: formatUnits(sC.value.amount, decimals), finalized: sF && /^\d+$/.test(sF.value.amount) ? formatUnits(sF.value.amount, sF.value.decimals) : null },
      window: null,
      windowReason: "Solana JSON-RPC cannot enumerate every transfer of a mint; network-wide Solana USDC activity needs a Geyser stream.",
      rpcLatencyMs,
      readAt: new Date().toISOString(),
    };
  } catch (e) {
    return { ...empty("solana", "unavailable", (e as Error).message.slice(0, 200)), rpcLatencyMs: Date.now() - t0 };
  }
}

export function summarize(chains: UsdcChain[], windowSeconds: UsdcWindow): UsdcNetwork {
  const ok = chains.filter((c) => c.status === "ok" && c.supply && c.decimals !== null);
  // Amounts are summed only across chains whose contracts report the SAME
  // decimals (the first healthy chain's); a mismatch is excluded, never mis-added.
  const d = ok[0]?.decimals ?? 0;
  const supplyChains = ok.filter((c) => c.decimals === d).map((c) => c.chain);
  const win = ok.filter((c) => c.window && c.decimals === d);
  const sum = (pick: (w: UsdcWindowStats) => string) => win.reduce((a, c) => addDec(a, pick(c.window!), d), "0");
  const secs = win.map((c) => c.window!.seconds);
  return {
    generatedAt: new Date().toISOString(),
    windowSeconds,
    source: "FurlPay-configured chain nodes (JSON-RPC), read live",
    chains,
    health: {},
    index: { available: false, reason: null },
    excluded: assetRegistry()
      .filter((a) => !a.indexed && a.symbol.startsWith("USDC"))
      .map((a) => ({ symbol: a.symbol, name: a.name, reason: a.exclusion ?? "Not indexed.", contracts: a.deployments })),
    totals: {
      supplyChains,
      supply: supplyChains.length ? ok.filter((c) => c.decimals === d).reduce((a, c) => addDec(a, c.supply!.latest, d), "0") : null,
      windowChains: win.map((c) => c.chain),
      transfers: win.reduce((a, c) => a + c.window!.transfers, 0),
      volume: sum((w) => w.volume),
      mintVolume: sum((w) => w.mintVolume),
      burnVolume: sum((w) => w.burnVolume),
      netSupplyChange: sum((w) => w.netSupplyChange),
      // Counted per chain: one address active on two chains counts twice.
      uniqueSenders: win.reduce((a, c) => a + c.window!.uniqueSenders, 0),
      uniqueRecipients: win.reduce((a, c) => a + c.window!.uniqueRecipients, 0),
      eventsPerSecond: win.length ? win.reduce((a, c) => a + (c.window!.eventsPerSecond ?? 0), 0) : null,
    },
  };
}

/**
 * Shared, short-lived snapshot: every request on an instance within TTL_MS
 * reads the same node results, so N viewers cost one read per chain per TTL.
 */
const TTL_MS = 15_000;
const cache = new Map<UsdcWindow, { at: number; p: Promise<UsdcNetwork> }>();
export function usdcNetwork(windowSeconds: UsdcWindow, now = Date.now()): Promise<UsdcNetwork> {
  const hit = cache.get(windowSeconds);
  if (hit && now - hit.at < TTL_MS) return hit.p;
  const p = Promise.all([
    Promise.all(USDC_CHAINS.map((c) => (c === "solana" ? readSolana() : readEvm(c, windowSeconds)))),
    readIndexState("usdc", USDC_CHAINS.filter((c) => c !== "solana")),
  ]).then(([chains, idx]) => {
    const net = summarize(chains, windowSeconds);
    for (const c of chains) {
      net.health[c.chain] = chainHealth(c, {
        asset: idx.status.find((r) => r.indexer === "asset" && r.chain === c.chain && r.asset === "usdc") ?? null,
        wallet: idx.status.find((r) => r.indexer === "wallet" && r.chain === c.chain) ?? null,
        commit: idx.commits.get(c.chain) ?? null,
        issues: idx.issues.filter((i) => i.chain === c.chain),
        available: idx.available,
        reason: idx.reason,
      });
    }
    net.index = { available: idx.available, reason: idx.reason };
    return net;
  });
  cache.set(windowSeconds, { at: now, p });
  p.catch(() => cache.delete(windowSeconds));
  return p;
}
