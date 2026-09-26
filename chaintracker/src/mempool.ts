// Entry point for the #mempool channel.
//
//   node dist/mempool.js watch [--dry-run] [--ticks N]
//       Resident. Walks every new block, samples the mempool, posts whale and
//       exploit alerts, keeps the pinned board live. This is what makes the
//       whale feed complete — see the note in mempool/whales.ts about why a
//       once-a-day pass cannot be.
//
//   node dist/mempool.js daily [--dry-run] [--no-digest]
//       Edits the board and posts the 24h digest. Reads only SQLite, so it is
//       fast and states its own coverage rather than assuming the watcher ran.
//
//   node dist/mempool.js once [--dry-run]
//       A single tick. Useful from a scheduler, and the thing to run first when
//       checking a new deployment.
//
//   node dist/mempool.js doctor
//       Which hosts answer, what the feeds return, what the database holds.
//       Makes no writes and needs no Discord credentials.

import { daily, tick, watch, config } from "./mempool/run.js";
import { makeClient, hostsFromEnv } from "./mempool/client.js";
import { readNetwork, congestionOf, congestionLabel, hashrateStr } from "./mempool/network.js";
import { refreshHacks, refreshSanctions } from "./mempool/threats.js";
import { btcScans, btcWhales, hacks } from "./db/mempool.js";
import { getDb } from "./db/index.js";
import { makeLogger } from "./util/logger.js";
import { usd } from "./util/fmt.js";

const log = makeLogger("mempool-cli");

/**
 * Report what is actually reachable and what is actually stored.
 * Every line is a measurement; nothing here is inferred from configuration.
 */
async function doctor(): Promise<void> {
  getDb();
  const client = makeClient();

  console.log("\nHosts");
  for (const h of hostsFromEnv()) {
    const started = Date.now();
    let verdict: string;
    try {
      const res = await fetch(h.base + "/blocks/tip/height", {
        signal: AbortSignal.timeout(12_000),
      });
      const body = (await res.text()).trim();
      verdict = res.ok ? `OK ${body.slice(0, 12)}` : `HTTP ${res.status}`;
    } catch (err) {
      const e = err as Error;
      verdict = e.name === "TimeoutError" || e.name === "AbortError" ? "UNREACHABLE (timeout)" : e.message.slice(0, 60);
    }
    console.log(
      `  ${new URL(h.base).hostname.padEnd(24)} ${h.caps.join("+").padEnd(14)} ` +
        `${String(h.rps).padStart(4)} rps  ${String(Date.now() - started).padStart(6)}ms  ${verdict}`,
    );
  }

  console.log("\nNetwork");
  const snap = await readNetwork(client);
  const cong = congestionOf(snap.mempoolVsize);
  console.log(`  tip              ${snap.tipHeight ?? "N/A"}`);
  console.log(`  waiting          ${snap.mempoolCount?.toLocaleString("en-US") ?? "N/A"}`);
  console.log(`  congestion       ${cong ? congestionLabel(cong) : "N/A"}`);
  console.log(`  fastest fee      ${snap.fees.fastest ?? "N/A"} s/vB`);
  console.log(`  hashrate         ${hashrateStr(snap.hashrate)}`);
  console.log(`  BTC price        ${snap.priceUsd !== null ? usd(snap.priceUsd, { compact: false }) : "N/A"}`);
  console.log(`  answered by      ${snap.sources.join(", ") || "(nothing)"}`);

  console.log("\nThreat feeds");
  const s = await refreshSanctions();
  console.log(`  sanctions        ${s.count} addresses${s.error ? ` — ERROR ${s.error}` : ""}`);
  if (s.count === 0) console.log("                   SCREENING IS OFF — zero hits would mean 'not checked'");
  const h = await refreshHacks();
  console.log(`  hacks            ${h.fetched} fetched, ${h.fresh.length} new${h.seeded ? " (seeded, none alerted)" : ""}${h.error ? ` — ERROR ${h.error}` : ""}`);

  console.log("\nStore");
  const since = Date.now() - 86_400_000;
  const stats = btcWhales.statsSince(since);
  const cov = btcScans.coverage(since);
  console.log(`  blocks walked    ${cov.complete} complete of ${cov.scanned} attempted (${cov.txsWalked.toLocaleString("en-US")} txs)`);
  console.log(`  confirmed whales ${stats.block.count}`);
  console.log(`  sampled whales   ${stats.mempool.count} (a floor)`);
  console.log(`  sanctions hits   ${stats.sanctioned}`);
  console.log(`  incidents held   ${hacks.size()}`);

  console.log("\nThresholds");
  console.log(`  whale            >= ${config.minWhaleBtc} BTC   (BTC_WHALE_MIN_BTC)`);
  console.log(`  alert            >= ${config.alertMinBtc} BTC   (BTC_ALERT_MIN_BTC)`);
  console.log(`  tick             ${config.tickSec}s        (BTC_TICK_SEC)`);
  console.log(`  blocks/tick      ${config.maxBlocksPerTick}          (BTC_MAX_BLOCKS_PER_TICK)`);
  console.log(`  http             ${JSON.stringify(client.stats())}\n`);
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("/mempool.js");
if (isMain) {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  const cmd = argv.find((a) => !a.startsWith("--")) ?? "once";
  const ticksArg = argv.find((a) => a.startsWith("--ticks="));
  const dryRun = args.has("--dry-run");

  // Ctrl-C and Task Scheduler's stop both arrive as signals; the watcher
  // finishes its current tick and exits cleanly rather than being killed
  // mid-write, which would leave a whale marked alerted but never posted.
  const ctl = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      log.info("stopping", { signal: sig });
      ctl.abort();
    });
  }

  const run = async (): Promise<void> => {
    switch (cmd) {
      case "watch":
        await watch({
          dryRun,
          signal: ctl.signal,
          maxTicks: ticksArg ? Number(ticksArg.split("=")[1]) : undefined,
        });
        return;
      case "daily": {
        const r = await daily({ dryRun, digest: !args.has("--no-digest") });
        log.info("daily complete", {
          channelId: r.channelId ?? "(dry run)",
          board: r.boardMessageId ?? "-",
          blocksEnumerated: r.coverage.complete,
        });
        return;
      }
      case "doctor":
        await doctor();
        return;
      case "once":
        // One tick with the same Discord wiring the watcher uses, so a
        // scheduler-driven single pass posts exactly what a resident one would.
        await watch({ dryRun, maxTicks: 1, signal: ctl.signal });
        return;
      default:
        console.error(`unknown command "${cmd}" — expected watch | daily | once | doctor`);
        process.exitCode = 2;
    }
  };

  run()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((err) => {
      log.error("mempool failed", { err: (err as Error).message });
      console.error(err);
      process.exit(1);
    });
}

export { daily, tick, watch, doctor };
