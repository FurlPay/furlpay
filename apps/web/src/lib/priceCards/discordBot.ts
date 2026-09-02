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
// ── EDIT, DO NOT SPAM ──────────────────────────────────────────────────────
//
// One card per asset per channel, edited in place. The message id is kept in KV
// under a per-channel key. If the edit fails because the message was deleted,
// the next run posts a fresh one and stores the new id — a deleted card should
// heal, not leave the channel permanently empty.
// ---------------------------------------------------------------------------

import { kvGet, kvSet } from "@/lib/kv";

const API = "https://discord.com/api/v10";

export interface DiscordResult {
  ok: boolean;
  /** Present on success. */
  messageId?: string;
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
 * Post a new card, or edit the one already in the channel.
 *
 * Retries once on 429 using Discord's own retry_after, which is the only
 * backoff signal worth trusting here. Anything else fails the single card and
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
  const existing = await kvGet<string>(stateKey).catch(() => null);

  const send = async (url: string, method: "POST" | "PATCH"): Promise<Response | null> => {
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

  // Try to edit first when we have an id.
  if (existing) {
    const res = await send(`${API}/channels/${channelId}/messages/${existing}`, "PATCH");
    if (res?.ok) {
      const j = (await res.json()) as { id?: string };
      return { ok: true, messageId: j.id ?? existing };
    }
    // A 404 means someone deleted the card. Fall through and post a new one
    // rather than leaving the channel empty forever.
    if (res && res.status !== 404) {
      if (res.status === 429) {
        const retry = Number(res.headers.get("retry-after") ?? "1");
        await new Promise((r) => setTimeout(r, Math.min(retry * 1000, 8_000)));
      } else {
        return { ok: false, error: describeFailure(res.status), status: res.status };
      }
    }
  }

  const res = await send(`${API}/channels/${channelId}/messages`, "POST");
  if (!res) return { ok: false, error: "Could not reach Discord." };
  if (!res.ok) return { ok: false, error: describeFailure(res.status), status: res.status };

  const j = (await res.json()) as { id?: string };
  if (j.id) await kvSet(stateKey, j.id, 60 * 60 * 24 * 90).catch(() => {});
  return { ok: true, messageId: j.id };
}
