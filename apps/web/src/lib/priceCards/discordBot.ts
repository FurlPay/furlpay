// ---------------------------------------------------------------------------
// Discord bot transport for the price cards.
//
// ── THE TOKEN ──────────────────────────────────────────────────────────────
//
// Read from DISCORD_BOT_TOKEN and never returned, logged, embedded in an error
// message or included in a thrown value. `describeFailure` below exists because
// the natural thing — throwing the fetch error or the response body — is how a
// token ends up in a log aggregator. Every error this module produces is
// constructed from a status code and a fixed string.
//
// This is a BOT token used with the `Bot ` authorization scheme. A user token
// would work against the same endpoints and is against Discord's terms; the
// header prefix here makes the distinction explicit rather than incidental.
//
// ── ONE CARD PER CHANNEL, FOREVER ──────────────────────────────────────────
//
// The whole point of this module is that a channel holds exactly one card,
// edited daily, rather than a growing column of stale ones. That is harder than
// it looks, because it depends on remembering a message id across runs, and
// there are three ways that memory fails:
//
//   1. THE KEY EXPIRES. A stored id with a finite TTL eventually vanishes even
//      though the message is still there. Every successful edit therefore
//      REFRESHES the TTL, so an actively-updated card never ages out. Writing
//      the id once at post time and never touching it again guarantees a
//      duplicate on the day the key expires.
//
//   2. THE STORE IS BRIEFLY UNAVAILABLE. A failed read looks exactly like "no
//      card here yet", and posting on that assumption is how a channel acquires
//      a second card. So before posting anything new, `findOwnCard` scans the
//      channel's recent history for a card this bot already posted and adopts
//      it. Discord's own message list is the durable record; KV is only a
//      shortcut past this lookup.
//
//   3. THE MESSAGE IS DELETED. Then there is nothing to edit and a new card is
//      correct. That is the only path that should ever post.
// ---------------------------------------------------------------------------

import { kvGet, kvSet } from "@/lib/kv";

const API = "https://discord.com/api/v10";

/** How long a remembered message id survives without being refreshed. Long
 *  enough that a paused job resumes cleanly; every edit pushes it out again. */
const ID_TTL_SECONDS = 60 * 60 * 24 * 90;

/** How far back to look for a card we already posted. A channel that holds one
 *  card only ever has it near the top. */
const RECOVERY_SCAN_LIMIT = 25;

export interface DiscordResult {
  ok: boolean;
  /** Present on success. */
  messageId?: string;
  /** How the card was written, for the job report. */
  action?: "edited" | "adopted" | "posted";
  /** Safe to log: never contains the token or a response body that might. */
  error?: string;
  status?: number;
}

/** A failure description that cannot contain a credential.
 *
 * Discord's error bodies are usually safe, but "usually" is not a property
 * worth relying on for a bot token, and a 401 body in particular is the one
 * most likely to be pasted into an issue. */
function describeFailure(status: number): string {
  switch (status) {
    case 401: return "Discord rejected the bot token (401). Check DISCORD_BOT_TOKEN.";
    case 403: return "Bot lacks permission in this channel (403). It needs View Channel, Send Messages, Embed Links and Attach Files.";
    case 404: return "Channel not found (404). Check the configured channel id and that the bot is in the server.";
    case 429: return "Rate limited by Discord (429).";
    default: return `Discord returned HTTP ${status}.`;
  }
}

function authHeaders(token: string): Record<string, string> {
  return {
    // `Bot` prefix: this is a bot token, not a user token.
    Authorization: `Bot ${token}`,
    "User-Agent": "FurlPay-PriceCards (+https://furlpay.com)",
  };
}

/**
 * Verify the bot can actually use a channel before trying to post to it.
 *
 * Returns a specific reason rather than a boolean, because "it didn't work" is
 * the least useful thing an operator can be told about a Discord integration.
 */
export async function checkChannel(
  token: string,
  channelId: string
): Promise<{ ok: boolean; name?: string; error?: string }> {
  try {
    const res = await fetch(`${API}/channels/${channelId}`, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: describeFailure(res.status) };
    const j = (await res.json()) as { name?: string; type?: number };
    return { ok: true, name: j.name };
  } catch {
    return { ok: false, error: "Could not reach Discord." };
  }
}

/** This bot's own user id, cached for the life of the process. */
let selfId: string | null = null;
async function botUserId(token: string): Promise<string | null> {
  if (selfId) return selfId;
  try {
    const res = await fetch(`${API}/users/@me`, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { id?: string };
    selfId = j.id ?? null;
    return selfId;
  } catch {
    return null;
  }
}

interface DiscordMessage {
  id: string;
  author?: { id?: string };
  embeds?: { image?: { url?: string } }[];
  attachments?: { filename?: string }[];
}

/**
 * Find a card this bot already posted in the channel.
 *
 * Matched on authorship AND the card's own filename, so a different FurlPay
 * message in the same channel is never mistaken for the card and edited into
 * one. Returns null when there is genuinely nothing to adopt.
 */
async function findOwnCard(
  token: string,
  channelId: string,
  filename: string
): Promise<string | null> {
  const me = await botUserId(token);
  if (!me) return null;
  try {
    const res = await fetch(
      `${API}/channels/${channelId}/messages?limit=${RECOVERY_SCAN_LIMIT}`,
      { headers: authHeaders(token), signal: AbortSignal.timeout(10_000), cache: "no-store" }
    );
    if (!res.ok) return null;
    const msgs = (await res.json()) as DiscordMessage[];
    for (const m of msgs) {
      if (m.author?.id !== me) continue;
      const named = (m.attachments ?? []).some((a) => a.filename === filename);
      const imaged = (m.embeds ?? []).some((e) => (e.image?.url ?? "").includes(filename));
      if (named || imaged) return m.id;
    }
    return null;
  } catch {
    return null;
  }
}

/** Multipart body carrying the embed payload and the card PNG together. */
function buildForm(payload: unknown, png: Uint8Array, filename: string): FormData {
  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  form.append(
    "files[0]",
    new Blob([png as unknown as BlobPart], { type: "image/png" }),
    filename
  );
  return form;
}

/**
 * Write the card into its channel: edit the existing one, adopt an orphaned
 * one, or post the first.
 *
 * Retries once on 429 using Discord's own retry_after, which is the only
 * backoff signal worth trusting here. Anything else fails this single card and
 * leaves the rest of the run alone.
 */
export async function upsertCardMessage(opts: {
  token: string;
  channelId: string;
  /** Stable key for remembering the message id, e.g. "SOL". */
  cardKey: string;
  payload: unknown;
  png: Uint8Array;
  filename: string;
}): Promise<DiscordResult> {
  const { token, channelId, cardKey, payload, png, filename } = opts;
  const stateKey = `pricecard:msg:${channelId}:${cardKey}`;

  const remember = async (id: string) => {
    // Rewritten on EVERY successful write, not only the first. An id stored
    // once with a finite TTL expires under a daily job and the next run posts a
    // duplicate; refreshing it means an actively-updated card never ages out.
    await kvSet(stateKey, id, ID_TTL_SECONDS).catch(() => {});
  };

  const once = async (url: string, method: "POST" | "PATCH"): Promise<Response | null> => {
    try {
      return await fetch(url, {
        method,
        headers: authHeaders(token),
        body: buildForm(payload, png, filename),
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
    } catch {
      return null;
    }
  };

  /**
   * One write, waiting out Discord's rate limit rather than giving up on it.
   *
   * Every card carries a PNG, and Discord meters attachment writes per channel,
   * so a job that refreshes seven cards in a row will be told to slow down at
   * least once — SOL was the card that lost on 2026-09-07 and kept a five-day
   * old price while the six around it updated. A single retry was not enough
   * because the limit applies across the whole batch, not to one message.
   *
   * `retry-after` is Discord's own number, in seconds, so it is honoured rather
   * than guessed at; the cap is there so a pathological value cannot hold the
   * daily job open past its budget. Only 429 is retried — a 403 will still be
   * a 403 in two seconds, and retrying it just spends the budget slower.
   */
  const send = async (url: string, method: "POST" | "PATCH"): Promise<Response | null> => {
    let res = await once(url, method);
    for (let attempt = 0; attempt < 3 && res && res.status === 429; attempt++) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "1");
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000;
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 8_000)));
      res = await once(url, method);
    }
    return res;
  };

  const edit = async (id: string): Promise<DiscordResult | null> => {
    const res = await send(`${API}/channels/${channelId}/messages/${id}`, "PATCH");
    if (res?.ok) {
      const j = (await res.json()) as { id?: string };
      const finalId = j.id ?? id;
      await remember(finalId);
      return { ok: true, messageId: finalId, action: "edited" };
    }
    // 404 means the card was deleted; fall through so a new one can be posted.
    if (res && res.status !== 404) {
      return { ok: false, error: describeFailure(res.status), status: res.status };
    }
    return null;
  };

  // 1. The remembered id.
  const known = await kvGet<string>(stateKey).catch(() => null);
  if (known) {
    const r = await edit(known);
    if (r) return r;
  }

  // 2. No id, or it pointed at a deleted message. Before posting anything,
  //    ask Discord whether a card is already sitting in the channel. This is
  //    what stops a KV outage from turning into a second card.
  const orphan = await findOwnCard(token, channelId, filename);
  if (orphan && orphan !== known) {
    const r = await edit(orphan);
    if (r) return { ...r, action: "adopted" };
  }

  // 3. Genuinely nothing to update.
  const res = await send(`${API}/channels/${channelId}/messages`, "POST");
  if (!res) return { ok: false, error: "Could not reach Discord." };
  if (!res.ok) return { ok: false, error: describeFailure(res.status), status: res.status };

  const j = (await res.json()) as { id?: string };
  if (j.id) await remember(j.id);
  return { ok: true, messageId: j.id, action: "posted" };
}
