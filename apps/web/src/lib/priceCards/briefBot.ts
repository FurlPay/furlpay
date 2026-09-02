// ---------------------------------------------------------------------------
// Posting the market brief as the bot, when no webhook is configured.
//
// A webhook is the simpler transport and needs no bot in the server, but it is
// also a separate credential that has to be created per channel. A deployment
// already running the price cards has a bot token and channel ids to hand, so
// this lets the brief use them rather than requiring a second setup.
//
// Deliberately NOT the price cards' upsert: a brief is a daily record and each
// day's is a new message. Editing yesterday's brief in place would destroy the
// history the channel exists to keep. The price cards edit because a price card
// is a live value with no history worth keeping; a brief is the opposite.
// ---------------------------------------------------------------------------

import { isSnowflake, botToken } from "./config";

const API = "https://discord.com/api/v10";

export interface BriefBotTarget {
  token: string;
  channelId: string;
}

/** The bot destination, or null when it is not configured. */
export function briefBotTarget(): BriefBotTarget | null {
  const token = botToken();
  const channelId = process.env.MARKET_BRIEF_CHANNEL_ID;
  if (!token || !isSnowflake(channelId)) return null;
  return { token, channelId: channelId.trim() };
}

export interface BriefPostResult {
  ok: boolean;
  status: number | null;
  retried: boolean;
  error?: string;
}

/** Post the brief, with its chart, as the bot.
 *
 * Never throws, and never puts a response body or the token into the error:
 * the same discipline the price-card transport uses, for the same reason. */
export async function postBriefAsBot(
  target: BriefBotTarget,
  payload: unknown,
  file?: { filename: string; bytes: Uint8Array }
): Promise<BriefPostResult> {
  const headers = {
    Authorization: `Bot ${target.token}`,
    "User-Agent": "FurlPay-MarketBrief (+https://furlpay.com)",
  };

  const body = () => {
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    if (file) {
      form.append(
        "files[0]",
        new Blob([file.bytes as unknown as BlobPart], { type: "image/png" }),
        file.filename
      );
    }
    return form;
  };

  try {
    let res = await fetch(`${API}/channels/${target.channelId}/messages`, {
      method: "POST",
      headers,
      body: body(),
      signal: AbortSignal.timeout(25_000),
    });
    let retried = false;

    if (res.status === 429) {
      const retry = Number(res.headers.get("retry-after") ?? "1");
      await new Promise((r) => setTimeout(r, Math.min(retry * 1000, 8_000)));
      retried = true;
      res = await fetch(`${API}/channels/${target.channelId}/messages`, {
        method: "POST",
        headers,
        body: body(),
        signal: AbortSignal.timeout(25_000),
      });
    }

    if (res.ok) return { ok: true, status: res.status, retried };
    return {
      ok: false,
      status: res.status,
      retried,
      error:
        res.status === 403
          ? "Bot lacks permission in the brief channel (403): needs Send Messages, Embed Links and Attach Files."
          : res.status === 404
            ? "Brief channel not found (404). Check MARKET_BRIEF_CHANNEL_ID."
            : `Discord returned HTTP ${res.status}.`,
    };
  } catch {
    return { ok: false, status: null, retried: false, error: "Could not reach Discord." };
  }
}
