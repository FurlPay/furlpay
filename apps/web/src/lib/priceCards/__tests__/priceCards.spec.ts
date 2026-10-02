import { afterEach, describe, it, expect } from "vitest";
import {
  DASH, changeColor, COLORS, discordTimestamp,
  formatCompactUsd, formatPct, formatRank, formatUsd, sparklinePath,
} from "../format";
import { calculateFromAth, CARD_ASSETS } from "../data";
import { buildPriceCardMessage } from "../embed";
import { isSnowflake, configuredChannels } from "../config";
import type { PriceCardData } from "../data";

// ---------------------------------------------------------------------------
// The card's job is to be true before it is pretty. These tests are mostly
// about the difference between "we do not have this" and "this is zero", which
// on a price card are opposite claims.
// ---------------------------------------------------------------------------

const sample: PriceCardData = {
  symbol: "SOL", name: "Solana", pair: "SOL / USD",
  price: 97.81, changePct24h: -4.24, changePct1h: -0.1, changePct7d: 0.5,
  high24h: 102.49, low24h: 97.38, rank: 7,
  marketCap: 57_250_000_000, volume24h: 3_330_000_000,
  athPrice: 294.33, fromAthPct: -66.77,
  sparkline: [100, 102, 99, 101, 98, 97.81],
  accent: "#14F195", source: "CoinGecko", note: null,
  unit: "usd", sparklineLabel: "7d",
};

describe("formatting", () => {
  it("scales price precision to magnitude", () => {
    // Bitcoin does not need four decimals; a sub-cent coin is destroyed by two.
    expect(formatUsd(76_692.1)).toBe("$76,692.10");
    expect(formatUsd(97.81)).toBe("$97.81");
    expect(formatUsd(0.0432)).toBe("$0.0432");
  });

  it("renders a dash for an absent number, never a zero", () => {
    // A price card showing "$0.00" is a claim that something is worthless.
    expect(formatUsd(null)).toBe(DASH);
    expect(formatCompactUsd(null)).toBe(DASH);
    expect(formatPct(null)).toBe(DASH);
    expect(formatRank(null)).toBe(DASH);
  });

  it("compacts large money the way the design shows it", () => {
    expect(formatCompactUsd(57_250_000_000)).toBe("$57.25B");
    expect(formatCompactUsd(3_330_000_000)).toBe("$3.33B");
    expect(formatCompactUsd(1_240_000_000_000)).toBe("$1.24T");
    expect(formatCompactUsd(912_400_000)).toBe("$912.40M");
  });

  it("signs percentages and keeps the requested precision", () => {
    expect(formatPct(-4.24)).toBe("-4.24%");
    expect(formatPct(0.5)).toBe("+0.50%");
    expect(formatPct(-66.77, 1)).toBe("-66.8%");
  });

  it("colours a flat session neutral rather than green", () => {
    // Zero is neither a gain nor a loss, and green implies one.
    expect(changeColor(0)).toBe(COLORS.neutral);
    expect(changeColor(null)).toBe(COLORS.neutral);
    expect(changeColor(1.2)).toBe(COLORS.positive);
    expect(changeColor(-1.2)).toBe(COLORS.negative);
  });

  it("emits a Discord timestamp rather than a baked local time", () => {
    // A literal "6:18 PM" is right in one timezone and wrong everywhere else.
    const t = discordTimestamp(new Date("2026-09-02T18:18:00Z"), "t");
    expect(t).toBe("<t:1788373080:t>");
  });
});

describe("distance from the all-time high", () => {
  it("computes (price / ath - 1) * 100", () => {
    expect(calculateFromAth(97.81, 294.33)!).toBeCloseTo(-66.77, 2);
  });

  it("returns null with no ATH rather than claiming 0%", () => {
    // "0% from its high" is a strong claim; an absent ATH is not evidence.
    expect(calculateFromAth(97.81, null)).toBeNull();
    expect(calculateFromAth(97.81, 0)).toBeNull();
  });

  it("is positive at a new high", () => {
    expect(calculateFromAth(300, 294.33)!).toBeGreaterThan(0);
  });
});

describe("sparkline geometry", () => {
  it("scales to the series' own range, not to zero", () => {
    // Anchored at zero, a gold chart is a flat line across the top.
    const p = sparklinePath([100, 110], 100, 50, 0)!;
    expect(p.min).toBe(100);
    expect(p.max).toBe(110);
    // The last point is the high, so it sits at the top of the panel.
    expect(p.lastY).toBeCloseTo(0, 6);
  });

  it("closes the area path back to the baseline", () => {
    const p = sparklinePath([1, 2, 3], 90, 30, 0)!;
    expect(p.area.startsWith("M ")).toBe(true);
    expect(p.area.endsWith("Z")).toBe(true);
  });

  it("draws nothing rather than a flat line for a constant series", () => {
    // A horizontal line through the middle would imply a stable price when the
    // truth is that there is no range to plot.
    expect(sparklinePath([5, 5, 5], 100, 50)).toBeNull();
  });

  it("refuses a series too short to be a line", () => {
    expect(sparklinePath([1], 100, 50)).toBeNull();
    expect(sparklinePath([], 100, 50)).toBeNull();
  });
});

describe("the embed", () => {
  const msg = buildPriceCardMessage(sample, "sol-price.png", new Date("2026-09-02T18:18:00Z"));
  const embed = (msg.embeds[0] ?? {}) as Record<string, unknown>;

  it("uses six inline fields, which Discord lays out three to a row", () => {
    // That is exactly the design's two rows of three.
    const fields = embed.fields as { name: string; inline: boolean }[];
    expect(fields).toHaveLength(6);
    expect(fields.every((f) => f.inline)).toBe(true);
    expect(fields.map((f) => f.name)).toEqual([
      "24h high", "24h low", "Rank", "Market cap", "Volume 24h", "From ATH",
    ]);
  });

  it("puts the price in the description so it renders larger than a field", () => {
    expect(embed.description).toBe("**$97.81** (-4.24% 24h)");
  });

  it("colours the embed by direction", () => {
    expect(embed.color).toBe(0xed4245);
    const up = buildPriceCardMessage({ ...sample, changePct24h: 2 }, "x.png");
    expect((up.embeds[0] as Record<string, unknown>).color).toBe(0x57f287);
    const flat = buildPriceCardMessage({ ...sample, changePct24h: 0 }, "x.png");
    expect((flat.embeds[0] as Record<string, unknown>).color).toBe(0x949ba4);
  });

  it("marks direction in the author line with a dot", () => {
    expect((embed.author as { name: string }).name).toBe("🔴 Solana · SOL");
    const up = buildPriceCardMessage({ ...sample, changePct24h: 3 }, "x.png");
    expect(((up.embeds[0] as Record<string, unknown>).author as { name: string }).name)
      .toBe("🟢 Solana · SOL");
  });

  it("references the upload by attachment:// so it renders inside the embed", () => {
    // A bare filename or a local path renders as a download, not an image.
    expect((embed.image as { url: string }).url).toBe("attachment://sol-price.png");
    expect(msg.attachments).toEqual([{ id: 0, filename: "sol-price.png" }]);
  });

  it("uses a real timestamp field rather than text in the footer", () => {
    expect(embed.timestamp).toBe("2026-09-02T18:18:00.000Z");
    expect((embed.footer as { text: string }).text).toBe("FurlPay · Source: CoinGecko");
  });

  it("states the provider's own timestamp when it has one", () => {
    const now = new Date("2026-10-02T13:05:00Z");
    const fresh = buildPriceCardMessage({ ...sample, asOf: "2026-10-02T13:04:30Z" }, "sol.png", now);
    expect(((fresh.embeds[0] as Record<string, unknown>).footer as { text: string }).text).toBe(
      "FurlPay · Source: CoinGecko · as of 2026-10-02 13:04 UTC"
    );
  });

  it("leads with DELAYED DATA when the provider's price is older than the asset allows", () => {
    // The September freeze: a card must not present an old number as current.
    const now = new Date("2026-10-02T13:05:00Z");
    const coin = buildPriceCardMessage({ ...sample, asOf: "2026-10-02T12:00:00Z" }, "sol.png", now);
    expect(((coin.embeds[0] as Record<string, unknown>).footer as { text: string }).text).toMatch(
      /^DELAYED DATA · last update 2026-10-02 12:00 UTC/
    );
    // An index keeps Friday's close over a weekend without being "delayed".
    const index = buildPriceCardMessage(
      { ...sample, source: "Yahoo Finance", unit: "points", asOf: "2026-10-02T20:00:00Z" },
      "spx.png",
      new Date("2026-10-04T13:05:00Z")
    );
    expect(((index.embeds[0] as Record<string, unknown>).footer as { text: string }).text).not.toMatch(/DELAYED/);
  });

  it("carries the instrument caveat into the footer when there is one", () => {
    // Gold's symbol and the contract actually quoted are not the same thing.
    const gold = buildPriceCardMessage(
      { ...sample, symbol: "XAUUSD", name: "Gold", note: "Front-month futures, not spot" },
      "gold.png"
    );
    expect(((gold.embeds[0] as Record<string, unknown>).footer as { text: string }).text)
      .toBe("FurlPay · Front-month futures, not spot · Source: CoinGecko");
  });

  it("renders dashes for an asset that genuinely has no rank or market cap", () => {
    const gold = buildPriceCardMessage(
      { ...sample, rank: null, marketCap: null, volume24h: null, fromAthPct: null },
      "gold.png"
    );
    const fields = (gold.embeds[0] as Record<string, unknown>).fields as { name: string; value: string }[];
    for (const n of ["Rank", "Market cap", "Volume 24h", "From ATH"]) {
      expect(fields.find((f) => f.name === n)!.value, n).toBe(DASH);
    }
  });
});

describe("configuration", () => {
  it("accepts a Discord snowflake and rejects a channel name", () => {
    // Pasting "#📈-sol-price" into a channel-ID variable is the most common
    // misconfiguration, and it must fail loudly rather than 404 at post time.
    expect(isSnowflake("1234567890123456789")).toBe(true);
    expect(isSnowflake("📈-sol-price")).toBe(false);
    expect(isSnowflake("12345")).toBe(false);
    expect(isSnowflake(undefined)).toBe(false);
  });

  it("reports why each unconfigured card was skipped", () => {
    const { ready, skipped } = configuredChannels();
    // In a test environment nothing is configured, and every asset should say
    // which variable it wanted rather than vanishing silently.
    expect(ready).toEqual([]);
    expect(skipped.length).toBe(Object.keys(CARD_ASSETS).length);
    for (const s of skipped) expect(s.reason).toMatch(/CHANNEL_ID/);
  });

  // -------------------------------------------------------------------------
  // A per-asset channel is an ADDITIONAL home, not an override.
  //
  // Under the old rule a per-asset setting won outright, so moving the cards to
  // a shared feed silently abandoned the four that already existed in their own
  // channels: they kept showing 2 September prices for five days under headings
  // that promise a live number. A card is a message that exists somewhere, not
  // a broadcast that can be redirected.
  // -------------------------------------------------------------------------
  describe("homes", () => {
    const SHARED = "1542628383752720434";
    const BTC_OWN = "1544711989090197608";

    afterEach(() => {
      delete process.env.MARKET_CARDS_CHANNEL_ID;
      delete process.env.BTC_PRICE_CHANNEL_ID;
    });

    it("writes an asset to its own channel AND the shared feed", () => {
      process.env.MARKET_CARDS_CHANNEL_ID = SHARED;
      process.env.BTC_PRICE_CHANNEL_ID = BTC_OWN;

      const { ready, skipped } = configuredChannels();
      expect(skipped).toEqual([]);

      const btc = ready.filter((r) => r.symbol === "BTC").map((r) => r.channelId).sort();
      expect(btc).toEqual([BTC_OWN, SHARED].sort());

      // An asset with no channel of its own still has exactly one home.
      expect(ready.filter((r) => r.symbol === "SPX").map((r) => r.channelId)).toEqual([SHARED]);
    });

    it("does not post the same card into one channel twice", () => {
      // Pointing a per-asset variable at the shared channel is a reasonable
      // thing to type, and it must not double-post.
      process.env.MARKET_CARDS_CHANNEL_ID = SHARED;
      process.env.BTC_PRICE_CHANNEL_ID = SHARED;

      const { ready } = configuredChannels();
      expect(ready.filter((r) => r.symbol === "BTC").map((r) => r.channelId)).toEqual([SHARED]);
    });

    it("still serves an asset that has only its own channel", () => {
      process.env.BTC_PRICE_CHANNEL_ID = BTC_OWN;

      const { ready, skipped } = configuredChannels();
      expect(ready.map((r) => r.channelId)).toEqual([BTC_OWN]);
      // The other six have nowhere to go, and each says so.
      expect(skipped.length).toBe(Object.keys(CARD_ASSETS).length - 1);
    });

    it("names the variable that supplied each home", () => {
      // The report has to be able to say WHICH setting sent a card to a channel
      // the bot cannot post in; "BTC failed" is not actionable when BTC has two.
      process.env.MARKET_CARDS_CHANNEL_ID = SHARED;
      process.env.BTC_PRICE_CHANNEL_ID = BTC_OWN;

      const btc = configuredChannels().ready.filter((r) => r.symbol === "BTC");
      expect(btc.find((r) => r.channelId === BTC_OWN)?.envVar).toBe("BTC_PRICE_CHANNEL_ID");
      expect(btc.find((r) => r.channelId === SHARED)?.envVar).toBe("MARKET_CARDS_CHANNEL_ID");
    });
  });

  it("knows a channel for every asset it can draw", () => {
    const { ready, skipped } = configuredChannels();
    const covered = new Set([...ready.map((r) => r.symbol), ...skipped.map((s) => s.symbol)]);
    for (const k of Object.keys(CARD_ASSETS)) expect(covered.has(k as never), k).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// An index level is not a price.
//
// The S&P 500 at 7,670.92 is a number of points. Rendering it as "$7,670.92"
// makes it look like something you could buy one of, and the same mistake in
// the other direction would strip the dollar sign off Bitcoin.
// ---------------------------------------------------------------------------
describe("units", () => {
  const index: PriceCardData = {
    ...sample, symbol: "SPX", name: "S&P 500", pair: "SPX · INDEX",
    price: 7670.92, high24h: 7700.1, low24h: 7600.5,
    rank: null, marketCap: null, volume24h: null, fromAthPct: null,
    unit: "points", sparklineLabel: "30d",
  };

  it("quotes an index in points, with no currency symbol", () => {
    const e = buildPriceCardMessage(index, "spx.png").embeds[0] as Record<string, unknown>;
    expect(e.description).toBe("**7,670.92** (-4.24% 24h)");
    const fields = e.fields as { name: string; value: string }[];
    expect(fields.find((f) => f.name === "24h high")!.value).toBe("7,700.10");
    expect(fields.find((f) => f.name === "24h low")!.value).toBe("7,600.50");
  });

  it("still quotes a coin in dollars", () => {
    const e = buildPriceCardMessage(sample, "sol.png").embeds[0] as Record<string, unknown>;
    expect(e.description).toBe("**$97.81** (-4.24% 24h)");
  });

  it("renders dashes for the statistics an index does not have", () => {
    const fields = (buildPriceCardMessage(index, "spx.png").embeds[0] as Record<string, unknown>)
      .fields as { name: string; value: string }[];
    for (const n of ["Rank", "Market cap", "Volume 24h", "From ATH"]) {
      expect(fields.find((f) => f.name === n)!.value, n).toBe(DASH);
    }
  });
});
