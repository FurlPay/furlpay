/**
 * Print a quote and a few daily bars. Runs in demo mode with no key; set
 * ALPHA_VANTAGE_KEY (and/or NASDAQ_DATA_LINK_KEY) to hit live providers.
 *
 *   npm run example                # demo data
 *   ALPHA_VANTAGE_KEY=xxx npm run example
 */
import { MarketData } from "../src/index";

async function main() {
  const md = new MarketData();
  console.log(`mode: ${md.live ? "live" : "demo"}`);

  const symbol = process.argv[2] || "AAPL";
  const quote = await md.quote(symbol);
  console.log(
    `${quote.symbol}  $${quote.price}  (${quote.change >= 0 ? "+" : ""}${quote.changePercent}%)  [${quote.source}]`,
  );

  const { bars } = await md.bars(symbol, { interval: "daily", limit: 5 });
  console.log("last 5 daily closes:", bars.map((b) => b.c).join(", "));

  const matches = await md.search("vanguard");
  console.log("search 'vanguard':", matches.map((m) => `${m.symbol} (${m.type})`).join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
