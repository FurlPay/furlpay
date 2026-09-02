import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// One card per channel, forever.
//
// The daily job must never leave a channel with two cards. These tests drive
// `upsertCardMessage` against a fake Discord and a fake KV, and cover each way
// the remembered message id can be lost — because every one of them looks, from
// inside the code, exactly like "there is no card here yet".
// ---------------------------------------------------------------------------

const store = new Map<string, string>();
vi.mock("@/lib/kv", () => ({
  kvGet: async (k: string) => store.get(k) ?? null,
  kvSet: async (k: string, v: string) => { store.set(k, v); },
}));

const { upsertCardMessage } = await import("../discordBot");

const TOKEN = "test-token";
const CHANNEL = "111";
const FILE = "sol-price.png";
const BOT = "botid";

interface Call { method: string; url: string }

/** A Discord that remembers the messages posted to it. */
function fakeDiscord(opts: { existing?: { id: string; mine: boolean }[] } = {}) {
  const messages = [...(opts.existing ?? [])];
  const calls: Call[] = [];
  let nextId = 900;

  const impl = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ method, url: u });

    if (u.endsWith("/users/@me")) {
      return new Response(JSON.stringify({ id: BOT }), { status: 200 });
    }
    if (method === "GET" && u.includes("/messages?limit=")) {
      return new Response(JSON.stringify(messages.map((m) => ({
        id: m.id,
        author: { id: m.mine ? BOT : "someone-else" },
        attachments: [{ filename: FILE }],
        embeds: [{ image: { url: `https://cdn/${FILE}` } }],
      }))), { status: 200 });
    }
    if (method === "PATCH") {
      const id = u.split("/messages/")[1]!;
      if (!messages.some((m) => m.id === id)) {
        return new Response(JSON.stringify({ message: "Unknown Message" }), { status: 404 });
      }
      return new Response(JSON.stringify({ id }), { status: 200 });
    }
    if (method === "POST") {
      const id = String(nextId++);
      messages.push({ id, mine: true });
      return new Response(JSON.stringify({ id }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };

  return {
    calls,
    messages,
    install() { globalThis.fetch = impl as unknown as typeof fetch; },
    postCount: () => calls.filter((c) => c.method === "POST").length,
  };
}

const run = () =>
  upsertCardMessage({
    token: TOKEN, channelId: CHANNEL, cardKey: "SOL",
    payload: { embeds: [] }, png: new Uint8Array([1, 2, 3]), filename: FILE,
  });

let realFetch: typeof globalThis.fetch;
beforeEach(() => { store.clear(); realFetch = globalThis.fetch; });

describe("a channel never accumulates a second card", () => {
  it("posts once, then edits on every later run", async () => {
    const d = fakeDiscord(); d.install();
    try {
      const first = await run();
      expect(first.action).toBe("posted");

      // Thirty daily runs.
      for (let i = 0; i < 30; i++) {
        const r = await run();
        expect(r.ok).toBe(true);
        expect(r.action).toBe("edited");
        expect(r.messageId).toBe(first.messageId);
      }
      // Exactly one message was ever created.
      expect(d.postCount()).toBe(1);
      expect(d.messages).toHaveLength(1);
    } finally { globalThis.fetch = realFetch; }
  });

  it("refreshes the remembered id on every edit, so it cannot age out", async () => {
    // An id written once with a TTL expires under a daily job, and the run
    // after that posts a duplicate. Each edit must rewrite it.
    const d = fakeDiscord(); d.install();
    try {
      const first = await run();
      const key = `pricecard:msg:${CHANNEL}:SOL`;
      store.delete(key); // simulate the key having expired
      const second = await run();
      // Recovered rather than duplicated...
      expect(second.messageId).toBe(first.messageId);
      // ...and the id is back in the store, so the next run is a plain edit.
      expect(store.get(key)).toBe(first.messageId);
      const third = await run();
      expect(third.action).toBe("edited");
      expect(d.postCount()).toBe(1);
    } finally { globalThis.fetch = realFetch; }
  });

  it("adopts the existing card when the store is empty", async () => {
    // A KV outage reads as "no card here yet". Discord's own history is the
    // durable record, and it says otherwise.
    const d = fakeDiscord({ existing: [{ id: "555", mine: true }] });
    d.install();
    try {
      const r = await run();
      expect(r.action).toBe("adopted");
      expect(r.messageId).toBe("555");
      expect(d.postCount()).toBe(0);
    } finally { globalThis.fetch = realFetch; }
  });

  it("posts a new card when the old one was genuinely deleted", async () => {
    // The one path that SHOULD post. A deleted card must heal, not leave the
    // channel permanently empty.
    const d = fakeDiscord(); d.install();
    try {
      const first = await run();
      d.messages.length = 0; // someone deleted it
      const second = await run();
      expect(second.action).toBe("posted");
      expect(second.messageId).not.toBe(first.messageId);
      expect(d.postCount()).toBe(2);
    } finally { globalThis.fetch = realFetch; }
  });

  it("does not adopt a message posted by someone else", async () => {
    // Editing a stranger's message is worse than posting our own.
    const d = fakeDiscord({ existing: [{ id: "777", mine: false }] });
    d.install();
    try {
      const r = await run();
      expect(r.action).toBe("posted");
      expect(r.messageId).not.toBe("777");
    } finally { globalThis.fetch = realFetch; }
  });

  it("surfaces a permission failure instead of posting anyway", async () => {
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) =>
      new Response("{}", { status: (init?.method ?? "GET") === "GET" ? 200 : 403 })) as unknown as typeof fetch;
    try {
      const r = await run();
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/permission/i);
      // And the error never carries a credential.
      expect(r.error).not.toContain(TOKEN);
    } finally { globalThis.fetch = realFetch; }
  });
});
