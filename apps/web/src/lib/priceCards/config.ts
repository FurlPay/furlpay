// ---------------------------------------------------------------------------
// Where each price card is posted.
//
// TWO WAYS TO ARRANGE THE SAME CARDS, and they COMBINE rather than compete:
//
//   ONE CHANNEL, MANY CARDS. `MARKET_CARDS_CHANNEL_ID` puts every asset into a
//   single channel as a vertical feed of independent messages — one per asset,
//   each with its own chart and its own message id, each edited on its own.
//   This is the layout a reader scans top to bottom.
//
//   ONE CHANNEL PER ASSET. A per-asset variable gives that asset a home of its
//   own, which suits a dedicated #btc-price channel someone follows on its own.
//
// A PER-ASSET CHANNEL IS AN ADDITIONAL HOME, NOT AN OVERRIDE. This reverses the
// earlier rule, and the reversal was forced by what the old one did in
// practice. On 2 September 2026 the cards were set up per-asset and then moved
// to a shared feed the same afternoon. Because a per-asset setting won
// outright, "moving" them only meant the shared channel started updating —
// the four cards already sitting in #🪙-btc-price, #🪙-eth-price,
// #🪙-sol-price and #🪙-gold-price were resolved away from and never written
// again. They showed 2 September prices for five days, under headings that
// promise a live number.
//
// A card is not a broadcast that can be redirected; it is a message that
// EXISTS in a channel, and a channel holding a card nobody updates is worse
// than a channel holding none. So every configured home for an asset is
// written on every run, and the same channel named twice is written once.
// ---------------------------------------------------------------------------

import { CARD_ORDER, type CardSymbol } from "./data";

export interface CardChannel {
  symbol: CardSymbol;
  channelId: string;
  /** The env var that supplied it, for error messages. */
  envVar: string;
}

/** Per-asset homes. An asset with no entry set lives only in the shared feed. */
const CHANNEL_ENV: Record<CardSymbol, string> = {
  SPX: "SPX_PRICE_CHANNEL_ID",
  NDX: "NDX_PRICE_CHANNEL_ID",
  DJI: "DJI_PRICE_CHANNEL_ID",
  BTC: "BTC_PRICE_CHANNEL_ID",
  ETH: "ETH_PRICE_CHANNEL_ID",
  SOL: "SOL_PRICE_CHANNEL_ID",
  XAUUSD: "GOLD_PRICE_CHANNEL_ID",
};

/** A Discord snowflake: 17-20 digits. Catches a channel NAME pasted into a
 *  channel-ID variable, which is the most common misconfiguration here. */
export function isSnowflake(v: string | undefined): v is string {
  return typeof v === "string" && /^\d{17,20}$/.test(v.trim());
}

/** The bot token, or null. Never logged, never returned in an error. */
export function botToken(): string | null {
  const t = process.env.DISCORD_BOT_TOKEN;
  return typeof t === "string" && t.trim().length > 0 ? t.trim() : null;
}

/**
 * Which cards are configured well enough to post, in display order.
 *
 * Returns the reasons for the ones that are not, so an operator gets "SOL has
 * no channel" rather than silence.
 */
export function configuredChannels(): {
  ready: CardChannel[];
  skipped: { symbol: CardSymbol; reason: string }[];
} {
  const shared = process.env.MARKET_CARDS_CHANNEL_ID;
  const sharedOk = isSnowflake(shared);

  const ready: CardChannel[] = [];
  const skipped: { symbol: CardSymbol; reason: string }[] = [];

  // CARD_ORDER rather than Object.keys: the order cards appear in a shared
  // channel is the order they are posted, and that should be deliberate.
  for (const symbol of CARD_ORDER) {
    const envVar = CHANNEL_ENV[symbol];
    const own = process.env[envVar];

    if (own && !isSnowflake(own)) {
      skipped.push({
        symbol,
        reason: `${envVar} is not a Discord id (expected 17-20 digits)`,
      });
      continue;
    }

    // Both homes, deduplicated by channel id. Pointing a per-asset variable at
    // the shared channel is a reasonable thing to type, and it must not post
    // the same card into the same channel twice.
    const homes: CardChannel[] = [];
    if (isSnowflake(own)) homes.push({ symbol, channelId: own.trim(), envVar });
    if (sharedOk && !homes.some((h) => h.channelId === shared.trim())) {
      homes.push({ symbol, channelId: shared.trim(), envVar: "MARKET_CARDS_CHANNEL_ID" });
    }

    if (homes.length === 0) {
      skipped.push({
        symbol,
        reason: `neither ${envVar} nor MARKET_CARDS_CHANNEL_ID is set`,
      });
      continue;
    }
    ready.push(...homes);
  }
  return { ready, skipped };
}

/** Optional: the guild the channels belong to, used only for a startup check. */
export function guildId(): string | null {
  const g = process.env.DISCORD_GUILD_ID;
  return isSnowflake(g) ? g.trim() : null;
}
