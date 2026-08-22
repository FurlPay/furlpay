import { describe, expect, it } from "vitest";
import { CATALOG } from "../catalog";
import { resolveMergedAsset } from "../universe";
import type { RealStats } from "../providers";
import {
  breadcrumbJsonLd,
  buildFaq,
  canonicalPath,
  companyJsonLd,
  entityLabel,
  faqJsonLd,
  overviewSentence,
  pageDescription,
  pageH1,
  pageTitle,
  sitemapSymbols,
} from "../seo";

// ---------------------------------------------------------------------------
// The SEO layer runs unattended across ~13,000 pages, so the failure mode that
// matters is not "this page is imperfect" but "every page makes the same false
// claim". These pin the invariants that have to hold for all of them.
// ---------------------------------------------------------------------------

const MU = resolveMergedAsset("MU")!;
const BTC = resolveMergedAsset("BTC")!;

/** Full stats, as a large-cap with filings would return. */
const richStats = {
  price: 245.5,
  changePct: 1.22,
  marketCap: 274_000_000_000,
  peRatio: 18.4,
  epsTtm: 13.34,
  revenueTtm: 51_000_000_000,
  high52w: 260.1,
  low52w: 85.4,
  dividendYieldPct: 0.19,
  dividendPerShareTtm: 0.46,
  provenance: { cik: "0000723125", fundamentals: "sec-edgar", price: "yahoo" },
} as unknown as RealStats;

/** A symbol nothing has fundamentals for. */
const emptyStats = null;

describe("titles and descriptions", () => {
  it("names the ticker and the company, in that order", () => {
    const title = pageTitle(MU);
    expect(title).toContain("MU");
    expect(title).toContain(MU.name);
    expect(title).toContain("FurlPay");
  });

  it("never promises data the symbol does not have", () => {
    // The failure this guards: a template that always says "financials,
    // earnings and analyst estimates" on 12,000 pages that have none.
    const bare = pageDescription(MU, emptyStats);
    expect(bare).not.toMatch(/financials/i);
    expect(bare).not.toMatch(/dividend/i);
    expect(bare).not.toMatch(/valuation/i);

    const rich = pageDescription(MU, richStats);
    expect(rich).toMatch(/financials/i);
    expect(rich).toMatch(/valuation/i);
    expect(rich).toMatch(/dividend/i);
  });

  it("stays a sensible length for the whole catalog", () => {
    for (const a of CATALOG.slice(0, 120)) {
      const asset = resolveMergedAsset(a.symbol);
      if (!asset) continue;
      const d = pageDescription(asset, richStats);
      expect(d.length, `${a.symbol} description`).toBeLessThan(320);
      expect(pageTitle(asset).length, `${a.symbol} title`).toBeLessThan(90);
    }
  });

  it("gives crypto a price noun rather than a stock one", () => {
    expect(pageH1(BTC)).not.toContain("Stock");
    expect(pageH1(MU)).toContain("Stock Price");
  });

  it("omits the exchange for crypto, which has none", () => {
    expect(entityLabel(BTC)).toBe(`${BTC.name} (${BTC.symbol})`);
  });
});

describe("canonical", () => {
  it("upper-cases the ticker so casing cannot fork a page in two", () => {
    expect(canonicalPath("mu")).toBe("/markets/MU");
    expect(canonicalPath("MU")).toBe("/markets/MU");
    expect(canonicalPath("brk.b")).toBe("/markets/BRK.B");
  });
});

describe("overview", () => {
  it("states only what is known, and terminates cleanly", () => {
    const text = overviewSentence(MU, emptyStats);
    expect(text.endsWith(".")).toBe(true);
    // No market cap known -> the sentence must not mention one.
    expect(text).not.toMatch(/capitalisation/i);
    expect(overviewSentence(MU, richStats)).toMatch(/capitalisation/i);
  });
});

describe("FAQ", () => {
  it("asks nothing it cannot answer", () => {
    // Every entry must carry a real answer; an FAQPage whose answers are
    // "unavailable" misrepresents the page to Google.
    const faq = buildFaq(MU, richStats);
    expect(faq.length).toBeGreaterThan(3);
    for (const e of faq) {
      expect(e.question.length).toBeGreaterThan(8);
      expect(e.answer.length).toBeGreaterThan(20);
      expect(e.answer).not.toMatch(/undefined|null|NaN/);
    }
  });

  it("shrinks rather than fabricates when there is no data", () => {
    const faq = buildFaq(MU, emptyStats);
    expect(faq.every((e) => !/price|market cap|P\/E|52-week/i.test(e.question))).toBe(true);
  });

  it("emits no FAQPage schema when there are no questions", () => {
    expect(faqJsonLd([])).toBeNull();
  });
});

describe("structured data", () => {
  it("breadcrumbs are absolute, ordered and complete", () => {
    const ld = breadcrumbJsonLd(MU) as {
      itemListElement: { position: number; item: string; name: string }[];
    };
    expect(ld.itemListElement.map((i) => i.position)).toEqual([1, 2, 3]);
    for (const i of ld.itemListElement) {
      expect(i.item).toMatch(/^https:\/\/furlpay\.com/);
      expect(i.name.length).toBeGreaterThan(0);
    }
    expect(ld.itemListElement[2]!.item).toBe(`https://furlpay.com/markets/${MU.symbol}`);
  });

  it("describes the company as a Corporation with its ticker, never a Product", () => {
    const ld = companyJsonLd(MU, richStats) as Record<string, unknown>;
    expect(ld["@type"]).toBe("Corporation");
    expect(ld.tickerSymbol).toBe(MU.symbol);
    // A listed security is not merchandise. Product/Offer here would be a
    // misrepresentation aimed at a price rich-result.
    expect(JSON.stringify(ld)).not.toMatch(/"Product"|"Offer"/);
  });

  it("cites the SEC CIK as the identifier when one is known", () => {
    const ld = companyJsonLd(MU, richStats) as Record<string, unknown>;
    expect(JSON.stringify(ld.identifier)).toContain("0000723125");
    const bare = companyJsonLd(MU, emptyStats) as Record<string, unknown>;
    expect(bare.identifier).toBeUndefined();
    expect(bare.sameAs).toBeUndefined();
  });

  it("emits no company entity for crypto, which is not a corporation", () => {
    expect(companyJsonLd(BTC, richStats)).toBeNull();
  });

  it("produces JSON that survives a round trip", () => {
    for (const g of [breadcrumbJsonLd(MU), companyJsonLd(MU, richStats), faqJsonLd(buildFaq(MU, richStats))]) {
      if (!g) continue;
      expect(() => JSON.parse(JSON.stringify(g))).not.toThrow();
      expect((g as Record<string, unknown>)["@context"]).toBe("https://schema.org");
    }
  });
});

describe("sitemap selection", () => {
  const sample = [
    { symbol: "MU", curated: true },
    { symbol: "mu", curated: false }, // casing duplicate
    { symbol: "BRK.B", curated: false }, // class share — keep
    { symbol: "AMPX.WS", curated: false }, // warrant — drop
    { symbol: "ALUB.U", curated: false }, // SPAC unit — drop
    { symbol: "ALL.PRB", curated: false }, // preferred — drop
  ];

  it("never lists the same ticker twice, whatever the casing", () => {
    const out = sitemapSymbols(sample).map((a) => a.symbol);
    expect(out.filter((s) => s === "MU")).toHaveLength(1);
  });

  it("keeps class shares but drops warrants, units and preferreds", () => {
    const out = sitemapSymbols(sample).map((a) => a.symbol);
    expect(out).toContain("BRK.B");
    expect(out).not.toContain("AMPX.WS");
    expect(out).not.toContain("ALUB.U");
    expect(out).not.toContain("ALL.PRB");
  });

  it("keeps a curated symbol even if its spelling looks thin", () => {
    const out = sitemapSymbols([{ symbol: "WEIRD.U", curated: true }]).map((a) => a.symbol);
    expect(out).toContain("WEIRD.U");
  });
});
