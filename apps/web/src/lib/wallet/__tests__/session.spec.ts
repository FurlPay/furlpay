import { describe, it, expect, beforeEach, vi } from "vitest";
import { mipdStore, displayName, type EIP6963ProviderDetail } from "../mipd";
import { sessionStore } from "../session";

// ---------------------------------------------------------------------------
// Provider lifecycle and discovery identity.
//
// The two behaviours under test are the two the audit found missing:
//
//   1. NOBODY WAS LISTENING. No accountsChanged / chainChanged / disconnect
//      handler existed anywhere, so a user could switch account in MetaMask
//      and FurlPay would display the old one forever.
//
//   2. LAST ANNOUNCER WON. Deduping by `rdns` meant any extension announcing
//      "io.metamask" silently replaced real MetaMask in the picker. EIP-6963
//      metadata is not authenticated, so that replacement was free.
//
// The recurring assertion across this file: a provider event updates what is
// DISPLAYED and never authorizes anything. An account the user switched to is
// not linked, not authorized, and not substituted for the linked address.
// ---------------------------------------------------------------------------

type Listener = (payload: unknown) => void;

function fakeProvider() {
  const handlers = new Map<string, Set<Listener>>();
  return {
    request: vi.fn(async () => "0x1"),
    on(event: string, fn: Listener) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    },
    removeListener(event: string, fn: Listener) {
      handlers.get(event)?.delete(fn);
    },
    /** Test helper — fire an event at whatever is currently bound. */
    emit(event: string, payload: unknown) {
      handlers.get(event)?.forEach((fn) => fn(payload));
    },
    count(event: string) {
      return handlers.get(event)?.size ?? 0;
    },
  };
}

function detail(over: Partial<{ uuid: string; rdns: string; name: string }> = {}) {
  const provider = fakeProvider();
  return {
    detail: {
      info: {
        uuid: over.uuid ?? "uuid-1",
        rdns: over.rdns ?? "io.metamask",
        name: over.name ?? "MetaMask",
        icon: "data:,",
      },
      provider,
    } as unknown as EIP6963ProviderDetail,
    provider,
  };
}

const A = "0xAAA0000000000000000000000000000000000001";
const B = "0xBBB0000000000000000000000000000000000002";

beforeEach(() => {
  sessionStore.__reset();
  mipdStore.__reset();
});

// ── Provider events ────────────────────────────────────────────────────────

describe("accountsChanged", () => {
  it("updates the active account and raises a notice", () => {
    const { detail: d, provider } = detail();
    sessionStore.connected(d, A, 8453);

    provider.emit("accountsChanged", [B]);

    const s = sessionStore.get();
    expect(s.activeAccount).toBe(B);
    expect(s.notice).toEqual({ kind: "account_changed", from: A, to: B });
  });

  it("does not authorize or link the new account", () => {
    // The whole point: switching account in the wallet changes what we SHOW.
    // It is not consent, and the linked record is a separate fact entirely.
    const { detail: d, provider } = detail();
    sessionStore.connected(d, A, 8453);
    provider.emit("accountsChanged", [B]);

    const s = sessionStore.get();
    expect(s.status).toBe("connected");
    // Nothing in the session claims B is linked or approved.
    expect(Object.keys(s)).not.toContain("linkedAddress");
    expect(Object.keys(s)).not.toContain("authorized");
  });

  it("treats an empty account array as a disconnected session", () => {
    const { detail: d, provider } = detail();
    sessionStore.connected(d, A, 8453);

    provider.emit("accountsChanged", []);

    const s = sessionStore.get();
    expect(s.status).toBe("disconnected");
    expect(s.activeAccount).toBeUndefined();
    expect(s.notice).toEqual({ kind: "account_disconnected" });
  });

  it("ignores a repeat of the same account, including case differences", () => {
    const { detail: d, provider } = detail();
    sessionStore.connected(d, A, 8453);
    provider.emit("accountsChanged", [A.toLowerCase()]);
    // No spurious "your account changed" for an address that did not change.
    expect(sessionStore.get().notice).toBeUndefined();
  });
});

describe("chainChanged", () => {
  it("updates the chain and raises a notice", () => {
    const { detail: d, provider } = detail();
    sessionStore.connected(d, A, 8453);

    provider.emit("chainChanged", "0x1");

    const s = sessionStore.get();
    expect(s.chainId).toBe(1);
    expect(s.notice).toEqual({ kind: "chain_changed", from: 8453, to: 1 });
  });

  it("accepts a numeric chain id as well as hex", () => {
    const { detail: d, provider } = detail();
    sessionStore.connected(d, A, 8453);
    provider.emit("chainChanged", 1);
    expect(sessionStore.get().chainId).toBe(1);
  });

  it("ignores an unparseable chain rather than guessing", () => {
    const { detail: d, provider } = detail();
    sessionStore.connected(d, A, 8453);
    provider.emit("chainChanged", "nonsense");
    expect(sessionStore.get().chainId).toBe(8453);
    expect(sessionStore.get().notice).toBeUndefined();
  });

  it("does not treat a chain change as authorization", () => {
    const { detail: d, provider } = detail();
    sessionStore.connected(d, A, 8453);
    provider.emit("chainChanged", "0x1");
    // Still connected, still the same account — only the chain moved.
    expect(sessionStore.get().status).toBe("connected");
    expect(sessionStore.get().activeAccount).toBe(A);
  });
});

describe("disconnect", () => {
  it("ends the session and detaches listeners", () => {
    const { detail: d, provider } = detail();
    sessionStore.connected(d, A, 8453);
    expect(sessionStore.__isBound()).toBe(true);

    provider.emit("disconnect", { message: "closed" });

    expect(sessionStore.get().status).toBe("disconnected");
    expect(sessionStore.__isBound()).toBe(false);
    expect(provider.count("accountsChanged")).toBe(0);
  });

  it("does NOT unlink the wallet", () => {
    // A provider disconnect is a browser event. Unlinking is an explicit
    // account operation with its own endpoint, and conflating them would let
    // an extension crash delete a user's account association.
    const { detail: d, provider } = detail();
    sessionStore.connected(d, A, 8453);
    provider.emit("disconnect", {});

    const s = sessionStore.get();
    expect(s.notice).toMatchObject({ kind: "provider_disconnected" });
    // Nothing in the session layer can express "unlinked" — by design.
    expect(Object.keys(s)).not.toContain("unlinked");
  });
});

describe("listener lifecycle", () => {
  it("attaches exactly one listener per event", () => {
    const { detail: d, provider } = detail();
    sessionStore.connected(d, A, 8453);
    expect(provider.count("accountsChanged")).toBe(1);
    expect(provider.count("chainChanged")).toBe(1);
    expect(provider.count("disconnect")).toBe(1);
  });

  it("detaches the previous provider when a second wallet connects", () => {
    // Otherwise the first wallet's events keep firing into a session that no
    // longer describes it — the stale-state bug, reintroduced sideways.
    const first = detail({ uuid: "uuid-1", rdns: "io.metamask" });
    const second = detail({ uuid: "uuid-2", rdns: "app.phantom", name: "Phantom" });

    sessionStore.connected(first.detail, A, 8453);
    sessionStore.connected(second.detail, B, 1);

    expect(first.provider.count("accountsChanged")).toBe(0);
    expect(second.provider.count("accountsChanged")).toBe(1);
    expect(sessionStore.get().rdns).toBe("app.phantom");
  });

  it("stops reacting to a provider after the session ends", () => {
    const { detail: d, provider } = detail();
    sessionStore.connected(d, A, 8453);
    sessionStore.endSession();

    provider.emit("accountsChanged", [B]);
    // The dead provider must not be able to move the session.
    expect(sessionStore.get().activeAccount).toBeUndefined();
  });

  it("survives a provider with no event support", () => {
    const bare = {
      info: { uuid: "u", rdns: "x.y", name: "Bare", icon: "data:," },
      provider: { request: vi.fn() },
    } as unknown as EIP6963ProviderDetail;
    expect(() => sessionStore.connected(bare, A, 1)).not.toThrow();
    expect(sessionStore.get().status).toBe("connected");
  });
});

describe("notice acknowledgement", () => {
  it("clears the notice without touching wallet state", () => {
    const { detail: d, provider } = detail();
    sessionStore.connected(d, A, 8453);
    provider.emit("chainChanged", "0x1");

    sessionStore.acknowledge();

    const s = sessionStore.get();
    expect(s.notice).toBeUndefined();
    expect(s.chainId).toBe(1);
    expect(s.activeAccount).toBe(A);
  });
});

// ── EIP-6963 identity ──────────────────────────────────────────────────────

describe("provider discovery identity", () => {
  it("deduplicates a repeat announcement of the same uuid", () => {
    const d = detail({ uuid: "same" }).detail;
    mipdStore.__announce(d);
    mipdStore.__announce(d);
    expect(mipdStore.getProviders()).toHaveLength(1);
  });

  it("keeps BOTH providers when two announce the same rdns", () => {
    // The collision the audit found. The incumbent must survive.
    mipdStore.__announce(detail({ uuid: "real", rdns: "io.metamask" }).detail);
    mipdStore.__announce(detail({ uuid: "impostor", rdns: "io.metamask" }).detail);

    const got = mipdStore.getProviders();
    expect(got).toHaveLength(2);
    expect(got.map((p) => p.info.uuid)).toEqual(["real", "impostor"]);
  });

  it("records the collision so the UI can disambiguate", () => {
    mipdStore.__announce(detail({ uuid: "real", rdns: "io.metamask" }).detail);
    mipdStore.__announce(detail({ uuid: "impostor", rdns: "io.metamask" }).detail);
    expect(mipdStore.isContested("io.metamask")).toBe(true);
  });

  it("first announcement wins — a later one cannot replace it", () => {
    const real = detail({ uuid: "real", rdns: "io.metamask" });
    mipdStore.__announce(real.detail);
    mipdStore.__announce(detail({ uuid: "impostor", rdns: "io.metamask" }).detail);
    // The provider OBJECT at index 0 is still the original one.
    expect(mipdStore.getProviders()[0].provider).toBe(real.detail.provider);
  });

  it("keeps distinct rdns entries separate", () => {
    mipdStore.__announce(detail({ uuid: "a", rdns: "io.metamask" }).detail);
    mipdStore.__announce(detail({ uuid: "b", rdns: "app.phantom", name: "Phantom" }).detail);
    expect(mipdStore.getProviders()).toHaveLength(2);
    expect(mipdStore.isContested("io.metamask")).toBe(false);
  });

  it("preserves announcement order deterministically", () => {
    for (const uuid of ["one", "two", "three"]) {
      mipdStore.__announce(detail({ uuid, rdns: `rdns.${uuid}` }).detail);
    }
    expect(mipdStore.getProviders().map((p) => p.info.uuid)).toEqual(["one", "two", "three"]);
  });

  it("accepts a late announcement after discovery started", () => {
    mipdStore.__announce(detail({ uuid: "early", rdns: "a.b" }).detail);
    const before = mipdStore.getProviders();
    mipdStore.__announce(detail({ uuid: "late", rdns: "c.d" }).detail);
    expect(mipdStore.getProviders()).toHaveLength(2);
    // Snapshot identity changed, so useSyncExternalStore re-renders.
    expect(mipdStore.getProviders()).not.toBe(before);
  });

  it("returns a stable snapshot reference when nothing changed", () => {
    mipdStore.__announce(detail({ uuid: "x", rdns: "a.b" }).detail);
    const first = mipdStore.getProviders();
    // A duplicate announcement must not produce a new array, or React would
    // re-render forever.
    mipdStore.__announce(detail({ uuid: "x", rdns: "a.b" }).detail);
    expect(mipdStore.getProviders()).toBe(first);
  });

  it("ignores a malformed announcement", () => {
    mipdStore.__announce({ info: { uuid: "", rdns: "", name: "", icon: "" } } as never);
    expect(mipdStore.getProviders()).toHaveLength(0);
  });

  it("disambiguates the display name only under collision", () => {
    mipdStore.__announce(detail({ uuid: "solo", rdns: "app.phantom", name: "Phantom" }).detail);
    expect(displayName(mipdStore.getProviders()[0])).toBe("Phantom");

    mipdStore.__announce(detail({ uuid: "aaaaaaaa-1", rdns: "io.metamask" }).detail);
    mipdStore.__announce(detail({ uuid: "bbbbbbbb-2", rdns: "io.metamask" }).detail);
    const contested = mipdStore.getProviders().filter((p) => p.info.rdns === "io.metamask");
    expect(displayName(contested[0])).toMatch(/MetaMask — provider aaaaaaaa/);
    expect(displayName(contested[1])).toMatch(/MetaMask — provider bbbbbbbb/);
  });
});

describe("snapshot purity", () => {
  it("does not dispatch or mutate when read", () => {
    // getProviders used to call start(), which dispatches a window event —
    // discovery as a side effect of React rendering.
    const dispatch = vi.fn();
    const original = globalThis.window;
    // @ts-expect-error — minimal window stub for this assertion
    globalThis.window = { dispatchEvent: dispatch, addEventListener: vi.fn() };
    try {
      mipdStore.getProviders();
      mipdStore.getProviders();
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      globalThis.window = original;
    }
  });
});
