import { EmbedBuilder } from "discord.js";
import { COLOR, chainIcon, chainColor } from "../bot/ui/theme.js";
import { usd, count, shortAddr, shortHash, relTime } from "../util/fmt.js";
import { getUsdcTier } from "./classify.js";
import { getUsdcAsset } from "./registry.js";
import type { CctpTransfer, ExchangeFlowSummary, UsdcTransfer } from "./types.js";

// ---------------------------------------------------------------------------
// Discord presentation for USDC intelligence.
//
// WHY THIS FILE IS SEPARATE FROM THE CLASSIFIER. `classify.ts` decides what a
// transfer IS; this decides how it READS. Keeping them apart means changing an
// embed's wording can never change which transfers are considered whales — the
// same split `src/mempool/embeds.ts` already uses for the mempool alerts.
//
// THE RULE THESE EMBEDS FOLLOW: never present an inference as an observation.
// An address with no verified label is "Unknown wallet", not a guess derived
// from its transaction pattern. A classification the pipeline is unsure about
// says so. In an intelligence channel the credibility of every alert depends on
// the reader being able to trust that the labelled ones were actually labelled.
// ---------------------------------------------------------------------------

/** Verified-label styling per entity class. Unknown deliberately gets nothing. */
const CATEGORY_GLYPH: Record<string, string> = {
  cex: "🏦",
  dex: "🔄",
  bridge: "🌉",
  treasury: "🏛️",
  circle: "⭕",
  furlpay: "💚",
  institutional: "🏢",
  unknown: "",
};

function party(label: string | null, category: string, address: string): string {
  const glyph = CATEGORY_GLYPH[category] ?? "";
  const name = label ?? "Unknown wallet";
  const prefix = glyph ? `${glyph} ` : "";
  return `${prefix}**${name}**\n\`${shortAddr(address)}\``;
}

function chainLine(chainSlug: string): string {
  const asset = getUsdcAsset(chainSlug);
  const name = asset?.chainName ?? chainSlug;
  return `${chainIcon(chainSlug)} ${name}`.trim();
}

/** Human wording for each classification. The enum is not user-facing. */
const CLASSIFICATION_TEXT: Record<string, string> = {
  WHALE_TRANSFER: "Large transfer",
  EXCHANGE_DEPOSIT: "Exchange deposit",
  EXCHANGE_WITHDRAWAL: "Exchange withdrawal",
  BRIDGE_TRANSFER: "Bridge transfer",
  CCTP_TRANSFER: "Cross-chain (CCTP)",
  TREASURY_TRANSFER: "Treasury movement",
  MINT: "USDC minted",
  BURN: "USDC burned",
  CIRCLE_TRANSFER: "Circle operations",
  DEX_TRANSFER: "DEX activity",
  FURLPAY_TRANSFER: "FurlPay wallet",
  INTERNAL_REBALANCE: "Internal rebalance",
  LIKELY_PAYMENT: "Likely payment",
  UNKNOWN: "Unclassified",
};

/**
 * A single significant transfer.
 *
 * FurlPay movements are styled differently and always shown regardless of size,
 * because "our own treasury moved" is interesting at any amount while a
 * stranger's $2M is not.
 */
export function usdcTransferEmbed(t: UsdcTransfer): EmbedBuilder {
  const tier = getUsdcTier(t.amountUsd);
  const asset = getUsdcAsset(t.chainSlug);

  const title = t.isFurlPay
    ? `${CATEGORY_GLYPH.furlpay} FurlPay USDC movement — ${usd(t.amountUsd, { compact: true })}`
    : `${tier.glyph} USDC ${CLASSIFICATION_TEXT[t.classification] ?? "movement"} — ${usd(t.amountUsd, { compact: true })}`;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(t.isFurlPay ? COLOR.positive : chainColor(t.chainSlug))
    .addFields(
      { name: "Chain", value: chainLine(t.chainSlug), inline: true },
      { name: "Amount", value: `${count(t.amount)} USDC`, inline: true },
      { name: "Type", value: CLASSIFICATION_TEXT[t.classification] ?? "Unclassified", inline: true },
      { name: "From", value: party(t.fromLabel, t.fromCategory, t.fromAddress), inline: true },
      { name: "To", value: party(t.toLabel, t.toCategory, t.toAddress), inline: true },
    );

  if (t.blockNumber !== null) {
    embed.addFields({ name: "Block", value: count(t.blockNumber), inline: true });
  }

  // The explorer link is the reader's way to check us. Only rendered when the
  // registry actually knows the explorer for this chain — a broken link is
  // worse than no link, because it reads as a fabricated reference.
  const tx = t.explorerUrl
    ? `[\`${shortHash(t.txHash)}\`](${t.explorerUrl})`
    : `\`${shortHash(t.txHash)}\``;
  embed.addFields({ name: "Transaction", value: tx, inline: false });

  // "occurred", not "detected". The timestamp is the BLOCK time — the whole point of
  // reading real header times rather than using scan time — so calling it detection
  // time misdescribes the one figure we went to lengths to get right, and would read
  // as a several-minute detection lag on a catch-up scan.
  embed.setFooter({
    text: `${asset?.chainName ?? t.chainSlug} · occurred ${relTime(t.timestamp)} · via ${t.source}`,
  });
  embed.setTimestamp(new Date(t.timestamp));
  return embed;
}

/**
 * A completed cross-chain movement, as ONE event.
 *
 * A CCTP transfer is a burn on one chain and a mint on another. Posting both
 * would double-count the money and double-alert the channel, so the correlator
 * pairs them and this renders the pair.
 */
export function cctpTransferEmbed(c: CctpTransfer): EmbedBuilder {
  const from = getUsdcAsset(c.sourceChain)?.chainName ?? c.sourceChain;
  const to = c.destChain ? (getUsdcAsset(c.destChain)?.chainName ?? c.destChain) : "pending";

  const embed = new EmbedBuilder()
    .setTitle(`🌐 USDC cross-chain — ${usd(c.amount, { compact: true })}`)
    .setColor(COLOR.info)
    .setDescription(`**${from}** → CCTP → **${to}**`)
    .addFields(
      { name: "Amount", value: `${count(c.amount)} USDC`, inline: true },
      { name: "Status", value: c.status === "completed" ? "Completed" : "Awaiting mint", inline: true },
    );

  if (c.mintTs && c.burnTs) {
    // Attestation latency is the number that tells an operator whether Circle's
    // Iris service is healthy, so it is surfaced rather than buried.
    const seconds = Math.max(0, Math.round((c.mintTs - c.burnTs) / 1000));
    embed.addFields({ name: "Latency", value: `~${seconds}s`, inline: true });
  }

  embed.addFields({ name: "Burn", value: `\`${shortHash(c.sourceTx)}\``, inline: true });
  if (c.destTx) embed.addFields({ name: "Mint", value: `\`${shortHash(c.destTx)}\``, inline: true });

  if (c.feeUsdc !== null && c.feeUsdc > 0) {
    embed.addFields({ name: "CCTP fee", value: `${count(c.feeUsdc)} USDC`, inline: true });
  }

  // HOW THE TWO LEGS WERE MATCHED, said plainly.
  //
  // A heuristic match is a strong inference, not a proof — it pairs a burn and a
  // mint on (source, destination, amount, recipient) within a window because
  // Circle's attestation service could not be reached. Presenting that with the
  // same confidence as a nonce match would be the quiet kind of wrong, so the
  // footer distinguishes them and never prints a `pending:` placeholder as if it
  // were an on-chain nonce.
  const provenance =
    c.correlation === "iris_nonce" && !c.nonce.startsWith("pending:")
      ? `nonce ${shortHash(c.nonce)}`
      : c.correlation === "heuristic"
        ? "pairing inferred (amount + recipient), not nonce-matched"
        : "awaiting attestation";

  const speed =
    c.finalityExecuted === 1000 ? "Fast" : c.finalityExecuted === 2000 ? "Standard" : null;

  embed.setFooter({
    text: [`CCTP V${c.cctpVersion}`, speed, provenance, relTime(c.burnTs)]
      .filter(Boolean)
      .join(" · "),
  });
  embed.setTimestamp(new Date(c.mintTs ?? c.burnTs));
  return embed;
}

/** Rolling exchange flows, one row per chain. */
export function exchangeFlowEmbed(
  flows: ExchangeFlowSummary[],
  windowLabel: string
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`📊 USDC exchange flows — ${windowLabel}`)
    .setColor(COLOR.neutral);

  if (flows.length === 0) {
    embed.setDescription("No labelled exchange activity in this window.");
    return embed;
  }

  const rows = flows
    .slice()
    .sort((a, b) => Math.abs(b.netFlowUsd) - Math.abs(a.netFlowUsd))
    .slice(0, 10)
    .map((f) => {
      const net = f.netFlowUsd;
      const arrow = net > 0 ? "▲" : net < 0 ? "▼" : "•";
      return `${arrow} **${f.chainName}** · in ${usd(f.inflowUsd, { compact: true })} · out ${usd(f.outflowUsd, { compact: true })} · net ${usd(net, { compact: true })}`;
    });

  const totalIn = flows.reduce((s, f) => s + f.inflowUsd, 0);
  const totalOut = flows.reduce((s, f) => s + f.outflowUsd, 0);

  embed.setDescription(rows.join("\n"));
  embed.addFields({
    name: "Total",
    value: `in ${usd(totalIn, { compact: true })} · out ${usd(totalOut, { compact: true })} · net ${usd(totalIn - totalOut, { compact: true })}`,
  });

  // The caveat is part of the data, not a disclaimer bolted on. Net flow only
  // covers addresses we have a verified label for, and most addresses have no
  // label at all — a reader who does not know that will over-read the number.
  embed.setFooter({
    text: "Labelled exchange addresses only — unlabelled wallets are not counted.",
  });
  return embed;
}

export interface UsdcDailyStats {
  readonly date: string;
  readonly totalVolumeUsd: number;
  readonly transferCount: number;
  readonly whaleCount: number;
  readonly whaleVolumeUsd: number;
  readonly chainsActive: number;
  readonly exchangeInflowUsd: number;
  readonly exchangeOutflowUsd: number;
  readonly cctpCount: number;
  readonly cctpVolumeUsd: number;
  readonly furlpayReceivedUsd: number;
  readonly furlpaySentUsd: number;
  readonly topChains: readonly { chainSlug: string; volumeUsd: number }[];
  readonly largest: UsdcTransfer | null;
  readonly infrastructureUsd: number;
  readonly likelyPaymentUsd: number;
}

/** The daily roll-up. */
export function usdcDailyEmbed(s: UsdcDailyStats): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`📅 USDC daily intelligence — ${s.date}`)
    .setColor(COLOR.info)
    .addFields(
      {
        name: "Volume",
        value: [
          `Total moved: **${usd(s.totalVolumeUsd, { compact: true })}**`,
          `Transfers: **${count(s.transferCount)}**`,
          `Chains active: **${s.chainsActive}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Large transfers",
        value: [
          `Count: **${count(s.whaleCount)}**`,
          `Volume: **${usd(s.whaleVolumeUsd, { compact: true })}**`,
          s.largest
            ? `Largest: **${usd(s.largest.amountUsd, { compact: true })}** (${getUsdcAsset(s.largest.chainSlug)?.chainName ?? s.largest.chainSlug})`
            : "Largest: —",
        ].join("\n"),
        inline: true,
      },
      {
        name: "Exchange flows",
        value: [
          `In: **${usd(s.exchangeInflowUsd, { compact: true })}**`,
          `Out: **${usd(s.exchangeOutflowUsd, { compact: true })}**`,
          `Net: **${usd(s.exchangeInflowUsd - s.exchangeOutflowUsd, { compact: true })}**`,
        ].join("\n"),
        inline: true,
      },
    );

  if (s.cctpCount > 0) {
    embed.addFields({
      name: "Cross-chain (CCTP)",
      value: `${count(s.cctpCount)} transfers · ${usd(s.cctpVolumeUsd, { compact: true })}`,
      inline: true,
    });
  }

  if (s.furlpayReceivedUsd > 0 || s.furlpaySentUsd > 0) {
    embed.addFields({
      name: `${CATEGORY_GLYPH.furlpay} FurlPay`,
      value: `received ${usd(s.furlpayReceivedUsd, { compact: true })} · sent ${usd(s.furlpaySentUsd, { compact: true })}`,
      inline: true,
    });
  }

  if (s.topChains.length > 0) {
    embed.addFields({
      name: "Top chains",
      value: s.topChains
        .slice(0, 7)
        .map(
          (c, i) =>
            `${i + 1}. ${chainIcon(c.chainSlug)} ${getUsdcAsset(c.chainSlug)?.chainName ?? c.chainSlug} — ${usd(c.volumeUsd, { compact: true })}`
        )
        .join("\n"),
    });
  }

  // THE MOST IMPORTANT FIELD IN THE WHOLE EMBED. Raw transfer volume is roughly
  // two orders of magnitude larger than actual payment activity — most of it is
  // exchange rebalancing, bridges, arbitrage and internal treasury movement.
  // Reporting a headline volume without this split is the single easiest way to
  // mislead a reader, so the split is shown next to the headline, not beneath a
  // footnote.
  const classified = s.infrastructureUsd + s.likelyPaymentUsd;
  if (classified > 0) {
    const infraPct = Math.round((s.infrastructureUsd / classified) * 100);
    embed.addFields({
      name: "What this volume actually is",
      value: [
        `Infrastructure / internal: **${usd(s.infrastructureUsd, { compact: true })}** (${infraPct}%)`,
        `Likely economic activity: **${usd(s.likelyPaymentUsd, { compact: true })}** (${100 - infraPct}%)`,
        "",
        "_Raw on-chain volume includes exchange rebalancing, bridge flows and" +
          " arbitrage. Only the second line resembles payments, and it is an" +
          " estimate from entity labels — not a measured figure._",
      ].join("\n"),
    });
  }

  embed.setFooter({ text: "ChainTracker · USDC intelligence" });
  embed.setTimestamp(new Date());
  return embed;
}

/** The pinned explainer, posted once when the channel is created. */
export function usdcChannelIntroEmbed(chains: readonly string[]): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("USDC Intelligence")
    .setColor(COLOR.info)
    .setDescription(
      [
        "Native USDC movement across supported chains, with entity labels and" +
          " classification.",
        "",
        "**What gets posted here**",
        "• Large transfers above the alert threshold",
        "• Exchange deposits and withdrawals, where the address is labelled",
        "• Cross-chain CCTP movements, as one event rather than two",
        "• Any FurlPay wallet activity, at any size",
        "• A daily roll-up",
        "",
        "**What this channel does not claim**",
        "• Raw transfer volume is not payment volume. Most on-chain USDC" +
          " movement is exchange rebalancing, bridges and arbitrage.",
        "• An address without a verified label is shown as *Unknown wallet*." +
          " It is never guessed from transaction patterns.",
        "• Only the verified native USDC contract per chain is tracked." +
          " Bridged variants (USDC.e) and lookalike tokens are excluded.",
      ].join("\n")
    )
    .addFields({ name: "Chains tracked", value: chains.join(", ") || "—" })
    .setFooter({ text: "ChainTracker · automated" });
}
