// ---------------------------------------------------------------------------
// Where each price card is posted.
//
// TWO WAYS TO ARRANGE THE SAME CARDS, and both are legitimate:
//
//   ONE CHANNEL, MANY CARDS. `MARKET_CARDS_CHANNEL_ID` puts every asset into a
//   single channel as a vertical feed of independent messages — one per asset,
//   each with its own chart and its own message id, each edited on its own.
//   This is the layout a reader scans top to bottom.
//
//   ONE CHANNEL PER ASSET. A per-asset variable overrides the shared channel
//   for that asset, which suits a dedicated #btc-price channel someone follows
//   on its own.
//
// A per-asset setting always wins, so adding the shared channel does not move
// cards that already have a home. What NEVER happens is a card in two places:
// each asset resolves to exactly one channel.
// ---------------------------------------------------------------------------

import { CARD_ORDER, type CardSymbol } from "./data";

export interface CardChannel {
  symbol: CardSymbol;
  channelId: string;
  /** The env var that supplied it, for error messages. */
  envVar: string;
}

/** Per-asset overrides. Absent entries fall back to the shared channel. */
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
    if (isSnowflake(own)) {
      ready.push({ symbol, channelId: own.trim(), envVar });
      continue;
    }
    if (sharedOk) {
      ready.push({ symbol, channelId: shared.trim(), envVar: "MARKET_CARDS_CHANNEL_ID" });
      continue;
    }
    skipped.push({
      symbol,
      reason: `neither ${envVar} nor MARKET_CARDS_CHANNEL_ID is set`,
    });
  }
  return { ready, skipped };
}

/** Optional: the guild the channels belong to, used only for a startup check. */
export function guildId(): string | null {
  const g = process.env.DISCORD_GUILD_ID;
  return isSnowflake(g) ? g.trim() : null;
}
