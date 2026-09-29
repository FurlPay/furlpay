// USDC intelligence CLI.
//
// Commands:
//   ensure    Create #usdc-intelligence and its category if absent, pin the
//             explainer. Idempotent.
//   doctor    Report configuration, registry contents and measured coverage
//             without posting or writing anything.
//   verify    Read symbol() and decimals() off every registry contract and
//             compare them to what the registry claims.
//   tick      One real pass: scan chains, correlate CCTP, post what clears the
//             bar. This is what the scheduler runs.
//   scan      Scan only — no Discord. For confirming ingestion in isolation.
//   backfill  Reset cursors and scan back over USDC_BACKFILL_HOURS.
//   daily     Post the daily roll-up from stored transfers.
//   flows     Post the rolling exchange-flow summary.
//   probe     Post ONE clearly-labelled synthetic embed to check the channel
//             and formatting. Not on any automated path.
//
// WHY A CLI RATHER THAN A DAEMON. This repository runs on Windows Task Scheduler,
// not a long-lived process — `run-daily.cmd` is the existing pattern, and a
// scheduled invocation that exits is far easier to reason about than a process
// that may or may not still be alive.
//
// WHERE THE DATA COMES FROM. Every figure this command prints or posts is read
// from `usdc_transfers` or `usdc_cctp_transfers`, and every row in those tables
// was written by a scanner from an `eth_getLogs` or Helius response against a
// contract verified in registry.ts. `probe` is the one synthetic output in the
// subsystem; it carries a zero amount and a PROBE label, and nothing calls it
// except a human typing it.

import { Publisher } from "../bot/publisher.js";
import { env, assertUsdcThresholds } from "../config/env.js";
import { makeLogger } from "../util/logger.js";
import { getDb } from "../db/index.js";
import { usdcDb } from "../db/usdc.js";
import {
  getAllUsdcAssets,
  getEvmScanAssets,
  getScannedAssets,
  getUsdcAsset,
  cctpDomainName,
  registryProblems,
  assertRegistryConsistent,
} from "./registry.js";
import { classifyUsdcTransfer, getUsdcTier, isUsdcAlertWorthy } from "./classify.js";
import { resolveEntity, loadFurlPayTrackedWallets, furlPayConfigProblems } from "./entities.js";
import {
  usdcChannelIntroEmbed,
  usdcTransferEmbed,
  exchangeFlowEmbed,
  usdcDailyEmbed,
  type UsdcDailyStats,
} from "./embeds.js";
import { scanAllEvmChains, verifyAsset, scanRange, PASS_THROUGH_WINDOW_MS } from "./scanner.js";
import { chainCoverage, pendingBackfills, markBackfillAttempt, completeBackfill, recordCoverage } from "./blocks.js";
import { storedHeads, confirmationFloor } from "./finality.js";
import { crossCheckSummary } from "./crossCheck.js";
import { scanSolanaUsdc } from "./solanaScanner.js";
import { scanAllCctp } from "./cctpScanner.js";
import { runTick, summariseTick } from "./tick.js";
import { acquire, isDenied, withLease } from "./lease.js";
import { buildDailyReport, exchangeFlows, reconciliationLines, DAY_MS } from "./daily.js";
import { coverageSince } from "./scanRuns.js";
import { ingestionLagSec, STALE_LAG_SEC } from "./metrics.js";
import { cursors } from "../db/index.js";
import { SCANNER } from "./scanner.js";
import { CCTP_SCANNER } from "./cctpScanner.js";
import type { UsdcTransfer } from "./types.js";

const log = makeLogger("usdc");

const CHANNEL_TOPIC =
  "Native USDC movement intelligence — large transfers, exchange flows, CCTP " +
  "cross-chain, FurlPay wallets. Raw volume is not payment volume.";

function requireGuild(): string {
  const guildId = env.discordGuildId;
  if (!guildId) {
    throw new Error("DISCORD_GUILD_ID is not set. The bot cannot find a server to post in.");
  }
  return guildId;
}

/** Create the channel if needed and pin the explainer. Safe to re-run. */
export async function ensureUsdcChannel(): Promise<{ id: string; created: boolean }> {
  const guildId = requireGuild();
  const pub = Publisher.fromEnv();

  const { id, created, name } = await pub.ensureChannel({
    guildId,
    channelName: env.usdcDiscordChannel,
    categoryName: env.usdcDiscordCategory,
    topic: CHANNEL_TOPIC,
  });

  log.info(created ? "usdc channel created" : "usdc channel already present", { id, name });

  if (created) {
    // The explainer is posted only on creation. Re-pinning on every run would
    // bury the alerts the channel exists for.
    const chains = getScannedAssets().map((a) => a.chainName);
    const msg = await pub.send(id, [usdcChannelIntroEmbed(chains)]);
    try {
      await pub.pin(id, msg.id);
    } catch (e) {
      // Pinning needs Manage Messages. Not having it is a permissions gap worth
      // reporting, not a reason to fail the whole setup.
      log.warn("could not pin the intro message — check Manage Messages", {
        error: (e as Error).message,
      });
    }
  }

  return { id, created };
}

/**
 * Resolve the channel without creating it.
 *
 * Used by `tick`, which runs unattended: a scheduled job that creates a Discord
 * channel because a name was mistyped is worse than one that fails loudly.
 */
async function findChannelOrThrow(): Promise<string> {
  const pub = Publisher.fromEnv();
  const ch = await pub.findChannel(requireGuild(), env.usdcDiscordChannel);
  if (!ch) {
    throw new Error(
      `#${env.usdcDiscordChannel} does not exist in this server. Run \`npm run usdc:ensure\` once first.`
    );
  }
  return ch.id;
}

/** Report configuration and measured coverage. Reads, never writes. */
export function doctor(): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;

  const need = (label: string, present: boolean, detail: string) => {
    lines.push(`${present ? "OK  " : "MISS"}  ${label.padEnd(30)} ${detail}`);
    if (!present) ok = false;
  };

  need("DISCORD_BOT_TOKEN", Boolean(env.discordToken), env.discordToken ? "set" : "required to post");
  need(
    "DISCORD_GUILD_ID",
    Boolean(env.discordGuildId),
    env.discordGuildId ?? "required to find the server"
  );
  lines.push(`      channel                        #${env.usdcDiscordChannel}`);
  lines.push(`      category                       ${env.usdcDiscordCategory}`);
  lines.push("");

  // Providers. Neither is required — the scanner falls back to public RPC — but
  // which one is in use changes the rate limits the tick operates under, so it
  // has to be visible.
  lines.push(
    `      ALCHEMY_API_KEY                ${env.alchemyKey ? "set (primary for enabled networks)" : "absent — public RPC only"}`
  );
  // Not "falls back to the public endpoint": Solana USDC needs the Helius parsed-
  // transaction API, and the public RPC has no equivalent. Without the key the
  // Solana adapter reads nothing at all, and saying otherwise would hide a gap.
  lines.push(
    `      HELIUS_API_KEY                 ${env.heliusKey ? "set" : "absent — SOLANA IS NOT READ AT ALL"}`
  );
  lines.push("");

  const scanned = getEvmScanAssets();
  const all = getAllUsdcAssets();
  lines.push(`      registry                       ${all.length} chains, ${scanned.length} EVM scanned`);
  for (const a of all) {
    const domain = a.cctpDomain === null ? "no CCTP" : `CCTP ${a.cctpDomain}`;
    const mark = a.scan ? " " : "·";
    lines.push(`       ${mark} ${a.chainName.padEnd(19)} ${a.contractOrMint}  ${domain}`);
  }
  lines.push("");

  const problems = registryProblems();
  if (problems.length) {
    lines.push("MISS  registry consistency");
    for (const p of problems) lines.push(`        ! ${p}`);
    ok = false;
  } else {
    lines.push("OK    registry consistency       every CCTP domain names its own chain");
  }

  if (env.usdcPassThroughMinUsd > env.usdcAlertMinUsd) {
    lines.push(
      "MISS  threshold order            USDC_PASS_THROUGH_MIN_USD is above USDC_ALERT_MIN_USD — " +
        "relay legs could be posted unchecked"
    );
    ok = false;
  }
  lines.push("");

  const wallets = loadFurlPayTrackedWallets();
  lines.push(
    `      FurlPay tracked wallets        ${wallets.length}${
      wallets.length === 0
        ? " (set FURLPAY_TRACKED_WALLETS to alert on your own movements)"
        : ""
    }`
  );
  for (const w of wallets) {
    lines.push(`         ${w.chainSlug.padEnd(12)} ${w.address}  ${w.label}`);
  }
  // A refused entry is the failure mode that matters here: the address is
  // configured, looks applied, and matches nothing.
  const walletProblems = furlPayConfigProblems();
  if (walletProblems.length) {
    lines.push(`      REFUSED wallet entries         ${walletProblems.length}`);
    for (const p of walletProblems) lines.push(`         ! ${p.entry} — ${p.problem}`);
    ok = false;
  }
  lines.push("");

  lines.push(`      whale floor                    $${env.usdcWhaleMinUsd.toLocaleString()}`);
  lines.push(`      realtime alert floor           $${env.usdcAlertMinUsd.toLocaleString()}`);
  lines.push(`      cold-start backfill            ${env.usdcBackfillHours}h`);
  lines.push("");

  /* --- Measured, not configured ----------------------------------- */
  //
  // The half of this report that is worth more than the other half. Everything
  // above is what we asked for; this is what actually happened.

  const dayAgo = Date.now() - DAY_MS;
  const rows = usdcDb.countSince(dayAgo);
  const coverage = coverageSince(dayAgo);

  // INGESTION LAG FIRST, because it is the one number that distinguishes a quiet
  // market from broken ingestion — and those are indistinguishable from the Discord
  // channel, which is where this subsystem is most likely to mislead.
  const lag = ingestionLagSec();
  if (lag === null) {
    lines.push("      ingestion lag                  NO DATA — nothing has ever been stored");
    ok = false;
  } else {
    const mins = Math.round(lag / 60);
    const stale = lag > STALE_LAG_SEC;
    lines.push(
      `      ingestion lag                  ${mins}m behind the newest stored transfer` +
        (stale ? "   <-- STALE" : "")
    );
    if (stale) ok = false;
  }
  lines.push("");

  lines.push("      INGESTION — last 24h");
  if (coverage.length === 0) {
    lines.push("        no scans recorded. Nothing has been ingested yet.");
    lines.push("        run `npm run usdc:scan` to confirm chain reads work.");
  } else {
    lines.push(`        transfers stored             ${rows}`);
    for (const c of coverage) {
      const cursor = cursors.get(c.chainSlug, SCANNER);
      const age =
        c.lastRunAt === null
          ? "never"
          : `${Math.round((Date.now() - c.lastRunAt) / 60000)}m ago`;
      const health = c.errors > 0 ? `${c.errors}/${c.runs} FAILED` : `${c.runs} ok`;
      lines.push(
        `        ${c.chainSlug.padEnd(12)} ${String(c.rowsNew).padStart(6)} rows  ` +
          `${String(c.logsSeen).padStart(7)} logs  block ${cursor.lastBlock ?? "-"}  ${health}  ${age}`
      );
      if (c.lastError) lines.push(`          last error: ${c.lastError.slice(0, 90)}`);
      // The breakdown, because the count alone cannot say whether a drop was
      // ordinary filtering or lost coverage. zero-value is benign; no-timestamp is
      // not.
      if (c.droppedDetail) lines.push(`          dropped: ${c.droppedDetail}`);
    }
    // A chain in the registry with no scan row at all is the failure mode most
    // easily missed: it looks like a quiet chain rather than an absent one.
    const seen = new Set(coverage.map((c) => c.chainSlug));
    const silent = getEvmScanAssets()
      .map((a) => a.chainSlug)
      .filter((s) => !seen.has(s));
    if (silent.length) {
      lines.push(`        NOT SCANNED AT ALL: ${silent.join(", ")}`);
      ok = false;
    }
  }

  return { ok, lines };
}

/**
 * Assess historical rows for being relayed money.
 *
 * Batched so a large window does not hold one enormous transaction, and bounded by
 * the same floor the scanner uses so the two agree about what was checked.
 */
export function reclassifyRelays(hours: number): { assessed: number; relays: number; ms: number } {
  const started = Date.now();
  const since = started - hours * 60 * 60 * 1000;
  const floor = env.usdcPassThroughMinUsd;
  const BATCH = 2_000;

  let assessed = 0;
  let relays = 0;
  let afterId = 0;

  // Keyset paging on id. A row found independent is left unmarked, so the filter
  // alone would return it again on every pass — paging on a strictly increasing id
  // is what makes this terminate rather than spin.
  for (;;) {
    const batch = usdcDb.unassessedForRelay(floor, since, BATCH, afterId);
    if (batch.length === 0) break;

    for (const t of batch) {
      const prior = usdcDb.precedingLeg(t, PASS_THROUGH_WINDOW_MS);
      if (prior) {
        usdcDb.markPassThrough(t.id, prior.isReversal ? "reversal" : "hop", prior.id);
        relays += 1;
      }
      assessed += 1;
      afterId = Math.max(afterId, t.id);
    }

    if (batch.length < BATCH) break;
  }

  return { assessed, relays, ms: Date.now() - started };
}

/**
 * Prove data coverage from the ledgers.
 *
 * The distinction from `integrity`: that command checks whether stored rows are
 * internally consistent; this one checks whether the stored rows are COMPLETE. A
 * table can be perfectly consistent and missing a third of a chain.
 *
 * Nothing here says "100%" unless the range ledger supports it. `usdc_scan_ranges`
 * records only fully-read ranges — deliberately stopping short of a block whose
 * transfers could not be dated — so a gap is arithmetic, not an opinion.
 */
export function reconcile(): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  const day = Date.now() - 24 * 60 * 60 * 1000;

  lines.push("BLOCK COVERAGE — from the merged scan-range ledger");
  lines.push("");
  let totalMissing = 0;
  let chainsWithCoverage = 0;

  for (const asset of getEvmScanAssets()) {
    const cov = chainCoverage(asset.chainSlug);
    const heads = storedHeads(asset.chainSlug);

    if (cov.firstBlock === null) {
      lines.push(`  ${asset.chainSlug.padEnd(12)} no coverage recorded yet`);
      continue;
    }

    chainsWithCoverage += 1;
    const pct = cov.spanBlocks > 0 ? (100 * cov.coveredBlocks) / cov.spanBlocks : 0;
    const verdict = cov.missingBlocks === 0 ? "COMPLETE" : `${cov.missingBlocks} MISSING`;
    totalMissing += cov.missingBlocks;
    if (cov.missingBlocks > 0) ok = false;

    lines.push(
      `  ${asset.chainSlug.padEnd(12)} ${cov.firstBlock}-${cov.lastBlock} ` +
        `(${cov.spanBlocks.toLocaleString("en-US")} blocks) ` +
        `${pct.toFixed(3)}%  ${verdict}`
    );
    for (const g of cov.gaps.slice(0, 3)) {
      lines.push(`      gap ${g.fromBlock}-${g.toBlock} (${g.blocks} blocks)`);
    }
    // Lag against the chain head, so "complete" cannot mean "complete but hours
    // behind" without saying so.
    if (heads?.latest != null && cov.lastBlock !== null) {
      const behind = heads.latest - cov.lastBlock;
      if (behind > 0) lines.push(`      ${behind.toLocaleString("en-US")} blocks behind head`);
    }
  }

  lines.push("");
  // ZERO GAPS OVER ZERO COVERAGE IS NOT A PASS.
  //
  // "No missing blocks" is trivially true when no range has ever been claimed, and
  // printing PASS there would be the most convincing kind of wrong output — a green
  // verdict on an empty ledger. The verdict therefore requires coverage to exist.
  if (chainsWithCoverage === 0) {
    lines.push("  UNKNOWN  no coverage recorded on any chain — nothing to reconcile yet.");
    lines.push("           Run a tick first; this is not a pass.");
    ok = false;
  } else if (chainsWithCoverage < getEvmScanAssets().length) {
    const without = getEvmScanAssets().length - chainsWithCoverage;
    lines.push(
      `  PARTIAL  ${chainsWithCoverage}/${getEvmScanAssets().length} chains have coverage; ` +
        `${without} have none and are therefore unverified.`
    );
    if (totalMissing > 0) lines.push(`           ${totalMissing} block(s) missing where coverage exists.`);
    ok = false;
  } else {
    lines.push(`  ${totalMissing === 0 ? "PASS" : "FAIL"}  total missing blocks: ${totalMissing}`);
  }
  lines.push("");

  /* --- Finality ---------------------------------------------------- */
  lines.push("FINALITY — how much of the last 24h is settled");
  lines.push("");
  const fin = usdcDb.finalityBreakdown(day);
  const live = fin.observed.usd + fin.canonical.usd + fin.final.usd;
  const m = (n: number) => `$${(n / 1e6).toFixed(1)}M`;
  const pct = (n: number) => (live > 0 ? `${((100 * n) / live).toFixed(1)}%` : "-");
  lines.push(`  final      ${String(fin.final.count).padStart(8)}  ${m(fin.final.usd).padStart(10)}  ${pct(fin.final.usd)}`);
  lines.push(`  canonical  ${String(fin.canonical.count).padStart(8)}  ${m(fin.canonical.usd).padStart(10)}  ${pct(fin.canonical.usd)}`);
  lines.push(`  observed   ${String(fin.observed.count).padStart(8)}  ${m(fin.observed.usd).padStart(10)}  ${pct(fin.observed.usd)}`);
  lines.push(`  reorged    ${String(fin.reorged.count).padStart(8)}  ${m(fin.reorged.usd).padStart(10)}  (excluded from every figure)`);
  lines.push("");
  lines.push("  Rows predating migration 0016 read as 'observed' — that is what was");
  lines.push("  known about them, and back-dating them to 'final' would assert a check");
  lines.push("  that never happened.");
  if (live > 0 && fin.final.usd === 0) {
    lines.push("");
    lines.push("  NOTE: nothing is marked final yet, so every figure above this line is");
    lines.push("  provisional. That is expected until a tick has run the finality pass.");
  }
  lines.push("");

  /* --- Chain heads ------------------------------------------------- */
  lines.push("CHAIN HEADS — finality lag, and which chains report optimistically");
  lines.push("");
  for (const asset of getEvmScanAssets()) {
    const h = storedHeads(asset.chainSlug);
    if (!h || h.latest === null) {
      lines.push(`  ${asset.chainSlug.padEnd(12)} not yet read`);
      continue;
    }
    const lag = h.finalized === null ? null : h.latest - h.finalized;
    lines.push(
      `  ${asset.chainSlug.padEnd(12)} latest ${String(h.latest).padStart(11)} ` +
        `finalized ${String(h.finalized ?? "-").padStart(11)} ` +
        `lag ${String(lag ?? "-").padStart(6)} ` +
        `floor ${String(confirmationFloor(asset.chainSlug)).padStart(4)}` +
        (h.optimistic ? "   OPTIMISTIC TAG — the floor is doing the work" : "")
    );
  }
  lines.push("");

  /* --- Provider cross-validation ----------------------------------- */
  lines.push("PROVIDER CROSS-VALIDATION — Alchemy is not the source of truth");
  lines.push("");
  const checks = crossCheckSummary(day);
  if (checks.length === 0) {
    lines.push("  no cross-checks recorded in the last 24h");
  } else {
    for (const c of checks) {
      const bad = c.disagreements > 0;
      if (bad) ok = false;
      lines.push(
        `  ${c.chainSlug.padEnd(12)} ${String(c.checks).padStart(4)} checks  ` +
          (bad ? `${c.disagreements} DISAGREEMENT(S)` : "all agreed")
      );
    }
  }
  const unchecked = getEvmScanAssets()
    .map((a) => a.chainSlug)
    .filter((c) => !checks.some((k) => k.chainSlug === c));
  if (unchecked.length) {
    lines.push(`  never cross-checked: ${unchecked.join(", ")} — single-provider trust`);
  }
  lines.push("");

  /* --- Backfill queue ---------------------------------------------- */
  const open = pendingBackfills(50);
  lines.push(`BACKFILL QUEUE — ${open.length} open job(s)`);
  for (const j of open.slice(0, 8)) {
    lines.push(
      `  ${j.chainSlug.padEnd(12)} ${j.fromBlock}-${j.toBlock}  ${j.reason}  attempts ${j.attempts}`
    );
  }
  if (open.length) ok = false;

  return { ok, lines };
}

/**
 * Re-read the ranges the gap detector queued.
 *
 * Resumable and idempotent by construction: each job is a block range, re-reading it
 * is a no-op for rows already present, and a job is completed only after the range
 * reads cleanly. A job that keeps failing accumulates attempts and sorts to the back
 * rather than blocking the queue.
 */
export async function runGapBackfill(
  maxJobs = 5
): Promise<{ jobs: number; rowsNew: number; failed: number }> {
  const jobs = pendingBackfills(maxJobs);
  let rowsNew = 0;
  let failed = 0;

  for (const job of jobs) {
    markBackfillAttempt(job.id);
    const asset = getUsdcAsset(job.chainSlug);
    if (!asset) {
      // A queued job for a chain no longer in the registry can never succeed;
      // completing it stops it blocking the queue forever.
      completeBackfill(job.id);
      continue;
    }
    try {
      const r = await scanRange(asset, job.fromBlock, job.toBlock);
      rowsNew += r.rowsNew;
      if (r.error) {
        failed += 1;
      } else {
        recordCoverage(job.chainSlug, job.fromBlock, job.toBlock);
        completeBackfill(job.id);
      }
    } catch {
      failed += 1;
    }
  }

  return { jobs: jobs.length, rowsNew, failed };
}

/**
 * Check invariants against the stored rows.
 *
 * `doctor` asks whether the system is configured correctly; this asks whether the
 * data it produced is actually consistent with what it claims. They fail for
 * different reasons and a green doctor tells you nothing about a corrupt table.
 */
export function integrity(): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  const db = getDb();

  const check = (label: string, sql: string, detail: string, params: unknown[] = []) => {
    const r = db.prepare(sql).get(...(params as never[])) as { n: number };
    const bad = r.n ?? 0;
    lines.push(`${bad === 0 ? "OK  " : "FAIL"}  ${label.padEnd(38)} ${bad === 0 ? "0" : `${bad} rows — ${detail}`}`);
    if (bad > 0) ok = false;
  };

  const now = Date.now();

  // Timestamps. The Solana seconds/milliseconds mix-up dated every Solana row to
  // the year 58713, inserted cleanly, and silently fell outside every 24h window.
  check(
    "timestamps in the future",
    "SELECT COUNT(*) AS n FROM usdc_transfers WHERE ts > ?",
    "a block cannot be mined after now",
    [now + 60 * 60 * 1000]
  );
  check(
    "timestamps before 2015",
    "SELECT COUNT(*) AS n FROM usdc_transfers WHERE ts < 1420070400000",
    "almost certainly a seconds value stored as milliseconds",
  );

  // Amounts.
  check(
    "non-positive amounts",
    "SELECT COUNT(*) AS n FROM usdc_transfers WHERE amount <= 0 OR amount_usd <= 0",
    "a zero or negative transfer is not a transfer",
  );
  check(
    "amount/USD disagreement",
    // USDC is valued 1:1 with a depeg band, so these must track each other. A
    // divergence means the valuation path was bypassed.
    "SELECT COUNT(*) AS n FROM usdc_transfers WHERE abs(amount - amount_usd) > amount * 0.15 + 1",
    "amount and amount_usd have diverged beyond the depeg band",
  );
  check(
    "implausibly large amounts",
    // USDC total supply is around $70bn, so a single transfer above that is a
    // decimal-scaling error rather than a transfer.
    "SELECT COUNT(*) AS n FROM usdc_transfers WHERE amount_usd > 100000000000",
    "larger than USDC total supply — check decimal scaling",
  );

  // Provenance. A row that cannot say where it came from is a row nobody should
  // quote, and `source` is NOT NULL precisely so this can be asserted.
  check(
    "rows with no source",
    "SELECT COUNT(*) AS n FROM usdc_transfers WHERE source IS NULL OR source = ''",
    "every figure must be traceable to a provider",
  );
  check(
    "rows from a synthetic source",
    "SELECT COUNT(*) AS n FROM usdc_transfers WHERE source = 'probe' OR source = 'seed' OR source = 'fixture'",
    "nothing synthetic may ever reach this table",
  );

  // Token identity — the invariant the whole report rests on.
  const assets = getAllUsdcAssets();
  const pairs = assets.map((a) => `('${a.chainSlug}','${a.contractOrMint}')`).join(",");
  check(
    "transfers of a non-registry token",
    `SELECT COUNT(*) AS n FROM usdc_transfers
      WHERE (chain_slug, token_address) NOT IN (${pairs})`,
    "a token that is not verified native USDC for its chain",
  );

  // Dedupe key. The UNIQUE index should make this impossible; asserting it proves
  // the index exists and is doing its job rather than assuming it.
  check(
    "duplicate (chain, tx, logIndex)",
    `SELECT COUNT(*) AS n FROM (
       SELECT 1 FROM usdc_transfers GROUP BY chain_slug, tx_hash, log_index HAVING COUNT(*) > 1
     )`,
    "the dedupe key is not unique",
  );

  // Pass-through bookkeeping.
  check(
    "pass-through with no predecessor",
    "SELECT COUNT(*) AS n FROM usdc_transfers WHERE pass_through = 1 AND predecessor_id IS NULL",
    "a suppression that cannot be audited back to its cause",
  );
  check(
    "pass-through pointing at itself",
    "SELECT COUNT(*) AS n FROM usdc_transfers WHERE predecessor_id = id",
    "a row cannot be its own predecessor",
  );

  // CCTP.
  check(
    "completed CCTP with no destination",
    "SELECT COUNT(*) AS n FROM usdc_cctp_transfers WHERE status = 'completed' AND (dest_tx IS NULL OR dest_chain IS NULL)",
    "completed means both legs are known",
  );
  check(
    "CCTP mint before burn",
    "SELECT COUNT(*) AS n FROM usdc_cctp_transfers WHERE mint_ts IS NOT NULL AND mint_ts < burn_ts - 60000",
    "a mint cannot precede its burn",
  );
  check(
    "CCTP completed still keyed pending",
    "SELECT COUNT(*) AS n FROM usdc_cctp_transfers WHERE status = 'completed' AND correlation = 'none'",
    "completed without recording how the legs were matched",
  );

  // Posted rows must be auditable.
  check(
    "posted rows that were also suppressed",
    "SELECT COUNT(*) AS n FROM usdc_transfers WHERE posted_at IS NOT NULL AND suppressed_reason IS NOT NULL",
    "a transfer cannot be both published and suppressed",
  );
  check(
    "posted rows that are relayed money",
    "SELECT COUNT(*) AS n FROM usdc_transfers WHERE posted_at IS NOT NULL AND pass_through = 1",
    "a relay leg was published as an independent movement",
  );

  lines.push("");
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS rows, COALESCE(SUM(amount_usd),0) AS usd,
              SUM(CASE WHEN pass_through=1 THEN 1 ELSE 0 END) AS relays,
              SUM(CASE WHEN posted_at IS NOT NULL THEN 1 ELSE 0 END) AS posted
         FROM usdc_transfers`
    )
    .get() as { rows: number; usd: number; relays: number; posted: number };
  lines.push(
    `      ${counts.rows.toLocaleString("en-US")} transfers · ` +
      `$${(counts.usd / 1e9).toFixed(2)}bn · ` +
      `${counts.relays.toLocaleString("en-US")} relays · ${counts.posted} posted`
  );

  return { ok, lines };
}

/** Read the registry's claims back off chain. */
export async function verify(): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  let ok = true;
  for (const asset of getAllUsdcAssets()) {
    const r = await verifyAsset(asset);
    lines.push(`${r.ok ? "OK  " : "FAIL"}  ${asset.chainName.padEnd(20)} ${r.detail}`);
    if (!r.ok) ok = false;
  }
  return { ok, lines };
}

/**
 * Post one probe embed.
 *
 * Deliberately marked as a probe in the title and given a zero amount, so it
 * cannot be read as a real observed transfer if somebody scrolls past it later.
 * Nothing on the automated path calls this.
 */
export async function probe(): Promise<void> {
  const { id } = await ensureUsdcChannel();
  const pub = Publisher.fromEnv();

  const asset = getAllUsdcAssets()[0];
  if (!asset) throw new Error("the USDC registry is empty — nothing to probe with");

  const probeTransfer: UsdcTransfer = {
    chainSlug: asset.chainSlug,
    tokenAddress: asset.contractOrMint,
    txHash: "0x" + "0".repeat(64),
    logIndex: 0,
    blockNumber: null,
    timestamp: Date.now(),
    fromAddress: "0x" + "0".repeat(40),
    toAddress: "0x" + "0".repeat(40),
    amount: 0,
    amountUsd: 0,
    fromLabel: "PROBE — not a real address",
    toLabel: "PROBE — not a real address",
    fromCategory: "unknown",
    toCategory: "unknown",
    fromEntity: null,
    toEntity: null,
    classification: "UNKNOWN",
    isWhale: false,
    isExchange: false,
    isCctp: false,
    isFurlPay: false,
    cctpNonce: null,
    source: "probe",
    explorerUrl: null,
    alerted: false,
    createdAt: Date.now(),
  };

  const embed = usdcTransferEmbed(probeTransfer).setTitle(
    "🧪 PROBE — channel and formatting check (not a real transfer)"
  );

  await pub.send(id, [embed], "Setup probe. Delete this message once verified.");
  log.info("probe posted", { channelId: id });
}

/**
 * Publish one transfer if it clears the alert bar.
 *
 * Kept exported for callers outside the tick. The threshold check lives in
 * classify.ts and is called rather than reimplemented, so the channel cannot
 * drift from the classifier's idea of what is significant.
 */
export async function publishTransfer(t: UsdcTransfer, channelId: string): Promise<boolean> {
  if (!isUsdcAlertWorthy(t.amountUsd, t.isFurlPay)) return false;
  const pub = Publisher.fromEnv();
  await pub.send(channelId, [usdcTransferEmbed(t)]);
  log.info("usdc alert posted", {
    chain: t.chainSlug,
    amountUsd: t.amountUsd,
    tier: getUsdcTier(t.amountUsd).label,
    classification: t.classification,
  });
  return true;
}

/** Post the daily roll-up plus the reconciliation and its caveats. */
export async function postDaily(): Promise<void> {
  const channelId = await findChannelOrThrow();
  const pub = Publisher.fromEnv();
  const report = buildDailyReport();

  const embed = usdcDailyEmbed(report.stats);
  // The reconciliation and the caveats go in the same message as the numbers.
  // Splitting them across messages is how a caveat gets scrolled past.
  embed.addFields({
    name: "Raw volume reconciled",
    value: "```\n" + reconciliationLines(report.reconciliation).join("\n") + "\n```",
  });
  embed.addFields({
    name: "Coverage and caveats",
    value: report.caveats.map((c) => `• ${c}`).join("\n").slice(0, 1024),
  });

  await pub.send(channelId, [embed]);
  log.info("daily posted", {
    rawUsd: Math.round(report.reconciliation.rawVolumeUsd),
    betweenPartiesUsd: Math.round(report.reconciliation.betweenPartiesUsd),
    transfers: report.stats.transferCount,
  });
}

/** Post the rolling exchange-flow summary. */
export async function postFlows(hours = 24): Promise<void> {
  const channelId = await findChannelOrThrow();
  const pub = Publisher.fromEnv();
  const flows = exchangeFlows(Date.now() - hours * 60 * 60 * 1000);
  await pub.send(channelId, [exchangeFlowEmbed(flows, `last ${hours}h`)]);
  log.info("flows posted", { chains: flows.length });
}

/**
 * Clear the scanner cursors so the next scan starts from the backfill window.
 *
 * Does not delete rows — the UNIQUE index makes rescanning the same blocks
 * harmless, and dropping observed data to re-fetch it would trade something we
 * have for something we might not get back.
 */
function resetCursors(): number {
  let n = 0;
  for (const asset of getEvmScanAssets()) {
    cursors.set(asset.chainSlug, SCANNER, null);
    cursors.set(asset.chainSlug, CCTP_SCANNER, null);
    n += 1;
  }
  return n;
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "doctor";

  // Opening the database runs the migrations, so this one call is what
  // guarantees the schema is present. Cheap and idempotent, so it happens
  // unconditionally rather than being remembered per command.
  getDb();

  // FAIL BEFORE DOING ANYTHING, not after publishing something wrong.
  //
  // Both of these guard against a misconfiguration whose symptom is plausible
  // output rather than an error: a CCTP domain that names the wrong chain, or a
  // pass-through floor above the alert floor, which would let a relay leg be posted
  // as an independent whale movement without ever being checked. `doctor` reports
  // the same problems without throwing, so a broken config can still be diagnosed.
  if (cmd !== "doctor") {
    assertRegistryConsistent();
    assertUsdcThresholds();
  }

  switch (cmd) {
    case "ensure": {
      const { id, created } = await ensureUsdcChannel();
      console.log(`${created ? "created" : "found"} #${env.usdcDiscordChannel} (${id})`);
      break;
    }

    case "probe":
      await probe();
      console.log("probe posted");
      break;

    case "doctor": {
      const { ok, lines } = doctor();
      console.log("\nUSDC intelligence — configuration and coverage\n");
      for (const l of lines) console.log("  " + l);
      console.log("");
      process.exit(ok ? 0 : 1);
    }

    case "verify": {
      console.log("\nReading symbol() and decimals() off chain for every registry entry...\n");
      const { ok, lines } = await verify();
      for (const l of lines) console.log("  " + l);
      console.log("");
      process.exit(ok ? 0 : 1);
    }

    case "scan": {
      // Scan with no Discord target. The way to answer "is ingestion working?"
      // without posting anything.
      console.log("\nScanning (no Discord output)...\n");
      const evm = await scanAllEvmChains();
      for (const r of evm) {
        const d = r.dropped;
        const dropped =
          d.zeroAmount + d.noTimestamp + d.notNativeUsdc === 0
            ? ""
            : `  dropped ${d.zeroAmount + d.noTimestamp + d.notNativeUsdc}` +
              ` (zero-value ${d.zeroAmount}, no-timestamp ${d.noTimestamp}, not-usdc ${d.notNativeUsdc})`;
        const line = `  ${r.chainSlug.padEnd(12)} blocks ${r.fromBlock}-${r.toBlock}  ${String(r.logsSeen).padStart(6)} logs  ${String(r.rowsNew).padStart(5)} new${dropped}`;
        console.log(r.error ? `${line}  ERROR: ${r.error}` : line);
      }
      const sol = await scanSolanaUsdc();
      console.log(
        `  ${"solana".padEnd(12)} ${sol.addressesChecked} addresses  ${sol.transfersFound} found  ${sol.rowsNew} new${sol.error ? `  ERROR: ${sol.error}` : ""}`
      );
      const { results, attestation } = await scanAllCctp();
      for (const r of results) {
        if (r.burnsNew || r.completed || r.error) {
          console.log(
            `  cctp/${r.chainSlug.padEnd(8)} ${r.burnsNew} burns  ${r.completed} completed${r.error ? `  ERROR: ${r.error}` : ""}`
          );
        }
      }
      console.log(
        `  attestation  ${attestation.checked} checked, ${attestation.resolved} nonces assigned`
      );
      const total = evm.reduce((s, r) => s + r.rowsNew, 0) + sol.rowsNew;
      console.log(`\n  ${total} new transfer(s) stored\n`);
      break;
    }

    case "tick": {
      const channelId = await findChannelOrThrow();

      // EVERY WRITING COMMAND TAKES THE LEASE. The scheduler fires every 2-5
      // minutes and a full tick measures about four, so two runs overlapping is
      // normal — and two runs both selecting from the same unalerted set post the
      // same movement to Discord twice.
      const outcome = await withLease("usdc-tick", (lease) =>
        runTick(channelId, () => lease.renew())
      );

      if (!outcome.ran) {
        // Not an error. Another tick is working; this one steps aside. Exiting 0
        // keeps Task Scheduler's history readable — a red entry every few minutes
        // trains the operator to ignore it.
        console.log(
          `another tick holds the lease (${outcome.heldBy}), ` +
            `expires in ${Math.round(outcome.expiresInMs / 1000)}s — skipping`
        );
        process.exit(0);
      }

      const r = outcome.value;
      console.log(summariseTick(r));
      for (const e of r.errors) console.error(`  ! ${e}`);
      // A tick that posted nothing because nothing cleared the bar is a success.
      // A tick where every chain errored is not, and the exit code has to say so.
      const allFailed = r.evm.length > 0 && r.evm.every((e) => e.error !== null);
      process.exit(allFailed || r.abandoned ? 1 : 0);
    }

    case "backfill": {
      // A backfill resets cursors and rescans wide ranges. Doing that while a tick
      // is mid-scan would have both writing the same chain's cursor.
      const lease = acquire("usdc-tick", 60 * 60 * 1000);
      if (isDenied(lease)) {
        console.error(
          `\n  A tick holds the lease (${lease.heldBy}), expires in ` +
            `${Math.round(lease.expiresInMs / 1000)}s. Wait, or stop the scheduled task first.\n`
        );
        process.exit(75);
      }
      const n = resetCursors();
      console.log(
        `\nReset ${n} chain cursor(s). Next scan reaches back up to ${env.usdcBackfillHours}h.`
      );
      console.log("Existing rows are kept — the UNIQUE index makes a rescan idempotent.\n");
      const evm = await scanAllEvmChains();
      let total = 0;
      for (const r of evm) {
        total += r.rowsNew;
        const line = `  ${r.chainSlug.padEnd(12)} blocks ${r.fromBlock}-${r.toBlock}  ${String(r.rowsNew).padStart(5)} new`;
        console.log(r.error ? `${line}  ERROR: ${r.error}` : line);
      }
      console.log(`\n  ${total} transfer(s) stored\n`);
      lease.release();
      break;
    }

    case "daily": {
      // Under the same lease as the tick: the daily report reads the tables a tick
      // is actively writing, and two dailies racing would post the roll-up twice.
      const r = await withLease("usdc-tick", async () => {
        await postDaily();
      });
      if (!r.ran) {
        console.log(`a tick holds the lease (${r.heldBy}) — daily not posted, retry shortly`);
        process.exit(75); // EX_TEMPFAIL: retryable, not a defect
      }
      console.log("daily report posted");
      break;
    }

    case "flows": {
      const r = await withLease("usdc-tick", async () => {
        await postFlows(Number(process.argv[3]) || 24);
      });
      if (!r.ran) {
        console.log(`a tick holds the lease (${r.heldBy}) — flows not posted, retry shortly`);
        process.exit(75);
      }
      console.log("exchange flows posted");
      break;
    }

    case "repair": {
      // Deliberately separate from `integrity`, which only reports. Repair mutates,
      // so it is an explicit action rather than something a health check does on its
      // own — a check that silently deletes rows is not a check.
      const r = await withLease("usdc-tick", async () => {
        const removed = usdcDb.deleteImpossibleTimestamps();
        return removed;
      });
      if (!r.ran) {
        console.log(`a tick holds the lease (${r.heldBy}) — repair skipped`);
        process.exit(75);
      }
      console.log(
        `\n  removed ${r.value} row(s) with an impossible timestamp.\n` +
          `  Their blocks will be re-ingested on the next scan — the dedupe key is\n` +
          `  (chain, tx, logIndex), not the timestamp, so nothing is permanently lost.\n`
      );
      break;
    }

    case "reclassify-relays": {
      // One-off after migration 0014: rows ingested before the pass_through column
      // existed default to 0, which is indistinguishable from "checked and found
      // independent", so the rolling 24h report under-deducts relays until the
      // window clears the migration.
      const hours = Number(process.argv[3]) || 48;
      const r = await withLease("usdc-tick", async () => reclassifyRelays(hours));
      if (!r.ran) {
        console.log(`a tick holds the lease (${r.heldBy}) — reclassify skipped`);
        process.exit(75);
      }
      const { assessed, relays, ms } = r.value;
      console.log(
        `\n  assessed ${assessed.toLocaleString("en-US")} transfer(s) over ${hours}h in ${(ms / 1000).toFixed(1)}s\n` +
          `  ${relays.toLocaleString("en-US")} were relayed money and are now deducted from the report\n`
      );
      break;
    }

    case "reconcile": {
      // PROVES coverage rather than claiming it. Every line is derived from the
      // merged scan-range ledger and the block ledger, so "complete" here means
      // "every block in the claimed span was read", not "we did not notice a problem".
      const { ok: recOk, lines } = reconcile();
      console.log("\nUSDC reconciliation\n");
      for (const l of lines) console.log("  " + l);
      console.log("");
      process.exit(recOk ? 0 : 1);
    }

    case "backfill-gaps": {
      // Works the queue the gap detector fills. Separate from `backfill`, which resets
      // cursors and rescans a time window — this re-reads specific missing ranges.
      const r = await withLease("usdc-tick", async () => runGapBackfill());
      if (!r.ran) {
        console.log(`a tick holds the lease (${r.heldBy}) — gap backfill skipped`);
        process.exit(75);
      }
      const { jobs, rowsNew, failed } = r.value;
      console.log(
        `\n  worked ${jobs} gap job(s), ${rowsNew} transfer(s) recovered` +
          (failed ? `, ${failed} still failing` : "") +
          "\n"
      );
      break;
    }

    case "integrity": {
      // Checks the DATA, where doctor checks the configuration. Every assertion
      // here is an invariant the pipeline is supposed to guarantee; finding a
      // violation means a bug shipped, not that the config is wrong.
      const { ok: intOk, lines } = integrity();
      console.log("\nUSDC stored-data integrity\n");
      for (const l of lines) console.log("  " + l);
      console.log("");
      process.exit(intOk ? 0 : 1);
    }

    case "report": {
      // Console-only version of the daily, for checking the numbers before they
      // are published.
      const report = buildDailyReport();
      console.log(`\nUSDC — last 24h (${report.stats.date})\n`);
      for (const l of reconciliationLines(report.reconciliation)) console.log("  " + l);
      console.log(`\n  transfers ${report.stats.transferCount} across ${report.stats.chainsActive} chain(s)`);
      console.log(`  cross-chain (CCTP) ${report.stats.cctpCount} completed, $${(report.stats.cctpVolumeUsd / 1e6).toFixed(2)}M`);
      console.log("\n  caveats:");
      for (const c of report.caveats) console.log(`   • ${c}`);
      console.log("");
      break;
    }

    default:
      console.error(
        `unknown command: ${cmd}\n` +
          "usage: usdc <doctor|verify|integrity|reconcile|repair|ensure|scan|tick|backfill|backfill-gaps|reclassify-relays|daily|flows|report|probe>"
      );
      process.exit(2);
  }
}

// Only run when invoked directly, so the exported helpers stay importable.
if (process.argv[1]?.includes("usdc")) {
  main().catch((e) => {
    log.error("usdc command failed", { error: (e as Error).message });
    console.error(`\n  FAILED: ${(e as Error).message}\n`);
    process.exit(1);
  });
}

export {
  classifyUsdcTransfer,
  resolveEntity,
  getUsdcAsset,
  exchangeFlowEmbed,
  usdcDailyEmbed,
  cctpDomainName,
  runTick,
  buildDailyReport,
};
export type { UsdcDailyStats };
