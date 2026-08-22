import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// The watchlist store and the profile-avatar helpers.
//
// The KV layer is mocked with an in-memory map rather than a stub that always
// succeeds: the interesting behaviour is what happens when a write FAILS, and a
// stub that cannot fail cannot show it. Symbol resolution is mocked too, so
// these tests never touch a network provider.
// ---------------------------------------------------------------------------

const store = new Map<string, unknown>();
let failWrites = false;

vi.mock("@/lib/kv", () => ({
  kvGet: async (key: string) => (store.has(key) ? store.get(key) : null),
  kvSet: async (key: string, value: unknown) => {
    if (failWrites) throw new Error("kv unreachable");
    store.set(key, value);
  },
  kvDel: async (key: string) => {
    if (failWrites) throw new Error("kv unreachable");
    store.delete(key);
  },
}));

/** A small stand-in universe. Anything outside it does not resolve, which is
 *  what proves the endpoint cannot be used to store arbitrary strings. */
const KNOWN = new Set(["BTC", "NVDA", "AAPL", "NBIS", "AAOI"]);

vi.mock("@/lib/markets/resolve", () => ({
  isPlausibleTicker: (s: string) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s),
  resolveAsset: async (symbol: string) =>
    KNOWN.has(symbol) ? { symbol, name: `${symbol} Corp.`, kind: "stock" } : null,
}));

const {
  addToWatchlist,
  getWatchlist,
  normalizeSymbol,
  removeFromWatchlist,
  WATCHLIST_MAX,
} = await import("@/lib/watchlist");
const { initialsFor, isAllowedAvatarUrl } = await import("@/lib/profileAvatar");

const USER = "user_1";

beforeEach(() => {
  store.clear();
  failWrites = false;
});

describe("normalizeSymbol", () => {
  it("upper-cases and trims a real ticker", () => {
    expect(normalizeSymbol(" nvda ")).toBe("NVDA");
    expect(normalizeSymbol("btc")).toBe("BTC");
  });

  it("rejects anything that could not be a ticker", () => {
    expect(normalizeSymbol("")).toBeNull();
    expect(normalizeSymbol("   ")).toBeNull();
    expect(normalizeSymbol(null)).toBeNull();
    expect(normalizeSymbol(42)).toBeNull();
    expect(normalizeSymbol({ symbol: "BTC" })).toBeNull();
    expect(normalizeSymbol("A".repeat(40))).toBeNull();
    expect(normalizeSymbol("<script>")).toBeNull();
  });
});

describe("addToWatchlist", () => {
  it("stars a real asset", async () => {
    const res = await addToWatchlist(USER, "nvda");
    expect(res).toEqual({ ok: true, symbols: ["NVDA"] });
    expect(await getWatchlist(USER)).toEqual(["NVDA"]);
  });

  it("puts the newest addition first", async () => {
    await addToWatchlist(USER, "NVDA");
    await addToWatchlist(USER, "BTC");
    expect(await getWatchlist(USER)).toEqual(["BTC", "NVDA"]);
  });

  it("refuses a symbol that does not exist in the universe", async () => {
    // Without this the endpoint stores whatever string it is handed, and the
    // watchlist tab renders rows for assets that do not exist.
    const res = await addToWatchlist(USER, "ZZZZ");
    expect(res).toEqual({ ok: false, error: "unknown_symbol" });
    expect(await getWatchlist(USER)).toEqual([]);
  });

  it("refuses a malformed symbol before it reaches the resolver", async () => {
    expect(await addToWatchlist(USER, "not a ticker")).toEqual({
      ok: false,
      error: "invalid_symbol",
    });
  });

  it("is idempotent — a double-tap does not duplicate or reorder", async () => {
    await addToWatchlist(USER, "NVDA");
    await addToWatchlist(USER, "BTC");
    const res = await addToWatchlist(USER, "NVDA");
    expect(res).toEqual({ ok: true, symbols: ["BTC", "NVDA"] });
  });

  it("enforces the cap", async () => {
    // Seed a full list directly; the resolver only knows five symbols.
    store.set(
      `watchlist:${USER}`,
      Array.from({ length: WATCHLIST_MAX }, (_, i) => `SYM${i}`)
    );
    expect(await addToWatchlist(USER, "NVDA")).toEqual({ ok: false, error: "limit_reached" });
  });

  it("reports a storage failure instead of pretending the write landed", async () => {
    failWrites = true;
    expect(await addToWatchlist(USER, "NVDA")).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("removeFromWatchlist", () => {
  it("un-stars", async () => {
    await addToWatchlist(USER, "NVDA");
    await addToWatchlist(USER, "BTC");
    expect(await removeFromWatchlist(USER, "NVDA")).toEqual({ ok: true, symbols: ["BTC"] });
  });

  it("succeeds when the symbol was never there — the requested state holds", async () => {
    await addToWatchlist(USER, "BTC");
    expect(await removeFromWatchlist(USER, "NVDA")).toEqual({ ok: true, symbols: ["BTC"] });
  });

  it("deletes the key rather than storing an empty array", async () => {
    await addToWatchlist(USER, "NVDA");
    await removeFromWatchlist(USER, "NVDA");
    expect(store.has(`watchlist:${USER}`)).toBe(false);
  });
});

describe("getWatchlist", () => {
  it("returns an empty list for an unknown user", async () => {
    expect(await getWatchlist("nobody")).toEqual([]);
  });

  it("sanitises whatever is in storage rather than trusting it", async () => {
    // A corrupted or hand-edited value must not reach the UI as-is.
    store.set(`watchlist:${USER}`, ["nvda", "NVDA", null, 7, "<script>", "BTC"]);
    expect(await getWatchlist(USER)).toEqual(["NVDA", "BTC"]);
  });

  it("returns an empty list — not an error — when storage is unreadable", async () => {
    store.set(`watchlist:${USER}`, { not: "an array" });
    expect(await getWatchlist(USER)).toEqual([]);
  });

  it("is scoped per user", async () => {
    await addToWatchlist("user_a", "NVDA");
    await addToWatchlist("user_b", "BTC");
    expect(await getWatchlist("user_a")).toEqual(["NVDA"]);
    expect(await getWatchlist("user_b")).toEqual(["BTC"]);
  });
});

describe("avatar URL allowlist", () => {
  it("accepts Google's profile-photo hosts over https", () => {
    expect(isAllowedAvatarUrl("https://lh3.googleusercontent.com/a/abc123")).toBe(true);
    expect(isAllowedAvatarUrl("https://lh6.googleusercontent.com/a/xyz")).toBe(true);
  });

  it("rejects anything else — this field renders in an <img> on every page", () => {
    expect(isAllowedAvatarUrl("http://lh3.googleusercontent.com/a/abc")).toBe(false); // not https
    expect(isAllowedAvatarUrl("https://evil.example.com/pixel.gif")).toBe(false);
    expect(isAllowedAvatarUrl("https://lh3.googleusercontent.com.evil.com/a")).toBe(false);
    expect(isAllowedAvatarUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedAvatarUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isAllowedAvatarUrl(null)).toBe(false);
    expect(isAllowedAvatarUrl("")).toBe(false);
    expect(isAllowedAvatarUrl("not a url")).toBe(false);
  });
});

describe("initialsFor", () => {
  it("takes first and last initial from a real name", () => {
    expect(initialsFor("Ashutosh Kumar")).toBe("AK");
    expect(initialsFor("Ada Byron Lovelace")).toBe("AL");
    expect(initialsFor("  jean   dupont  ")).toBe("JD");
  });

  it("uses a single initial for a mononym", () => {
    expect(initialsFor("Prince")).toBe("P");
  });

  it("handles non-Latin names without mangling them", () => {
    expect(initialsFor("Ada Лавлейс")).toBe("AЛ");
  });

  it("returns null when there is no name to take initials from", () => {
    // The caller draws a neutral silhouette. Two letters that stand for nothing
    // look exactly like two letters that stand for someone.
    expect(initialsFor("")).toBeNull();
    expect(initialsFor("   ")).toBeNull();
    expect(initialsFor(null)).toBeNull();
    expect(initialsFor(undefined)).toBeNull();
    expect(initialsFor("123 456")).toBeNull();
  });
});
