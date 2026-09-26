// The daily run.
//
// One command that: refreshes every collector, scans for whales, then posts the
// dashboard into #chain-tracker. Safe to run repeatedly — the dashboard message
// is edited in place rather than reposted, so running it hourly during the day
// keeps the pinned board live while the digest posts once.
//
// Designed to be driven by Task Scheduler / cron, so nothing has to stay
// resident for the daily post to happen.

import { env, assertBootable } from "./config/env.js";
import { getDb, chains, whales, guilds } from "./db/index.js";
import {
  collectDefi, collectHeads, collectPrices, collectWhales, prune, scoreWallets, seedAll,
} from "./collectors/index.js";
import { Publisher } from "./bot/publisher.js";
import {
  buildRows, computeTotals, dashboardEmbed, exchangeFlowEmbed, whaleDigestEmbed,
} from "./bot/ui/embeds.js";
import { loadChainEmojis } from "./bot/ui/theme.js";
import { loadEmojiMap } from "./scripts/setup-icons.js";
import { makeLogger } from "./util/logger.js";
import { usd } from "./util/fmt.js";

const log = makeLogger("daily");

/** Footer marker used to find and edit yesterday's board. */
export const BOARD_MARKER = "ChainTracker board";

export const CHANNEL = {
  name: "chain-tracker",
  category: "CHAINTRACKER",
  topic:
    "Live multi-chain intelligence — prices, TVL, whales and network health across 28 chains. " +
    "Updated daily by ChainTracker. Data: CoinGecko, DeFiLlama, on-chain RPC.",
};

export interface DailyOptions {
  /** Refresh data before posting. Off makes a post-only dry run. */
  collect?: boolean;
  /** Post the whale digest as a separate message. */
  digest?: boolean;
  /** Do everything except the Discord write. */
  dryRun?: boolean;
  guildId?: string;
}

export async function runDaily(opts: DailyOptions = {}): Promise<{
  channelId: string | null;
  boardMessageId: string | null;
  digestMessageId: string | null;
  totals: ReturnType<typeof computeTotals>;
}> {
  const collect = opts.collect ?? true;
  const guildId = opts.guildId ?? env.discordGuildId;

  getDb();
  seedAll();

  // Chain marks are uploaded once by `setup-icons`; this loads the resulting
  // slug → "<:ct_x:id>" map. Absent map means the embeds simply render without
  // artwork rather than printing broken emoji markup.
  const icons = loadEmojiMap();
  loadChainEmojis(icons);
  log.info("chain icons loaded", { count: Object.keys(icons).length });

  /* ---------------- collect ---------------- */
  if (collect) {
    log.info("collecting");
    const p = await collectPrices();
    log.info("prices", { updated: p.updated, err: p.error ?? undefined });

    const d = await collectDefi();
    log.info("defi", { chains: d.updated, err: d.error ?? undefined });

    const h = await collectHeads();
    log.info("heads", { ok: h.ok, failed: h.failed });

    for (const tier of [1, 2] as const) {
      const w = await collectWhales(tier);
      log.info("whales", { tier, scanned: w.scanned, found: w.found });
    }
    scoreWallets();
    prune();
  }

  /* ---------------- render ---------------- */
  const rows = buildRows();
  const totals = computeTotals(rows);
  const board = dashboardEmbed(rows, { page: 0, perPage: 15 });
  // Tag the board so tomorrow's run can find and edit it.
  const footer = board.data.footer?.text ?? "";
  board.setFooter({ text: `${BOARD_MARKER} • ${footer}`.slice(0, 2048) });

  const since = Date.now() - 86_400_000;
  const topWhales = whales.largest(null, since, 20);
  const digest = whaleDigestEmbed(topWhales, "last 24h");
  const flows = exchangeFlowEmbed(86_400_000);

  log.info("rendered", {
    chains: totals.chainsTracked,
    mcap: usd(totals.globalMarketCap),
    trackedMcap: usd(totals.trackedMarketCap),
    tvl: usd(totals.totalTvl),
    whales24h: totals.whales24h,
  });

  if (opts.dryRun || !guildId) {
    if (!guildId) log.warn("DISCORD_GUILD_ID not set — nothing posted");
    return { channelId: null, boardMessageId: null, digestMessageId: null, totals };
  }

  /* ---------------- publish ---------------- */
  assertBootable();
  const pub = Publisher.fromEnv();
  const app = await pub.appInfo();
  log.info("publishing as", { app: app.name, id: app.id });

  const ch = await pub.ensureChannel({
    guildId,
    channelName: CHANNEL.name,
    categoryName: CHANNEL.category,
    topic: CHANNEL.topic,
  });
  guilds.register(guildId, null);

  const boardRes = await pub.upsertByMarker(ch.id, BOARD_MARKER, [board]);
  if (!boardRes.edited) await pub.pin(ch.id, boardRes.messageId);
  log.info("board posted", {
    channel: ch.name,
    messageId: boardRes.messageId,
    edited: boardRes.edited,
  });

  let digestId: string | null = null;
  if (opts.digest ?? true) {
    const sent = await pub.send(ch.id, [digest, flows]);
    digestId = sent.id;
    log.info("digest posted", { messageId: digestId, events: topWhales.length });
  }

  return {
    channelId: ch.id,
    boardMessageId: boardRes.messageId,
    digestMessageId: digestId,
    totals,
  };
}

/* Run directly: `node dist/daily.js [--no-collect] [--dry-run] [--no-digest]` */
const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("/daily.js");
if (isMain) {
  const args = new Set(process.argv.slice(2));
  runDaily({
    collect: !args.has("--no-collect"),
    digest: !args.has("--no-digest"),
    dryRun: args.has("--dry-run"),
  })
    .then((r) => {
      log.info("daily complete", {
        channelId: r.channelId ?? "(dry run)",
        board: r.boardMessageId ?? "-",
      });
      process.exit(0);
    })
    .catch((err) => {
      log.error("daily failed", { err: (err as Error).message });
      console.error(err);
      process.exit(1);
    });
}
