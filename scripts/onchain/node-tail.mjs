#!/usr/bin/env node
// Head-driven tail for the direct-to-node indexers. Runs OUTSIDE the web
// deployment (Vercel Cron fires at most daily on this plan).
//
//   FURLPAY_BASE_URL=https://furlpay.com FURLPAY_CRON_SECRET=… \
//   ONCHAIN_TAIL_CHAINS=ethereum,base,arbitrum,polygon,solana \
//   ETHEREUM_RPC_URL=… BASE_RPC_URL=… ARBITRUM_RPC_URL=… POLYGON_RPC_URL=… SOLANA_RPC_URL=… \
//   node scripts/onchain/node-tail.mjs
//
// For each chain it reads the head from the node itself (eth_blockNumber /
// getSlot "confirmed") every ONCHAIN_TAIL_POLL_MS and, the moment the head
// moves, calls GET /api/cron/onchain-node?chain=<chain>, which runs both
// indexers for that chain (tracked wallets + the network-wide asset index).
//
// What this process does NOT own, on purpose: cursors, reorg handling,
// finality, deduplication. Those live in Postgres (compare-and-set cursors,
// idempotent ingest, exactly-once range commits), so this worker holds no
// state worth losing:
//   - restart it at any time; the next pass resumes from the stored cursors;
//   - downtime is caught up range by range from those cursors;
//   - two copies running at once cannot double-count (the store refuses the
//     second commit of a range).
//
// Scheduling rules:
//   - one scan in flight per chain; a head that moves during a scan queues
//     exactly one follow-up (heads are coalesced, the same head is never
//     scanned twice);
//   - at most one scan per ONCHAIN_TAIL_MIN_GAP_MS per chain;
//   - failures back off exponentially to 60 s; the first success after a
//     failure logs indexer_recovered with the downtime;
//   - a chain with no head RPC configured here scans every ONCHAIN_TAIL_INTERVAL_MS.
//
// Logs are JSON lines with a stable `event` (indexer_started, block_detected,
// block_indexed, indexer_checkpoint_saved, indexer_reorg_detected,
// rpc_unavailable, indexer_error, indexer_recovered, integrity_issue). RPC
// URLs and the cron secret are never logged.

import { pathToFileURL } from "node:url";

const MAX_BACKOFF_MS = 60_000;

function num(env, name, dflt) {
  const n = Number(env[name]);
  return Number.isFinite(n) && n >= 100 ? n : dflt;
}

export function configFromEnv(env = process.env) {
  return {
    baseUrl: (env.FURLPAY_BASE_URL ?? "").replace(/\/+$/, ""),
    secret: env.FURLPAY_CRON_SECRET ?? "",
    chains: (env.ONCHAIN_TAIL_CHAINS ?? env.ONCHAIN_NODE_CHAINS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((c, i, all) => /^[a-z0-9_-]{2,32}$/.test(c) && all.indexOf(c) === i),
    pollMs: num(env, "ONCHAIN_TAIL_POLL_MS", 1_000),
    minGapMs: num(env, "ONCHAIN_TAIL_MIN_GAP_MS", 2_000),
    intervalMs: num(env, "ONCHAIN_TAIL_INTERVAL_MS", 5_000),
    /** Same variable names the app reads (lib/onchain/balances.ts). */
    headRpc: (chain) => {
      const v = chain === "solana" ? env.SOLANA_RPC_URL ?? env.HELIUS_RPC_URL : env[`${chain.toUpperCase().replace(/-/g, "_")}_RPC_URL`];
      return v && v.trim() ? v.trim() : null;
    },
  };
}

export function validate(cfg) {
  if (!cfg.baseUrl || !/^https?:\/\//.test(cfg.baseUrl)) return "FURLPAY_BASE_URL must be the app origin, e.g. https://furlpay.com";
  if (cfg.secret.length < 16) return "FURLPAY_CRON_SECRET is not set";
  if (cfg.chains.length === 0) return "ONCHAIN_TAIL_CHAINS (or ONCHAIN_NODE_CHAINS) is empty";
  return null;
}

const scrub = (s) => String(s ?? "").replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, "[url]").slice(0, 300);

/**
 * The tail loop. Every dependency is injectable so it can be tested without a
 * network or a clock. `stop()` ends it; `maxIterations` bounds it in tests.
 */
export function createTail(cfg, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const emit = deps.log ?? ((rec) => console.log(JSON.stringify(rec)));
  let stopping = false;
  const out = (level, event, fields = {}) => emit({ at: new Date(now()).toISOString(), level, event, ...fields });

  async function rpc(url, method, params) {
    const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`head rpc ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`head rpc error ${body.error.code ?? ""}`.trim());
    return body.result;
  }
  const readHead = async (chain, url) => BigInt(chain === "solana" ? await rpc(url, "getSlot", [{ commitment: "confirmed" }]) : await rpc(url, "eth_blockNumber", []));

  async function scan(chain, head) {
    const started = now();
    const res = await fetchImpl(`${cfg.baseUrl}/api/cron/onchain-node?chain=${encodeURIComponent(chain)}`, { headers: { "x-furlpay-cron-key": cfg.secret }, signal: AbortSignal.timeout(70_000) });
    const body = await res.json().catch(() => null);
    const w = body?.reports?.[0] ?? null;
    const assets = body?.assets ?? [];
    const failed = !res.ok || (!w && assets.length === 0) || [w, ...assets].filter(Boolean).every((r) => r.status === "failed");
    const fields = { chain, head: head === null ? null : String(head), http: res.status, ms: now() - started };
    if (failed) {
      const err = w?.errors?.[0] ?? assets.find((a) => a.errors?.length)?.errors[0] ?? body?.reason ?? `HTTP ${res.status}`;
      throw Object.assign(new Error(scrub(err)), { fields });
    }
    if (w) {
      out(w.status === "ok" ? "info" : "warn", "block_indexed", { ...fields, indexer: "wallet", status: w.status, from: w.from, through: w.scannedThrough, finalized: w.finalized, logs: w.logs, inserted: w.counts?.inserted, errors: (w.errors ?? []).slice(0, 3).map(scrub) });
      if (w.cursorAdvanced) out("info", "indexer_checkpoint_saved", { chain, indexer: "wallet", block: w.finalized });
      if (w.markedReorged > 0 || (w.errors ?? []).some((e) => /reorganis|reorg/i.test(e))) out("warn", "indexer_reorg_detected", { chain, indexer: "wallet", provenOrphans: w.markedReorged ?? 0 });
    }
    for (const a of assets) {
      out(a.status === "failed" ? "error" : a.status === "partial" ? "warn" : "info", "block_indexed", { ...fields, indexer: "asset", asset: a.asset, status: a.status, cursor: `${a.cursorBefore}..${a.cursorAfter}`, finalized: a.finalized, commits: a.commits, reconciled: a.reconciled, errors: (a.errors ?? []).slice(0, 3).map(scrub) });
      if (a.commits > 0) out("info", "indexer_checkpoint_saved", { chain, indexer: "asset", asset: a.asset, block: a.cursorAfter });
      if (a.reconciled === false) out("error", "integrity_issue", { chain, asset: a.asset, kind: "supply_mismatch", block: a.cursorAfter });
      if ((a.errors ?? []).some((e) => /parent_hash_mismatch/.test(e))) out("error", "indexer_reorg_detected", { chain, indexer: "asset", asset: a.asset, block: a.cursorBefore });
    }
  }

  async function tail(chain, maxIterations) {
    const url = cfg.headRpc(chain);
    out("info", "indexer_started", { chain, mode: url ? "head" : "interval", pollMs: url ? cfg.pollMs : cfg.intervalMs });
    let scannedAt = null;
    let lastHead = null;
    let lastStart = -Infinity;
    let backoff = 0;
    let failingSince = null;
    for (let i = 0; !stopping && (maxIterations === undefined || i < maxIterations); i++) {
      let head = null;
      if (url) {
        try {
          head = await readHead(chain, url);
          if (head !== lastHead) out("info", "block_detected", { chain, head: String(head) });
          lastHead = head;
        } catch (e) {
          out("warn", "rpc_unavailable", { chain, error: scrub(e.message) });
        }
      }
      const due = head === null ? now() - lastStart >= cfg.intervalMs : head !== scannedAt;
      const gapOk = now() - lastStart >= Math.max(cfg.minGapMs, backoff);
      if (due && gapOk) {
        lastStart = now();
        try {
          await scan(chain, head);
          scannedAt = head;
          if (failingSince !== null) out("info", "indexer_recovered", { chain, downMs: now() - failingSince });
          failingSince = null;
          backoff = 0;
        } catch (e) {
          if (failingSince === null) failingSince = now();
          backoff = Math.min(MAX_BACKOFF_MS, backoff ? backoff * 2 : 2_000);
          out("error", "indexer_error", { ...(e.fields ?? { chain }), error: scrub(e.message), retryInMs: backoff });
        }
      }
      await sleep(url ? cfg.pollMs : Math.min(cfg.pollMs, cfg.intervalMs));
    }
  }

  return {
    run: (maxIterations) => Promise.all(cfg.chains.map((c) => tail(c, maxIterations))),
    stop: () => {
      stopping = true;
    },
  };
}

// Direct invocation: run until SIGINT/SIGTERM.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = configFromEnv();
  const problem = validate(cfg);
  if (problem) {
    console.log(JSON.stringify({ at: new Date().toISOString(), level: "error", event: "indexer_error", error: problem }));
    process.exit(2);
  }
  const t = createTail(cfg);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => t.stop());
  await t.run();
  console.log(JSON.stringify({ at: new Date().toISOString(), level: "info", event: "indexer_stopped" }));
}
