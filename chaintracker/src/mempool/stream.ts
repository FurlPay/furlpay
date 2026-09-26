// The realtime feed: a WebSocket onto a mempool.space instance.
//
// Measured 2026-09-08 against mempool.emzy.de, because guessing this protocol
// from documentation was not possible — the docs page is client-rendered and
// returns no content to a fetcher. Every claim below came from connecting.
//
//   want ["blocks"]          -> "blocks"
//   want ["stats"]           -> "transactions", "fees", "da", "mempoolInfo",
//                               "vBytesPerSecond"
//   want ["mempool-blocks"]  -> "mempool-blocks", "conversions"
//
// Two consequences shape the whole module:
//
// 1. "transactions" is a LIVE stream of mempool entries carrying txid, fee,
//    vsize, value, rate and time. Over 60s it delivered 136 unique
//    transactions (2.3/s) including a 165 BTC one. This is the realtime whale
//    feed — nothing else here sees a whale before it confirms.
//
// 2. The stats messages carry fees, difficulty, mempool size and (via
//    "conversions") the BTC price. So a full network snapshot costs ZERO REST
//    calls while the socket is up, which matters because the only host serving
//    /v1 that is reachable from here rate-limits above ~0.5 rps.
//
// THE STREAM IS NOT COMPLETE, and that is not a bug to fix. Measured over the
// same 60s window against a REST poll of a DIFFERENT host: the socket saw 136
// transactions, the poll saw 115, and only 75 were common — the socket missed
// 40 the poll caught. Bitcoin has no canonical mempool; every node has its own.
// So the two observers are kept as two observers, their union is better than
// either, and neither is ever presented as a total.

import { makeLogger } from "../util/logger.js";

const log = makeLogger("btc-stream");

/** One live mempool transaction, exactly as the socket sends it. */
export interface StreamTx {
  txid: string;
  fee: number;
  vsize: number;
  /** Sum of outputs, in satoshis. */
  value: number;
  /** Fee rate in sat/vB. */
  rate?: number;
  time?: number;
}

/** A block header as the socket sends it. */
export interface StreamBlock {
  id: string;
  height: number;
  timestamp: number;
  tx_count: number;
  size: number;
}

/** The stats half of the feed — everything a network snapshot needs. */
export interface StreamStats {
  fees?: {
    fastestFee: number;
    halfHourFee: number;
    hourFee: number;
    economyFee: number;
    minimumFee: number;
  };
  mempoolInfo?: { size: number; bytes: number; usage: number; total_fee: number };
  da?: { progressPercent: number; difficultyChange: number; estimatedRetargetDate: number };
  mempoolBlocks?: number;
  priceUsd?: number;
  vBytesPerSecond?: number;
}

export interface StreamHandlers {
  onTransactions?: (txs: StreamTx[]) => void | Promise<void>;
  onBlocks?: (blocks: StreamBlock[]) => void | Promise<void>;
  onStats?: (s: StreamStats) => void;
  onOpen?: (host: string) => void;
  onClose?: (host: string, reason: string) => void;
}

/**
 * WebSocket hosts, in preference order.
 *
 * Short list on purpose: blockstream.info closes the handshake immediately
 * (code 1006 — it runs Esplora, which has no such endpoint), and mempool.space
 * is unreachable from this machine but works from others, so it is kept as a
 * candidate rather than removed.
 */
export const DEFAULT_WS_HOSTS = [
  "wss://mempool.emzy.de/api/v1/ws",
  "wss://mempool.space/api/v1/ws",
];

export function wsHostsFromEnv(): string[] {
  const raw = process.env.BTC_WS_HOSTS?.trim();
  if (!raw) return DEFAULT_WS_HOSTS;
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_WS_HOSTS;
}

/**
 * A self-healing subscription to one mempool instance.
 *
 * Reconnects with exponential backoff and rotates hosts on repeated failure.
 * A dead socket is detected by silence rather than by an error, because the
 * failure that actually happens is a connection that stays open and stops
 * delivering — the server pushes stats every ~2s, so 90s of quiet means gone.
 */
export class MempoolStream {
  private ws: WebSocket | null = null;
  private hostIndex = 0;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private stopped = false;

  /** Timestamp of the last message of any kind. */
  lastMessageAt: number | null = null;
  /** Timestamp of the last `transactions` push specifically. */
  lastTxAt: number | null = null;
  connected = false;
  /** Unique transactions delivered since start — reported by the watcher. */
  txCount = 0;
  blockCount = 0;
  reconnects = 0;

  constructor(
    private readonly hosts: string[] = wsHostsFromEnv(),
    private readonly handlers: StreamHandlers = {},
  ) {}

  get host(): string {
    return this.hosts[this.hostIndex % this.hosts.length] ?? "(none)";
  }

  start(): void {
    if (this.stopped) return;
    this.connect();
    // Silence, not an error, is how this connection dies.
    this.watchdog = setInterval(() => {
      if (this.stopped || !this.connected) return;
      const quiet = this.lastMessageAt ? Date.now() - this.lastMessageAt : 0;
      if (quiet > 90_000) {
        log.warn("stream silent — reconnecting", { host: this.host, quietMs: quiet });
        this.cycle("watchdog");
      }
    }, 30_000);
    this.watchdog.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    try {
      this.ws?.close();
    } catch {
      /* closing a socket that is already gone is not an error worth raising */
    }
    this.connected = false;
  }

  private connect(): void {
    if (this.stopped) return;
    const host = this.host;
    let ws: WebSocket;
    try {
      ws = new WebSocket(host);
    } catch (err) {
      log.warn("stream could not be created", { host, err: (err as Error).message.slice(0, 120) });
      this.cycle("construct failed");
      return;
    }
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.connected = true;
      this.attempt = 0;
      this.lastMessageAt = Date.now();
      // All three wants: "stats" carries the live transaction stream and the
      // fee/difficulty fields, "mempool-blocks" adds the projection and the
      // price, "blocks" delivers a new block the moment it is found.
      ws.send(JSON.stringify({ action: "want", data: ["blocks", "stats", "mempool-blocks"] }));
      log.info("stream open", { host });
      this.handlers.onOpen?.(host);
    });

    ws.addEventListener("message", (ev: MessageEvent) => {
      this.lastMessageAt = Date.now();
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(String(ev.data)) as Record<string, unknown>;
      } catch {
        return; // a malformed frame is not worth tearing the connection down
      }
      this.dispatch(m);
    });

    ws.addEventListener("error", () => {
      // The error event carries no useful detail in Node's implementation;
      // the close event that follows is where the reason lives.
      this.connected = false;
    });

    // Typed structurally rather than as CloseEvent: @types/node exposes the
    // global WebSocket but not the DOM event interfaces that go with it.
    ws.addEventListener("close", (ev: { code?: number; reason?: string }) => {
      const wasConnected = this.connected;
      this.connected = false;
      const reason = `${ev.code}${ev.reason ? ` ${ev.reason}` : ""}`;
      if (wasConnected) log.warn("stream closed", { host, reason });
      this.handlers.onClose?.(host, reason);
      this.cycle(reason);
    });
  }

  private dispatch(m: Record<string, unknown>): void {
    if (Array.isArray(m.transactions) && m.transactions.length) {
      const txs = m.transactions as StreamTx[];
      this.txCount += txs.length;
      this.lastTxAt = Date.now();
      void this.handlers.onTransactions?.(txs);
    }
    // A new block arrives as "block"; "blocks" is the backlog sent on connect.
    if (m.block && typeof m.block === "object") {
      const b = m.block as StreamBlock;
      this.blockCount += 1;
      void this.handlers.onBlocks?.([b]);
    }

    const stats: StreamStats = {};
    let any = false;
    if (m.fees && typeof m.fees === "object") { stats.fees = m.fees as StreamStats["fees"]; any = true; }
    if (m.mempoolInfo && typeof m.mempoolInfo === "object") {
      stats.mempoolInfo = m.mempoolInfo as StreamStats["mempoolInfo"];
      any = true;
    }
    if (m.da && typeof m.da === "object") { stats.da = m.da as StreamStats["da"]; any = true; }
    if (Array.isArray(m["mempool-blocks"])) {
      stats.mempoolBlocks = (m["mempool-blocks"] as unknown[]).length;
      any = true;
    }
    if (typeof m.vBytesPerSecond === "number") { stats.vBytesPerSecond = m.vBytesPerSecond; any = true; }
    const conv = m.conversions as { USD?: number } | undefined;
    if (conv && typeof conv.USD === "number") { stats.priceUsd = conv.USD; any = true; }
    if (any) this.handlers.onStats?.(stats);
  }

  /** Close the current socket and schedule the next attempt, rotating hosts. */
  private cycle(reason: string): void {
    if (this.stopped) return;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.connected = false;
    this.attempt += 1;
    this.reconnects += 1;

    // Two failures on a host is enough to try the next one; a single blip is
    // not worth abandoning a host that was otherwise healthy.
    if (this.attempt % 2 === 0) this.hostIndex += 1;

    const wait = Math.min(60_000, 2_000 * 2 ** Math.min(this.attempt - 1, 5));
    const jittered = Math.round(wait * (0.5 + Math.random() * 0.5));
    log.debug("stream reconnecting", { host: this.host, inMs: jittered, attempt: this.attempt, reason });
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), jittered);
    this.reconnectTimer.unref?.();
  }

  /** Health line for the board footer. */
  status(): { connected: boolean; host: string; txCount: number; reconnects: number; quietMs: number | null } {
    return {
      connected: this.connected,
      host: safeHost(this.host),
      txCount: this.txCount,
      reconnects: this.reconnects,
      quietMs: this.lastMessageAt ? Date.now() - this.lastMessageAt : null,
    };
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
