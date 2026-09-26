// Embeds for the #mempool channel.
//
// Same honesty rule as the rest of the bot's UI, and here it has real teeth:
// this channel reports two whale counts that come from two different kinds of
// observation, and they must never be added together or presented as one
// number. A block-derived count is complete. A mempool-derived count is a floor
// from a sampled endpoint. Every surface below keeps the two apart in words,
// and the digest prints the block coverage that backs the complete one.

import { EmbedBuilder } from "discord.js";
import type { BtcWhaleTx, HackIncident, NetworkSnapshot, Severity } from "./types.js";
import { severityOf } from "./types.js";
import { congestionLabel, congestionOf, hashrateStr } from "./network.js";
import { SATS_PER_BTC, btcStr } from "./whales.js";
import { COLOR, GLYPH } from "../bot/ui/theme.js";
import { absTime, count, fence, padCell, pct, relTime, shortAddr, shortHash, usd } from "../util/fmt.js";

/** Footer markers — how a run finds yesterday's message and edits it in place. */
export const MEMPOOL_BOARD_MARKER = "Mempool board";
export const MEMPOOL_DIGEST_MARKER = "Mempool digest";

export const MEMPOOL_CHANNEL = {
  name: "mempool",
  category: "CHAINTRACKER",
  topic:
    "Bitcoin mempool intelligence — congestion, fee pressure, whale transactions and " +
    "security alerts. Whale counts labelled 'confirmed' come from walking every " +
    "transaction in a block; counts labelled 'unconfirmed' are sampled and are a floor.",
};

const mempoolTxUrl = (txid: string) => `https://mempool.space/tx/${txid}`;
const mempoolAddrUrl = (a: string) => `https://mempool.space/address/${a}`;

/** Discord's hard limit on one embed field's value. */
const FIELD_LIMIT = 1024;

/** Always shown under a sampled list, so the number is never read as a total. */
const CAVEAT =
  "\n-# Union of a live socket and a poll of a second node. Bitcoin has no " +
  "canonical mempool, so this is a floor — measured, each observer misses " +
  "transactions the other catches.";

/**
 * Join entries without cutting one in half.
 *
 * A plain `.slice(1024)` truncates mid-string, which here produced a dangling
 * "**165.61" — a number with no unit, no link and no way to tell it had been
 * cut. Whole entries are kept and the remainder is counted, so a reader always
 * knows the list is partial and by how much.
 */
export function fitEntries(entries: string[], limit = FIELD_LIMIT): string {
  if (!entries.length) return "";
  const note = (n: number) => `\n-# +${n} more not shown`;

  // Each candidate is measured as the string that would actually be emitted —
  // notice included. Reserving an estimate instead was the earlier mistake: the
  // reserved text and the emitted text were different lengths, so the result
  // could still overrun.
  const kept: string[] = [];
  for (const entry of entries) {
    const omitted = entries.length - kept.length - 1;
    const text = [...kept, entry].join("\n") + (omitted > 0 ? note(omitted) : "");
    if (text.length > limit) break;
    kept.push(entry);
  }

  if (!kept.length) {
    // Not even one entry fits. A bare notice is honest; a fragment is not.
    const bare = note(entries.length).slice(1);
    return bare.length <= limit ? bare : "";
  }
  const omitted = entries.length - kept.length;
  return kept.join("\n") + (omitted > 0 ? note(omitted) : "");
}

/* ------------------------------------------------------------------ */
/* The live board                                                      */
/* ------------------------------------------------------------------ */

export interface BoardContext {
  snapshot: NetworkSnapshot;
  /** The reading nearest 24h ago, for deltas. Null when history is too short. */
  dayAgo: NetworkSnapshot | null;
  whales24h: {
    block: { count: number; sats: number };
    mempool: { count: number; sats: number };
    sanctioned: number;
  };
  coverage: { scanned: number; complete: number; lowest: number | null; highest: number | null };
  /** Blocks mined in the window, from the tip heights — the denominator. */
  blocksMined: number | null;
  hacks7d: { count: number; amountUsd: number };
  sanctionsArmed: number;
  sanctionsStaleMs: number | null;
  minWhaleBtc: number;
  degradedHosts: string[];
  /** Live-feed health. Absent when the board is rendered outside the watcher. */
  stream?: { connected: boolean; host: string; txCount: number; reconnects: number };
}

/** The pinned board: what the Bitcoin network looks like right now. */
export function boardEmbed(ctx: BoardContext): EmbedBuilder {
  const s = ctx.snapshot;
  const cong = congestionOf(s.mempoolVsize);

  const e = new EmbedBuilder()
    .setColor(congestionColor(cong?.band))
    .setTitle("Bitcoin Mempool")
    .setDescription(
      s.tipHeight === null
        ? "_Tip height unreadable — no host answered._"
        : `Block \`${s.tipHeight.toLocaleString("en-US")}\`` +
          (cong ? ` ${GLYPH.bullet} ${congestionLabel(cong)}` : "") +
          (s.priceUsd !== null ? `\n**${usd(s.priceUsd, { compact: false })}** / BTC` : ""),
    );

  /* --- backlog --- */
  const backlogLines = [
    `${padCell("Waiting", 12)}${padCell(s.mempoolCount === null ? "N/A" : count(s.mempoolCount), 12, "right")}`,
    `${padCell("Backlog", 12)}${padCell(cong ? `${cong.blocksDeep.toFixed(1)} blk` : "N/A", 12, "right")}`,
    // Fees offered by everything waiting. Labelled with its unit: stripping
    // "BTC" to fit the column would leave a bare 0.0468 that reads as anything.
    `${padCell("Fees BTC", 12)}${padCell(
      s.mempoolTotalFee === null ? "N/A" : (s.mempoolTotalFee / 1e8).toFixed(3),
      12, "right",
    )}`,
  ];
  if (ctx.dayAgo?.mempoolCount != null && s.mempoolCount != null) {
    const delta = ((s.mempoolCount - ctx.dayAgo.mempoolCount) / ctx.dayAgo.mempoolCount) * 100;
    backlogLines.push(`${padCell("vs 24h", 12)}${padCell(pct(delta), 12, "right")}`);
  }
  e.addFields({ name: "Backlog", value: fence(backlogLines), inline: true });

  /* --- fees --- */
  const f = s.fees;
  const feeLines =
    f.fastest === null
      ? ["N/A", "", "no /v1 host", "answered"]
      : [
          `${padCell("Fastest", 10)}${padCell(`${f.fastest} s/vB`, 12, "right")}`,
          `${padCell("30 min", 10)}${padCell(`${f.halfHour} s/vB`, 12, "right")}`,
          `${padCell("1 hour", 10)}${padCell(`${f.hour} s/vB`, 12, "right")}`,
          `${padCell("Economy", 10)}${padCell(`${f.economy} s/vB`, 12, "right")}`,
        ];
  e.addFields({ name: "Fee bands", value: fence(feeLines), inline: true });

  /* --- network --- */
  const netLines = [
    `${padCell("Hashrate", 11)}${padCell(hashrateStr(s.hashrate), 13, "right")}`,
    `${padCell("Difficulty", 11)}${padCell(
      s.difficultyChangePct === null ? "N/A" : pct(s.difficultyChangePct, { arrow: false }),
      13, "right",
    )}`,
    `${padCell("Retarget", 11)}${padCell(
      s.difficultyProgressPct === null ? "N/A" : `${s.difficultyProgressPct.toFixed(0)}%`,
      13, "right",
    )}`,
  ];
  e.addFields({ name: "Network", value: fence(netLines), inline: true });

  /* --- whales, split by provenance --- */
  const w = ctx.whales24h;
  const cov = ctx.coverage;
  const denom = ctx.blocksMined;
  const coverageNote =
    cov.scanned === 0
      ? "no blocks enumerated yet"
      : denom
        ? `${cov.complete} of ${denom} blocks fully enumerated`
        : `${cov.complete} blocks fully enumerated`;

  e.addFields({
    name: `Whales · 24h · at or above ${ctx.minWhaleBtc} BTC`,
    value:
      `**Confirmed** \`${w.block.count}\` transactions ${GLYPH.bullet} ${btcStr(w.block.sats)}\n` +
      `-# Complete for the blocks walked — ${coverageNote}.\n` +
      `**Unconfirmed** \`${w.mempool.count}\` seen ${GLYPH.bullet} ${btcStr(w.mempool.sats)}\n` +
      `-# A floor, not a total. Bitcoin has no single mempool — every node has ` +
      `its own — so this is the union of two partial observers ` +
      `(a live socket and a poll of a second node), never a complete set.`,
  });

  /* --- live feed health --- */
  if (ctx.stream) {
    const st = ctx.stream;
    e.addFields({
      name: "Live feed",
      value: st.connected
        ? `${GLYPH.live} Connected to \`${st.host}\` ${GLYPH.bullet} ` +
          `\`${st.txCount.toLocaleString("en-US")}\` transactions streamed` +
          (st.reconnects ? ` ${GLYPH.bullet} ${st.reconnects} reconnect${st.reconnects === 1 ? "" : "s"}` : "")
        : `${GLYPH.down_} **Disconnected** from \`${st.host}\` — unconfirmed whales are ` +
          `coming from the poll alone right now, which sees fewer of them.`,
    });
  }

  /* --- security --- */
  const sanctionsLine =
    ctx.sanctionsArmed === 0
      ? `**Screening OFF** — no sanctioned-address list loaded, so \`0\` hits means *not checked*, not *clean*.`
      : `**Screening ON** — \`${ctx.sanctionsArmed}\` OFAC-listed addresses` +
        (ctx.sanctionsStaleMs
          ? ` (list is ${Math.round(ctx.sanctionsStaleMs / 3_600_000)}h old — refresh failed)`
          : "") +
        `\n${ctx.whales24h.sanctioned > 0 ? `**\`${ctx.whales24h.sanctioned}\` flagged transactions in 24h**` : "No flagged transactions in 24h."}`;

  e.addFields({
    name: "Security",
    value:
      sanctionsLine +
      `\n**Published exploits · 7d** \`${ctx.hacks7d.count}\` incidents ${GLYPH.bullet} ` +
      `${usd(ctx.hacks7d.amountUsd)} reported lost`,
  });

  const hostNote = ctx.degradedHosts.length
    ? ` ${GLYPH.bullet} degraded: ${ctx.degradedHosts.join(", ")}`
    : "";
  e.setFooter({
    text:
      `${MEMPOOL_BOARD_MARKER} ${GLYPH.bullet} ` +
      `source: ${s.sources.join(" + ") || "none answered"}${hostNote}`,
  }).setTimestamp(new Date(s.ts));
  return e;
}

function congestionColor(band?: string): number {
  switch (band) {
    case "clear": return COLOR.positive;
    case "normal": return COLOR.info;
    case "busy": return COLOR.warning;
    case "congested": return COLOR.negative;
    case "backlogged": return COLOR.danger;
    default: return COLOR.neutral;
  }
}

/* ------------------------------------------------------------------ */
/* A single whale                                                      */
/* ------------------------------------------------------------------ */

/** One large transaction, posted as it is found. */
export function whaleAlertEmbed(t: BtcWhaleTx): EmbedBuilder {
  const btc = t.valueSats / SATS_PER_BTC;
  const confirmed = t.discovery === "block";

  const e = new EmbedBuilder()
    .setColor(t.sanctioned ? COLOR.danger : confirmed ? COLOR.whale : COLOR.warning)
    .setTitle(
      (t.sanctioned ? "SANCTIONED ADDRESS — " : "") +
        (t.selfSpend ? "BTC CONSOLIDATION" : "BTC WHALE") +
        (confirmed ? "" : " (UNCONFIRMED)"),
    )
    .setDescription(
      `## ${btcStr(t.valueSats)}\n` +
        (t.valueUsd !== null ? `### ${usd(t.valueUsd)}\n` : "### _no BTC price available_\n") +
        (t.selfSpend
          ? `-# The largest output pays an address that also funded the inputs — ` +
            `this is a wallet moving its own coins, not a transfer between parties.`
          : ""),
    );

  if (confirmed) {
    e.addFields(
      {
        name: "Largest input",
        value: t.topInAddr
          ? `[\`${shortAddr(t.topInAddr, 8, 6)}\`](${mempoolAddrUrl(t.topInAddr)})\n-# ${
              t.topInSats ? btcStr(t.topInSats) : "N/A"
            } of ${t.nIn} input${t.nIn === 1 ? "" : "s"}`
          : `_no address_\n-# ${t.nIn ?? "?"} inputs`,
        inline: true,
      },
      {
        name: "Largest output",
        value: t.topOutAddr
          ? `[\`${shortAddr(t.topOutAddr, 8, 6)}\`](${mempoolAddrUrl(t.topOutAddr)})\n-# ${
              t.topOutSats ? btcStr(t.topOutSats) : "N/A"
            } of ${t.nOut} output${t.nOut === 1 ? "" : "s"}`
          : `_no address_\n-# ${t.nOut ?? "?"} outputs`,
        inline: true,
      },
      {
        name: "Confirmed",
        value:
          (t.blockHeight ? `Block \`${t.blockHeight.toLocaleString("en-US")}\`\n` : "") +
          `-# ${t.blockTime ? relTime(t.blockTime * 1000) : "unknown time"}`,
        inline: true,
      },
    );
  } else {
    e.addFields({
      name: "Status",
      value:
        "Waiting in the mempool — **not yet confirmed** and it may never be.\n" +
        "-# The recent-transactions endpoint carries no addresses, so the sender, " +
        "the recipient and the sanctions screen are all unknown until it lands in a block.",
    });
  }

  if (t.feeSats !== null) {
    const rate = t.vsize ? (t.feeSats / t.vsize).toFixed(1) : null;
    e.addFields({
      name: "Fee",
      value: `\`${t.feeSats.toLocaleString("en-US")}\` sats${rate ? ` ${GLYPH.bullet} \`${rate}\` s/vB` : ""}`,
      inline: true,
    });
  }

  if (t.sanctioned && t.sanctionedAddr) {
    e.addFields({
      name: "Why this is flagged",
      value:
        `\`${t.sanctionedAddr}\` appears on the OFAC sanctioned digital-currency ` +
        `address list mirrored by 0xB10C.\n` +
        `-# This is an address match against a published list, not a legal determination, ` +
        `and address reuse means a match is a lead rather than a conclusion.`,
    });
  }

  e.addFields({
    name: "Transaction",
    value: `[\`${shortHash(t.txid)}\`](${mempoolTxUrl(t.txid)})`,
  })
    .setFooter({
      text: confirmed
        ? "found by walking every transaction in the block"
        : "sampled from the mempool — this feed misses transactions between polls",
    })
    .setTimestamp(new Date(t.firstSeen));
  return e;
}

/* ------------------------------------------------------------------ */
/* A single incident                                                   */
/* ------------------------------------------------------------------ */

const SEVERITY_COLOR: Record<Severity, number> = {
  critical: COLOR.danger,
  major: COLOR.negative,
  notable: COLOR.warning,
  minor: COLOR.neutral,
};

/** One newly published exploit. */
export function hackAlertEmbed(h: HackIncident): EmbedBuilder {
  const sev = severityOf(h.amountUsd);
  const e = new EmbedBuilder()
    .setColor(SEVERITY_COLOR[sev])
    .setTitle(`${sev.toUpperCase()} — ${h.name}`)
    .setDescription(
      `## ${h.amountUsd === null ? "Loss not quantified" : usd(h.amountUsd)}\n` +
        `${h.classification ?? "Unclassified"}${h.technique && h.technique !== "Unknown" ? ` ${GLYPH.bullet} ${h.technique}` : ""}`,
    )
    .addFields(
      { name: "Target", value: h.targetType ?? "Unknown", inline: true },
      { name: "Chains", value: h.chains.length ? h.chains.join(", ") : "Unknown", inline: true },
      { name: "Dated", value: absTime(h.ts), inline: true },
    );

  if (h.bridgeHack) {
    e.addFields({
      name: "Bridge",
      value: "Classified upstream as a bridge or cross-chain incident.",
      inline: true,
    });
  }
  if (h.returnedFunds) {
    e.addFields({
      name: "Returned",
      value: `${usd(h.returnedFunds)} recovered`,
      inline: true,
    });
  }
  if (h.sourceUrl) {
    e.addFields({ name: "Report", value: h.sourceUrl.slice(0, 1024) });
  }

  e.setFooter({
    text:
      "DefiLlama hacks dataset — a record of PUBLISHED incidents. " +
      "It is silent about anything not yet disclosed.",
  }).setTimestamp(new Date(h.ts));
  return e;
}

/* ------------------------------------------------------------------ */
/* The daily digest                                                    */
/* ------------------------------------------------------------------ */

export interface DigestContext {
  windowLabel: string;
  whalesBlock: BtcWhaleTx[];
  whalesMempool: BtcWhaleTx[];
  stats: { block: { count: number; sats: number }; mempool: { count: number; sats: number }; sanctioned: number };
  coverage: { scanned: number; complete: number; txsWalked: number; lowest: number | null; highest: number | null };
  blocksMined: number | null;
  sanctionedTxs: BtcWhaleTx[];
  incidents: HackIncident[];
  incidentTotals: { count: number; amountUsd: number; recovered: number };
  minWhaleBtc: number;
  sanctionsArmed: number;
}

/** The once-a-day summary posted fresh rather than edited. */
export function digestEmbed(ctx: DigestContext): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(ctx.sanctionedTxs.length ? COLOR.danger : COLOR.brand)
    .setTitle(`Bitcoin & security digest — ${ctx.windowLabel}`);

  /* --- coverage first: it qualifies every number that follows --- */
  const cov = ctx.coverage;
  const gaps =
    ctx.blocksMined !== null && cov.complete < ctx.blocksMined
      ? ctx.blocksMined - cov.complete
      : 0;
  e.setDescription(
    cov.scanned === 0
      ? "**No blocks were enumerated in this window**, so the confirmed-whale count below " +
        "is not a count of anything. Start the watcher to populate it."
      : `Walked **${cov.txsWalked.toLocaleString("en-US")}** transactions across ` +
        `**${cov.complete}** fully enumerated block${cov.complete === 1 ? "" : "s"}` +
        (cov.lowest !== null && cov.highest !== null
          ? ` (\`${cov.lowest.toLocaleString("en-US")}\`–\`${cov.highest.toLocaleString("en-US")}\`)`
          : "") +
        (gaps > 0
          ? `.\n**${gaps} block${gaps === 1 ? " was" : "s were"} not enumerated** — whales in ` +
            `${gaps === 1 ? "it" : "them"} are absent from these figures, not absent from the chain.`
          : ". No gaps."),
  );

  /* --- confirmed whales --- */
  if (ctx.whalesBlock.length) {
    e.addFields({
      name: `Confirmed whales · at or above ${ctx.minWhaleBtc} BTC · ${ctx.stats.block.count} total`,
      value: fitEntries(ctx.whalesBlock.slice(0, 8).map(whaleLine)),
    });
  } else if (cov.complete > 0) {
    e.addFields({
      name: "Confirmed whales",
      value: `None at or above ${ctx.minWhaleBtc} BTC in ${cov.complete} enumerated block${cov.complete === 1 ? "" : "s"}.`,
    });
  }

  /* --- unconfirmed, kept visibly separate --- */
  if (ctx.whalesMempool.length) {
    e.addFields({
      name: `Unconfirmed · ${ctx.stats.mempool.count} sampled (a floor)`,
      value:
        fitEntries(
          ctx.whalesMempool.slice(0, 4).map(whaleLine),
          FIELD_LIMIT - CAVEAT.length,
        ) + CAVEAT,
    });
  }

  /* --- sanctions --- */
  if (ctx.sanctionsArmed === 0) {
    e.addFields({
      name: "Sanctions screening",
      value:
        "**Not armed** — no address list was loaded this window, so nothing was screened. " +
        "This is not the same as finding nothing.",
    });
  } else if (ctx.sanctionedTxs.length) {
    e.addFields({
      name: `Sanctioned-address hits · ${ctx.sanctionedTxs.length}`,
      value: fitEntries(
        ctx.sanctionedTxs.slice(0, 5).map(
          (t) =>
            `[\`${shortHash(t.txid)}\`](${mempoolTxUrl(t.txid)}) ${GLYPH.bullet} **${btcStr(t.valueSats)}** ` +
            `${GLYPH.bullet} \`${shortAddr(t.sanctionedAddr ?? "", 8, 6)}\``,
        ),
      ),
    });
  } else {
    e.addFields({
      name: "Sanctions screening",
      value: `Armed against \`${ctx.sanctionsArmed}\` OFAC-listed addresses. No hits.`,
    });
  }

  /* --- incidents --- */
  if (ctx.incidents.length) {
    e.addFields({
      name: `Published exploits · ${ctx.incidentTotals.count} incidents ${GLYPH.bullet} ${usd(ctx.incidentTotals.amountUsd)}`,
      value: fitEntries(
        ctx.incidents.slice(0, 8).map(
          (h) =>
            `**${usd(h.amountUsd)}** ${GLYPH.bullet} ${h.name}\n` +
            `-# ${h.classification ?? "unclassified"} ${GLYPH.bullet} ${h.chains.join(", ") || "chain unknown"} ${GLYPH.bullet} ${absTime(h.ts)}`,
        ),
      ),
    });
  } else {
    e.addFields({
      name: "Published exploits",
      value: "None published in this window.",
    });
  }

  e.setFooter({
    text: [
      MEMPOOL_DIGEST_MARKER,
      "whales: block enumeration + mempool sampling",
      "exploits: DefiLlama",
      "sanctions: OFAC via 0xB10C",
    ].join(` ${GLYPH.bullet} `),
  }).setTimestamp();
  return e;
}

function whaleLine(t: BtcWhaleTx): string {
  const tag = t.sanctioned ? " `SANCTIONED`" : t.selfSpend ? " `self-spend`" : "";
  return (
    `**${btcStr(t.valueSats)}**${t.valueUsd !== null ? ` ${GLYPH.bullet} ${usd(t.valueUsd)}` : ""}${tag}\n` +
    `-# [\`${shortHash(t.txid)}\`](${mempoolTxUrl(t.txid)}) ${GLYPH.bullet} ` +
    (t.blockHeight ? `block \`${t.blockHeight.toLocaleString("en-US")}\` ${GLYPH.bullet} ` : "") +
    `${t.nIn ?? "?"} in ${GLYPH.arrow} ${t.nOut ?? "?"} out ${GLYPH.bullet} ${relTime(t.firstSeen)}`
  );
}
