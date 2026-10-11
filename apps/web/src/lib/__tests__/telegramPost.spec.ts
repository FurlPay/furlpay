import { describe, it, expect } from "vitest";
import { looksLikeBotToken, postToTelegram, redactTelegramUrl, TEXT_LIMIT } from "../telegramPost";

// ---------------------------------------------------------------------------
// The Telegram broadcast poster.
//
// Telegram puts the bot token in the URL PATH, so the reflexive act of logging
// a failed request writes a live credential into a log aggregator. That, and
// distinguishing a retryable fault from a permanent one, are what this module
// exists for — `sendToChat` returns a bare boolean and erases both.
// ---------------------------------------------------------------------------

// Synthetic, never a real credential (a live token was committed here before; it must be revoked).
const TOKEN = "123456789:AAHsyntheticTestTokenNotARealBot0000";
const CHAT = "-1003799112431";

const okResponse = (id = 42) =>
  new Response(JSON.stringify({ ok: true, result: { message_id: id } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("looksLikeBotToken", () => {
  it("accepts the documented shape", () => {
    expect(looksLikeBotToken(TOKEN)).toBe(true);
  });

  it("rejects an unset or malformed value before a request is made", () => {
    expect(looksLikeBotToken("")).toBe(false);
    expect(looksLikeBotToken("not-a-token")).toBe(false);
    expect(looksLikeBotToken("12345")).toBe(false);
    expect(looksLikeBotToken("abc:defghijklmnopqrstuvwxyz0123456789")).toBe(false);
  });
});

describe("redactTelegramUrl — the token is in the path", () => {
  it("strips the token and keeps the method", () => {
    const out = redactTelegramUrl(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(out).toBe("https://api.telegram.org/bot<redacted>/sendMessage");
    expect(out).not.toContain("AAEsLNz3");
  });
});

describe("postToTelegram", () => {
  it("sends HTML with previews disabled and returns the message id", async () => {
    let seen: { url: string; body: Record<string, unknown> } | null = null;
    const res = await postToTelegram(TOKEN, CHAT, "<b>hi</b>", {
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen = { url, body: JSON.parse(String(init.body)) };
        return okResponse(99);
      }) as unknown as typeof fetch,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.messageId).toBe(99);
    expect(seen!.body.parse_mode).toBe("HTML");
    expect(seen!.body.disable_web_page_preview).toBe(true);
    expect(seen!.body.chat_id).toBe(CHAT);
    expect(seen!.url).toContain("/sendMessage");
  });

  it("attaches inline buttons when given them", async () => {
    let body: Record<string, unknown> = {};
    await postToTelegram(TOKEN, CHAT, "x", {
      buttons: [[{ text: "Markets", url: "https://furlpay.com/investing" }]],
      fetchImpl: (async (_u: string, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return okResponse();
      }) as unknown as typeof fetch,
    });
    expect(body.reply_markup).toEqual({
      inline_keyboard: [[{ text: "Markets", url: "https://furlpay.com/investing" }]],
    });
  });

  it("omits reply_markup entirely when there are no buttons", async () => {
    let body: Record<string, unknown> = {};
    await postToTelegram(TOKEN, CHAT, "x", {
      fetchImpl: (async (_u: string, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return okResponse();
      }) as unknown as typeof fetch,
    });
    expect("reply_markup" in body).toBe(false);
  });

  it("refuses a malformed token without making a request", async () => {
    let called = false;
    const res = await postToTelegram("nope", CHAT, "x", {
      fetchImpl: (async () => {
        called = true;
        return okResponse();
      }) as unknown as typeof fetch,
    });
    expect(res.ok).toBe(false);
    expect(called).toBe(false);
    if (res.ok) return;
    expect(res.retryable).toBe(false);
  });

  it("refuses an empty chat id", async () => {
    const res = await postToTelegram(TOKEN, "   ", "x", {
      fetchImpl: (async () => okResponse()) as unknown as typeof fetch,
    });
    expect(res.ok).toBe(false);
  });

  it("names an over-length message instead of letting it become an opaque 400", async () => {
    let called = false;
    const res = await postToTelegram(TOKEN, CHAT, "x".repeat(TEXT_LIMIT + 1), {
      fetchImpl: (async () => {
        called = true;
        return okResponse();
      }) as unknown as typeof fetch,
    });
    expect(called).toBe(false);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("4097");
    expect(res.error).toContain("limit is 4096");
  });

  it("honours one 429 retry_after (seconds) and then succeeds", async () => {
    let n = 0;
    let slept = 0;
    const res = await postToTelegram(TOKEN, CHAT, "x", {
      sleep: async (ms) => {
        slept = ms;
      },
      fetchImpl: (async () => {
        n++;
        if (n === 1) {
          return new Response(
            JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 2 } }),
            { status: 429, headers: { "Content-Type": "application/json" } }
          );
        }
        return okResponse();
      }) as unknown as typeof fetch,
    });
    expect(res.ok).toBe(true);
    expect(res.retried).toBe(true);
    // retry_after is SECONDS; sleeping 2ms would hammer the endpoint.
    expect(slept).toBe(2000);
    expect(n).toBe(2);
  });

  it("does not sleep past the cap, and reports the post as undelivered", async () => {
    let n = 0;
    const res = await postToTelegram(TOKEN, CHAT, "x", {
      maxRetryDelayMs: 5_000,
      sleep: async () => {},
      fetchImpl: (async () => {
        n++;
        return new Response(
          JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 600 } }),
          { status: 429, headers: { "Content-Type": "application/json" } }
        );
      }) as unknown as typeof fetch,
    });
    expect(n).toBe(1);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.retryable).toBe(true);
    expect(res.error).toContain("not delivered");
  });

  it("marks a parse failure as NOT retryable — retrying never fixes our HTML", async () => {
    const res = await postToTelegram(TOKEN, CHAT, "<b>unclosed", {
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error_code: 400,
            description: "Bad Request: can't parse entities: Unclosed start tag at byte offset 0",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )) as unknown as typeof fetch,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.retryable).toBe(false);
    // The byte offset is the whole diagnostic value — carry it verbatim.
    expect(res.error).toContain("can't parse entities");
    expect(res.error).toContain("byte offset");
  });

  it("marks a 5xx as retryable", async () => {
    const res = await postToTelegram(TOKEN, CHAT, "x", {
      fetchImpl: (async () =>
        new Response(JSON.stringify({ ok: false, error_code: 502, description: "Bad Gateway" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        })) as unknown as typeof fetch,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.retryable).toBe(true);
  });

  it("reports a bot removed from the channel in terms an operator can act on", async () => {
    const res = await postToTelegram(TOKEN, CHAT, "x", {
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot is not a member of the channel chat" }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        )) as unknown as typeof fetch,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("bot is not a member");
    expect(res.retryable).toBe(false);
  });

  it("returns a value instead of throwing when the network fails, and leaks no token", async () => {
    const res = await postToTelegram(TOKEN, CHAT, "x", {
      fetchImpl: (async () => {
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("ECONNRESET");
    expect(res.error).toContain("<redacted>");
    expect(res.error).not.toContain("AAEsLNz3");
  });

  it("never puts the token in an error, whatever the failure", async () => {
    const failures = [
      new Response("not json at all", { status: 500 }),
      new Response(JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    ];
    for (const f of failures) {
      const res = await postToTelegram(TOKEN, CHAT, "x", {
        fetchImpl: (async () => f) as unknown as typeof fetch,
      });
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.error).not.toContain("AAEsLNz3");
      expect(res.error).not.toContain(TOKEN);
    }
  });
});
