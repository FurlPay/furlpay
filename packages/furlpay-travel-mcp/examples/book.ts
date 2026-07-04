/**
 * End-to-end FurlPay Travels flow, runnable in demo mode (no keys):
 *   search → budget check → authorize (x402 + rebate) → confirm → rebates.
 *
 *   npm run example
 *   FURLPAY_API_KEY=fp_live_sk_... TRAVALA_API_KEY=... npm run example
 */
import { TravelClient } from "../src/index";

async function main() {
  const travel = new TravelClient({ developerWallet: "0xYourDevWallet" });
  console.log(`mode: ${travel.live ? "live" : "demo"}\n`);

  // 1. Agent searches Travala inventory.
  const stays = await travel.searchStays({
    city: "London",
    checkIn: "2026-08-01",
    checkOut: "2026-08-04",
    maxNightlyUsd: 200,
  });
  console.log("Top stays under $200/night:");
  stays.slice(0, 3).forEach((s) => console.log(`  • ${s.name} — $${s.nightlyUsd}/night, $${s.totalUsd} total`));

  const pick = stays[0];

  // 2. Set the agent's spend cap, then authorize via the crypto route (x402/USDC on Base).
  travel.setAgentBudget("agent_london", 1000);
  const booking = await travel.authorizeBooking({
    amountUsd: pick.totalUsd,
    source: "travala",
    agentId: "agent_london",
    reference: pick.quoteId,
  });
  console.log(`\nAuthorized ${pick.name} for $${booking.amountUsd}`);
  console.log(`  x402 proof: ${booking.authorization.x402?.proof} (network ${booking.authorization.x402?.network})`);
  console.log(`  cbBTC rebate: $${booking.rebate?.totalUsd} → dev $${booking.rebate?.developerUsd} / treasury $${booking.rebate?.treasuryUsd}`);

  // 3. Confirm (passkey step-up in a real flow).
  travel.confirmBooking(booking.id);

  // 4. A legacy (Web2) booking uses a single-use, MCC-locked Visa VCN instead.
  const legacy = await travel.authorizeBooking({ amountUsd: 130, source: "legacy", agentId: "agent_london" });
  const card = legacy.authorization.card!;
  console.log(`\nLegacy VCN issued: •••• ${card.last4}  limit $${card.limitUsd}  MCC-locked ${card.mccWhitelist.join(",")}  single-use ${card.singleUse}`);

  // 5. Rebate ledger.
  const r = travel.listRebates();
  console.log(`\nDeveloper cbBTC earned so far: $${r.developerTotalUsd} (wallet ${r.developerWallet})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
