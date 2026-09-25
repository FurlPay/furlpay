import { describe, it, expect, beforeEach } from "vitest";
import {
  ALLOWED_ORIGINS_KEY,
  allowedOrigins,
  MAX_ALLOWED_ORIGINS,
  ORIGIN_GRANT_TTL_MS,
  originGranted,
  rememberOrigin,
  revokeOrigin,
  senderOrigin,
  type OriginStore,
} from "../originGrants";

// ---------------------------------------------------------------------------
// The wallet consent gate — the extension's security boundary.
//
// The content script that relays a connect request runs on `https://*/*`, which
// is every HTTPS page on the internet. These functions are what stands between
// "a dapp the user chose to connect to" and "any page that happens to be open",
// and until now they had no tests because they were private to background.ts.
//
// Each block below maps to one clause of the threat model in originGrants.ts.
// ---------------------------------------------------------------------------

function memoryStore(initial: Record<string, unknown> = {}): OriginStore {
  let data = { ...initial };
  return {
    async get(key) {
      return key in data ? { [key]: data[key] } : {};
    },
    async set(items) {
      data = { ...data, ...items };
    },
  };
}

const DAPP = "https://app.uniswap.org";
const HOSTILE = "https://evil.example";

describe("the origin comes from the browser, never the page", () => {
  it("prefers sender.origin, which Chrome sets and a page cannot forge", () => {
    expect(senderOrigin({ origin: DAPP, url: `${HOSTILE}/spoof` })).toBe(DAPP);
  });

  it("falls back to parsing sender.url for Firefox, which sets no origin", () => {
    expect(senderOrigin({ url: `${DAPP}/swap?from=USDC` })).toBe(DAPP);
  });

  it("REJECTS the literal string \"null\", which is an opaque origin", () => {
    // Chrome reports "null" for a sandboxed iframe or a data: URL. Treating it as
    // an origin would let every such context share a single grant — one
    // approval in any sandboxed frame would cover all of them.
    expect(senderOrigin({ origin: "null" })).toBeNull();
    // With a usable url alongside it, the url is used instead.
    expect(senderOrigin({ origin: "null", url: `${DAPP}/x` })).toBe(DAPP);
  });

  it("returns null for an unparseable or absent url, refusing the connect", () => {
    expect(senderOrigin({})).toBeNull();
    expect(senderOrigin({ url: "not a url" })).toBeNull();
    expect(senderOrigin({ url: "" })).toBeNull();
  });

  it("keeps the ORIGIN only — path, query and fragment are dropped", () => {
    // A grant is per-origin. If the path survived, `https://x.com/a` and
    // `https://x.com/b` would be separate grants and the user would be prompted
    // on every page of the same site.
    expect(senderOrigin({ url: "https://app.uniswap.org/swap#pool?a=1" })).toBe(DAPP);
  });

  it("treats a different PORT and SCHEME as different origins", () => {
    // Same-origin policy, which is the boundary the browser itself enforces.
    expect(senderOrigin({ url: "https://x.com:8443/" })).toBe("https://x.com:8443");
    expect(senderOrigin({ url: "http://x.com/" })).toBe("http://x.com");
    expect(senderOrigin({ url: "https://x.com/" })).toBe("https://x.com");
  });
});

describe("an ungranted origin is refused", () => {
  it("returns false for an origin never approved", async () => {
    const store = memoryStore();
    expect(await originGranted(store, HOSTILE)).toBe(false);
  });

  it("does not let one granted origin cover another", async () => {
    // The core isolation property: approving one dapp must not approve the rest
    // of the internet.
    const store = memoryStore();
    await rememberOrigin(store, DAPP);
    expect(await originGranted(store, DAPP)).toBe(true);
    expect(await originGranted(store, HOSTILE)).toBe(false);
  });

  it("does not treat a SUBDOMAIN of a granted origin as granted", async () => {
    // `https://evil.app.uniswap.org` is a different origin. If a subdomain
    // inherited the parent's grant, a single XSS on any subdomain would reach
    // the wallet.
    const store = memoryStore();
    await rememberOrigin(store, DAPP);
    expect(await originGranted(store, "https://evil.app.uniswap.org")).toBe(false);
  });

  it("survives malformed stored data without granting anything", async () => {
    // Corrupt storage must fail closed, not throw and not grant.
    for (const junk of [null, "a string", 42, []]) {
      const store = memoryStore({ [ALLOWED_ORIGINS_KEY]: junk });
      expect(await originGranted(store, DAPP), JSON.stringify(junk)).toBe(false);
    }
  });

  it("ignores a non-numeric grant timestamp", async () => {
    const store = memoryStore({ [ALLOWED_ORIGINS_KEY]: { [DAPP]: "yesterday" } });
    expect(await originGranted(store, DAPP)).toBe(false);
  });
});

describe("grants expire", () => {
  it("honours a grant inside the 30-day window", async () => {
    const store = memoryStore();
    const now = 1_800_000_000_000;
    await rememberOrigin(store, DAPP, now);
    expect(await originGranted(store, DAPP, now + ORIGIN_GRANT_TTL_MS - 1000)).toBe(true);
  });

  it("honours a grant exactly AT the boundary, so the window is not off by one", async () => {
    const store = memoryStore();
    const now = 1_800_000_000_000;
    await rememberOrigin(store, DAPP, now);
    expect(await originGranted(store, DAPP, now + ORIGIN_GRANT_TTL_MS)).toBe(true);
  });

  it("REFUSES a grant one millisecond past the window", async () => {
    const store = memoryStore();
    const now = 1_800_000_000_000;
    await rememberOrigin(store, DAPP, now);
    expect(await originGranted(store, DAPP, now + ORIGIN_GRANT_TTL_MS + 1)).toBe(false);
  });

  it("SWEEPS every expired grant from storage, not just the one asked about", async () => {
    // The sweep is what stops the record filling with dead grants that would
    // otherwise consume the cap and evict live ones.
    const now = 1_800_000_000_000;
    const old = now - ORIGIN_GRANT_TTL_MS - 5000;
    const store = memoryStore({
      [ALLOWED_ORIGINS_KEY]: {
        "https://stale-a.example": old,
        "https://stale-b.example": old,
        [DAPP]: now,
      },
    });

    // Asking about a stale origin triggers the sweep.
    expect(await originGranted(store, "https://stale-a.example", now)).toBe(false);

    const remaining = await allowedOrigins(store);
    expect(Object.keys(remaining), "both stale grants swept, the live one kept").toEqual([DAPP]);
  });

  it("re-granting an origin refreshes its expiry", async () => {
    const store = memoryStore();
    const t0 = 1_800_000_000_000;
    await rememberOrigin(store, DAPP, t0);
    const later = t0 + ORIGIN_GRANT_TTL_MS - 1000;
    await rememberOrigin(store, DAPP, later);
    // Would have expired on the original grant; the refresh carries it forward.
    expect(await originGranted(store, DAPP, later + ORIGIN_GRANT_TTL_MS - 1000)).toBe(true);
  });
});

describe("storage is bounded", () => {
  it("keeps at most MAX_ALLOWED_ORIGINS grants", async () => {
    const store = memoryStore();
    for (let i = 0; i < MAX_ALLOWED_ORIGINS + 20; i++) {
      await rememberOrigin(store, `https://site-${i}.example`, 1_800_000_000_000 + i);
    }
    expect(Object.keys(await allowedOrigins(store))).toHaveLength(MAX_ALLOWED_ORIGINS);
  });

  it("evicts the OLDEST grant, keeping the most recently approved", async () => {
    // Retaining the newest is the right choice: those are the sites the user is
    // most likely to still be using, so eviction costs them the least.
    const store = memoryStore();
    const base = 1_800_000_000_000;
    for (let i = 0; i < MAX_ALLOWED_ORIGINS; i++) {
      await rememberOrigin(store, `https://site-${i}.example`, base + i);
    }
    await rememberOrigin(store, "https://newest.example", base + 10_000);

    const kept = await allowedOrigins(store);
    expect(kept["https://newest.example"], "the newest grant is kept").toBeDefined();
    expect(kept["https://site-0.example"], "the oldest was evicted").toBeUndefined();
    expect(Object.keys(kept)).toHaveLength(MAX_ALLOWED_ORIGINS);
  });

  it("an evicted origin is no longer granted", async () => {
    // Eviction has to actually revoke access, not merely drop a record while
    // something else still honours it.
    const store = memoryStore();
    const base = 1_800_000_000_000;
    for (let i = 0; i < MAX_ALLOWED_ORIGINS; i++) {
      await rememberOrigin(store, `https://site-${i}.example`, base + i);
    }
    await rememberOrigin(store, "https://newest.example", base + 10_000);
    expect(await originGranted(store, "https://site-0.example", base + 10_001)).toBe(false);
  });
});

describe("revocation", () => {
  it("removes a grant so the next connect prompts again", async () => {
    const store = memoryStore();
    await rememberOrigin(store, DAPP);
    expect(await originGranted(store, DAPP)).toBe(true);

    expect(await revokeOrigin(store, DAPP)).toBe(true);
    expect(await originGranted(store, DAPP)).toBe(false);
  });

  it("reports false for an origin that was never granted", async () => {
    expect(await revokeOrigin(memoryStore(), HOSTILE)).toBe(false);
  });

  it("revoking one origin leaves the others intact", async () => {
    const store = memoryStore();
    await rememberOrigin(store, DAPP);
    await rememberOrigin(store, "https://keep.example");
    await revokeOrigin(store, DAPP);
    expect(await originGranted(store, "https://keep.example")).toBe(true);
  });
});
