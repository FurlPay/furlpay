// ---------------------------------------------------------------------------
// Configuration for the price cards.
//
// Every asset gets its own channel, so each is configured independently and a
// missing channel id disables just that card rather than the whole job. Nothing
// here has a default channel: posting a price card into the wrong Discord
// channel is not a failure mode worth risking to save an environment variable.
// ---------------------------------------------------------------------------

import type { CardSymbol } from "./data";

export interface CardChannel {
  symbol: CardSymbol;
  channelId: string;
  /** The env var that supplied it, for error messages. */
  envVar: string;
}

const CHANNEL_ENV: Record<CardSymbol, string> = {
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
 * Which cards are configured well enough to post.
 *
 * Returns the reasons for the ones that are not, so an operator gets "SOL is
 * missing SOL_PRICE_CHANNEL_ID" rather than silence.
 */
export function configuredChannels(): {
  ready: CardChannel[];
  skipped: { symbol: CardSymbol; reason: string }[];
} {
  const ready: CardChannel[] = [];
  const skipped: { symbol: CardSymbol; reason: string }[] = [];

  for (const [symbol, envVar] of Object.entries(CHANNEL_ENV) as [CardSymbol, string][]) {
    const raw = process.env[envVar];
    if (!raw) {
      skipped.push({ symbol, reason: `${envVar} is not set` });
      continue;
    }
    if (!isSnowflake(raw)) {
      skipped.push({
        symbol,
        reason: `${envVar} is not a Discord id (expected 17-20 digits, e.g. 1234567890123456789)`,
      });
      continue;
    }
    ready.push({ symbol, channelId: raw.trim(), envVar });
  }
  return { ready, skipped };
}

/** Optional: the guild the channels belong to, used only for a startup check. */
export function guildId(): string | null {
  const g = process.env.DISCORD_GUILD_ID;
  return isSnowflake(g) ? g.trim() : null;
}
