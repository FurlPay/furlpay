// Jest Expo's SecureStore auto-mock does not retain writes. These tests need a
// real in-memory store to exercise the token-transition race.
jest.mock("expo-secure-store", () => {
  const values = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => values.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
    deleteItemAsync: jest.fn(async (key: string) => { values.delete(key); }),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
  };
});

import { api, ApiError, AbortedError, getToken, setToken } from "../api";

function expiringJwt(): string {
  const b64url = (value: string) =>
    Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ exp: Math.floor((Date.now() + 5 * 60_000) / 1000) }))}.sig`;
}

// SecureStore is auto-mocked by jest-expo (getToken -> null), so requests are
// anonymous here; we mock fetch to assert correlation-id behavior.
describe("api client — correlation id", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("sends X-Correlation-Id and captures the server's echoed id on error", async () => {
    let sentCid: string | undefined;
    global.fetch = (async (_url: string, init: any) => {
      sentCid = init.headers["X-Correlation-Id"];
      return {
        ok: false,
        status: 400,
        headers: { get: (h: string) => (h.toLowerCase() === "x-correlation-id" ? "server-echoed-id" : null) },
        json: async () => ({ error: "bad" }),
      };
    }) as unknown as typeof fetch;

    await expect(api("/x", { method: "POST", anonymous: true })).rejects.toMatchObject({
      correlationId: "server-echoed-id",
    });
    expect(typeof sentCid).toBe("string");
    expect((sentCid ?? "").length).toBeGreaterThan(10);
  });

  it("falls back to the client-generated id when the server does not echo", async () => {
    global.fetch = (async () => ({
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: async () => null,
    })) as unknown as typeof fetch;

    try {
      await api("/x", { anonymous: true });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).correlationId).toMatch(/[0-9a-f-]{36}/);
    }
  });
});

describe("api client — session transitions", () => {
  const realFetch = global.fetch;

  afterEach(async () => {
    global.fetch = realFetch;
    await setToken(null);
  });

  it("does not restore an old session or dispatch its request after account switch during refresh", async () => {
    const oldToken = expiringJwt();
    const newToken = "new-account-session";
    await setToken(oldToken);

    let refreshStarted!: () => void;
    const started = new Promise<void>((resolve) => { refreshStarted = resolve; });
    let finishRefresh!: (response: Response) => void;
    const refresh = new Promise<Response>((resolve) => { finishRefresh = resolve; });
    const dispatched: string[] = [];
    global.fetch = ((url: string) => {
      if (url.endsWith("/auth/refresh")) {
        refreshStarted();
        return refresh;
      }
      dispatched.push(url);
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) } as Response);
    }) as unknown as typeof fetch;

    const pending = api("/wallets");
    await started;
    await setToken(newToken);
    await expect(getToken()).resolves.toBe(newToken);
    finishRefresh({ ok: true, json: async () => ({ token: "refreshed-old-session" }) } as Response);

    await expect(pending).rejects.toBeInstanceOf(AbortedError);
    expect(dispatched).toEqual([]);
    await expect(getToken()).resolves.toBe(newToken);
  });
});

// ---------------------------------------------------------------------------
// Request deadlines.
//
// `fetch` has no default timeout. A socket that opens and then goes silent — a
// captive portal, a dropped cellular hand-off, a stalled load balancer — leaves
// the promise pending forever: a spinner that never resolves, no error, nothing
// queued and nothing retried. These tests pin the deadline behaviour and, just
// as importantly, that a deadline is distinguishable from a caller abort.
// ---------------------------------------------------------------------------
describe("api client — timeouts", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  /** A fetch that never settles until its signal aborts. */
  const hangingFetch = () =>
    ((_url: string, init: any) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const err: any = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
        });
      })) as unknown as typeof fetch;

  it("gives up on a hung socket instead of hanging forever", async () => {
    global.fetch = hangingFetch();
    const { TimeoutError } = require("../api");
    await expect(api("/x", { anonymous: true, timeoutMs: 30 })).rejects.toBeInstanceOf(
      TimeoutError
    );
  });

  it("reports a deadline as a timeout, NOT as a caller abort", async () => {
    // A timeout aborts the same underlying controller a supersede would, so the
    // two are easy to confuse. Getting this wrong means a real network failure
    // is silently swallowed as "superseded" and never retried or queued.
    global.fetch = hangingFetch();
    const { TimeoutError, AbortedError } = require("../api");
    const err = await api("/x", { anonymous: true, timeoutMs: 30 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err).not.toBeInstanceOf(AbortedError);
  });

  it("still honours a caller abort, and calls it superseded", async () => {
    global.fetch = hangingFetch();
    const { AbortedError } = require("../api");
    const controller = new AbortController();
    const p = api("/x", { anonymous: true, signal: controller.signal, timeoutMs: 5_000 });
    controller.abort();
    await expect(p).rejects.toBeInstanceOf(AbortedError);
  });

  it("does not time out a request that answers in time", async () => {
    global.fetch = (async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ ok: true }),
    })) as unknown as typeof fetch;
    await expect(api("/x", { anonymous: true, timeoutMs: 1_000 })).resolves.toEqual({ ok: true });
  });

  it("timeoutMs: 0 disables the deadline for genuinely long operations", async () => {
    let settled = false;
    global.fetch = ((_url: string, init: any) =>
      new Promise((resolve) => {
        setTimeout(() => {
          settled = true;
          resolve({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({ slow: true }),
          } as any);
        }, 60);
      })) as unknown as typeof fetch;

    await expect(api("/x", { anonymous: true, timeoutMs: 0 })).resolves.toEqual({ slow: true });
    expect(settled).toBe(true);
  });

  it("a timeout is retryable, so the outbox replays it under the same key", () => {
    // Critical pairing: the request MAY have landed. Retrying is only safe
    // because the outbox reuses the original idempotency key.
    const { TimeoutError } = require("../api");
    const { isRetryable } = require("../sync");
    expect(isRetryable(new TimeoutError(1000))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 401 means two different things. An expired session must sign the user out;
// a step-up challenge (`step_up_required`) is a 401 on a session that is still
// valid, and signing out there throws away the session the step-up screen is
// about to strengthen.
// ---------------------------------------------------------------------------
describe("api client — 401 handling", () => {
  const realFetch = global.fetch;
  const { setUnauthorizedHandler } = require("../api");
  const signedOut = jest.fn();

  beforeEach(async () => {
    signedOut.mockReset();
    setUnauthorizedHandler(signedOut);
    await setToken("live-session");
  });
  afterEach(async () => {
    global.fetch = realFetch;
    setUnauthorizedHandler(() => {});
    await setToken(null);
  });

  const respond = (body: unknown) =>
    (global.fetch = (async () => ({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => body,
    })) as unknown as typeof fetch);

  it("signs out on a plain 401", async () => {
    respond({ error: "Unauthorized" });
    await expect(api("/x")).rejects.toBeInstanceOf(ApiError);
    expect(signedOut).toHaveBeenCalledTimes(1);
  });

  it("keeps the session on step_up_required and surfaces the code", async () => {
    respond({ error: "step_up_required", action: { type: "step_up" } });
    const { isStepUpRequired } = require("../stepUp");
    const err = await api("/x", { method: "POST" }).catch((e: unknown) => e);
    expect(isStepUpRequired(err)).toBe(true);
    expect(signedOut).not.toHaveBeenCalled();
    await expect(getToken()).resolves.toBe("live-session");
  });
});
