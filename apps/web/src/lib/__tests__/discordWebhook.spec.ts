import { describe, it, expect } from "vitest";
import { isDiscordWebhookUrl, postToDiscordWebhook, redactWebhookUrl } from "../discordWebhook";

// ---------------------------------------------------------------------------
// The Discord webhook poster.
//
// A webhook URL is a bearer credential in URL form. Two of the three concerns
// here are security ones and neither produces a visible symptom when it fails:
// an unpinned host sends our payload wherever the env var points, and an
// unredacted log writes a live posting credential into an aggregator.
// ---------------------------------------------------------------------------

const VALID = "https://discord.com/api/webhooks/1542628418192015440/abcdefghijklmnopqrstuvwxyz012345";

describe("isDiscordWebhookUrl — the host is pinned", () => {
  it("accepts the documented shape on every Discord host", () => {
    expect(isDiscordWebhookUrl(VALID)).toBe(true);
    expect(isDiscordWebhookUrl(VALID.replace("discord.com", "discordapp.com"))).toBe(true);
    expect(isDiscordWebhookUrl(VALID.replace("discord.com", "ptb.discord.com"))).toBe(true);
    expect(isDiscordWebhookUrl(VALID.replace("/api/", "/api/v10/"))).toBe(true);
  });

  it("refuses a non-Discord host, which is the whole point", () => {
    expect(isDiscordWebhookUrl(VALID.replace("discord.com", "evil.example"))).toBe(false);
    // The lookalike that a hurried eye passes over.
    expect(isDiscordWebhookUrl(VALID.replace("discord.com", "discord.com.evil.example"))).toBe(false);
    expect(isDiscordWebhookUrl(VALID.replace("discord.com", "evil.example/discord.com"))).toBe(false);
  });

  it("refuses plaintext http, which would put the token on the wire", () => {
    expect(isDiscordWebhookUrl(VALID.replace("https:", "http:"))).toBe(false);
  });

  it("refuses a Discord URL that is not a webhook path", () => {
    // Being on the right host is not enough — an open redirect anywhere on it
    // would otherwise be reachable.
    expect(isDiscordWebhookUrl("https://discord.com/api/v10/channels/123/messages")).toBe(false);
    expect(isDiscordWebhookUrl("https://discord.com/")).toBe(false);
    expect(isDiscordWebhookUrl("https://discord.com/api/webhooks/123")).toBe(false);
    expect(isDiscordWebhookUrl("https://discord.com/api/webhooks/abc/token12345678901234567890")).toBe(false);
  });

  it("refuses junk without throwing", () => {
    expect(isDiscordWebhookUrl("")).toBe(false);
    expect(isDiscordWebhookUrl("not a url")).toBe(false);
    expect(isDiscordWebhookUrl("javascript:alert(1)")).toBe(false);
    expect(isDiscordWebhookUrl("file:///etc/passwd")).toBe(false);
  });
});

describe("redactWebhookUrl — the token never reaches a log", () => {
  it("keeps the host and id and drops the token", () => {
    const out = redactWebhookUrl(VALID);
    expect(out).toContain("discord.com");
    expect(out).toContain("1542628418192015440");
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
  });

  it("does not throw on an unparseable value", () => {
    expect(redactWebhookUrl("garbage")).toBe("<unparseable webhook url>");
  });
});

describe("postToDiscordWebhook", () => {
  // 204 is a null-body status: `new Response("", { status: 204 })` throws in
  // undici, which would make every mock look like a network failure.
  const ok = () => new Response(null, { status: 204 });

  it("posts JSON and reports success", async () => {
    let seen: { url: string; body: string } | null = null;
    const res = await postToDiscordWebhook(
      VALID,
      { content: "hi" },
      {
        fetchImpl: (async (url: string, init: RequestInit) => {
          seen = { url, body: String(init.body) };
          return ok();
        }) as unknown as typeof fetch,
      }
    );
    expect(res.ok).toBe(true);
    expect(res.status).toBe(204);
    expect(seen!.body).toBe('{"content":"hi"}');
  });

  it("refuses to send anywhere but Discord, without making a request", async () => {
    let called = false;
    const res = await postToDiscordWebhook(
      "https://evil.example/api/webhooks/1/aaaaaaaaaaaaaaaaaaaaaaa",
      {},
      {
        fetchImpl: (async () => {
          called = true;
          return ok();
        }) as unknown as typeof fetch,
      }
    );
    expect(res.ok).toBe(false);
    expect(called).toBe(false);
    expect(res.error).toContain("Refusing to post");
  });

  it("honours one 429 retry_after and then succeeds", async () => {
    let n = 0;
    let slept = 0;
    const res = await postToDiscordWebhook(
      VALID,
      {},
      {
        sleep: async (ms) => {
          slept = ms;
        },
        fetchImpl: (async () => {
          n++;
          if (n === 1) {
            return new Response(JSON.stringify({ retry_after: 1.25 }), {
              status: 429,
              headers: { "Content-Type": "application/json" },
            });
          }
          return ok();
        }) as unknown as typeof fetch,
      }
    );
    expect(res.ok).toBe(true);
    expect(res.retried).toBe(true);
    // retry_after is SECONDS in the body; sleeping 1.25ms would be a silent
    // no-op that hammers the endpoint.
    expect(slept).toBe(1250);
    expect(n).toBe(2);
  });

  it("does not retry a delay longer than the cap, and says the post did not land", async () => {
    let n = 0;
    const res = await postToDiscordWebhook(
      VALID,
      {},
      {
        maxRetryDelayMs: 5_000,
        sleep: async () => {},
        fetchImpl: (async () => {
          n++;
          return new Response(JSON.stringify({ retry_after: 600 }), {
            status: 429,
            headers: { "Content-Type": "application/json" },
          });
        }) as unknown as typeof fetch,
      }
    );
    expect(n).toBe(1);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(429);
    expect(res.error).toContain("not delivered");
  });

  it("falls back to the Retry-After header when a 429 has no JSON body", async () => {
    let slept = 0;
    let n = 0;
    await postToDiscordWebhook(
      VALID,
      {},
      {
        sleep: async (ms) => {
          slept = ms;
        },
        fetchImpl: (async () => {
          n++;
          if (n === 1) return new Response("", { status: 429, headers: { "retry-after": "2" } });
          return ok();
        }) as unknown as typeof fetch,
      }
    );
    expect(slept).toBe(2000);
  });

  it("carries Discord's explanation of a 400 rather than just the status", async () => {
    const res = await postToDiscordWebhook(
      VALID,
      {},
      {
        fetchImpl: (async () =>
          new Response('{"message":"Invalid Form Body"}', { status: 400 })) as unknown as typeof fetch,
      }
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Invalid Form Body");
    // ...but never the token.
    expect(res.error).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
  });

  it("returns a value instead of throwing when the network fails", async () => {
    const res = await postToDiscordWebhook(
      VALID,
      {},
      {
        fetchImpl: (async () => {
          throw new Error("ECONNRESET");
        }) as unknown as typeof fetch,
      }
    );
    expect(res.ok).toBe(false);
    expect(res.status).toBeNull();
    expect(res.error).toContain("ECONNRESET");
    expect(res.error).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
  });
});
