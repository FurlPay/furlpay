// ---------------------------------------------------------------------------
// The native half of the card: header, price and six statistics.
//
// Discord lays out inline fields three to a row, which is exactly the design's
// two rows of three. That is why this half is a real embed rather than more
// pixels in the PNG: native fields reflow correctly on mobile, stay selectable,
// and cost nothing to render. The chart, the per-metric panels and the type
// scale are things embeds genuinely cannot do, and those live in the image.
//
// The description line carries the price because an embed has no way to make
// one field larger than another — putting the price in a field would render it
// at the same size as "Rank".
// ---------------------------------------------------------------------------

import type { PriceCardData } from "./data";
import {
  DASH, formatCompactUsd, formatLevel, formatPct, formatRank, formatUsd,
} from "./format";

/** Discord embed colours are integers, not hex strings. */
const GREEN = 0x57f287;
const RED = 0xed4245;
const GREY = 0x949ba4;

/** The coloured dot in the header, chosen by the day's direction.
 *
 * Emoji rather than a drawn shape because this half is native: Discord renders
 * them consistently across desktop, web and mobile, which a unicode geometric
 * shape does not. */
function directionDot(change: number | null): string {
  if (change === null || change === 0) return "⚪";
  return change > 0 ? "🟢" : "🔴";
}

export interface CardMessage {
  embeds: unknown[];
  /** Discord requires attachment metadata alongside a multipart upload. */
  attachments: unknown[];
}

/**
 * Build the message body for one asset.
 *
 * `filename` must match the name used in the multipart upload; the embed
 * references it as attachment://<filename>, which is how Discord renders an
 * uploaded file inside the embed rather than as a separate download.
 */
export function buildPriceCardMessage(
  data: PriceCardData,
  filename: string,
  now = new Date()
): CardMessage {
  const chg = data.changePct24h;
  const color = chg === null || chg === 0 ? GREY : chg > 0 ? GREEN : RED;

  // An index is quoted in points. "$7,670.92" for the S&P 500 makes the number
  // look like a price you could pay for one, which is a different claim.
  const price = (n: number | null) =>
    data.unit === "points" ? formatLevel(n) : formatUsd(n);

  // "$97.81 (-4.24% 24h)" — the price dominant, the change beside it.
  const priceLine =
    `**${price(data.price)}** ` +
    (chg === null ? `(${DASH} 24h)` : `(${formatPct(chg)} 24h)`);

  const fields = [
    { name: "24h high", value: price(data.high24h), inline: true },
    { name: "24h low", value: price(data.low24h), inline: true },
    { name: "Rank", value: formatRank(data.rank), inline: true },
    { name: "Market cap", value: formatCompactUsd(data.marketCap), inline: true },
    { name: "Volume 24h", value: formatCompactUsd(data.volume24h), inline: true },
    { name: "From ATH", value: formatPct(data.fromAthPct, 1), inline: true },
  ];

  return {
    embeds: [
      {
        // No title: the design's header is the dot, name and ticker on one
        // line, which is what an author line renders as. A title would add a
        // second, larger heading the reference does not have.
        author: { name: `${directionDot(chg)} ${data.name} · ${data.symbol}` },
        description: priceLine,
        color,
        fields,
        image: { url: `attachment://${filename}` },
        footer: {
          // Our own branding. The reference screenshot's footer read "kimchi",
          // which is the other bot's name -- a design reference is a guide to
          // layout, not an instruction to wear someone else's label.
          //
          // The instrument note rides here too, for gold, where the symbol and
          // the contract actually quoted are not the same thing.
          text: data.note ? `FurlPay · ${data.note}` : "FurlPay",
        },
        // Discord renders this as the reader's local time and keeps it correct
        // when the message is edited hours later. A baked "6:18 PM" is right in
        // one timezone and wrong everywhere else.
        timestamp: now.toISOString(),
      },
    ],
    attachments: [{ id: 0, filename }],
  };
}
