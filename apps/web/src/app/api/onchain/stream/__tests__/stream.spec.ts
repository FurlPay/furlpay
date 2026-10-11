import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The stream carries change NOTIFICATIONS only. It must emit when any
// version moves (ledger row, security event, chain event, pipeline state),
// stay quiet when nothing changed, heartbeat, and close on abort.
let n = 0;
const versions = ["v1", "v1", "v1", "v2", "v2", "v2", "v2", "v2", "v2", "v2", "v2", "v2"];
vi.mock("@/lib/onchain/live", () => ({
  liveSnapshot: vi.fn(async () => {
    const v = versions[Math.min(n++, versions.length - 1)];
    return { latestId: 7, state: "live", dataVersion: v, generatedAt: new Date().toISOString() };
  }),
}));
vi.mock("@/lib/rateLimit", async (orig) => ({ ...(await orig<typeof import("@/lib/rateLimit")>()), rateLimitOr429: vi.fn(async () => null) }));

import { GET } from "../route";

describe("GET /api/onchain/stream", () => {
  it("emits change on version moves only, heartbeats, and closes on abort", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const res = await GET(new NextRequest("https://furlpay.com/api/onchain/stream", { signal: ac.signal }));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    const pump = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value);
      }
    })();
    for (let i = 0; i < 12; i++) await vi.advanceTimersByTimeAsync(2_000);
    ac.abort();
    await vi.advanceTimersByTimeAsync(10);
    await pump;
    vi.useRealTimers();
    const changes = text.split("event: change").length - 1;
    expect(text.startsWith("retry: 3000")).toBe(true);
    expect(changes).toBe(2); // v1 once, v2 once — repeats are silent
    expect(text).toContain('"version":"v2"');
    expect(text).toContain(": ping");
  });
});
