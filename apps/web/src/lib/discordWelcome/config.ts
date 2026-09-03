// ---------------------------------------------------------------------------
// Configuration for the new-member welcome.
//
// WHY THIS IS A SWEEP AND NOT AN EVENT LISTENER. `guildMemberAdd` is a GATEWAY
// event: it arrives over a WebSocket that a bot process holds open for its
// whole life. This app is Next.js on Vercel — every route is a function that
// starts on a request and is frozen the moment it responds. There is no
// process here that can hold a socket, so there is no client to attach a
// listener to, and adding discord.js would not change that.
//
// What this deployment CAN do is ask Discord who joined, on a schedule, over
// the same REST API the price cards already use. That turns "welcome on join"
// into "welcome shortly after join", and makes exactly-once delivery a
// property of our own storage rather than of the socket. Everything below
// exists to make that swap safe.
//
// FAIL QUIET WHEN UNCONFIGURED, LOUD WHEN MISCONFIGURED. An unset channel id
// means the feature is off and the job says so. A channel id that is not a
// snowflake is a typo someone needs to see, so it is reported as an error
// rather than silently treated as "off".
// ---------------------------------------------------------------------------

/** A Discord snowflake: 17-20 digits. Catches a channel NAME pasted into a
 *  channel-ID variable, which is the most common misconfiguration here. */
export function isSnowflake(v: string | undefined | null): v is string {
  return typeof v === "string" && /^\d{17,20}$/.test(v.trim());
}

/** The bot token, or null. Never logged, never returned in an error. */
export function botToken(): string | null {
  const t = process.env.DISCORD_BOT_TOKEN;
  return typeof t === "string" && t.trim().length > 0 ? t.trim() : null;
}

/**
 * Read a boolean flag.
 *
 * `fallback` rather than a bare `=== "true"`, because "the channel is
 * configured so the channel post is on" and "DMs are off until someone says
 * otherwise" are different defaults and both need to be expressible.
 */
export function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

/** Read a positive number, falling back when absent or nonsense. */
export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface WelcomeConfig {
  guildId: string;
  channelId: string | null;
  channelEnabled: boolean;
  dmEnabled: boolean;
  /**
   * How old a join may be and still earn a welcome.
   *
   * A sweep that has not run for a week must not wake up and post thirty
   * welcomes at once. Anything past this window is marked as seen without
   * being greeted — late is worse than never for a "welcome".
   */
  maxAgeHours: number;
  /**
   * Whether the FIRST EVER sweep may greet the members it finds.
   *
   * Off by default, and this is the single most important default in the file.
   * The first run has no record of who has already been welcomed, so without
   * this guard it would greet every existing member of the server at once —
   * the exact spam the duplicate protection exists to prevent. The first run
   * instead records everyone as seen and greets nobody.
   */
  backfillOnFirstRun: boolean;
  /** Greet bots that join. Off by default: a bot does not read its welcome. */
  includeBots: boolean;
  /** Channel to point newcomers at ("check out #welcome"). Null = no pointer,
   *  rather than a link to a channel that may not exist. */
  startHereChannelId: string | null;
  /** Include the "we will never ask for your seed phrase" line. On by default:
   *  the first thing a new member in this space should read is the thing that
   *  makes the next scam DM recognisable. */
  securityNote: boolean;
}

export type ConfigResult =
  | { ok: true; config: WelcomeConfig }
  | { ok: false; reason: string; misconfigured: boolean };

/**
 * Resolve the welcome configuration.
 *
 * `misconfigured` separates "this feature is switched off" from "somebody
 * meant to switch it on and got a value wrong". Only the second deserves an
 * operator's attention, and collapsing them into one boolean is how a typo
 * sits unnoticed for a month.
 */
export function welcomeConfig(): ConfigResult {
  const guild = process.env.DISCORD_GUILD_ID;
  // Computed BEFORE the snowflake check. `isSnowflake` is a type predicate, so
  // its false branch narrows `guild` to undefined and TypeScript then treats a
  // "set but malformed" value as unreachable — which is exactly the case this
  // needs to report.
  const guildSupplied = Boolean(guild && guild.trim());
  if (!isSnowflake(guild)) {
    return {
      ok: false,
      misconfigured: guildSupplied,
      reason: guildSupplied
        ? "DISCORD_GUILD_ID is not a Discord id (expected 17-20 digits)"
        : "DISCORD_GUILD_ID is not set",
    };
  }

  const rawChannel = process.env.WELCOME_CHANNEL_ID;
  const hasChannel = Boolean(rawChannel && rawChannel.trim());
  if (hasChannel && !isSnowflake(rawChannel)) {
    return {
      ok: false,
      misconfigured: true,
      reason: "WELCOME_CHANNEL_ID is not a Discord id (expected 17-20 digits)",
    };
  }

  const channelId = isSnowflake(rawChannel) ? rawChannel.trim() : null;
  const rawStartHere = process.env.WELCOME_START_HERE_CHANNEL_ID;
  const startHereChannelId = isSnowflake(rawStartHere) ? rawStartHere.trim() : null;
  // The channel post is the feature. With no channel there is nothing to turn
  // on, so the flag defaults to whether a channel was supplied at all.
  const channelEnabled = envFlag("WELCOME_CHANNEL_ENABLED", channelId !== null);
  const dmEnabled = envFlag("WELCOME_DM_ENABLED", false);

  if (!channelEnabled && !dmEnabled) {
    return {
      ok: false,
      misconfigured: false,
      reason: channelId
        ? "WELCOME_CHANNEL_ENABLED and WELCOME_DM_ENABLED are both off"
        : "WELCOME_CHANNEL_ID is not set",
    };
  }

  return {
    ok: true,
    config: {
      guildId: guild.trim(),
      channelId,
      channelEnabled: channelEnabled && channelId !== null,
      dmEnabled,
      maxAgeHours: envNumber("WELCOME_MAX_AGE_HOURS", 48),
      backfillOnFirstRun: envFlag("WELCOME_BACKFILL_ON_FIRST_RUN", false),
      includeBots: envFlag("WELCOME_INCLUDE_BOTS", false),
      // A bad id here is a broken link in the message rather than a broken
      // feature, so it degrades to "no pointer" instead of failing the config.
      startHereChannelId,
      securityNote: envFlag("WELCOME_SECURITY_NOTE", true),
    },
  };
}
