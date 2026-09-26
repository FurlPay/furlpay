// The behavioural alert.
//
// What this replaces: an embed titled "BTC WHALE" whose entire argument was
// the size of the transaction. A reader could see that 500 BTC moved and had
// no way to tell whether that was an exchange doing its job or a wallet being
// emptied — which is the only question worth asking.
//
// Every line below is a measurement with its own provenance. The rules:
//
//   NO BARE SCORES. "Risk 92" tells a reader nothing they can check. Each
//   contributing signal prints the comparison that produced it, so "37x its
//   historical norm" can be argued with and "92" cannot.
//
//   RISK AND CONFIDENCE ARE SHOWN SEPARATELY, always, because they answer
//   different questions and a reader who conflates them will act on a lead as
//   though it were a finding.
//
//   ABSENT EVIDENCE IS STATED. A transaction analysed without address history
//   says so. The alternative — quietly showing the same layout with fewer rows
//   — reads as "nothing else was unusual" when the truth is "nothing else was
//   measured".

import { EmbedBuilder } from "discord.js";
import type { Analysis, Severity } from "./analyse.js";
import { label as patternLabel } from "./patterns.js";
import { COLOR, GLYPH } from "../../bot/ui/theme.js";
import { relTime, shortAddr, shortHash, usd } from "../../util/fmt.js";

const SEVERITY_COLOR: Record<Severity, number> = {
  CRITICAL: COLOR.danger,
  HIGH: COLOR.negative,
  SUSPICIOUS: COLOR.warning,
  WATCH: COLOR.info,
  INFO: COLOR.neutral,
};

const txUrl = (txid: string) => `https://mempool.space/tx/${txid}`;
const addrUrl = (a: string) => `https://mempool.space/address/${a}`;

/** Satoshis → "2,437.57 BTC". */
function btc(sats: number): string {
  const v = sats / 1e8;
  return `${v.toLocaleString("en-US", {
    minimumFractionDigits: v >= 1000 ? 2 : v >= 1 ? 4 : 8,
    maximumFractionDigits: v >= 1000 ? 2 : v >= 1 ? 4 : 8,
  })} BTC`;
}

/** A 0..1 score as a percentage, for a reader rather than a spreadsheet. */
const pct = (x: number): string => `${Math.round(x * 100)}`;

/**
 * One behavioural alert.
 *
 * `priceUsd` is optional and, when absent, the USD line is omitted entirely
 * rather than shown as zero — a missing price is not a free asset.
 */
export function behaviourAlertEmbed(a: Analysis, priceUsd: number | null = null): EmbedBuilder {
  const f = a.features;
  const valueUsd = priceUsd === null ? null : (f.valueSats / 1e8) * priceUsd;

  const e = new EmbedBuilder()
    .setColor(SEVERITY_COLOR[a.severity])
    .setTitle(
      a.flagged
        ? `${a.severity} — WATCHLIST MATCH`
        : a.drain
          ? `${a.severity} — RESERVE DRAIN`
          : `${a.severity} — BEHAVIOURAL ANOMALY`,
    );

  /* ---- headline: what moved, and how sure we are ---- */
  e.setDescription(
    `## ${btc(f.valueSats)}\n` +
      (valueUsd !== null ? `### ${usd(valueUsd)}\n` : "") +
      `**Risk ${pct(a.risk)}/100** ${GLYPH.bullet} **Confidence ${pct(a.confidence)}%** ` +
      `${GLYPH.bullet} ${a.shape}\n` +
      // The two axes mean different things and a reader must not blend them.
      `-# Risk is how unusual the behaviour is. Confidence is how much history ` +
      `backs that judgement — they move independently.`,
  );

  /* ---- why: the signals that fired, each with its measurement ---- */
  if (a.patterns.length) {
    const lines = a.patterns.slice(0, 6).map((p) => {
      const strength = Math.round(p.strength * 100);
      return `**${patternLabel(p.kind)}** \`${strength}%\`\n-# ${p.evidence}`;
    });
    e.addFields({
      name: "Why this is unusual",
      value: fit(lines, 1024),
    });
  } else {
    e.addFields({
      name: "Why this is unusual",
      value: "No behavioural signal fired. This alert rests on a categorical match alone.",
    });
  }

  /* ---- the categorical findings, which outrank the arithmetic ---- */
  if (a.drain) {
    e.addFields({
      name: "Reserve drain",
      value:
        `**${Math.round(a.drain.fractionOfBalance * 100)}%** of ${a.drain.entry.label}'s ` +
        `tracked balance left in this transaction\n` +
        `-# ${btc(a.drain.spentSats)} of ${btc(a.drain.balanceBefore)}` +
        (a.drain.entry.source ? ` ${GLYPH.bullet} list source: ${a.drain.entry.source}` : ""),
    });
  }
  if (a.flagged) {
    e.addFields({
      name: "Watchlist",
      value:
        `An ${a.flagged.side} address matches **${a.flagged.label}**\n` +
        `-# An address match against a maintained list, not a legal determination. ` +
        `Address reuse makes a match a lead rather than a conclusion.`,
    });
  }

  /* ---- history: what this address normally does ---- */
  if (a.profile && a.profile.observations > 0) {
    const p = a.profile;
    const bits: string[] = [`\`${p.observations}\` prior spends observed`];
    if (p.spendBaseline) bits.push(`usually ${btc(p.spendBaseline.median)}`);
    if (p.gapBaseline) {
      bits.push(`usually every ${fmtDays(p.gapBaseline.median / 86_400_000)}`);
    }
    if (p.counterparties > 0) bits.push(`\`${p.counterparties}\` known counterparties`);
    e.addFields({ name: "This address, historically", value: bits.join(`\n-# `) });
  } else {
    e.addFields({
      name: "This address, historically",
      value:
        "**No recorded history.** Every judgement above is chain-relative rather " +
        "than address-relative, which is why confidence is capped.",
    });
  }

  /* ---- structure ---- */
  const structure = [
    `\`${f.nIn}\` in ${GLYPH.arrow} \`${f.nOut}\` out`,
    f.feeRate !== null ? `\`${f.feeRate.toFixed(2)}\` sat/vB` : null,
    f.inputAddresses > 0 ? `\`${f.inputAddresses}\` funding address${f.inputAddresses === 1 ? "" : "es"}` : null,
    f.meanAgeDays !== null ? `coins avg ${fmtDays(f.meanAgeDays)} old` : null,
  ].filter(Boolean);
  e.addFields({ name: "Structure", value: structure.join(` ${GLYPH.bullet} `), inline: false });

  /* ---- the addresses, so a reader can go and look ---- */
  const parties: string[] = [];
  if (f.topInputAddr) {
    parties.push(`**From** [\`${shortAddr(f.topInputAddr, 8, 6)}\`](${addrUrl(f.topInputAddr)})`);
  }
  if (f.topOutputAddr) {
    parties.push(`**To** [\`${shortAddr(f.topOutputAddr, 8, 6)}\`](${addrUrl(f.topOutputAddr)})`);
  }
  if (parties.length) e.addFields({ name: "Largest parties", value: parties.join("\n") });

  /* ---- on-chain messages, shown but never used as the signal ---- */
  if (a.messages.length) {
    const texts = a.messages
      .filter((m) => m.kind === "text" && m.text)
      .slice(0, 2)
      .map((m) => `> ${truncate(m.text!.replace(/[\r\n]+/g, " "), 160)}`);
    e.addFields({
      name: `Embedded data ${GLYPH.bullet} ${a.messages.length} output${a.messages.length === 1 ? "" : "s"}`,
      value:
        (texts.length ? `${texts.join("\n")}\n` : "_binary payload, not text_\n") +
        `-# Shown for the reader. Message CONTENT is never a detection signal — ` +
        `only novelty and burst are, and those are structural.`,
    });
  }

  /* ---- what we could not measure ---- */
  const gaps: string[] = [];
  if (!a.coverage.hasProfile) gaps.push("no address history");
  if (!a.coverage.hasBaselines) gaps.push("no chain baselines yet");
  if (!a.coverage.hasBalance) gaps.push("balance not read, so drain is unmeasured");
  if (a.coverage.ageResolved === 0) gaps.push("coin age unresolved");
  if (gaps.length) {
    e.addFields({
      name: "Not measured",
      value: `-# ${gaps.join(` ${GLYPH.bullet} `)}`,
    });
  }

  e.addFields({ name: "Transaction", value: `[\`${shortHash(a.txid)}\`](${txUrl(a.txid)})` })
    .setFooter({
      text:
        `${a.patterns.length} signal${a.patterns.length === 1 ? "" : "s"} ${GLYPH.bullet} ` +
        `thresholds derived from observed chain behaviour, not fixed amounts`,
    })
    .setTimestamp(new Date(f.computedAt));

  return e;
}

/** Join lines without cutting one in half, stating what was dropped. */
function fit(lines: string[], limit: number): string {
  const kept: string[] = [];
  for (const line of lines) {
    const omitted = lines.length - kept.length - 1;
    const note = omitted > 0 ? `\n-# +${omitted} more` : "";
    if ([...kept, line].join("\n").length + note.length > limit) break;
    kept.push(line);
  }
  const omitted = lines.length - kept.length;
  return kept.join("\n") + (omitted > 0 ? `\n-# +${omitted} more signals` : "");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function fmtDays(days: number): string {
  if (days < 2) return `${(days * 24).toFixed(0)}h`;
  if (days < 60) return `${days.toFixed(0)} days`;
  if (days < 730) return `${(days / 30.44).toFixed(1)} months`;
  return `${(days / 365).toFixed(1)} years`;
}
