import { CONTRACT_EVENTS_SENT, MAX_QUEUE, NATIVE_EVENT_MAP, createFurlpaySink, tokenSubject, type SinkDeps } from "../furlpaySink";

// The Android/iOS FurlPay sink: explicit mapping, offline queue, upload.

const ctx = { timestamp: Date.now(), environment: "test", sessionId: "s", userId: "usr_should_never_be_sent" };

function setup(over: Partial<SinkDeps> = {}) {
  const mem = new Map<string, string>();
  let n = 0;
  const fetchImpl = jest.fn(async () => new Response(JSON.stringify({ accepted: 1 }), { status: 202 }));
  const deps: SinkDeps = {
    storage: { getItem: async (k) => mem.get(k) ?? null, setItem: async (k, v) => void mem.set(k, v) },
    fetchImpl: fetchImpl as unknown as typeof fetch,
    getToken: async () => "session-token",
    apiBase: "https://furlpay.com/api",
    platform: "android",
    appVersion: "2.3.0",
    buildNumber: "7",
    osVersion: "34",
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    now: () => Date.now(),
    ...over,
  };
  const sink = createFurlpaySink(deps);
  const queue = () => JSON.parse(mem.get("fp.analytics.queue.v1") ?? "[]") as { event: Record<string, unknown>; attempts: number }[];
  const settle = () => new Promise((r) => setTimeout(r, 10));
  return { sink, deps, fetchImpl, queue, settle, mem };
}

describe("mapping", () => {
  it("sends only mapped events, under their contract names", async () => {
    const { sink, queue, settle } = setup();
    sink.track("send_submitted", { chain: "solana", token: "USDC", bucket: "10_100" }, ctx);
    sink.track("swap_settled", { provider: "x", outcome: "success" }, ctx); // completion: a ledger fact, never sent
    sink.track("kyc_started", {}, ctx); // server records KYC itself
    await settle();
    expect(queue().map((q) => q.event.eventName)).toEqual(["payment_started"]);
  });

  it("never sends the user id, contents or unknown props", async () => {
    const { sink, queue, settle } = setup();
    sink.track("screen_viewed", { screen: "Wallet", seedPhrase: "abandon abandon", balance: 1234.56 }, ctx);
    await settle();
    const e = queue()[0].event;
    expect(e).toMatchObject({ eventName: "screen_viewed", screen: "Wallet", platform: "android", appVersion: "2.3.0", buildNumber: "7" });
    expect(JSON.stringify(e)).not.toMatch(/usr_should_never_be_sent|abandon|1234/);
  });

  it("a screen name outside the contract format is not sent", async () => {
    const { sink, queue, settle } = setup();
    sink.track("screen_viewed", { screen: "Wallet <script>" }, ctx);
    await settle();
    expect(queue()).toHaveLength(0);
  });

  it("every event this sink can send is a CLIENT event in the web contract", () => {
    // The web side asserts the same list (apps/web contract parity test).
    expect(CONTRACT_EVENTS_SENT.sort()).toEqual(["app_opened", "deposit_started", "login_started", "payment_started", "screen_viewed", "swap_started"]);
    expect(Object.keys(NATIVE_EVENT_MAP)).not.toContain("swap_settled");
  });
});

describe("offline queue", () => {
  it("is bounded", async () => {
    const { sink, queue, settle } = setup();
    for (let i = 0; i < MAX_QUEUE + 25; i++) sink.track("app_opened", { source: "warm" }, ctx);
    await settle();
    expect(queue()).toHaveLength(MAX_QUEUE);
  });

  it("uploads with the session token and empties on 202", async () => {
    const { sink, fetchImpl, queue, settle } = setup();
    sink.track("app_opened", { source: "cold" }, ctx);
    await settle();
    const r = await sink.upload();
    expect(r.sent).toBe(1);
    expect(queue()).toHaveLength(0);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://furlpay.com/api/analytics/events/batch");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer session-token");
  });

  it("offline: kept and retried (each event keeps its id, so the server dedupes), dropped after 5 attempts", async () => {
    const down = jest.fn(async () => {
      throw new Error("network");
    });
    const { sink, queue, settle } = setup({ fetchImpl: down as unknown as typeof fetch });
    sink.track("app_opened", { source: "cold" }, ctx);
    await settle();
    const id = queue()[0].event.eventId;
    for (let i = 0; i < 5; i++) await sink.upload();
    expect(queue()[0].event.eventId).toBe(id);
    expect((await sink.upload()).dropped).toBe(1);
    expect(queue()).toHaveLength(0);
  });

  it("stale events (>3 days) are dropped, not sent", async () => {
    const { sink, fetchImpl, settle } = setup({ now: () => Date.now() + 4 * 86_400_000 });
    sink.track("app_opened", { source: "cold" }, ctx);
    await settle();
    expect((await sink.upload()).dropped).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("identify() sends nothing: identity is derived server-side", () => {
    const { sink, fetchImpl } = setup();
    sink.identify("usr_x", { email: "a@b.c" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// Audit 7 Oct 2026, P2-1: the queue survived sign-out and was uploaded with
// whatever token was current, so account A's events were attributed to B.
describe("account isolation", () => {
  const jwt = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;

  it("tokenSubject reads the sub claim, and null for junk", async () => {
    expect(tokenSubject(jwt("usr_a"))).toBe("usr_a");
    expect(tokenSubject(null)).toBeNull();
    expect(tokenSubject("not-a-jwt")).toBeNull();
  });

  it("never uploads account A's events under account B's session", async () => {
    let token = jwt("usr_a");
    const { sink, fetchImpl, queue, settle } = setup({ getToken: async () => token });
    sink.track("send_submitted", { chain: "base", token: "USDC", bucket: "10_100" }, ctx);
    await settle();
    expect(queue()[0]).toMatchObject({ owner: "usr_a" });
    token = jwt("usr_b"); // A signed out without a flush, B signed in
    const r = await sink.upload();
    expect(r.sent).toBe(0);
    expect(r.dropped).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uploads events recorded before sign-in with the session that follows", async () => {
    let token: string | null = null;
    const { sink, fetchImpl, settle } = setup({ getToken: async () => token });
    sink.track("app_opened", { source: "cold" }, ctx);
    await settle();
    token = jwt("usr_a");
    expect((await sink.upload()).sent).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("clear() empties the queue (sign-out)", async () => {
    const { sink, queue, settle } = setup();
    sink.track("app_opened", { source: "cold" }, ctx);
    await settle();
    expect(queue().length).toBe(1);
    await sink.clear();
    expect(queue().length).toBe(0);
  });
});
