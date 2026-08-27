// ---------------------------------------------------------------------------
// Posting a scheduled broadcast to Telegram.
//
// WHY NOT `sendToChat` FROM lib/telegram.ts. That helper returns a bare
// boolean. For an interactive reply that is fine — a person sees the failure
// immediately and retries. For a job that runs unattended at 21:30 UTC it is
// not: "false" cannot tell you whether the bot was removed from the channel,
// the token was rotated, the message broke the HTML parser, or Telegram simply
// rate-limited us. Each needs a different response, and a boolean erases the
// difference. This module returns the reason.
//
// THE TOKEN IS IN THE URL. Telegram puts the bot token in the PATH
// (`/bot<token>/sendMessage`), so the natural act of logging a failed request
// URL writes a live credential into a log aggregator. `redactTelegramUrl`
// exists so that cannot happen by accident, and every error string here goes
// through it.
//
// 429 IS ROUTINE. Telegram answers with `parameters.retry_after` in SECONDS.
// One bounded retry is honoured; a longer wait than the cap is reported rather
// than slept through, because a serverless function has a deadline and a job
// that dies mid-sleep leaves no record of what it did.
//
// 400 IS THE ONE THAT ACTUALLY BITES. `can't parse entities` means the HTML we
// built was malformed — almost always an unescaped `&` or `<` in a company
// name. Telegram rejects the WHOLE message; there is no partial render. The
// description is carried back verbatim because it names the byte offset.
// ---------------------------------------------------------------------------

const TELEGRAM_HOST = "api.telegram.org";

/** Telegram's hard cap on `text`. Checked before sending: a 4,097-character
 *  message is a guaranteed 400, and catching it here names the real cause. */
export const TEXT_LIMIT = 4096;

export type TelegramResult =
  | { ok: true; messageId: number | null; retried: boolean }
  | { ok: false; error: string; retried: boolean; retryable: boolean };

export interface TelegramButton {
  text: string;
  url: string;
}

export interface SendOptions {
  timeoutMs?: number;
  maxRetryDelayMs?: number;
  buttons?: TelegramButton[][];
  /** Silent delivery — no push notification. */
  disableNotification?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** A form of the API URL safe to log: the method, never the token. */
export function redactTelegramUrl(url: string): string {
  return url.replace(/\/bot[^/]+\//, "/bot<redacted>/");
}

/** Is this a plausible bot token? Shape only — the API is the real authority.
 *  Guards against an empty or obviously wrong env value producing a confusing
 *  404 instead of a clear "not configured". */
export function looksLikeBotToken(token: string): boolean {
  return /^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token);
}

interface TelegramResponse {
  ok: boolean;
  result?: { message_id?: number };
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

/**
 * Send one HTML message to a chat.
 *
 * Never throws. A scheduled job's failure path must be a value the runner can
 * record, not an exception that becomes a 500 and invites a retry of a post
 * that may already have landed.
 */
export async function postToTelegram(
  token: string,
  chatId: string | number,
  html: string,
  options: SendOptions = {}
): Promise<TelegramResult> {
  const {
    timeoutMs = 10_000,
    maxRetryDelayMs = 5_000,
    buttons,
    disableNotification = false,
    fetchImpl = fetch,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  } = options;

  if (!looksLikeBotToken(token)) {
    return {
      ok: false,
      retried: false,
      retryable: false,
      error:
        "Refusing to send: TELEGRAM_BOT_TOKEN is missing or malformed " +
        "(expected <numeric id>:<secret>).",
    };
  }
  if (!String(chatId).trim()) {
    return { ok: false, retried: false, retryable: false, error: "No Telegram chat id configured." };
  }
  if (html.length > TEXT_LIMIT) {
    // Named here rather than discovered as an opaque 400 from the API.
    return {
      ok: false,
      retried: false,
      retryable: false,
      error: `Message is ${html.length} characters; Telegram's limit is ${TEXT_LIMIT}.`,
    };
  }

  const url = `https://${TELEGRAM_HOST}/bot${token}/sendMessage`;
  const body = JSON.stringify({
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    disable_notification: disableNotification,
    ...(buttons?.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });

  const attempt = async (): Promise<TelegramResponse & { status: number }> => {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const parsed = (await res.json().catch(() => null)) as TelegramResponse | null;
    return { status: res.status, ...(parsed ?? { ok: false, description: "unparseable response" }) };
  };

  let retried = false;
  try {
    let out = await attempt();

    const retryAfterMs =
      out.error_code === 429 && typeof out.parameters?.retry_after === "number"
        ? out.parameters.retry_after * 1000
        : null;

    if (retryAfterMs !== null && retryAfterMs <= maxRetryDelayMs) {
      retried = true;
      await sleep(retryAfterMs);
      out = await attempt();
    }

    if (out.ok) {
      return { ok: true, messageId: out.result?.message_id ?? null, retried };
    }

    if (out.error_code === 429) {
      return {
        ok: false,
        retried,
        retryable: true,
        error: `Telegram rate-limited the post${
          out.parameters?.retry_after ? ` (retry after ${out.parameters.retry_after}s)` : ""
        }; not delivered.`,
      };
    }

    // 400 with "can't parse entities" is a bug in our HTML, not a transient
    // fault — retrying it forever would never succeed.
    const retryable = out.error_code === undefined || out.error_code >= 500;
    return {
      ok: false,
      retried,
      retryable,
      error: `Telegram refused the post (${out.error_code ?? out.status}): ${
        out.description ?? "no description"
      }`,
    };
  } catch (e) {
    return {
      ok: false,
      retried,
      retryable: true,
      error: `Could not reach ${redactTelegramUrl(url)}: ${
        e instanceof Error ? e.message : "network error"
      }`,
    };
  }
}
