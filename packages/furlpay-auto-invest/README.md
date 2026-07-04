# @furlpay/auto-invest

Automated **dollar-cost averaging (DCA)** for [FurlPay](https://furlpay.com) —
_"buy $10 of VOO every Monday with USDC."_ Schedule recurring, stablecoin-funded
stock/ETF/crypto buys; a runner decides what's due and places the orders.

- **You own the schedules** — create them here or seed from your own database.
- **Deterministic scheduling** — pure, UTC-based due logic with catch-up (a slot
  fires once even if the runner was down, and never double-fires).
- **Clone-and-run** — with no API key, orders are **simulated** so you can watch
  the DCA loop end-to-end. Zero runtime dependencies (global `fetch`, Node 18+).

Maintained by [FurlPay](https://furlpay.com) · MIT licensed.

## Install

```sh
npm i @furlpay/auto-invest
```

## Usage

```ts
import { AutoInvest } from "@furlpay/auto-invest";

const ai = new AutoInvest({ apiKey: process.env.FURLPAY_API_KEY });   // omit key → simulate

ai.add({ symbol: "VOO", amount: 10, frequency: "weekly", dayOfWeek: 1 });   // Mondays
ai.add({ symbol: "BTC", amount: 25, frequency: "monthly", dayOfMonth: 1 }); // 1st of month
ai.add({ symbol: "AAPL", amount: 5, frequency: "daily" });                  // every day

// Run this on a cron (e.g. hourly). It buys everything currently due.
const results = await ai.runDue();
// [{ scheduleId, symbol, amount, currency, status, orderId?, simulated?, ranAt }]
```

Each due schedule places a fractional **market buy** for its notional via
`POST /investing/orders`, funded in the schedule's currency (default `USDC`), and
records `lastRun` so it advances to the next slot.

## Scheduling

| Frequency | Fires on | Options (UTC) |
| --- | --- | --- |
| `daily` | every day at `hour` | `hour` (0–23, default 14) |
| `weekly` | `dayOfWeek` at `hour` | `dayOfWeek` (0=Sun…6=Sat, default 1), `hour` |
| `monthly` | `dayOfMonth` at `hour` | `dayOfMonth` (1–28, default 1), `hour` |

The pure helpers are exported if you want to compute times yourself:

```ts
import { isDue, nextRun } from "@furlpay/auto-invest";
nextRun(schedule, new Date());   // next UTC fire time
isDue(schedule, new Date());     // should it run now?
```

## API

| Method | Purpose |
| --- | --- |
| `ai.add(input)` | Create a schedule (validates amount/day ranges) → `Schedule` |
| `ai.list()` / `ai.get(id)` | Read schedules |
| `ai.pause(id)` / `ai.resume(id)` / `ai.remove(id)` | Toggle / delete |
| `ai.nextRunAt(id)` | Next UTC fire time for a schedule |
| `ai.due(now?)` | Schedules due at `now` |
| `ai.runDue(now?)` | Buy everything due; records `lastRun` → `OrderResult[]` |
| `ai.runNow(id, now?)` | Force one schedule to buy now (ignores due check) |
| `ai.live` | `true` when an API key is set (else orders simulate) |

Seed from your store and persist after each tick:

```ts
const ai = new AutoInvest({ apiKey, schedules: await db.loadSchedules() });
await ai.runDue();
await db.saveSchedules(ai.list());   // persists updated lastRun
```

## Example

```sh
npm run example
FURLPAY_API_KEY=fp_live_sk_... npm run example
```

## Test

```sh
npm test        # tsc build + node --test (demo mode, no network)
```

The suite pins the scheduling math (daily/weekly/monthly `nextRun`, `isDue`
catch-up and no-double-fire), input validation, simulated runs recording
`lastRun`, and the live path (correct POST body to `/investing/orders`, plus
failed orders captured rather than thrown).

## Scope

This library orchestrates FurlPay's investing API — it doesn't custody funds or
execute trades itself; brokerage (via Alpaca) and settlement happen in the FurlPay
API. Point it at your own FurlPay account and it invests on your behalf.

## License

MIT
