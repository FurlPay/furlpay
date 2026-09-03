// ---------------------------------------------------------------------------
// Who the new member is, as Discord itself would render them.
//
// discord.js gives you `member.displayName` and `member.displayAvatarURL()`.
// There is no discord.js here — this app talks to Discord over REST — so both
// have to be derived from the raw member object. Both have a fallback chain,
// and getting either chain wrong is visible in the welcome message itself: the
// wrong name, or a broken image where a face should be.
//
// ── THE NAME CHAIN ─────────────────────────────────────────────────────────
//
//   nick  →  global_name  →  username
//
// Server nickname first because that is the name this community knows them by.
// `global_name` is the modern display name; `username` is the handle, and is
// the only one guaranteed to exist.
//
// ── THE AVATAR CHAIN ───────────────────────────────────────────────────────
//
//   per-server avatar  →  account avatar  →  Discord's default
//
// The third link is the one that is usually missed. A member with no avatar has
// `avatar: null`, and building a CDN URL from a null hash yields a 404 and an
// embed with a broken thumbnail. Discord serves a default for exactly this
// case, and WHICH default is computed differently depending on whether the
// account has migrated to the new username system.
// ---------------------------------------------------------------------------

import type { DiscordMember, DiscordUser } from "./rest";

const CDN = "https://cdn.discordapp.com";

/** Requested avatar edge length. A power of two; Discord rejects other sizes. */
const AVATAR_SIZE = 256;

/**
 * The name to show.
 *
 * Falls all the way through to the user id rather than an empty string: a
 * welcome addressed to nobody is worse than one addressed to a number, and an
 * empty embed author field is silently dropped by Discord.
 */
export function displayName(member: DiscordMember): string {
  const user = member.user;
  const candidates = [member.nick, user?.global_name, user?.username];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return user?.id ?? "New member";
}

/**
 * Which of Discord's default avatars belongs to this account.
 *
 * TWO SCHEMES, because Discord changed its username system and did not
 * renumber the old accounts:
 *
 *   Migrated accounts (discriminator "0" or absent) use six defaults, indexed
 *   by (id >> 22) % 6 — the timestamp section of the snowflake.
 *
 *   Legacy accounts still carry a four-digit discriminator and use five
 *   defaults, indexed by discriminator % 5.
 *
 * BigInt rather than Number for the shift: a Discord snowflake is a 64-bit
 * integer and exceeds Number.MAX_SAFE_INTEGER, so `Number(id) >> 22` silently
 * computes the wrong index for every real user.
 */
export function defaultAvatarIndex(user: Pick<DiscordUser, "id" | "discriminator">): number {
  const disc = user.discriminator;
  if (disc && disc !== "0") {
    const n = Number(disc);
    if (Number.isFinite(n)) return ((n % 5) + 5) % 5;
  }
  try {
    return Number((BigInt(user.id) >> 22n) % 6n);
  } catch {
    // A malformed id should still produce a usable image rather than throw.
    return 0;
  }
}

/** Animated avatar hashes are prefixed "a_" and are the only ones with a gif. */
function isAnimated(hash: string): boolean {
  return hash.startsWith("a_");
}

/**
 * The member's avatar, preferring the one they set for this specific server.
 *
 * Always returns a URL. There is no failure mode that yields null, because the
 * caller's only sensible response to null would be to pick the default itself.
 */
export function avatarUrl(member: DiscordMember, guildId: string): string {
  const user = member.user;
  if (!user?.id) return `${CDN}/embed/avatars/0.png`;

  const size = `?size=${AVATAR_SIZE}`;

  // 1. Per-server avatar.
  if (typeof member.avatar === "string" && member.avatar.length > 0) {
    const ext = isAnimated(member.avatar) ? "gif" : "png";
    return `${CDN}/guilds/${guildId}/users/${user.id}/avatars/${member.avatar}.${ext}${size}`;
  }

  // 2. Account avatar.
  if (typeof user.avatar === "string" && user.avatar.length > 0) {
    const ext = isAnimated(user.avatar) ? "gif" : "png";
    return `${CDN}/avatars/${user.id}/${user.avatar}.${ext}${size}`;
  }

  // 3. Discord's own default. No size parameter: these are served at a fixed
  //    resolution and appending one is ignored at best.
  return `${CDN}/embed/avatars/${defaultAvatarIndex(user)}.png`;
}

/** A real Discord mention. Printing the username instead renders as plain text
 *  and does not ping — the difference the spec calls out explicitly. */
export function mention(userId: string): string {
  return `<@${userId}>`;
}
