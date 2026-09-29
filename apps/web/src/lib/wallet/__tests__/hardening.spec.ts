import { describe, it, expect, beforeEach, vi } from "vitest";
import { silentAccounts, classifyProviderError } from "../connect";
import { sessionStore } from "../session";
import { addr, walletEvent } from "../telemetry";
import type { EIP6963ProviderDetail } from "../mipd";

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
const { log } = await import("@/lib/log");

// ---------------------------------------------------------------------------
// Gaps the previous pass left open.
//
//   * silentAccounts() shipped with no test at all. It is the function that
//     decides whether a page load shows "connected" — and the one that must
//     never open a wallet popup.
//   * Stale-provider authority was implemented but only partly proven.
//   * Telemetry's safety is a type-level claim; the runtime behaviour that
//     backs it (truncation, no raw messages) was unasserted.
//   * connected / linked / active were named but never tested as distinct.
// ---------------------------------------------------------------------------

type Listener = (payload: unknown) => void;

function fakeProvider(request?: (a: { method: string }) => Promise<unknown>) {
  const handlers = new Map<string, Set<Listener>>();
  return {
    request: vi.fn(request ?? (async () => "0x1")),
    on(e: string, fn: Listener) {
      if (!handlers.has(e)) handlers.set(e, new Set());
      handlers.get(e)!.add(fn);
    },
    removeListener(e: string, fn: Listener) {
      handlers.get(e)?.delete(fn);
    },
    emit(e: string, p: unknown) {
      handlers.get(e)?.forEach((fn) => fn(p));
    },
  };
}

function detail(uuid: string, rdns: string, req?: (a: { method: string }) => Promise<unknown>) {
  const provider = fakeProvider(req);
  return {
    d: {
      info: { uuid, rdns, name: "W", icon: "data:," },
      provider,
    } as unknown as EIP6963ProviderDetail,
    provider,
  };
}

const A = "0xAAA0000000000000000000000000000000000001";
const B = "0xBBB0000000000000000000000000000000000002";

beforeEach(() => {
  sessionStore.__reset();
  vi.clearAllMocks();
});

// ── §9 silent reconnect ────────────────────────────────────────────────────

describe("silentAccounts", () => {
  it("asks eth_accounts and NEVER eth_requestAccounts", async () => {
    // The whole point. eth_requestAccounts opens a permission popup; a page
    // load must never do that. eth_accounts returns the already-permitted set.
    const { d, provider } = detail("u", "r", async () => [A]);
    await silentAccounts(d);

    const methods = provider.request.mock.calls.map((c) => c[0].method);
    expect(methods).toContain("eth_accounts");
    expect(methods).not.toContain("eth_requestAccounts");
  });

  it("returns the permitted accounts when authorization still stands", async () => {
    const { d } = detail("u", "r", async () => [A, B]);
    expect(await silentAccounts(d)).toEqual([A, B]);
  });

  it("returns [] when the origin is no longer authorized", async () => {
    const { d } = detail("u", "r", async () => []);
    expect(await silentAccounts(d)).toEqual([]);
  });

  it("returns [] when the provider rejects", async () => {
    // A wallet that will not answer is NOT authorized. Treating an error as
    // "probably still connected" is how a UI shows a connected state over a
    // wallet the user revoked.
    const { d } = detail("u", "r", async () => {
      throw { code: 4100 };
    });
    expect(await silentAccounts(d)).toEqual([]);
  });

  it("returns [] when the provider returns a non-array", async () => {
    const { d } = detail("u", "r", async () => ({ nope: true }));
    expect(await silentAccounts(d)).toEqual([]);
  });

  it("filters non-string entries rather than trusting the shape", async () => {
    const { d } = detail("u", "r", async () => [A, null, 42, B]);
    expect(await silentAccounts(d)).toEqual([A, B]);
  });

  it("returns [] rather than hanging when the provider never answers", async () => {
    const { d } = detail("u", "r", () => new Promise(() => {}));
    await expect(silentAccounts(d)).resolves.toEqual([]);
  }, 10_000);
});

// ── §11 stale provider authority ───────────────────────────────────────────

describe("stale provider has no authority", () => {
  it("ignores events from provider A after provider B connects", () => {
    const a = detail("uuid-a", "io.a");
    const b = detail("uuid-b", "io.b");

    sessionStore.connected(a.d, A, 1);
    sessionStore.connected(b.d, B, 8453);

    // A is detached. Its event must not touch the session that describes B.
    a.provider.emit("accountsChanged", ["0xCCC0000000000000000000000000000000000003"]);

    const s = sessionStore.get();
    expect(s.rdns).toBe("io.b");
    expect(s.activeAccount).toBe(B);
    expect(s.notice).toBeUndefined();
  });

  it("ignores a chain event from a replaced provider", () => {
    const a = detail("uuid-a", "io.a");
    const b = detail("uuid-b", "io.b");
    sessionStore.connected(a.d, A, 1);
    sessionStore.connected(b.d, B, 8453);

    a.provider.emit("chainChanged", "0x89");
    expect(sessionStore.get().chainId).toBe(8453);
  });

  it("ignores a late event after its own session ended", () => {
    const a = detail("uuid-a", "io.a");
    sessionStore.connected(a.d, A, 1);
    sessionStore.endSession();

    a.provider.emit("accountsChanged", [B]);
    a.provider.emit("chainChanged", "0x1");
    a.provider.emit("disconnect", {});

    expect(sessionStore.get().activeAccount).toBeUndefined();
    expect(sessionStore.get().status).toBe("disconnected");
  });

  it("supports connect → disconnect → reconnect", () => {
    const a = detail("uuid-a", "io.a");
    sessionStore.connected(a.d, A, 1);
    sessionStore.endSession();
    expect(sessionStore.get().status).toBe("disconnected");

    sessionStore.connected(a.d, A, 1);
    expect(sessionStore.get().status).toBe("connected");
    expect(sessionStore.get().activeAccount).toBe(A);

    // And the reattached listener works.
    a.provider.emit("accountsChanged", [B]);
    expect(sessionStore.get().activeAccount).toBe(B);
  });

  it("runs the full lifecycle in order without leaking state", () => {
    const a = detail("uuid-a", "io.a");
    sessionStore.connected(a.d, A, 8453);

    a.provider.emit("accountsChanged", [B]);
    expect(sessionStore.get().activeAccount).toBe(B);

    sessionStore.acknowledge();
    a.provider.emit("chainChanged", "0x1");
    expect(sessionStore.get().chainId).toBe(1);

    sessionStore.acknowledge();
    a.provider.emit("disconnect", {});
    expect(sessionStore.get().status).toBe("disconnected");
    expect(sessionStore.__isBound()).toBe(false);
  });
});

// ── §14 telemetry safety ───────────────────────────────────────────────────

describe("telemetry safety", () => {
  it("truncates an address to a correlation-sized fragment", () => {
    expect(addr(A)).toBe("0xAAA0…0001");
    expect(addr(A)!.length).toBeLessThan(A.length);
  });

  it("refuses to emit anything that is not plausibly an address", () => {
    // A short or absent value returns undefined rather than being logged raw,
    // so a malformed field cannot become a full-value log line.
    expect(addr("0x1")).toBeUndefined();
    expect(addr(undefined)).toBeUndefined();
    expect(addr(null)).toBeUndefined();
    expect(addr("")).toBeUndefined();
  });

  it("drops undefined fields instead of logging empty keys", () => {
    walletEvent("wallet_connect_started", { uuid: "u", rdns: undefined });
    const payload = (log.info as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(payload).toEqual({ event: "wallet_connect_started", uuid: "u" });
    expect("rdns" in payload).toBe(false);
  });

  it("logs a rejection at info, not warn", () => {
    // A user declining a prompt is a normal outcome. Logging it as a warning
    // trains people to ignore warnings.
    walletEvent("wallet_connect_rejected", { errorKind: "rejected" });
    expect(log.info).toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("logs a genuine failure at warn", () => {
    walletEvent("wallet_connect_failed", { errorKind: "unknown" });
    expect(log.warn).toHaveBeenCalled();
  });

  it("never carries a raw provider message — only a classified kind", () => {
    // classifyProviderError returns a SAFE message; what telemetry records is
    // the kind. The raw string never becomes a field.
    const raw = "Internal JSON-RPC error: reverted 0xdeadbeef at 0xSECRET";
    const { kind } = classifyProviderError({ code: -32603, message: raw });
    walletEvent("wallet_provider_error", { errorKind: kind });

    const serialized = JSON.stringify(
      (log.warn as ReturnType<typeof vi.fn>).mock.calls[0][1],
    );
    expect(serialized).not.toContain("0xdeadbeef");
    expect(serialized).not.toContain("SECRET");
    expect(serialized).toContain("provider-error");
  });
});

// ── §13 error classification completeness ──────────────────────────────────

describe("error classification is deterministic for every documented input", () => {
  it.each([
    [{ code: -32002 }, "pending"],
    [{ code: 4001 }, "rejected"],
    [{ code: 4100 }, "locked"],
    [{ code: 4900 }, "locked"],
    [{ code: 4902 }, "wrong-network"],
    [{ code: -32603 }, "provider-error"],
    [{ code: -32000 }, "network"],
    [{ data: { originalError: { code: -32002 } } }, "pending"],
    [{ name: "AbortError" }, "timeout"],
    [{ message: "network request failed" }, "network"],
    [{ code: 123456 }, "unknown"],
    [null, "unknown"],
    [undefined, "unknown"],
    ["a string error", "unknown"],
  ])("classifies %j as %s", (input, expected) => {
    expect(classifyProviderError(input).kind).toBe(expected);
  });

  it("never returns an empty message", () => {
    for (const input of [{ code: -32603 }, null, "x", { code: 1 }]) {
      expect(classifyProviderError(input).message.length).toBeGreaterThan(10);
    }
  });
});

// ── §15 connected vs linked vs active ──────────────────────────────────────

describe("connected / linked / active are distinct", () => {
  // `linked` is a SERVER fact (linked_wallets). The session layer never stores
  // it, which is what makes these independent by construction rather than by
  // discipline. These tests pin that the session cannot express or imply it.
  const linkedAddress = A;

  it("A: connected but not linked", () => {
    const { d } = detail("u", "r");
    sessionStore.connected(d, B, 1);
    const s = sessionStore.get();
    expect(s.status).toBe("connected");
    // Nothing in the session asserts a link.
    expect(Object.keys(s)).not.toContain("linked");
  });

  it("B: connected, linked, and active are the same address", () => {
    const { d } = detail("u", "r");
    sessionStore.connected(d, linkedAddress, 1);
    expect(sessionStore.get().activeAccount).toBe(linkedAddress);
  });

  it("C: linked wallet stays linked after the provider disconnects", () => {
    const { d, provider } = detail("u", "r");
    sessionStore.connected(d, linkedAddress, 1);
    provider.emit("disconnect", {});

    // The session ended. The server-side link is untouched — the session layer
    // has no field that could clear it.
    expect(sessionStore.get().status).toBe("disconnected");
    expect(Object.keys(sessionStore.get())).not.toContain("linked");
  });

  it("D: active account may differ from the linked address, with no relink", () => {
    const { d, provider } = detail("u", "r");
    sessionStore.connected(d, linkedAddress, 1);
    provider.emit("accountsChanged", [B]);

    const s = sessionStore.get();
    expect(s.activeAccount).toBe(B);
    expect(s.activeAccount).not.toBe(linkedAddress);
    // The user is TOLD, and nothing relinks silently.
    expect(s.notice).toEqual({ kind: "account_changed", from: linkedAddress, to: B });
  });
});
