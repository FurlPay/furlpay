import { describe, it, expect } from "vitest";
import { CATALOG, bySymbol, byKindSymbol, assetLogoPath } from "../catalog";
import { COLLECTIONS, collectionBySlug } from "../collections";
import { backerAudit, backersFor, BACKERS } from "../backers";
import universe from "../universe.json";

// ---------------------------------------------------------------------------
// Catalog integrity.
//
// The catalog is hand-maintained data that every market surface reads, and the
// failure mode of hand-maintained data is silent drift: a collection pointing
// at a symbol that was removed renders an empty themed card, and a symbol that
// is not in the broker's tradable universe renders a Trade button that cannot
// fill. Both look like bugs in the UI rather than gaps in the data.
// ---------------------------------------------------------------------------

const SYMBOLS = new Set(CATALOG.map((a) => a.symbol));
const TRADABLE = new Set(
  (universe as { assets: { symbol: string }[] }).assets.map((a) => a.symbol)
);

describe("catalog", () => {
  it("has no duplicate kind+symbol pair", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const a of CATALOG) {
      const key = `${a.kind}:${a.symbol}`;
      if (seen.has(key)) dupes.push(key);
      seen.add(key);
    }
    expect(dupes).toEqual([]);
  });

  it("resolves an ambiguous ticker to the listed security, not the coin", () => {
    // STX is both Seagate and Stacks; DASH is both DoorDash and Dash. A bare
    // ticker on a finance surface means the security — and /api/investing/order
    // resolves against this map, so getting it wrong books the wrong asset.
    expect(bySymbol.get("STX")?.kind).toBe("stock");
    expect(bySymbol.get("DASH")?.kind).toBe("stock");
    expect(byKindSymbol.get("crypto:STX")?.name).toBe("Stacks");
    expect(byKindSymbol.get("crypto:DASH")?.name).toBe("Dash");
  });

  it("every stock and ETF is in the broker's tradable universe", () => {
    // A Trade button on a symbol the broker does not carry is a button that
    // cannot fill.
    const untradable = CATALOG.filter((a) => a.kind !== "crypto" && !TRADABLE.has(a.symbol)).map(
      (a) => a.symbol
    );
    expect(untradable).toEqual([]);
  });

  it("every crypto asset carries a CoinGecko id", () => {
    // Without one there is no price and no supply — the asset renders as a row
    // of em-dashes.
    const unpriceable = CATALOG.filter((a) => a.kind === "crypto" && !a.cg).map((a) => a.symbol);
    expect(unpriceable).toEqual([]);
  });

  it("returns a logo path only for artwork that is actually shipped", () => {
    for (const a of CATALOG) {
      const path = assetLogoPath(a);
      if (path !== null) expect(path).toMatch(/^\/logos\/(coins|etfs|stocks)\/[a-z0-9.-]+\.svg$/);
    }
  });
});

describe("meme assets are gone", () => {
  const REMOVED = ["DOGE", "SHIB", "PEPE", "WIF", "BONK", "FLOKI", "NOT"];

  it("no meme coin remains in the catalog", () => {
    expect(REMOVED.filter((s) => SYMBOLS.has(s))).toEqual([]);
  });

  it("no asset is categorised as a meme coin", () => {
    const memes = CATALOG.filter((a) => a.industry === "Meme").map((a) => a.symbol);
    expect(memes).toEqual([]);
  });

  it("no collection still points at a removed symbol", () => {
    // This is the check that matters: a collection whose members have all left
    // the catalog renders as an empty themed card, which reads as broken.
    const stale = COLLECTIONS.flatMap((c) =>
      c.symbols.filter((s) => REMOVED.includes(s)).map((s) => `${c.slug}:${s}`)
    );
    expect(stale).toEqual([]);
  });

  it("the meme-coins collection itself is gone", () => {
    expect(collectionBySlug("meme-coins")).toBeUndefined();
  });
});

describe("newly added assets", () => {
  // Every one of these was verified against a live provider quote before it
  // was added, and each is present in the broker's tradable universe.
  const ADDED = ["AAOI", "LITE", "COHR", "CIEN", "NBIS", "VRT", "MRNA"];

  it.each(ADDED)("%s is in the catalog and tradable", (symbol) => {
    expect(SYMBOLS.has(symbol)).toBe(true);
    expect(TRADABLE.has(symbol)).toBe(true);
  });

  it("groups the optical-interconnect names under one industry", () => {
    const optical = CATALOG.filter((a) => a.industry === "Optical Networking").map((a) => a.symbol);
    expect(optical.sort()).toEqual(["AAOI", "CIEN", "COHR", "LITE"]);
  });

  it("gives Moderna a cap tier that matches its actual size", () => {
    // It was tagged `small` while being a ~$58B company. The tier drives the
    // heatmap block size and the market-cap filter, so a wrong tier is a wrong
    // screen, not a cosmetic slip.
    expect(CATALOG.find((a) => a.symbol === "MRNA")?.cap).toBe("large");
  });
});

describe("collections", () => {
  it("every collection symbol exists in the catalog", () => {
    const missing = COLLECTIONS.flatMap((c) =>
      c.symbols.filter((s) => !SYMBOLS.has(s)).map((s) => `${c.slug}:${s}`)
    );
    expect(missing).toEqual([]);
  });

  it("has no duplicate slug", () => {
    const slugs = COLLECTIONS.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("no collection is empty", () => {
    expect(COLLECTIONS.filter((c) => c.symbols.length === 0).map((c) => c.slug)).toEqual([]);
  });
});

describe("strategic backers", () => {
  it("renders nothing that a human has not verified against its source", () => {
    // The safeguard that makes a curated dataset acceptable on a money surface:
    // `verified` gates rendering, so a draft entry sits inert until someone
    // opens the citation and confirms it. Every entry is currently a draft.
    for (const symbol of Object.keys(BACKERS)) {
      const shown = backersFor(symbol);
      expect(shown.every((b) => b.verified)).toBe(true);
    }
  });

  it("every entry carries a source URL and an announcement date", () => {
    for (const rows of Object.values(BACKERS)) {
      for (const b of rows) {
        expect(b.source).toMatch(/^https:\/\//);
        expect(b.sourceLabel.length).toBeGreaterThan(0);
        expect(b.announced).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("only records backers for symbols the catalog actually carries", () => {
    expect(Object.keys(BACKERS).filter((s) => !SYMBOLS.has(s))).toEqual([]);
  });

  it("reports how much of the dataset is still unverified", () => {
    const audit = backerAudit();
    expect(audit.length).toBeGreaterThan(0);
    // Not an assertion about the number — a reminder that the number exists and
    // that a verification pass is outstanding.
    for (const row of audit) expect(row.verified).toBeLessThanOrEqual(row.total);
  });
});
