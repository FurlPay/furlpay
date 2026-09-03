// ---------------------------------------------------------------------------
// Finding out who joined, without a gateway connection.
//
// TWO SOURCES, AND THE FALLBACK IS NOT A CONSOLATION PRIZE. Which one is
// available depends on a switch in the Discord Developer Portal, so the sweep
// has to work either way or it will appear broken to whoever has not flipped
// it.
//
//   1. THE MEMBER LIST — GET /guilds/{id}/members. The better source: it
//      carries a real `joined_at`, the server nickname and the server-specific
//      avatar. It requires the SERVER MEMBERS privileged intent to be enabled
//      in the Developer Portal, and answers 403 until it is, regardless of the
//      bot's permissions in the server.
//
//   2. THE SYSTEM JOIN MESSAGES — the "X joined the party" posts Discord
//      writes into the system channel. Needs no privileged intent, only the
//      ability to read that channel. It gives a user and a timestamp but no
//      nickname and no per-server avatar, so the welcome is very slightly less
//      personalised, and it goes blind if an admin turns join messages off.
//
// The 403 on source 1 is therefore treated as "use source 2", not as an error.
// A hard failure is reserved for the case where NEITHER can see anything, which
// is the only case an operator can actually act on.
// ---------------------------------------------------------------------------

import type { WelcomeConfig } from "./config";
import {
  MESSAGE_TYPE_USER_JOIN,
  SUPPRESS_JOIN_NOTIFICATIONS,
  getGuild,
  listMembers,
  listMessages,
  type DiscordMember,
} from "./rest";

export type JoinSource = "member-list" | "system-messages";

export interface JoinEvent {
  member: DiscordMember;
  /** Epoch milliseconds. */
  joinedAt: number;
  source: JoinSource;
}

export interface DetectResult {
  ok: boolean;
  source: JoinSource | null;
  joins: JoinEvent[];
  /** Why the preferred source was not used. Informational, not a failure. */
  degraded: string | null;
  error: string | null;
}

/** Parse an ISO timestamp, returning null rather than NaN. */
function parseTime(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** Members with a usable join time, newest first. */
function fromMemberList(members: DiscordMember[]): JoinEvent[] {
  const out: JoinEvent[] = [];
  for (const m of members) {
    if (!m.user?.id) continue;
    const joinedAt = parseTime(m.joined_at);
    // No join time means no way to tell a new member from a founding one. The
    // safe reading is "not new" — a missed welcome beats greeting everybody.
    if (joinedAt === null) continue;
    out.push({ member: m, joinedAt, source: "member-list" });
  }
  return out.sort((a, b) => b.joinedAt - a.joinedAt);
}

/**
 * Join events reconstructed from the system channel.
 *
 * The member object is synthesised from the message author, so `nick` and the
 * per-server `avatar` are absent by construction — `identity.ts` falls back
 * through them to the account avatar and global name, which is why those
 * chains exist.
 */
function fromSystemMessages(
  messages: { id: string; type: number; timestamp: string; author?: DiscordMember["user"] }[]
): JoinEvent[] {
  const out: JoinEvent[] = [];
  for (const msg of messages) {
    if (msg.type !== MESSAGE_TYPE_USER_JOIN) continue;
    if (!msg.author?.id) continue;
    const joinedAt = parseTime(msg.timestamp);
    if (joinedAt === null) continue;
    out.push({
      member: { user: msg.author, nick: null, avatar: null, joined_at: msg.timestamp },
      joinedAt,
      source: "system-messages",
    });
  }
  return out.sort((a, b) => b.joinedAt - a.joinedAt);
}

/**
 * Find recent joins, preferring the member list.
 *
 * Returns everything both sources know about; filtering by age and by who has
 * already been greeted is the caller's job, because those are policy and this
 * is retrieval.
 */
export async function detectJoins(token: string, cfg: WelcomeConfig): Promise<DetectResult> {
  // ---- Source 1: the member list ---------------------------------------
  const members = await listMembers(token, cfg.guildId);
  if (members.ok) {
    return {
      ok: true,
      source: "member-list",
      joins: fromMemberList(members.data),
      degraded: null,
      error: null,
    };
  }

  // A 403 is the documented "intent is off" answer. Anything else (401, 404,
  // network) is a real problem and is reported alongside the fallback attempt,
  // so a bad token does not masquerade as a missing intent.
  const degraded =
    members.status === 403
      ? "Server Members intent is off in the Developer Portal; using system join messages instead."
      : `Member list unavailable (${members.error}); using system join messages instead.`;

  // ---- Source 2: the system channel ------------------------------------
  const guild = await getGuild(token, cfg.guildId);
  if (!guild.ok) {
    return { ok: false, source: null, joins: [], degraded, error: guild.error };
  }

  const systemChannelId = guild.data.system_channel_id;
  if (!systemChannelId) {
    return {
      ok: false,
      source: null,
      joins: [],
      degraded,
      error:
        "No system channel is set for this server, so there are no join messages to read. " +
        "Enable the Server Members intent, or set a system channel with join messages on.",
    };
  }

  if (((guild.data.system_channel_flags ?? 0) & SUPPRESS_JOIN_NOTIFICATIONS) !== 0) {
    return {
      ok: false,
      source: null,
      joins: [],
      degraded,
      error:
        "Join messages are suppressed for this server's system channel, so there is nothing to read. " +
        "Enable the Server Members intent, or re-enable join messages in Server Settings.",
    };
  }

  const messages = await listMessages(token, systemChannelId, 100);
  if (!messages.ok) {
    return { ok: false, source: null, joins: [], degraded, error: messages.error };
  }

  return {
    ok: true,
    source: "system-messages",
    joins: fromSystemMessages(messages.data),
    degraded,
    error: null,
  };
}
