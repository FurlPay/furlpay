import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { remoteSearchRows } from "../searchRows";
import { INSTRUMENTS } from "../instruments";

// ---------------------------------------------------------------------------
// These tests exist because of one bug and one near-miss.
//
// The bug: the markets search box filtered the ~420 loaded rows and nothing
// else, so a real, tradable, openable symbol returned an empty table.
//
// The near-miss: the first version of the adapter gave uncurated rows a rank of
// Infinity, and the table's comparator subtracts two ranks. Infinity - Infinity
// is NaN, and a comparator returning NaN has undefined behaviour.
// ---------------------------------------------------------------------------

const item = (symbol: string, over: Record<string, unknown> = {}) => ({
  symbol,
  name: `${symbol} Inc.`,
  kind: "stock" as const,
  sector: "Technology",
  logo: null,
  price: null,
  changePct: null,
  live: false,
  ...over,
});

describe("adapting search hits to table rows", () => {
  it("keeps every unknown field null rather than zero", () => {
    // The whole point. A 0 in a market-cap or change column is a claim.
    const [row] = remoteSearchRows({ items: [item("SKHYNIX")] });
    expect(row!.price).toBeNull();
    expect(row!.changePct).toBeNull();
    expect(row!.changePct7d).toBeNull();
    expect(row!.marketCap).toBeNull();
    expect(row!.volume24h).toBeNull();
    expect(row!.spark).toBeNull();
  });

  it("carries a price through when the search did have one", () => {
    const [row] = remoteSearchRows({ items: [item("AAPL", { price: 326.2, changePct: 0.33, live: true })] });
    expect(row!.price).toBe(326.2);
    expect(row!.changePct).toBe(0.33);
    expect(row!.live).toBe(true);
  });

  it("gives uncurated rows a finite rank, so the comparator cannot return NaN", () => {
    const rows = remoteSearchRows({ items: [item("A"), item("B")] });
    for (const r of rows) expect(Number.isFinite(r.rank)).toBe(true);
    // The exact expression the table's sort runs on two of these.
    expect(rows[0]!.rank - rows[1]!.rank).toBe(0);
  });

  it("ranks them after every curated row", () => {
    const [row] = remoteSearchRows({ items: [item("OBSCURE")] });
    expect(row!.rank).toBeGreaterThan(100_000);
  });

  it("puts instruments before securities", () => {
    // "gold" matches the XAUUSD alias exactly and also matches several mining
    // companies by name. The exact convention should not be buried under them.
    const rows = remoteSearchRows({
      items: [item("GOLD", { name: "Barrick Gold" }), item("AU", { name: "AngloGold" })],
      instruments: [
        { symbol: "XAUUSD", displayName: "Gold / US Dollar", assetClassLabel: "Commodity", logo: "/logos/instruments/gold.svg" },
      ],
    });
    expect(rows[0]!.symbol).toBe("XAUUSD");
    expect(rows).toHaveLength(3);
  });

  it("labels an instrument by its asset class, not by a made-up sector", () => {
    const [row] = remoteSearchRows({
      items: [],
      instruments: [
        { symbol: "EURUSD", displayName: "Euro / US Dollar", assetClassLabel: "Currency", logo: null },
      ],
    });
    expect(row!.category).toBe("Currency");
    expect(row!.kind).toBe("instrument");
    expect(row!.price).toBeNull();
  });

  it("survives a response with no instruments key at all", () => {
    expect(() => remoteSearchRows({ items: [] })).not.toThrow();
    expect(remoteSearchRows({ items: [] })).toEqual([]);
  });
});

describe("instrument artwork", () => {
  const PUBLIC = join(process.cwd(), "public");

  it("points every declared logo at a file that exists", () => {
    // A logo path that 404s degrades to a letter badge, so it is invisible in
    // the UI and invisible in review. This is the only place it can be caught.
    const withLogos = INSTRUMENTS.filter((i) => i.logo);
    expect(withLogos.length).toBeGreaterThan(0);
    for (const i of withLogos) {
      expect(existsSync(join(PUBLIC, i.logo!)), `${i.symbol} -> ${i.logo}`).toBe(true);
    }
  });

  it("serves real SVG artwork, not an error page saved with an .svg name", () => {
    for (const i of INSTRUMENTS.filter((x) => x.logo)) {
      const body = readFileSync(join(PUBLIC, i.logo!), "utf8");
      expect(body, i.symbol).toContain("<svg");
      expect(body.length, i.symbol).toBeGreaterThan(100);
    }
  });

  it("gives gold a mark, because that is the one a reader looks for", () => {
    const gold = INSTRUMENTS.find((i) => i.symbol === "XAUUSD");
    expect(gold!.logo).toBe("/logos/instruments/gold.svg");
  });

  it("leaves indices and the ten-year without artwork rather than borrowing one", () => {
    // Neither has an issuer whose mark it would be. The letter badge claims
    // nothing; a borrowed logo would imply a company that does not exist.
    for (const symbol of ["SPX", "NDX", "DJI", "VIX", "US10Y"]) {
      expect(INSTRUMENTS.find((i) => i.symbol === symbol)!.logo).toBeUndefined();
    }
  });

  it("never renders two USD pairs as the same flag", () => {
    // The reason the FX logo is the non-dollar leg: four of these pairs are
    // base USD, so a base-currency flag would draw USDJPY and USDINR alike.
    const fxLogos = INSTRUMENTS.filter((i) => i.assetClass === "fx").map((i) => i.logo);
    expect(new Set(fxLogos).size).toBe(fxLogos.length);
  });
});
