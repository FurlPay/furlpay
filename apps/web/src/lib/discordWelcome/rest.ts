// ---------------------------------------------------------------------------
// The Discord REST calls the welcome sweep needs.
//
// SEPARATE FROM priceCards/discordBot.ts ON PURPOSE. That module upserts one
// message per channel and owns a message-id memory; this one reads membership
// and posts fresh messages. Merging them would give both features a shared
// surface neither needs, and the price cards are a working production job that
// this change must not touch.
//
// WHAT IS SHARED IS THE DISCIPLINE, and it is worth restating: the bot token
// never appears in a return value, a thrown error, or a log field. Discord's
// error bodies are usually harmless, but a 401 body is precisely the one most
// likely to be pasted into an issue, so every error here is built from a
// status code and a fixed string.
// ---------------------------------------------------------------------------

const API = "https://discord.com/api/v10";

/** Requests that fail slowly are worse than requests that fail: a sweep with a
 *  hung fetch burns its whole budget on one call. */
const TIMEOUT_MS = 10_000;

export interface DiscordUser {
  id: string;
  username: string;
  /** The new display-name field. Null for accounts that have not set one. */
  global_name?: string | null;
  discriminator?: string | null;
  avatar?: string | null;
  bot?: boolean;
}

export interface DiscordMember {
  user?: DiscordUser;
  /** Server nickname, if set. */
  nick?: string | null;
  /** Server-specific avatar hash, if set. */
  avatar?: string | null;
  /** ISO 8601. The field the whole sweep is built on. */
  joined_at?: string | null;
}

export interface DiscordMessage {
  id: string;
  type: number;
  timestamp: string;
  author?: DiscordUser;
}

/** Discord message type 7 — the "X joined the party" system message. */
export const MESSAGE_TYPE_USER_JOIN = 7;

export type RestResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number | null };

/** A failure description that cannot contain a credential. */
export function describeFailure(status: number): string {
  switch (status) {
    case 401:
      return "Discord rejected the bot token (401). Check DISCORD_BOT_TOKEN.";
    case 403:
      return (
        "Discord refused the request (403). For member listing this usually means the " +
        "SERVER MEMBERS INTENT is off in the Developer Portal; for posting it means the " +
        "bot lacks View Channel / Send Messages / Embed Links in the channel."
      );
    case 404:
      return "Not found (404). Check the configured guild and channel ids, and that the bot is in the server.";
    case 429:
      return "Rate limited by Discord (429).";
    default:
      return `Discord returned HTTP ${status}.`;
  }
}

function authHeaders(token: string): Record<string, string> {
  return {
    // `Bot` prefix: this is a bot token, not a user token.
    Authorization: `Bot ${token}`,
    "User-Agent": "FurlPay-Welcome (+https://furlpay.com)",
  };
}

/** Sleep for a 429 retry, bounded so a sweep cannot stall on one call. */
async function backoff(res: Response): Promise<void> {
  const retry = Number(res.headers.get("retry-after") ?? "1");
  const ms = Number.isFinite(retry) ? Math.max(retry, 0) * 1000 : 1000;
  await new Promise((r) => setTimeout(r, Math.min(ms, 8_000)));
}

/**
 * A GET that returns parsed JSON, retrying once on a 429.
 *
 * One retry, not a loop. A sweep runs under a deadline, and a job that spends
 * its budget backing off has failed just as surely as one that errored — it
 * has simply failed without saying so.
 */
async function getJson<T>(token: string, path: string): Promise<RestResult<T>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, {
        headers: authHeaders(token),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      return { ok: false, error: "Could not reach Discord.", status: null };
    }

    if (res.ok) {
      try {
        return { ok: true, data: (await res.json()) as T };
      } catch {
        return { ok: false, error: "Discord returned a body that is not JSON.", status: res.status };
      }
    }

    if (res.status === 429 && attempt === 0) {
      await backoff(res);
      continue;
    }

    return { ok: false, error: describeFailure(res.status), status: res.status };
  }
  return { ok: false, error: describeFailure(429), status: 429 };
}

export interface DiscordGuild {
  id: string;
  name?: string;
  /** Where Discord posts its own "X joined" messages, when enabled. */
  system_channel_id?: string | null;
  /** Bit 0 (SUPPRESS_JOIN_NOTIFICATIONS) set means join messages are off. */
  system_channel_flags?: number;
}

/** SUPPRESS_JOIN_NOTIFICATIONS — bit 0 of system_channel_flags. */
export const SUPPRESS_JOIN_NOTIFICATIONS = 1 << 0;

/** The guild, for its system-channel configuration. */
export async function getGuild(token: string, guildId: string): Promise<RestResult<DiscordGuild>> {
  return getJson<DiscordGuild>(token, `/guilds/${guildId}`);
}

/** Confirm the bot can see a channel, and get its name for the job report. */
export async function getChannel(
  token: string,
  channelId: string
): Promise<RestResult<{ name?: string; type?: number }>> {
  return getJson(token, `/channels/${channelId}`);
}

/**
 * List guild members.
 *
 * REQUIRES THE SERVER MEMBERS PRIVILEGED INTENT to be enabled in the Developer
 * Portal; without it this endpoint answers 403 no matter what the bot's
 * channel permissions are. `detect.ts` treats that 403 as "use the other
 * source" rather than as a failure.
 *
 * `after` pages by USER id, which is a creation snowflake and says nothing
 * about when someone joined — a brand-new member with a five-year-old account
 * sorts near the front. So this pages through everyone and lets the caller
 * filter on `joined_at`. That is affordable for a community server and honest
 * about what the API actually offers.
 */
export async function listMembers(
  token: string,
  guildId: string,
  opts: { pageSize?: number; maxPages?: number } = {}
): Promise<RestResult<DiscordMember[]>> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 1000, 1), 1000);
  const maxPages = Math.max(opts.maxPages ?? 10, 1);

  const all: DiscordMember[] = [];
  let after = "0";

  for (let page = 0; page < maxPages; page++) {
    const r = await getJson<DiscordMember[]>(
      token,
      `/guilds/${guildId}/members?limit=${pageSize}&after=${after}`
    );
    if (!r.ok) return r;
    if (!Array.isArray(r.data)) {
      return { ok: false, error: "Discord returned an unexpected member list.", status: null };
    }

    all.push(...r.data);
    if (r.data.length < pageSize) return { ok: true, data: all };

    // Page on the largest user id seen, which is what `after` means here.
    let max = after;
    for (const m of r.data) {
      const id = m.user?.id;
      if (id && (max === "0" || BigInt(id) > BigInt(max))) max = id;
    }
    // No forward progress would loop forever; stop with what we have.
    if (max === after) return { ok: true, data: all };
    after = max;
  }

  return { ok: true, data: all };
}

/** Recent messages in a channel, newest first. */
export async function listMessages(
  token: string,
  channelId: string,
  limit = 50
): Promise<RestResult<DiscordMessage[]>> {
  const n = Math.min(Math.max(limit, 1), 100);
  return getJson<DiscordMessage[]>(token, `/channels/${channelId}/messages?limit=${n}`);
}

/** Post a message. Used for the welcome embed. */
export async function postMessage(
  token: string,
  channelId: string,
  payload: unknown
): Promise<RestResult<{ id?: string }>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API}/channels/${channelId}/messages`, {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      return { ok: false, error: "Could not reach Discord.", status: null };
    }

    if (res.ok) {
      try {
        return { ok: true, data: (await res.json()) as { id?: string } };
      } catch {
        // The message was accepted; only the echo was unreadable. Reporting a
        // failure here would make the caller repost and duplicate the welcome.
        return { ok: true, data: {} };
      }
    }

    if (res.status === 429 && attempt === 0) {
      await backoff(res);
      continue;
    }

    return { ok: false, error: describeFailure(res.status), status: res.status };
  }
  return { ok: false, error: describeFailure(429), status: 429 };
}

/**
 * Open a DM channel with a user and send one message.
 *
 * Two calls, and the first is the one with a cost: Discord asks apps not to
 * open DM channels in bulk, and doing so is a recognised way to get an
 * application flagged. This is only ever reached behind WELCOME_DM_ENABLED,
 * which defaults to off.
 */
export async function sendDirectMessage(
  token: string,
  userId: string,
  payload: unknown
): Promise<RestResult<{ id?: string }>> {
  let res: Response;
  try {
    res = await fetch(`${API}/users/@me/channels`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ recipient_id: userId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "Could not reach Discord.", status: null };
  }
  if (!res.ok) {
    // 403 here is ordinary rather than broken: the member has DMs from server
    // members turned off, which is their choice and not a fault to alert on.
    return { ok: false, error: describeFailure(res.status), status: res.status };
  }

  let channelId: string | undefined;
  try {
    channelId = ((await res.json()) as { id?: string }).id;
  } catch {
    channelId = undefined;
  }
  if (!channelId) {
    return { ok: false, error: "Discord did not return a DM channel.", status: null };
  }

  return postMessage(token, channelId, payload);
}
