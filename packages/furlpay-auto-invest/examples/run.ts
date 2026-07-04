/**
 * Set up two DCA schedules and run whatever is due. Runs in demo mode with no
 * key (orders are simulated); set FURLPAY_API_KEY to place real buys.
 *
 * In production you'd call `ai.runDue()` from a cron (e.g. hourly) and persist
 * `ai.list()` to your database between ticks.
 *
 *   npm run example
 *   FURLPAY_API_KEY=fp_live_sk_... npm run example
 */
import { AutoInvest } from "../src/index";

async function main() {
  const ai = new AutoInvest();
  console.log(`mode: ${ai.live ? "live" : "demo"}\n`);

  const voo = ai.add({ symbol: "VOO", amount: 10, frequency: "weekly", dayOfWeek: 1 }); // Mondays
  ai.add({ symbol: "BTC", amount: 25, frequency: "monthly", dayOfMonth: 1 }); // 1st of month

  for (const s of ai.list()) {
    console.log(`• ${s.symbol}  $${s.amount} ${s.currency}  ${s.frequency}  next: ${ai.nextRunAt(s.id).toISOString()}`);
  }

  // Simulate a tick at the moment VOO's Monday slot is due.
  const tick = ai.nextRunAt(voo.id);
  console.log(`\nrunning due schedules at ${tick.toISOString()} ...`);
  const results = await ai.runDue(new Date(tick.getTime() + 60_000));
  for (const r of results) {
    console.log(`  ${r.symbol}: ${r.status}${r.orderId ? ` (${r.orderId})` : ""}`);
  }
  if (!results.length) console.log("  (nothing due)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
