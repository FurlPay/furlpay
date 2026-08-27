// ---------------------------------------------------------------------------
// Posting to a Discord channel webhook.
//
// A Discord webhook URL is a bearer credential in URL form: anyone holding it
// can post into that channel as that webhook, forever, with no further auth.
// Three consequences are handled here.
//
// THE HOST IS PINNED. The URL comes from an environment variable, and an env
// var is not a trusted input — it is whatever the last person to touch the
// Vercel dashboard typed. A mistyped or swapped value turns "post the brief" into
// an outbound request to an attacker-chosen host carrying whatever we send.
// `isDiscordWebhookUrl` refuses anything that is not https on a known Discord
// host with a webhook path. Cheap, and it closes the whole class.
//
// THE URL NEVER APPEARS IN A RESPONSE OR A LOG. `redactWebhookUrl` exists
// because the natural thing to do when a post fails is log the URL that failed,
// which writes a live credential into a log aggregator. Errors carry the host
// and the channel-less prefix of the id, never the token.
//
// 429 IS EXPECTED, NOT EXCEPTIONAL. Discord rate-limits webhooks per channel
// and answers with `retry_after` in seconds. One bounded retry is honoured;
// beyond that the caller is told, rather than the job either hammering the
// endpoint or silently dropping the day's post.
// ---------------------------------------------------------------------------

/** Hosts Discord serves webhooks from. Anything else is refused. */
const ALLOWED_HOSTS = new Set([
  "discord.com",
  "discordapp.com",
  "canary.discord.com",
  "ptb.discord.com",
]);

/**
 * Is this a Discord webhook URL we are willing to POST to?
 *
 * Deliberately strict: https only, an allowlisted host, and the documented
 * `/api/webhooks/<id>/<token>` shape. A URL that merely lives on discord.com is
 * not enough — the path matters, because an open redirect anywhere on the host
 * would otherwise be reachable.
 */
export function isDiscordWebhookUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (!ALLOWED_HOSTS.has(url.hostname)) return false;
  // /api/webhooks/<id>/<token>, optionally /api/v10/webhooks/<id>/<token>.
  return /^\/api\/(v\d{1,2}\/)?webhooks\/\d{5,25}\/[A-Za-z0-9_-]{20,}$/.test(url.pathname);
}

/**
 * A form of the URL safe to log: host and webhook id, never the token.
 *
 * The id alone cannot post. The token is the credential and it is dropped here
 * before it can reach a log line, an error response or a cron run record.
 */
export function redactWebhookUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const id = url.pathname.match(/webhooks\/(\d+)\//)?.[1];
    return `${url.hostname}/…/webhooks/${id ?? "?"}/<redacted>`;
  } catch {
    return "<unparseable webhook url>";
  }
}

export type PostResult =
  | { ok: true; status: number; retried: boolean }
  | { ok: false; status: number | null; error: string; retried: boolean };

export interface PostOptions {
  timeoutMs?: number;
  /** Cap on how long a 429 may make us wait. Discord can ask for far longer
   *  than a serverless function has left to live. */
  maxRetryDelayMs?: number;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * POST a payload to a Discord channel webhook.
 *
 * Never throws. A daily job's error path must be a value the runner can record,
 * not an exception that turns into a 500 and invites a retry of a post that may
 * already have landed.
 */
export async function postToDiscordWebhook(
  webhookUrl: string,
  payload: unknown,
  options: PostOptions = {}
): Promise<PostResult> {
  const {
    timeoutMs = 10_000,
    maxRetryDelayMs = 5_000,
    fetchImpl = fetch,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  } = options;

  if (!isDiscordWebhookUrl(webhookUrl)) {
    return {
      ok: false,
      status: null,
      retried: false,
      error:
        "Refusing to post: the configured webhook URL is not an https Discord webhook " +
        "(expected https://discord.com/api/webhooks/<id>/<token>).",
    };
  }

  const body = JSON.stringify(payload);

  const attempt = async (): Promise<{ status: number; retryAfterMs: number | null; detail: string }> => {
    const res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    let retryAfterMs: number | null = null;
    let detail = "";
    if (res.status === 429) {
      // Discord's JSON body states retry_after in SECONDS (fractional). The
      // header is a fallback for the edge-proxy 429, which has no body.
      const parsed = await res.json().catch(() => null);
      const fromBody =
        parsed && typeof (parsed as { retry_after?: unknown }).retry_after === "number"
          ? (parsed as { retry_after: number }).retry_after * 1000
          : null;
      const fromHeader = Number(res.headers.get("retry-after"));
      retryAfterMs = fromBody ?? (Number.isFinite(fromHeader) ? fromHeader * 1000 : null);
    } else if (!res.ok) {
      // Discord explains 400s ("Invalid Form Body", with the offending field).
      // Worth carrying — it is the difference between "we exceeded a limit" and
      // "the webhook was deleted".
      detail = (await res.text().catch(() => "")).slice(0, 300);
    }
    return { status: res.status, retryAfterMs, detail };
  };

  let retried = false;
  try {
    let out = await attempt();

    if (out.status === 429 && out.retryAfterMs !== null && out.retryAfterMs <= maxRetryDelayMs) {
      retried = true;
      await sleep(out.retryAfterMs);
      out = await attempt();
    }

    if (out.status >= 200 && out.status < 300) {
      return { ok: true, status: out.status, retried };
    }
    if (out.status === 429) {
      return {
        ok: false,
        status: 429,
        retried,
        error: `Discord rate-limited ${redactWebhookUrl(webhookUrl)}${
          out.retryAfterMs === null ? "" : ` (retry after ${Math.round(out.retryAfterMs)}ms)`
        }; post not delivered.`,
      };
    }
    return {
      ok: false,
      status: out.status,
      retried,
      error: `Discord returned HTTP ${out.status} for ${redactWebhookUrl(webhookUrl)}${
        out.detail ? `: ${out.detail}` : ""
      }`,
    };
  } catch (e) {
    return {
      ok: false,
      status: null,
      retried,
      error: `Could not reach ${redactWebhookUrl(webhookUrl)}: ${
        e instanceof Error ? e.message : "network error"
      }`,
    };
  }
}
