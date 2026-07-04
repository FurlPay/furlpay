# @furlpay/market-data

Real-time stock/ETF market data for [FurlPay](https://furlpay.com) — a thin,
zero-dependency aggregator over **Alpha Vantage** and **Nasdaq Data Link** with a
deterministic **demo fallback**. It powers live prices in the FurlPay dashboard
and is drop-in usable in any Node service.

- **Clone-and-run** — no API key needed. Every quote/bar is deterministic demo
  data until you add a key, so charts render immediately.
- **Fails soft** — a live call that errors or hits a rate limit degrades to demo
  data instead of throwing, so a quote is never empty.
- **Zero runtime dependencies** — uses the global `fetch` (Node 18+).

Maintained by [FurlPay](https://furlpay.com) · MIT licensed.

## Install

```sh
npm i @furlpay/market-data
```

## Usage

```ts
import { MarketData } from "@furlpay/market-data";

const md = new MarketData({
  alphaVantageKey: process.env.ALPHA_VANTAGE_KEY,   // optional
  nasdaqKey: process.env.NASDAQ_DATA_LINK_KEY,      // optional (daily bars)
});

md.live;                                    // false until a key is set

await md.quote("AAPL");
// { symbol: "AAPL", price: 241.75, change: 1.9, changePercent: 0.79,
//   open, high, low, previousClose, volume, currency: "USD", asOf, source }

await md.quotes(["AAPL", "VOO", "NVDA"]);   // batch, never rejects

await md.bars("VOO", { interval: "daily", limit: 100 });
// { symbol, interval, bars: [{ t, o, h, l, c, v }, ...], source }

await md.search("vanguard");
// [{ symbol: "VOO", name: "Vanguard S&P 500 ETF", type: "ETF", ... }]
```

Keys are read from the constructor first, then from `ALPHA_VANTAGE_KEY` /
`NASDAQ_DATA_LINK_KEY` in the environment.

## API

| Method | Returns | Notes |
| --- | --- | --- |
| `new MarketData(opts?)` | — | `alphaVantageKey?`, `nasdaqKey?`, `fetchImpl?`, `timeoutMs?` |
| `md.live` | `boolean` | true when any provider key is configured |
| `md.quote(symbol)` | `Promise<Quote>` | latest quote; demo fallback on error |
| `md.quotes(symbols)` | `Promise<Quote[]>` | batch; resolves all, never rejects |
| `md.bars(symbol, { interval?, limit? })` | `Promise<BarsResult>` | `interval`: `1min\|5min\|15min\|30min\|60min\|daily` (default `daily`); daily prefers Nasdaq |
| `md.search(query)` | `Promise<AssetMatch[]>` | symbol/name lookup |

All shapes are exported types (`Quote`, `Bar`, `BarsResult`, `AssetMatch`).

### Providers

| Provider | Used for | Key |
| --- | --- | --- |
| [Alpha Vantage](https://www.alphavantage.co/support/#api-key) | quotes, intraday & daily bars, search | `alphaVantageKey` |
| [Nasdaq Data Link](https://data.nasdaq.com) | historical daily bars (preferred when set) | `nasdaqKey` |

## Example

```sh
npm run example            # demo data
npm run example -- TSLA    # different symbol
ALPHA_VANTAGE_KEY=xxx npm run example
```

## Test

```sh
npm test        # tsc build + node --test (runs in demo mode, no network)
```

The suite asserts the contract: demo quotes are deterministic per symbol, batch
quotes resolve, bars are chronological with valid OHLC, search matches by symbol
and name, and a failing live provider falls back to demo instead of throwing.

## License

MIT
