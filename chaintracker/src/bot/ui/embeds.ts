// Embed builders.
//
// The reference design is a dense terminal table, and Discord's proportional
// font cannot hold columns — so every table is rendered inside a code fence
// with display-width padding. That is the only way rows line up on both the
// desktop and mobile clients.
//
// The honesty rule that shapes this file: a column only exists if a free
// provider actually supplies it. Per-chain 24h transaction counts and daily
// active users have no free source across 28 chains, so they render as N/A
// with the reason attached rather than as a fabricated number.

import { EmbedBuilder } from "discord.js";
import { chains, head, metrics, prices, whales, wallets } from "../../db/index.js";
import { capabilitiesFor } from "../../providers/index.js";
import {
  bar, blockTime, count, fence, gwei, padCell, pct, relTime,
  shortAddr, shortHash, sparkline, tokens, usd,
} from "../../util/fmt.js";
import {
  COLOR, GLYPH, chainColor, chainIcon, freshness, freshnessGlyph, freshnessLabel,
  sourceFooter,
} from "./theme.js";
import { eventLabel, tierMeta, categoryLabel } from "../../whale/classify.js";
import type { ChainRow, WhaleEvent } from "../../types/index.js";

/** Why a metric is missing — shown instead of a zero. */
const NO_TXCOUNT = "no free per-chain tx-count source";
const NO_DAU = "no free active-address source";

export interface ChainViewRow {
  chain: ChainRow;
  priceUsd: number | null;
  marketCap: number | null;
  change24h: number | null;
  tvl: number | null;
  whales24h: number;
  spark: number[];
}

/**
 * Collapse the legs of a round trip.
 *
 * A swap or flash loan emits two Transfer logs for the same token inside one
 * transaction — A→B and B→A — and both are genuine. Listing both, and summing
 * both, would double the apparent volume, so the digest keeps one leg per
 * (tx, token, amount) and reports distinct movement instead.
 */
export function dedupeRoundTrips(events: WhaleEvent[]): WhaleEvent[] {
  const seen = new Set<string>();
  const out: WhaleEvent[] = [];
  for (const e of events) {
    // Round the amount so float noise cannot split one pair into two keys.
    const key = `${e.chainSlug}|${e.txHash}|${e.tokenSymbol}|${e.amount.toPrecision(10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** A transfer plus how many identical repeats it stands for. */
export interface CollapsedEvent {
  event: WhaleEvent;
  repeats: number;
}

/**
 * Collapse repeated bot cycles.
 *
 * Distinct from `dedupeRoundTrips`, which handles two legs inside ONE
 * transaction. This handles the other pattern seen on high-throughput L2s: the
 * same actor moving the same amount of the same token between the same two
 * addresses across many separate transactions — an arbitrage loop. Each
 * transfer is real, but reporting fifty of them as fifty whale sightings
 * misrepresents one actor as a crowd, so they are shown once with a count.
 */
export function collapseRepeats(events: WhaleEvent[]): CollapsedEvent[] {
  const groups = new Map<string, CollapsedEvent>();
  for (const e of dedupeRoundTrips(events)) {
    // 3 significant figures: a bot loop varies slightly per cycle.
    const key = [
      e.chainSlug,
      e.tokenSymbol,
      e.fromAddress.toLowerCase(),
      e.toAddress.toLowerCase(),
      e.amountUsd.toPrecision(3),
    ].join("|");
    const hit = groups.get(key);
    if (hit) {
      hit.repeats += 1;
      // Keep the most recent instance as the representative.
      if (e.timestamp > hit.event.timestamp) hit.event = e;
    } else {
      groups.set(key, { event: e, repeats: 1 });
    }
  }
  return [...groups.values()].sort((a, b) => b.event.amountUsd - a.event.amountUsd);
}

/** Assemble the ranked table rows from cached data only — no API calls. */
export function buildRows(filter?: (c: ChainRow) => boolean): ChainViewRow[] {
  const since = Date.now() - 86_400_000;
  const rows: ChainViewRow[] = [];
  for (const c of chains.all()) {
    if (filter && !filter(c)) continue;
    const q = c.coingeckoId ? prices.get(c.coingeckoId) : null;
    const m = metrics.get(c.slug);
    rows.push({
      chain: c,
      priceUsd: q?.priceUsd ?? null,
      marketCap: q?.marketCapUsd ?? null,
      change24h: q?.change24hPct ?? null,
      tvl: m?.tvlUsd ?? null,
      whales24h: whales.countSince(c.slug, since),
      spark: q?.sparkline7d?.slice(-24) ?? [],
    });
  }
  // Rank by market cap, but a chain with no token still needs a stable slot,
  // so those fall to TVL rather than dropping to the bottom as zero.
  rows.sort((a, b) => (b.marketCap ?? b.tvl ?? 0) - (a.marketCap ?? a.tvl ?? 0));
  return rows;
}

/* ------------------------------------------------------------------ */
/* Main dashboard                                                      */
/* ------------------------------------------------------------------ */

export interface DashboardTotals {
  chainsTracked: number;
  /** Sum of the tracked chains' OWN tokens. Not the whole crypto market. */
  trackedMarketCap: number | null;
  /** Whole-market cap from CoinGecko /global, when the collector has it. */
  globalMarketCap: number | null;
  totalTvl: number | null;
  whales24h: number;
  whaleVolume24h: number;
  marketCapChange24h: number | null;
}

export function computeTotals(rows: ChainViewRow[]): DashboardTotals {
  let mcap = 0;
  let tvl = 0;
  let seenMcap = false;
  let seenTvl = false;
  let whaleCount = 0;
  for (const r of rows) {
    if (r.marketCap !== null) {
      mcap += r.marketCap;
      seenMcap = true;
    }
    if (r.tvl !== null) {
      tvl += r.tvl;
      seenTvl = true;
    }
    whaleCount += r.whales24h;
  }
  const btc = prices.get("bitcoin");
  const global = prices.get("__global__");
  const since = Date.now() - 86_400_000;
  const volume = dedupeRoundTrips(whales.largest(null, since, 200)).reduce(
    (s, e) => s + e.amountUsd,
    0,
  );
  return {
    chainsTracked: rows.length,
    trackedMarketCap: seenMcap ? mcap : null,
    globalMarketCap: global?.marketCapUsd ?? null,
    totalTvl: seenTvl ? tvl : null,
    whales24h: whaleCount,
    whaleVolume24h: volume,
    marketCapChange24h: global?.change24hPct ?? btc?.change24hPct ?? null,
  };
}

/**
 * The headline embed: stat row, then the ranked chain table.
 * `page` is zero-based; 15 rows a page keeps the fence under Discord's limit.
 */
export function dashboardEmbed(
  rows: ChainViewRow[],
  opts: { page?: number; perPage?: number; title?: string; category?: string } = {},
): EmbedBuilder {
  const perPage = opts.perPage ?? 15;
  const page = Math.max(0, opts.page ?? 0);
  const totals = computeTotals(rows);
  const slice = rows.slice(page * perPage, page * perPage + perPage);
  const pages = Math.max(1, Math.ceil(rows.length / perPage));

  const freshest = Math.max(
    0,
    ...rows.map((r) => (r.chain.coingeckoId ? (prices.get(r.chain.coingeckoId)?.fetchedAt ?? 0) : 0)),
  );
  const f = freshness(freshest || null, 60_000);

  // Two market-cap lines on purpose. The whole-crypto figure and the sum of
  // just these chains' tokens are different quantities, and labelling the
  // second as "total market cap" would be quietly wrong by a factor of five.
  const header = [
    `\`Chains tracked\`  **${totals.chainsTracked}**`,
    `\`Crypto market cap\`  **${usd(totals.globalMarketCap)}**` +
      (totals.marketCapChange24h !== null ? `  ${pct(totals.marketCapChange24h)}` : ""),
    `\`These chains' tokens\`  **${usd(totals.trackedMarketCap)}**`,
    `\`Total TVL\`  **${usd(totals.totalTvl)}**`,
    `\`Whales 24h\`  **${totals.whales24h}** moving **${usd(totals.whaleVolume24h)}**`,
  ].join("\n");

  // Layout note: a custom emoji does NOT render inside a code fence — it comes
  // out as raw `<:ct_ethereum:123>` text. So the chain mark sits outside the
  // fence and the rest of the row goes in an inline code span, which Discord
  // renders monospace. That keeps the numeric columns aligned while still
  // showing real artwork per chain.
  const COL = { rank: 3, name: 14, tok: 5, price: 10, mcap: 8, tvl: 8, chg: 7, whale: 3 };

  const headerRow =
    "`" +
    [
      padCell("#", COL.rank, "right"),
      padCell("CHAIN", COL.name),
      padCell("TOKEN", COL.tok),
      padCell("PRICE", COL.price, "right"),
      padCell("MCAP", COL.mcap, "right"),
      padCell("TVL", COL.tvl, "right"),
      padCell("24H", COL.chg, "right"),
      padCell("WH", COL.whale, "right"),
    ].join(" ") +
    "`";

  const body = slice.map((r, i) => {
    const rank = page * perPage + i + 1;
    const icon = chainIcon(r.chain.slug);
    const cells = [
      padCell(String(rank), COL.rank, "right"),
      padCell(r.chain.name, COL.name),
      padCell(r.chain.symbol ?? "—", COL.tok),
      padCell(r.priceUsd === null ? "—" : usd(r.priceUsd, { compact: false }), COL.price, "right"),
      padCell(r.marketCap === null ? "—" : usd(r.marketCap), COL.mcap, "right"),
      padCell(r.tvl === null ? "—" : usd(r.tvl), COL.tvl, "right"),
      padCell(r.change24h === null ? "—" : pct(r.change24h, { arrow: false }), COL.chg, "right"),
      padCell(String(r.whales24h), COL.whale, "right"),
    ].join(" ");
    return `${icon} \`${cells}\``;
  });

  const table = [headerRow, ...body].join("\n");

  const e = new EmbedBuilder()
    .setColor(COLOR.brand)
    .setTitle("ChainTracker Pro — Live Blockchain Tracker")
    .setDescription(
      `${freshnessGlyph(f)} ${opts.category ? `**${opts.category}** • ` : ""}` +
        `Real-time prices, TVL, whales and network health across ${totals.chainsTracked} chains.\n\n` +
        `${header}\n\n${table}`,
    )
    .setFooter({
      text:
        `Page ${page + 1}/${pages}  •  ` +
        sourceFooter(["CoinGecko", "DeFiLlama", "on-chain RPC"], freshest || null),
    })
    .setTimestamp(new Date());

  // A dash in a cell means "no such value", which is not the same as unknown.
  e.addFields({
    name: "​",
    value:
      `-# \`—\` in MCAP means the chain has no native token (Base, Robinhood Chain), ` +
      `so it has no market cap by definition — not a missing reading.`,
  });
  return e;
}

/* ------------------------------------------------------------------ */
/* Single chain                                                        */
/* ------------------------------------------------------------------ */

export function chainEmbed(chain: ChainRow): EmbedBuilder {
  const q = chain.coingeckoId ? prices.get(chain.coingeckoId) : null;
  const m = metrics.get(chain.slug);
  const h = head.get(chain.slug);
  const caps = capabilitiesFor(chain);

  const height = (h?.block_height as number) ?? null;
  const healthy = h?.healthy === 1;
  const latency = (h?.latency_ms as number) ?? null;
  const observedBt = (h?.observed_bt_sec as number) ?? null;
  const gasGwei = (h?.gas_price_gwei as number) ?? null;

  const e = new EmbedBuilder()
    .setColor(chainColor(chain.slug))
    .setTitle(`${chainIcon(chain.slug)} ${chain.name}${chain.symbol ? ` (${chain.symbol})` : ""}`.trim())
    .setURL(chain.explorerUrl);

  /* Market — only when the chain has its own token. */
  if (chain.symbol && q) {
    e.setDescription(
      `**${usd(q.priceUsd, { compact: false })}**  ${pct(q.change24hPct)} (24h)\n` +
        (q.sparkline7d?.length ? `\`${sparkline(q.sparkline7d)}\` 7d\n` : ""),
    );
    e.addFields(
      { name: "Market Cap", value: usd(q.marketCapUsd), inline: true },
      { name: "FDV", value: usd(q.fdvUsd), inline: true },
      { name: "24h Volume", value: usd(q.volume24hUsd), inline: true },
      { name: "7d", value: pct(q.change7dPct), inline: true },
      { name: "30d", value: pct(q.change30dPct), inline: true },
      {
        name: "Circulating",
        value: q.circulatingSupply ? `${count(q.circulatingSupply)} ${chain.symbol}` : "N/A",
        inline: true,
      },
    );
  } else {
    e.setDescription(
      chain.symbol === null
        ? `**No native token.** Gas is paid in \`${chain.nativeToken}\`, so this chain has ` +
            `no price or market cap — it is measured by TVL and activity instead.`
        : `Market data unavailable — ${caps.notes.find((n) => n.includes("CoinGecko")) ?? "no CoinGecko id"}.`,
    );
  }

  /* DeFi */
  e.addFields(
    {
      name: "TVL",
      value: m?.tvlUsd !== null && m?.tvlUsd !== undefined
        ? `${usd(m.tvlUsd)}${m.tvlChange24hPct !== null ? `\n${pct(m.tvlChange24hPct)}` : ""}`
        : caps.defi ? "N/A" : "N/A ⁽not on DeFiLlama⁾",
      inline: true,
    },
    {
      name: "Stablecoins",
      value: usd(m?.stablecoinMcapUsd ?? null),
      inline: true,
    },
    {
      name: "RWA TVL",
      value: m?.rwaTvlUsd ? usd(m.rwaTvlUsd) : "N/A",
      inline: true,
    },
    { name: "DEX Volume 24h", value: usd(m?.dexVolume24hUsd ?? null), inline: true },
    { name: "Fees 24h", value: usd(m?.fees24hUsd ?? null), inline: true },
    { name: "Revenue 24h", value: usd(m?.revenue24hUsd ?? null), inline: true },
  );

  /* Network */
  e.addFields(
    {
      name: "Block Height",
      value: height !== null ? `\`${height.toLocaleString("en-US")}\`` : "N/A",
      inline: true,
    },
    {
      name: "Block Time",
      value: observedBt
        ? `${blockTime(observedBt)} ⁽measured⁾`
        : `${blockTime(chain.blockTimeSec)} ⁽nominal⁾`,
      inline: true,
    },
    {
      name: "Gas",
      value: gasGwei !== null ? gwei(gasGwei) : caps.gas ? "N/A" : "N/A ⁽non-EVM⁾",
      inline: true,
    },
    { name: "24h Transactions", value: `N/A ⁽${NO_TXCOUNT}⁾`, inline: true },
    { name: "Active Addresses", value: `N/A ⁽${NO_DAU}⁾`, inline: true },
    {
      name: "RPC Status",
      value: healthy
        ? `${GLYPH.live} ${caps.primary}${latency ? ` · ${latency}ms` : ""}`
        : `${GLYPH.down_} unreachable`,
      inline: true,
    },
  );

  /* Whales */
  const recent = whales.recent(chain.slug, 3);
  if (recent.length) {
    e.addFields({
      name: "Recent Whale Activity",
      value: recent.map(whaleLine).join("\n"),
    });
  } else {
    e.addFields({
      name: "Whale Detection",
      value:
        caps.whales === "none"
          ? `Not available — ${caps.notes.find((n) => n.includes("whale")) ?? "no free transfer index"}.`
          : caps.whales === "tracked-address"
            ? "Tracked-address mode (labelled + watched accounts). No events yet."
            : "Block-scan mode. No events above threshold yet.",
    });
  }

  e.addFields({
    name: "Links",
    value: `[${chain.explorerName}](${chain.explorerUrl})` +
      (chain.evmChainId ? ` · Chain ID \`${chain.evmChainId}\`` : "") +
      ` · Layer \`${chain.layer}\`` +
      (chain.parentChain ? ` · settles to \`${chain.parentChain}\`` : ""),
  });

  const newest = Math.max(q?.fetchedAt ?? 0, m?.fetchedAt ?? 0, (h?.fetched_at as number) ?? 0);
  e.setFooter({
    text: sourceFooter(
      [q ? "CoinGecko" : "", m ? "DeFiLlama" : "", h ? String(h.source) : ""],
      newest || null,
    ),
  }).setTimestamp(new Date());
  return e;
}

/* ------------------------------------------------------------------ */
/* Whale alert                                                         */
/* ------------------------------------------------------------------ */

export function whaleEmbed(e: WhaleEvent): EmbedBuilder {
  const chain = chains.bySlug(e.chainSlug);
  const meta = tierMeta(e.tier);
  const from = e.fromLabel ?? "Unknown wallet";
  const to = e.toLabel ?? "Unknown wallet";

  const embed = new EmbedBuilder()
    .setColor(chain?.color ?? COLOR.whale)
    .setTitle(`${meta.label.toUpperCase()} — ${eventLabel(e.eventType)}`)
    .setDescription(
      `**${chain?.name ?? e.chainSlug}** · \`${e.tokenSymbol}\`\n\n` +
        `## ${tokens(e.amount, e.tokenSymbol)}\n` +
        `### ${usd(e.amountUsd)}`,
    )
    .addFields(
      {
        name: "From",
        value: `**${from}**\n\`${shortAddr(e.fromAddress)}\`\n-# ${categoryLabel(e.fromCategory)}`,
        inline: true,
      },
      {
        name: "To",
        value: `**${to}**\n\`${shortAddr(e.toAddress)}\`\n-# ${categoryLabel(e.toCategory)}`,
        inline: true,
      },
      {
        name: "When",
        value: `${relTime(e.timestamp)}${e.blockNumber ? `\nBlock \`${e.blockNumber.toLocaleString("en-US")}\`` : ""}`,
        inline: true,
      },
      {
        name: "Transaction",
        value: e.explorerUrl
          ? `[\`${shortHash(e.txHash)}\`](${e.explorerUrl})`
          : `\`${shortHash(e.txHash)}\``,
      },
    );

  // Surface a soft valuation so nobody treats a stale price as gospel.
  if (e.confidence < 0.9) {
    embed.addFields({
      name: "Valuation confidence",
      value: `\`${Math.round(e.confidence * 100)}%\` — USD value rests on a ${
        e.confidence < 0.7 ? "stale" : "slightly aged"
      } price for ${e.tokenSymbol}.`,
    });
  }

  embed
    .setFooter({ text: `${meta.label} tier · at or above ${usd(meta.minUsd)} · source: ${e.source}` })
    .setTimestamp(new Date(e.timestamp));
  return embed;
}

function whaleLine(e: WhaleEvent, repeats = 1): string {
  const meta = tierMeta(e.tier);
  // Direction is encoded in the words, not in a pictogram: "to Exchange" and
  // "from Exchange" are the two readings that actually change what a trader
  // does, so they are spelled out.
  const flow =
    e.eventType === "exchange_deposit"
      ? " to exchange"
      : e.eventType === "exchange_withdrawal"
        ? " from exchange"
        : "";
  const link = e.explorerUrl
    ? `[\`${shortHash(e.txHash)}\`](${e.explorerUrl})`
    : `\`${shortHash(e.txHash)}\``;
  return (
    `\`${padCell(meta.short, 5)}\` **${usd(e.amountUsd)}** ${GLYPH.bullet} ` +
    `${tokens(e.amount, e.tokenSymbol)}${flow}` +
    (repeats > 1 ? ` \`x${repeats}\`` : "") +
    `
` +
    `-# ${e.fromLabel ?? shortAddr(e.fromAddress)} ${GLYPH.arrow} ` +
    `${e.toLabel ?? shortAddr(e.toAddress)} ${GLYPH.bullet} ${link} ${GLYPH.bullet} ${relTime(e.timestamp)}`
  );
}

/** Top whale movements across all chains, for the daily digest. */
export function whaleDigestEmbed(rawEvents: WhaleEvent[], windowLabel: string): EmbedBuilder {
  const grouped = collapseRepeats(rawEvents);
  const events = grouped.map((g) => g.event);
  const repeatsBy = new Map(grouped.map((g) => [g.event.txHash + g.event.logIndex, g.repeats]));
  const collapsed = rawEvents.length - events.length;
  const e = new EmbedBuilder()
    .setColor(COLOR.whale)
    .setTitle(`Whale Movements — ${windowLabel}`)
    .setTimestamp(new Date());

  if (!events.length) {
    e.setDescription(
      "No transfers crossed a chain's whale threshold in this window.\n" +
        "-# Thresholds are per chain (Ethereum ≥ $1M, Solana ≥ $250k). " +
        "An empty window is a real reading, not a failure.",
    );
    return e;
  }

  const byChain = new Map<string, WhaleEvent[]>();
  for (const ev of events) {
    const list = byChain.get(ev.chainSlug) ?? [];
    list.push(ev);
    byChain.set(ev.chainSlug, list);
  }

  const total = events.reduce((s, x) => s + x.amountUsd, 0);
  e.setDescription(
    `**${events.length}** transfers · **${usd(total)}** moved · ` +
      `${byChain.size} chain${byChain.size === 1 ? "" : "s"}` +
      (collapsed
        ? `
-# ${collapsed} repeated leg${collapsed === 1 ? "" : "s"} collapsed — swap return legs ` +
          `and arbitrage loops — so this counts distinct movement, not churn.`
        : ""),
  );

  for (const [slug, list] of [...byChain.entries()].slice(0, 6)) {
    const chain = chains.bySlug(slug);
    const sum = list.reduce((s, x) => s + x.amountUsd, 0);
    e.addFields({
      name: `${chain?.name ?? slug} — ${list.length} transfer${list.length === 1 ? "" : "s"}, ${usd(sum)}`,
      value: list.slice(0, 4).map(whaleLine).join("\n").slice(0, 1024),
    });
  }
  e.setFooter({ text: "Detected by ChainTracker from on-chain transfers" });
  return e;
}

/* ------------------------------------------------------------------ */
/* Exchange flow                                                       */
/* ------------------------------------------------------------------ */

export function exchangeFlowEmbed(windowMs: number): EmbedBuilder {
  const since = Date.now() - windowMs;
  const e = new EmbedBuilder()
    .setColor(COLOR.info)
    .setTitle("Exchange Flows")
    .setTimestamp(new Date());

  const lines: string[] = [];
  let anyData = false;
  for (const c of chains.all()) {
    const f = whales.exchangeFlow(c.slug, since);
    if (f.inUsd === 0 && f.outUsd === 0) continue;
    anyData = true;
    const net = f.outUsd - f.inUsd;
    const dir = net > 0 ? "outflow" : "inflow";
    lines.push(
      `${padCell(c.name, 14)} in ${padCell(usd(f.inUsd), 9, "right")}  ` +
        `out ${padCell(usd(f.outUsd), 9, "right")}  net ${padCell(usd(Math.abs(net)), 9, "right")} ${dir}`,
    );
  }

  e.setDescription(
    anyData
      ? "Deposits to labelled exchange wallets versus withdrawals from them.\n" +
          fence(lines) +
          "\n-# Net **outflow** means coins left exchanges for self-custody. " +
          "Net **inflow** often precedes selling pressure."
      : "No exchange-labelled transfers detected in this window.\n" +
          "-# Flows are computed from our own labelled-address set, so coverage " +
          "grows as more addresses are labelled.",
  );
  return e;
}

/* ------------------------------------------------------------------ */
/* Address                                                             */
/* ------------------------------------------------------------------ */

export function addressEmbed(chain: ChainRow, address: string): EmbedBuilder {
  const w = wallets.get(chain.slug, address);
  const history = whales.byAddress(address, 5);
  const e = new EmbedBuilder()
    .setColor(chainColor(chain.slug))
    .setTitle(w?.label ?? "Unlabelled address")
    .setURL(`${chain.explorerUrl.replace(/\/$/, "")}/address/${address}`)
    .setDescription(`\`${address}\`\non **${chain.name}**`);

  e.addFields(
    { name: "Category", value: w?.category ?? "unknown", inline: true },
    { name: "Entity", value: w?.entity ?? "—", inline: true },
    {
      name: "Label confidence",
      value: w ? `${Math.round(w.confidence * 100)}%` : "—",
      inline: true,
    },
    {
      name: "Balance",
      value:
        w?.balanceNative !== null && w?.balanceNative !== undefined
          ? `${tokens(w.balanceNative, chain.nativeToken)}${w.balanceUsd ? `\n${usd(w.balanceUsd)}` : ""}`
          : "N/A",
      inline: true,
    },
    {
      name: "Whale score",
      value: w?.whaleScore !== null && w?.whaleScore !== undefined
        ? `\`${bar(w.whaleScore / 100)}\` ${w.whaleScore}/100`
        : "not scored",
      inline: true,
    },
    {
      name: "Last seen",
      value: w?.lastSeen ? relTime(w.lastSeen) : "never observed",
      inline: true,
    },
  );

  if (history.length) {
    e.addFields({
      name: "Recent large transfers",
      value: history.map(whaleLine).join("\n").slice(0, 1024),
    });
  }
  if (w?.tags.length) {
    e.addFields({ name: "Tags", value: w.tags.map((t) => `\`${t}\``).join(" ") });
  }
  e.setFooter({
    text: w?.source
      ? `Label source: ${w.source} • balances and history from on-chain reads`
      : "Address not in the label set — shown from on-chain data only",
  }).setTimestamp(new Date());
  return e;
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

export function compareEmbed(a: ChainRow, b: ChainRow): EmbedBuilder {
  const qa = a.coingeckoId ? prices.get(a.coingeckoId) : null;
  const qb = b.coingeckoId ? prices.get(b.coingeckoId) : null;
  const ma = metrics.get(a.slug);
  const mb = metrics.get(b.slug);
  const ha = head.get(a.slug);
  const hb = head.get(b.slug);

  const W = 13;
  const row = (label: string, x: string, y: string): string =>
    `${padCell(label, 16)}${padCell(x, W, "right")}  ${padCell(y, W, "right")}`;

  const lines = [
    `${padCell("", 16)}${padCell(a.symbol ?? a.name.slice(0, 10), W, "right")}  ${padCell(b.symbol ?? b.name.slice(0, 10), W, "right")}`,
    "─".repeat(16 + W * 2 + 2),
    row("Price", qa?.priceUsd ? usd(qa.priceUsd, { compact: false }) : "—", qb?.priceUsd ? usd(qb.priceUsd, { compact: false }) : "—"),
    row("Market Cap", usd(qa?.marketCapUsd ?? null), usd(qb?.marketCapUsd ?? null)),
    row("FDV", usd(qa?.fdvUsd ?? null), usd(qb?.fdvUsd ?? null)),
    row("24h Volume", usd(qa?.volume24hUsd ?? null), usd(qb?.volume24hUsd ?? null)),
    row("24h Change", pct(qa?.change24hPct ?? null, { arrow: false }), pct(qb?.change24hPct ?? null, { arrow: false })),
    row("7d Change", pct(qa?.change7dPct ?? null, { arrow: false }), pct(qb?.change7dPct ?? null, { arrow: false })),
    "─".repeat(16 + W * 2 + 2),
    row("TVL", usd(ma?.tvlUsd ?? null), usd(mb?.tvlUsd ?? null)),
    row("Stablecoins", usd(ma?.stablecoinMcapUsd ?? null), usd(mb?.stablecoinMcapUsd ?? null)),
    row("RWA TVL", usd(ma?.rwaTvlUsd ?? null), usd(mb?.rwaTvlUsd ?? null)),
    row("DEX Vol 24h", usd(ma?.dexVolume24hUsd ?? null), usd(mb?.dexVolume24hUsd ?? null)),
    row("Fees 24h", usd(ma?.fees24hUsd ?? null), usd(mb?.fees24hUsd ?? null)),
    row("Revenue 24h", usd(ma?.revenue24hUsd ?? null), usd(mb?.revenue24hUsd ?? null)),
    "─".repeat(16 + W * 2 + 2),
    row("Layer", a.layer, b.layer),
    row("Block time", blockTime((ha?.observed_bt_sec as number) ?? a.blockTimeSec), blockTime((hb?.observed_bt_sec as number) ?? b.blockTimeSec)),
    row("Gas", ha?.gas_price_gwei ? gwei(ha.gas_price_gwei as number) : "—", hb?.gas_price_gwei ? gwei(hb.gas_price_gwei as number) : "—"),
    row("Whales 24h", String(whales.countSince(a.slug, Date.now() - 86_400_000)), String(whales.countSince(b.slug, Date.now() - 86_400_000))),
  ];

  return new EmbedBuilder()
    .setColor(COLOR.brand)
    .setTitle(`${a.name} vs ${b.name}`)
    .setDescription(fence(lines))
    .addFields({
      name: "Categories",
      value: `**${a.name}**: ${a.categories.join(", ")}\n**${b.name}**: ${b.categories.join(", ")}`,
    })
    .setFooter({ text: sourceFooter(["CoinGecko", "DeFiLlama", "on-chain RPC"], Date.now()) })
    .setTimestamp(new Date());
}

export { NO_TXCOUNT, NO_DAU };
