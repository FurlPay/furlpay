// The #mempool channel's two jobs.
//
//   tick()   — one pass: read the network, walk whatever blocks are new, sample
//              the mempool, refresh the threat feeds, post what is worth
//              posting. Cheap, idempotent, safe to run on any schedule.
//   watch()  — tick() on a loop, which is the only way the whale feed is any
//              good: blocks arrive every ten minutes and the mempool sample is
//              a ten-transaction window, so a once-a-day pass would see almost
//              nothing. Runs until stopped.
//   daily()  — the board plus a fresh 24h digest, read entirely out of SQLite.
//              This is the "update me daily" surface and it does NOT depend on
//              the watcher having run — it just reports honestly on how much
//              coverage it actually has.
//
// The division exists because complete whale coverage requires being resident.
// Rather than pretend a daily batch can do it, the digest states its coverage.

import { btcNetwork, btcScans, btcWhales, hacks } from "../db/mempool.js";
import { getDb } from "../db/index.js";
import { makeClient, type BitcoinClient } from "./client.js";
import { readNetwork } from "./network.js";
import { blocksSince, sampleMempool, walkBlock, SATS_PER_BTC, type EsploraTx } from "./whales.js";
import { refreshHacks, refreshSanctions, sanctionedSet } from "./threats.js";
import {
  MEMPOOL_BOARD_MARKER, MEMPOOL_CHANNEL, boardEmbed, digestEmbed,
  hackAlertEmbed, whaleAlertEmbed,
} from "./embeds.js";
import { Publisher } from "../bot/publisher.js";
import { AlertQueue } from "./alerts.js";
import {
  recordSamples, pruneSamples, refreshBaselines, loadBaselines, sortedValues, sampleOf, type Metric,
} from "./intel/baselines.js";
import {
  observeTransaction, pruneProfiles, profileStats, knownAddresses,
} from "./intel/addressProfile.js";
import {
  cheapFeatures, stage1, addressesOf, newTriageStats, recordTriage, triageConfigFromEnv,
} from "./intel/triage.js";
import {
  analyse, isAlertWorthy, rankOf, loadAnalysisBaselines, type Analysis,
} from "./intel/analyse.js";
import { behaviourAlertEmbed } from "./intel/alertEmbed.js";
import type { RawTx } from "./intel/features.js";
import { MempoolStream, wsHostsFromEnv, type StreamBlock, type StreamStats } from "./stream.js";
import { env, assertBootable } from "../config/env.js";
import { makeLogger } from "../util/logger.js";
import type { BtcWhaleTx, NetworkSnapshot } from "./types.js";

const log = makeLogger("mempool");

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const numEnv = (k: string, d: number): number => {
  const v = process.env[k]?.trim();
  if (!v) return d;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const config = {
  /** A transaction at or above this many BTC is a whale. */
  get minWhaleBtc(): number {
    return numEnv("BTC_WHALE_MIN_BTC", 50);
  },
  /** Alert threshold — every whale is stored, only the big ones are posted. */
  get alertMinBtc(): number {
    return numEnv("BTC_ALERT_MIN_BTC", 250);
  },
  /** Blocks to walk in one tick. Caps catch-up so a long gap cannot stall. */
  get maxBlocksPerTick(): number {
    return numEnv("BTC_MAX_BLOCKS_PER_TICK", 3);
  },
  /** Seconds between watcher ticks. */
  get tickSec(): number {
    return numEnv("BTC_TICK_SEC", 60);
  },
  /** Whale alerts per tick, so a busy block cannot flood the channel. */
  get maxAlertsPerTick(): number {
    return numEnv("BTC_MAX_ALERTS_PER_TICK", 4);
  },
  /**
   * Seconds between threat-feed pulls while the watcher is resident.
   *
   * Five minutes is as live as the source allows: the incident dataset
   * publishes when somebody writes an incident down, so polling faster buys
   * nothing but bandwidth. It is still a large improvement on the once-a-day
   * pull — a newly published exploit now reaches the channel in minutes.
   */
  get threatRefreshSec(): number {
    return numEnv("BTC_THREAT_REFRESH_SEC", 300);
  },
  /** Days of history kept before pruning. */
  get retentionDays(): number {
    return numEnv("BTC_RETENTION_DAYS", 30);
  },
};

export interface TickResult {
  snapshotTs: number;
  blocksWalked: number;
  whalesFound: number;
  mempoolSampled: number;
  freshHacks: number;
  alertsPosted: number;
  sanctionsArmed: number;
  errors: string[];
}

/* ------------------------------------------------------------------ */
/* One pass                                                            */
/* ------------------------------------------------------------------ */

export interface TickOptions {
  client?: BitcoinClient;
  publisher?: Publisher | null;
  channelId?: string | null;
  /** Do everything except the Discord write. */
  dryRun?: boolean;
  /** Skip the threat-feed refresh; the watcher does it once every few ticks. */
  skipThreats?: boolean;
  /**
   * Network state already delivered by the WebSocket. When present the REST
   * snapshot is skipped entirely — the socket carries fees, difficulty,
   * mempool size and price, so re-fetching them would spend rate-limit budget
   * on numbers already in hand.
   */
  liveStats?: StreamStats;
  /** The socket announces blocks, so the watcher walks them itself. */
  skipBlocks?: boolean;
  signal?: AbortSignal;
}

/**
 * Build a network snapshot out of what the WebSocket has delivered.
 *
 * The socket carries every field the REST snapshot does except the tip height,
 * which arrives only on a block message — so the previous snapshot's height is
 * carried forward rather than nulled. Carrying it is correct: the tip does not
 * become unknown because no block was mined in the last minute.
 *
 * `hashrate` has no socket equivalent and stays null rather than being derived
 * from difficulty, which would be an estimate presented as a reading.
 */
export function snapshotFromStream(
  s: StreamStats,
  previous: NetworkSnapshot | null,
): NetworkSnapshot {
  return {
    ts: Date.now(),
    tipHeight: previous?.tipHeight ?? null,
    mempoolCount: s.mempoolInfo?.size ?? null,
    mempoolVsize: s.mempoolInfo?.bytes ?? null,
    // The socket reports total fee in BTC where the REST endpoint uses
    // satoshis. Storing one as the other would misreport it by 1e8.
    mempoolTotalFee:
      typeof s.mempoolInfo?.total_fee === "number"
        ? Math.round(s.mempoolInfo.total_fee * 1e8)
        : null,
    fees: {
      fastest: s.fees?.fastestFee ?? null,
      halfHour: s.fees?.halfHourFee ?? null,
      hour: s.fees?.hourFee ?? null,
      economy: s.fees?.economyFee ?? null,
      minimum: s.fees?.minimumFee ?? null,
    },
    projectedBlocks: s.mempoolBlocks ?? null,
    difficultyChangePct: s.da?.difficultyChange ?? null,
    difficultyProgressPct: s.da?.progressPercent ?? null,
    retargetEta: s.da?.estimatedRetargetDate ?? null,
    hashrate: previous?.hashrate ?? null,
    priceUsd: s.priceUsd ?? previous?.priceUsd ?? null,
    sources: ["websocket"],
  };
}

export async function tick(opts: TickOptions = {}): Promise<TickResult> {
  const client = opts.client ?? makeClient();
  const errors: string[] = [];
  const minSats = Math.round(config.minWhaleBtc * SATS_PER_BTC);

  /* --- threat feeds --- */
  let sanctioned = sanctionedSet();
  let freshHackCount = 0;
  if (!opts.skipThreats) {
    const s = await refreshSanctions();
    if (s.error) errors.push(`sanctions: ${s.error}`);
    sanctioned = sanctionedSet();

    const h = await refreshHacks();
    if (h.error) errors.push(`hacks: ${h.error}`);
    freshHackCount = h.fresh.length;
  }
  if (sanctioned.size === 0) {
    // Loud, because an unarmed screen reports zero hits exactly like a clean chain.
    log.warn("sanctions screening is NOT armed — zero hits will mean 'not checked'");
  }

  /* --- network --- */
  const snapshot = opts.liveStats
    ? snapshotFromStream(opts.liveStats, btcNetwork.latest())
    : await readNetwork(client);
  btcNetwork.insert(snapshot);
  if (!snapshot.sources.length) errors.push("no host answered for network state");

  const scanOpts = {
    minSats,
    priceUsd: snapshot.priceUsd,
    sanctioned,
    signal: opts.signal,
  };

  /* --- blocks --- */
  let blocksWalked = 0;
  let whalesFound = 0;
  const newWhales: BtcWhaleTx[] = [];
  if (!opts.skipBlocks) try {
    const from = btcScans.highest();
    const blocks = await blocksSince(client, from, config.maxBlocksPerTick);
    for (const b of blocks) {
      if (opts.signal?.aborted) break;
      if (btcScans.has(b.height)) continue;
      const { scan, whales } = await walkBlock(client, b.hash, scanOpts);
      btcScans.record(scan);
      blocksWalked += 1;
      whalesFound += whales.length;
      for (const w of whales) {
        const { isNew } = btcWhales.upsert(w);
        if (isNew) newWhales.push(w);
      }
    }
  } catch (err) {
    const msg = (err as Error).message.slice(0, 200);
    errors.push(`blocks: ${msg}`);
    log.warn("block pass failed", { err: msg });
  }

  /* --- mempool sample --- */
  let sampled = 0;
  try {
    const { whales, seen } = await sampleMempool(client, scanOpts);
    sampled = seen;
    for (const w of whales) {
      const { isNew } = btcWhales.upsert(w);
      if (isNew) newWhales.push(w);
    }
  } catch (err) {
    const msg = (err as Error).message.slice(0, 200);
    errors.push(`mempool: ${msg}`);
    log.warn("mempool sample failed", { err: msg });
  }

  /* --- publish --- */
  let alertsPosted = 0;
  if (!opts.dryRun && opts.publisher && opts.channelId) {
    alertsPosted = await postAlerts(opts.publisher, opts.channelId, errors);
  }

  log.info("tick", {
    blocks: blocksWalked,
    whales: whalesFound,
    newWhales: newWhales.length,
    sampled,
    freshHacks: freshHackCount,
    alerts: alertsPosted,
    tip: snapshot.tipHeight,
    errors: errors.length || undefined,
  });

  return {
    snapshotTs: snapshot.ts,
    blocksWalked,
    whalesFound,
    mempoolSampled: sampled,
    freshHacks: freshHackCount,
    alertsPosted,
    sanctionsArmed: sanctioned.size,
    errors,
  };
}

/**
 * Post pending alerts, marking each one only after Discord accepted it.
 *
 * Marking before the write would lose an alert whenever a post failed — the
 * row would read as delivered and never be retried. Marking after can at worst
 * repost one message if the process dies between the write and the update,
 * which is the failure worth having.
 */
async function postAlerts(pub: Publisher, channelId: string, errors: string[]): Promise<number> {
  let posted = 0;
  const alertMinSats = Math.round(config.alertMinBtc * SATS_PER_BTC);

  /* Whales: only the ones over the alert threshold, plus every sanctions hit
   * regardless of size — a flagged transaction is newsworthy at any value. */
  const pending = btcWhales.pendingAlerts(50);
  const worth = pending
    .filter((w) => w.valueSats >= alertMinSats || w.sanctioned)
    .slice(0, config.maxAlertsPerTick);
  // Everything else is marked seen so it cannot pile up forever; it still
  // counts in the digest, it just does not earn its own message.
  const skipped = pending.filter((w) => !worth.includes(w)).map((w) => w.txid);
  if (skipped.length) btcWhales.markAlerted(skipped);

  for (const w of worth) {
    try {
      await pub.send(channelId, [whaleAlertEmbed(w)]);
      btcWhales.markAlerted([w.txid]);
      posted += 1;
    } catch (err) {
      const msg = (err as Error).message.slice(0, 160);
      errors.push(`whale alert ${w.txid.slice(0, 12)}: ${msg}`);
      log.warn("whale alert failed", { txid: w.txid.slice(0, 16), err: msg });
      break; // a failing channel will fail for the next one too
    }
  }

  for (const h of hacks.pendingAlerts(3)) {
    try {
      await pub.send(channelId, [hackAlertEmbed(h)]);
      hacks.markAlerted([h.key]);
      posted += 1;
    } catch (err) {
      const msg = (err as Error).message.slice(0, 160);
      errors.push(`hack alert ${h.name}: ${msg}`);
      log.warn("hack alert failed", { name: h.name, err: msg });
      break;
    }
  }
  return posted;
}

/* ------------------------------------------------------------------ */
/* The board and the digest                                            */
/* ------------------------------------------------------------------ */

export interface DailyResult {
  channelId: string | null;
  boardMessageId: string | null;
  digestMessageId: string | null;
  coverage: ReturnType<typeof btcScans.coverage>;
}

/**
 * Refresh the pinned board and, when asked, post the 24h digest.
 *
 * Reads only from SQLite, so it is fast and cannot fail on a provider outage.
 * If the watcher has not been running, the coverage line says exactly that
 * rather than presenting a near-empty whale list as a quiet day.
 */
export async function daily(
  opts: { digest?: boolean; dryRun?: boolean; guildId?: string; client?: BitcoinClient } = {},
): Promise<DailyResult> {
  getDb();
  const guildId = opts.guildId ?? env.discordGuildId;
  const since = Date.now() - 86_400_000;
  const client = opts.client ?? makeClient();

  const snapshot = btcNetwork.latest() ?? (await readNetwork(client));
  const stats = btcWhales.statsSince(since);
  const coverage = btcScans.coverage(since);
  const hacks7d = hacks.totalsSince(Date.now() - 7 * 86_400_000);
  const armed = sanctionedSet();

  // Blocks actually mined in the window, from the heights themselves. Bitcoin
  // targets ten minutes but does not deliver exactly 144 a day, so the real
  // denominator is the height range, not the target.
  const blocksMined =
    snapshot.tipHeight !== null && coverage.lowest !== null
      ? snapshot.tipHeight - coverage.lowest + 1
      : null;

  const board = boardEmbed({
    snapshot,
    dayAgo: btcNetwork.nearest(since),
    whales24h: stats,
    coverage,
    blocksMined,
    hacks7d: { count: hacks7d.count, amountUsd: hacks7d.amountUsd },
    sanctionsArmed: armed.size,
    sanctionsStaleMs: null,
    minWhaleBtc: config.minWhaleBtc,
    degradedHosts: client.degradedHosts().map((h) => new URL(h.base).hostname),
  });

  const digest = digestEmbed({
    windowLabel: "last 24h",
    whalesBlock: btcWhales.largest(since, 8, "block"),
    whalesMempool: btcWhales.largest(since, 4, "mempool"),
    stats,
    coverage,
    blocksMined,
    sanctionedTxs: btcWhales.sanctionedSince(since, 5),
    incidents: hacks.since(since, 8),
    incidentTotals: hacks.totalsSince(since),
    minWhaleBtc: config.minWhaleBtc,
    sanctionsArmed: armed.size,
  });

  log.info("daily rendered", {
    tip: snapshot.tipHeight,
    confirmedWhales: stats.block.count,
    sampledWhales: stats.mempool.count,
    blocksEnumerated: coverage.complete,
    blocksMined,
    sanctioned: stats.sanctioned,
  });

  if (opts.dryRun || !guildId) {
    if (!guildId) log.warn("DISCORD_GUILD_ID not set — nothing posted");
    return { channelId: null, boardMessageId: null, digestMessageId: null, coverage };
  }

  assertBootable();
  const pub = Publisher.fromEnv();
  const ch = await pub.ensureChannel({
    guildId,
    channelName: MEMPOOL_CHANNEL.name,
    categoryName: MEMPOOL_CHANNEL.category,
    topic: MEMPOOL_CHANNEL.topic,
  });

  const boardRes = await pub.upsertByMarker(ch.id, MEMPOOL_BOARD_MARKER, [board]);
  if (!boardRes.edited) await pub.pin(ch.id, boardRes.messageId);
  log.info("board posted", { channel: ch.name, id: boardRes.messageId, edited: boardRes.edited });

  let digestId: string | null = null;
  if (opts.digest ?? true) {
    const sent = await pub.send(ch.id, [digest]);
    digestId = sent.id;
    log.info("digest posted", { id: digestId });
  }

  /* Retention. Kept last so a prune failure cannot cost a post. */
  const cutoff = Date.now() - config.retentionDays * 86_400_000;
  btcWhales.prune(cutoff);
  btcNetwork.prune(cutoff);
  btcScans.prune(Math.floor(cutoff / 1000));

  return { channelId: ch.id, boardMessageId: boardRes.messageId, digestMessageId: digestId, coverage };
}

/* ------------------------------------------------------------------ */
/* Resident watcher                                                    */
/* ------------------------------------------------------------------ */

export interface WatchOptions {
  dryRun?: boolean;
  guildId?: string;
  /** Stop after this many ticks. Omitted means run until signalled. */
  maxTicks?: number;
  signal?: AbortSignal;
}

/**
 * Run ticks forever.
 *
 * The board is refreshed every tick (it is an edit, so it costs one call and
 * never adds a message). The threat feeds are refreshed every tenth tick —
 * incidents are published hourly at best, so pulling 342KB every minute would
 * be waste. The digest is NOT posted here: it belongs to the daily schedule so
 * that it lands at a predictable time whether or not the watcher was up.
 */
export async function watch(opts: WatchOptions = {}): Promise<void> {
  getDb();
  const client = makeClient();
  const guildId = opts.guildId ?? env.discordGuildId;

  let pub: Publisher | null = null;
  let channelId: string | null = null;
  let queue: AlertQueue | null = null;
  if (!opts.dryRun && guildId) {
    assertBootable();
    pub = Publisher.fromEnv();
    const ch = await pub.ensureChannel({
      guildId,
      channelName: MEMPOOL_CHANNEL.name,
      categoryName: MEMPOOL_CHANNEL.category,
      topic: MEMPOOL_CHANNEL.topic,
    });
    channelId = ch.id;
    queue = new AlertQueue(pub, ch.id);
    log.info("watching", { channel: ch.name, id: ch.id, tickSec: config.tickSec });
  } else {
    log.info("watching (no Discord write)", { tickSec: config.tickSec });
  }

  /* ---------------- realtime ---------------- */

  // Live stats off the socket. While it is connected these cost no REST call
  // at all, which is what keeps the run inside the rate limit of the only
  // reachable /v1 host.
  let live: StreamStats = {};
  // Heights the socket has announced but nobody has walked yet. A block is
  // walked because it was announced, not because a timer came round, so the
  // confirmed feed follows the chain rather than the clock.
  const pendingBlocks: StreamBlock[] = [];

  const alertMinSats = Math.round(config.alertMinBtc * SATS_PER_BTC);
  const minSats = Math.round(config.minWhaleBtc * SATS_PER_BTC);

  const stream = new MempoolStream(wsHostsFromEnv(), {
    onStats: (s) => {
      live = { ...live, ...s };
    },

    onBlocks: (blocks) => {
      for (const b of blocks) {
        if (!btcScans.has(b.height)) pendingBlocks.push(b);
      }
      log.info("block announced", {
        height: blocks[0]?.height,
        txs: blocks[0]?.tx_count,
        queued: pendingBlocks.length,
      });
    },

    onTransactions: (txs) => {
      // The socket carries value but NO addresses, so a hit here cannot be
      // screened and cannot be told apart from a self-spend. Those fields stay
      // null until the block walk confirms it and fills them in.
      for (const t of txs) {
        const valueSats = Number(t.value) || 0;
        if (valueSats < minSats) continue;
        const btc = valueSats / SATS_PER_BTC;
        const price = live.priceUsd ?? null;
        const whale: BtcWhaleTx = {
          txid: t.txid,
          firstSeen: Date.now(),
          valueSats,
          feeSats: Number.isFinite(t.fee) ? t.fee : null,
          vsize: Number.isFinite(t.vsize) ? t.vsize : null,
          nIn: null, nOut: null,
          topInAddr: null, topInSats: null,
          topOutAddr: null, topOutSats: null,
          selfSpend: false,
          blockHeight: null, blockTime: null,
          priceUsd: price,
          valueUsd: price === null ? null : btc * price,
          discovery: "mempool",
          sanctioned: false,
          sanctionedAddr: null,
        };
        const { isNew } = btcWhales.upsert(whale);
        if (!isNew) continue;
        log.info("live whale", { btc: btc.toFixed(2), txid: t.txid.slice(0, 16) });
        if (queue && valueSats >= alertMinSats) {
          queue.push({
            weight: valueSats,
            embed: whaleAlertEmbed(whale),
            label: `${btc.toFixed(1)} BTC ${t.txid.slice(0, 10)}`,
            onDelivered: () => btcWhales.markAlerted([t.txid]),
          });
        }
      }
    },
  });
  stream.start();

  /* ---------------- the loop ---------------- */

  // Threat feeds are pulled far more often than the daily job did, so a newly
  // published exploit reaches the channel in minutes rather than a day. It is
  // still only as live as the upstream dataset — that feed publishes when
  // somebody writes an incident down, and no amount of polling changes it.
  // COLD-START BACKFILL. The watcher walks blocks the socket ANNOUNCES, so a
  // fresh database sits with no block coverage until the next block is mined —
  // up to ten minutes reporting "nothing enumerated" while the chain is
  // perfectly readable. Seed once from the tip, then let the stream drive.
  if (btcScans.highest() === null) {
    try {
      const { data: tipHash } = await client.fetchText("esplora", "/blocks/tip/hash");
      const { data: tip } = await client.fetchJson<{
        id: string; height: number; timestamp: number; tx_count: number;
      }>("esplora", `/block/${tipHash}`);
      log.info("cold start — seeding from tip", { height: tip.height, txs: tip.tx_count });
      pendingBlocks.push({
        id: tip.id, height: tip.height, timestamp: tip.timestamp, tx_count: tip.tx_count, size: 0,
      });
    } catch (err) {
      log.warn("cold-start seed failed", { err: (err as Error).message.slice(0, 160) });
    }
  }

  const threatEvery = Math.max(1, Math.round(config.threatRefreshSec / config.tickSec));

  let n = 0;
  for (;;) {
    if (opts.signal?.aborted) break;
    if (opts.maxTicks !== undefined && n >= opts.maxTicks) break;

    const started = Date.now();
    try {
      // Walk whatever the socket announced, oldest first, capped so a burst
      // cannot monopolise the tick.
      pendingBlocks.sort((a, b) => a.height - b.height);
      const toWalk = pendingBlocks.splice(0, config.maxBlocksPerTick);
      for (const b of toWalk) {
        if (opts.signal?.aborted) break;
        await walkAnnouncedBlock(client, b, queue, opts.signal);
      }

      await tick({
        client,
        publisher: pub,
        channelId,
        dryRun: opts.dryRun,
        skipThreats: n % threatEvery !== 0,
        signal: opts.signal,
        // The socket already delivers everything readNetwork would fetch, so
        // while it is connected the REST snapshot is skipped entirely.
        liveStats: stream.connected ? live : undefined,
        // The socket is the primary transaction feed, but it is not complete —
        // measured, it missed 40 of 115 transactions a REST poll of another
        // node caught. Sampling stays on as a second, independent observer.
        skipBlocks: true,
      });

      if (pub && channelId) await refreshBoard(pub, channelId, client, stream);
    } catch (err) {
      // A tick must never end the watcher: the next one may well succeed, and
      // a crash here means Task Scheduler silence until the next logon.
      log.error("tick failed", { err: (err as Error).message.slice(0, 200) });
    }
    n += 1;

    const elapsed = Date.now() - started;
    const wait = Math.max(5_000, config.tickSec * 1000 - elapsed);
    await sleep(wait, opts.signal);
  }

  stream.stop();
  if (queue) {
    await queue.flush(15_000);
    queue.stop();
  }
  log.info("watcher stopped", {
    ticks: n,
    http: client.stats(),
    stream: stream.status(),
    alerts: queue?.stats(),
  });
}

/**
 * Walk a block the socket announced and alert on what it holds.
 *
 * This is where an unconfirmed sighting becomes a confirmed one: the walk
 * carries addresses, so it is also the first point at which a transaction can
 * be screened against the sanctions list.
 */
async function walkAnnouncedBlock(
  client: BitcoinClient,
  b: StreamBlock,
  queue: AlertQueue | null,
  signal?: AbortSignal,
): Promise<void> {
  const alertMinSats = Math.round(config.alertMinBtc * SATS_PER_BTC);
  const snapshot = btcNetwork.latest();

  // Collected in memory during the walk and written in one transaction after
  // it. Four inserts per transaction through autocommit, over 4,552
  // transactions, is slower than the network calls the walk is already making.
  const samples: Array<{ metric: Metric; value: number }> = [];
  const whaleTxs: EsploraTx[] = [];
  const triaged: EsploraTx[] = [];

  const { scan, whales } = await walkBlock(client, b.id, {
    minSats: Math.round(config.minWhaleBtc * SATS_PER_BTC),
    priceUsd: snapshot?.priceUsd ?? null,
    sanctioned: sanctionedSet(),
    signal,
    onSample: (t) => {
      samples.push({ metric: "value", value: t.valueSats });
      samples.push({ metric: "nIn", value: t.nIn });
      samples.push({ metric: "nOut", value: t.nOut });
      if (t.feeRate !== null) samples.push({ metric: "feeRate", value: t.feeRate });
    },
    onWhaleTx: (tx) => whaleTxs.push(tx),
    // The analytical stream: every non-coinbase transaction, at any value.
    onTriage: (tx) => triaged.push(tx),
  });
  btcScans.record(scan);

  try {
    const n = recordSamples(samples);
    pruneSamples();
    refreshBaselines();
    log.info("baselines updated", { samplesFromBlock: n, height: b.height });
  } catch (err) {
    // A statistics failure must never lose the block's whales.
    log.warn("baseline update failed", { err: (err as Error).message.slice(0, 160) });
  }

  // Behavioural history, fed by the STAGED TRIAGE rather than by the whale list.
  //
  // This is the fix for the architecture's central bias. Profiles used to be
  // built only from transactions that cleared an absolute value gate, so the
  // engine could only ever learn about addresses that had already moved a lot
  // of bitcoin — and a small anomaly was invisible no matter how sharply it
  // scored. Admission is now decided by percentile and by address history, both
  // of which are indifferent to size.
  //
  // Recorded from CONFIRMED transactions only. Confirmation is what makes
  // baseline poisoning expensive: priming a profile costs real fees and real
  // block space rather than free mempool spam that can be withdrawn.
  //
  // Dated by `blockTime`, not by now — a catch-up run walking yesterday's
  // blocks must date their spends by when they happened, or every gap in every
  // profile collapses to zero and dormancy stops meaning anything.
  try {
    const at = b.timestamp * 1000;
    const cfg = triageConfigFromEnv();
    const baselines = loadBaselines();
    const triageBase = {
      value: baselines.value,
      feeRate: baselines.feeRate,
      nIn: baselines.nIn,
      nOut: baselines.nOut,
      sortedValues: sortedValues(),
      sortedNIn: sampleOf("nIn").sort((x, y) => x - y),
      sortedNOut: sampleOf("nOut").sort((x, y) => x - y),
      sortedFeeRate: sampleOf("feeRate").sort((x, y) => x - y),
    };

    // One cheap pass to extract features, then ONE batched query to find which
    // addresses we already know. Asking per transaction would cost ~15,000
    // round trips on a busy block, which is the expense the ladder exists to
    // avoid in the first place.
    const cheap = triaged.map((tx) => ({ tx, c: cheapFeatures(tx) }));
    const known = knownAddresses(cheap.flatMap(({ c }) => addressesOf(c)));

    const stats = newTriageStats();
    const admitted: EsploraTx[] = [];
    for (const { tx, c } of cheap) {
      const { admit, reasons } = stage1(c, triageBase, cfg, (a) => known.has(a));
      recordTriage(stats, { stage: admit ? 1 : 0, reasons, cheap: c });
      if (admit) admitted.push(tx);
    }

    // Bounded so one strange block cannot stall the tick. Sorted by value only
    // to make the cap deterministic — it decides WHICH of an over-large batch
    // is deferred, never whether analysis happens at all.
    const capped = admitted.length > cfg.maxStage2PerBlock
      ? admitted
          .slice()
          .sort((x, y) =>
            y.vout.reduce((s, o) => s + o.value, 0) - x.vout.reduce((s, o) => s + o.value, 0))
          .slice(0, cfg.maxStage2PerBlock)
      : admitted;

    let spenders = 0;
    for (const tx of capped) {
      spenders += observeTransaction(tx as unknown as RawTx, at).spenders;
    }
    const pruned = pruneProfiles();
    const cov = profileStats();
    log.info("profiles updated", {
      height: b.height,
      seen: stats.seen,
      admitted: stats.stage1,
      admittedPct: stats.seen ? `${((stats.stage1 / stats.seen) * 100).toFixed(1)}%` : undefined,
      analysed: capped.length,
      deferred: admitted.length - capped.length || undefined,
      spenders,
      prunedSpends: pruned.spends || undefined,
      profiled: cov.addresses,
      withHistory: cov.withHistory,
    });
  } catch (err) {
    log.warn("profile update failed", { err: (err as Error).message.slice(0, 160) });
  }

  for (const w of whales) {
    btcWhales.upsert(w);
  }

  // BEHAVIOURAL ALERTING.
  //
  // This is the join that was missing. Every detector, every profile and every
  // baseline existed and was tested, and NOTHING CALLED THEM: the alert
  // decision was `valueSats >= alertMinSats`, so the deployed behaviour was a
  // whale bot with an unused intelligence engine bolted to its side.
  //
  // Alerts are now decided by `isAlertWorthy`, which reads no amount at all.
  // The analysed set is the TRIAGED one, not the whale list, so a 0.2 BTC
  // dormancy break is eligible and a routine 4,000 BTC exchange payout is not.
  if (queue) {
    const analysisBase = loadAnalysisBaselines();
    const price = btcNetwork.latest()?.priceUsd ?? null;
    const at = b.timestamp * 1000;
    let analysed = 0;
    let alerted = 0;

    // Ranked so the alert budget is spent on the most significant findings
    // when a block produces more than the channel should carry.
    const results: Analysis[] = [];
    for (const tx of capped) {
      try {
        results.push(
          analyse(tx as unknown as RawTx, { now: at, baselines: analysisBase }),
        );
        analysed += 1;
      } catch (err) {
        // One malformed transaction must not cost the block its analysis.
        log.debug("analysis failed", {
          txid: tx.txid.slice(0, 16),
          err: (err as Error).message.slice(0, 120),
        });
      }
    }
    results.sort((x, y) => rankOf(y) - rankOf(x));

    for (const a of results) {
      if (!isAlertWorthy(a)) continue;
      if (alerted >= config.maxAlertsPerTick) break;
      alerted += 1;
      queue.push({
        // Ranked by evidence, not by size — a small high-confidence finding
        // must outrank a large unremarkable one in the delivery queue too.
        weight: Math.round(rankOf(a)),
        embed: behaviourAlertEmbed(a, price),
        label: `${a.severity} risk=${Math.round(a.risk * 100)} ${a.txid.slice(0, 10)}`,
        onDelivered: () => btcWhales.markAlerted([a.txid]),
      });
    }

    const top = results[0];
    log.info("behavioural analysis", {
      height: b.height,
      analysed,
      alerted,
      topRisk: top ? Math.round(top.risk * 100) : undefined,
      topSeverity: top?.severity,
      withProfile: results.filter((r) => r.coverage.hasProfile).length,
    });
  }
}

/** Edit the pinned board in place — one call, no new message. */
async function refreshBoard(
  pub: Publisher,
  channelId: string,
  client: BitcoinClient,
  stream?: MempoolStream,
): Promise<void> {
  const since = Date.now() - 86_400_000;
  const snapshot = btcNetwork.latest();
  if (!snapshot) return;
  const coverage = btcScans.coverage(since);
  const hacks7d = hacks.totalsSince(Date.now() - 7 * 86_400_000);
  const armed = sanctionedSet();
  const board = boardEmbed({
    snapshot,
    dayAgo: btcNetwork.nearest(since),
    whales24h: btcWhales.statsSince(since),
    coverage,
    blocksMined:
      snapshot.tipHeight !== null && coverage.lowest !== null
        ? snapshot.tipHeight - coverage.lowest + 1
        : null,
    hacks7d: { count: hacks7d.count, amountUsd: hacks7d.amountUsd },
    sanctionsArmed: armed.size,
    sanctionsStaleMs: null,
    minWhaleBtc: config.minWhaleBtc,
    degradedHosts: client.degradedHosts().map((h) => new URL(h.base).hostname),
    stream: stream?.status(),
  });
  try {
    await pub.upsertByMarker(channelId, MEMPOOL_BOARD_MARKER, [board]);
  } catch (err) {
    log.warn("board refresh failed", { err: (err as Error).message.slice(0, 160) });
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((res) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); res(); }, { once: true });
  });
}
