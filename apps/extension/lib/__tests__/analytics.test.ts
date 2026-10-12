import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Extension analytics: a bounded, expiring queue in extension storage, flushed
// to the FurlPay API with the session cookie. Never page data, never identity.

const storage: Record<string, unknown> = {};
vi.stubGlobal("browser", {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(storage, items);
      }),
    },
  },
  runtime: { getManifest: () => ({ version: "1.2.0" }) },
});

const { track, flush, EXTENSION_EVENTS } = await import("../analytics");

const queue = () => (storage.fp_analytics_queue as { event: Record<string, unknown>; attempts: number }[]) ?? [];

beforeEach(() => {
  for (const k of Object.keys(storage)) delete storage[k];
});

describe("what an event contains", () => {
  it("platform, version, installation id, allowlisted metadata, and nothing about the user or the page", async () => {
    await track("travel_search", { source: "extension", url: "https://bank.example/secret", email: "a@b.c" } as never);
    const e = queue()[0]!.event;
    expect(e).toMatchObject({ eventName: "travel_search", platform: "chrome_extension", appVersion: "1.2.0", schemaVersion: 1 });
    expect(e.metadata).toEqual({ source: "extension" });
    expect(JSON.stringify(e)).not.toMatch(/bank\.example|a@b\.c|userId/);
    expect(String(e.installationId)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("the installation id is stable across events", async () => {
    await track("extension_started");
    await track("extension_started");
    expect(queue()[0]!.event.installationId).toBe(queue()[1]!.event.installationId);
  });

  it("the queue is bounded", async () => {
    for (let i = 0; i < 130; i++) await track("extension_started");
    expect(queue()).toHaveLength(100);
  });
});

describe("flush", () => {
  it("sends with the session cookie and clears on 202", async () => {
    await track("extension_installed");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ accepted: 1 }), { status: 202 }));
    const r = await flush(fetchImpl as never);
    expect(r.sent).toBe(1);
    expect(queue()).toHaveLength(0);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/analytics\/events\/batch$/);
    expect(init.credentials).toBe("include");
    // Cookie only: no bearer token is ever attached by the extension.
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("offline / 5xx keeps events for the next alarm, up to 5 attempts, then drops", async () => {
    await track("extension_started");
    const down = vi.fn(async () => {
      throw new Error("offline");
    });
    for (let i = 0; i < 5; i++) await flush(down as never);
    expect(queue()).toHaveLength(1);
    expect(queue()[0]!.attempts).toBe(5);
    const r = await flush(down as never);
    expect(r.dropped).toBe(1);
    expect(queue()).toHaveLength(0);
  });

  it("events older than 3 days are dropped, not uploaded", async () => {
    await track("extension_started");
    const fetchImpl = vi.fn();
    const r = await flush(fetchImpl as never, Date.now() + 4 * 86_400_000);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.dropped).toBe(1);
  });

  it("a malformed-batch 400 is not retried forever", async () => {
    await track("extension_started");
    await flush(vi.fn(async () => new Response("{}", { status: 400 })) as never);
    expect(queue()).toHaveLength(0);
  });
});

describe("contract parity with the server", () => {
  it("every extension event is an accepted CLIENT event in the web contract", () => {
    const contract = readFileSync(join(__dirname, "../../../web/src/lib/analytics/contract.ts"), "utf8");
    const block = contract.slice(contract.indexOf("export const CLIENT_EVENTS"), contract.indexOf("] as const;", contract.indexOf("export const CLIENT_EVENTS")));
    for (const e of EXTENSION_EVENTS) expect(block, e).toContain(`"${e}"`);
  });

  it("no message handler lets a page or content script submit analytics", () => {
    const bg = readFileSync(join(__dirname, "../../entrypoints/background.ts"), "utf8");
    expect(bg).not.toMatch(/case\s+"(ANALYTICS|TRACK)[A-Z_]*"/);
  });
});
