import { log } from "../../log";

// ---------------------------------------------------------------------------
// Sending a direct message to a Discord user.
//
// Discord has no "send DM to user id" endpoint. A DM channel must be opened
// first (POST /users/@me/channels with a recipient_id), which returns a channel
// the bot can post to. The channel is reused on subsequent calls, so opening it
// repeatedly is cheap and idempotent.
//
// DMS CAN BE REFUSED, AND THAT IS NORMAL. A member may block the bot, disable
// DMs from server members, or be in a server where that setting is off by
// default — Discord's teen-by-default changes made this materially more common.
// The failure arrives as 50007 "Cannot send messages to this user". It is a
// user preference rather than an error to swallow: the caller has to tell the
// member what to change, because a verification that silently never arrives is
// indistinguishable to them from a broken bot.
// ---------------------------------------------------------------------------

const API = "https://discord.com/api/v10";

/** Discord's code for "this user does not accept your DMs". */
export const CANNOT_DM = 50007;

export type DmResult =
  | { ok: true; channelId: string; messageId: string }
  | { ok: false; reason: "dms_disabled" | "not_configured" | "failed"; detail: string };

function botToken(): string | null {
  const t = process.env.DISCORD_BOT_TOKEN?.trim();
  return t || null;
}

/**
 * Open (or reuse) the DM channel with a user.
 *
 * Exported separately because the channel id is worth caching by the caller:
 * it never changes for a given pair, and reusing it avoids a round trip on
 * every message.
 */
export async function openDmChannel(discordUserId: string): Promise<
  { ok: true; channelId: string } | { ok: false; reason: "dms_disabled" | "not_configured" | "failed"; detail: string }
> {
  const token = botToken();
  if (!token) {
    return { ok: false, reason: "not_configured", detail: "No bot token on this deployment." };
  }

  const res = await fetch(`${API}/users/@me/channels`, {
    method: "POST",
    headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ recipient_id: discordUserId }),
  });

  if (res.ok) {
    const channel = (await res.json()) as { id: string };
    return { ok: true, channelId: channel.id };
  }

  const body = (await res.json().catch(() => null)) as { code?: number; message?: string } | null;
  if (body?.code === CANNOT_DM) {
    return {
      ok: false,
      reason: "dms_disabled",
      detail: "This member does not accept direct messages from the bot.",
    };
  }
  // The response body is safe to log: Discord's errors carry a code and a
  // message, never the token that was used.
  log.error("discord: could not open DM channel", { status: res.status, code: body?.code });
  return { ok: false, reason: "failed", detail: "Discord refused to open a direct message." };
}

/**
 * Send a message to a user's DM.
 *
 * Returns a structured failure rather than throwing, because the DM-disabled
 * case is a routine branch the onboarding flow has to render, not an
 * exceptional one.
 */
export async function sendDm(
  discordUserId: string,
  payload: Record<string, unknown>
): Promise<DmResult> {
  const channel = await openDmChannel(discordUserId);
  if (!channel.ok) return channel;

  const token = botToken()!;
  const res = await fetch(`${API}/channels/${channel.channelId}/messages`, {
    method: "POST",
    headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: number } | null;
    if (body?.code === CANNOT_DM) {
      return {
        ok: false,
        reason: "dms_disabled",
        detail: "This member does not accept direct messages from the bot.",
      };
    }
    log.error("discord: DM send failed", { status: res.status, code: body?.code });
    return { ok: false, reason: "failed", detail: "Discord refused to deliver the message." };
  }

  const message = (await res.json()) as { id: string };
  return { ok: true, channelId: channel.channelId, messageId: message.id };
}
