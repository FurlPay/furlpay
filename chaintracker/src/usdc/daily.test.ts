// Reconciliation and suppression tests.
//
// The single claim this subsystem must not get wrong is that raw on-chain USDC
// volume is not payment volume. Every test here is about an arithmetic mistake
// that would overstate economic activity while looking entirely plausible in a
// Discord embed — the class of error nobody catches by reading the output.

import { test } from "node:test";
import assert from "node:assert/strict";

import { reconcile, reconciliationLines } from "./daily.js";
import { suppressionReason } from "./tick.js";
import { isUsableTimestamp, scaleAmount, usdValue } from "./scanner.js";
import type { UsdcClassification, UsdcTransfer } from "./types.js";

/** A transfer with everything defaulted, so each test states only what it means. */
function transfer(over: Partial<UsdcTransfer> = {}): UsdcTransfer {
  return {
    chainSlug: "base",
    tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    txHash: "0x" + "a".repeat(64),
    logIndex: 0,
    blockNumber: 1,
    timestamp: Date.now(),
    fromAddress: "0x" + "1".repeat(40),
    toAddress: "0x" + "2".repeat(40),
    amount: 1000,
    amountUsd: 1000,
    fromLabel: null,
    toLabel: null,
    fromCategory: "unknown",
    toCategory: "unknown",
    fromEntity: null,
    toEntity: null,
    classification: "RAW_TRANSFER",
    isWhale: false,
    isExchange: false,
    isCctp: false,
    isFurlPay: false,
    cctpNonce: null,
    source: "rpc",
    explorerUrl: null,
    alerted: false,
    createdAt: Date.now(),
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* Reconciliation                                                      */
/* ------------------------------------------------------------------ */

test("raw volume counts every observed transfer", () => {
  const r = reconcile([
    transfer({ amountUsd: 100 }),
    transfer({ amountUsd: 250, classification: "MINT" }),
    transfer({ amountUsd: 650, classification: "INTERNAL_REBALANCE" }),
  ]);
  assert.equal(r.rawVolumeUsd, 1000);
});

test("infrastructure movement is excluded from between-party volume", () => {
  // THE CENTRAL ASSERTION OF THIS FILE. $900 of this $1000 is Circle issuing,
  // Circle redeeming, a CCTP leg, an exchange moving its own funds and a bridge.
  // Only $100 was one party paying another. A report that called this "$1,000 of
  // USDC payments" would be overstating by 10x.
  const r = reconcile([
    transfer({ amountUsd: 200, classification: "MINT" }),
    transfer({ amountUsd: 200, classification: "BURN" }),
    transfer({ amountUsd: 200, classification: "CCTP_TRANSFER" }),
    transfer({ amountUsd: 200, classification: "INTERNAL_REBALANCE" }),
    transfer({ amountUsd: 100, classification: "BRIDGE_TRANSFER" }),
    transfer({ amountUsd: 100, classification: "LIKELY_PAYMENT" }),
  ]);

  assert.equal(r.rawVolumeUsd, 1000);
  assert.equal(r.betweenPartiesUsd, 100);
  assert.equal(r.issuanceUsd, 200);
  assert.equal(r.redemptionUsd, 200);
  assert.equal(r.cctpLegsUsd, 200);
  assert.equal(r.rebalanceUsd, 200);
  assert.equal(r.bridgeUsd, 100);
  assert.equal(r.likelyPaymentUsd, 100);
});

test("the infrastructure categories partition the rows exactly once", () => {
  // If a classification were counted in two buckets, or in none, the
  // reconciliation printed in the daily report would not add up — and it is
  // printed as arithmetic, so it has to.
  const every: UsdcClassification[] = [
    "WHALE_TRANSFER",
    "EXCHANGE_DEPOSIT",
    "EXCHANGE_WITHDRAWAL",
    "BRIDGE_TRANSFER",
    "CCTP_TRANSFER",
    "TREASURY_TRANSFER",
    "MINT",
    "BURN",
    "DEX_TRANSFER",
    "FURLPAY_TRANSFER",
    "INTERNAL_REBALANCE",
    "LIKELY_PAYMENT",
    "RAW_TRANSFER",
    "UNKNOWN",
  ];
  const r = reconcile(every.map((c) => transfer({ classification: c, amountUsd: 10 })));

  assert.equal(r.rawVolumeUsd, every.length * 10);

  const deducted =
    r.issuanceUsd + r.redemptionUsd + r.cctpLegsUsd + r.rebalanceUsd + r.bridgeUsd + r.passThroughUsd;
  assert.equal(
    r.betweenPartiesUsd,
    r.rawVolumeUsd - deducted,
    "raw − (infrastructure + relays) must equal between-parties, or the printed sum is wrong"
  );
});

test("whale volume overlaps the categories and is never added to them", () => {
  // A whale transfer is a size band, not a category. Adding it into the
  // reconciliation would double-count every large transfer.
  const r = reconcile([
    transfer({ amountUsd: 5_000_000, isWhale: true, classification: "EXCHANGE_DEPOSIT" }),
  ]);
  assert.equal(r.whaleVolumeUsd, 5_000_000);
  assert.equal(r.exchangeInflowUsd, 5_000_000);
  assert.equal(r.betweenPartiesUsd, 5_000_000, "counted once, not twice");
  assert.equal(r.rawVolumeUsd, 5_000_000);
});

test("exchange flows are split by direction, not netted", () => {
  const r = reconcile([
    transfer({ amountUsd: 300, classification: "EXCHANGE_DEPOSIT" }),
    transfer({ amountUsd: 500, classification: "EXCHANGE_WITHDRAWAL" }),
  ]);
  assert.equal(r.exchangeInflowUsd, 300);
  assert.equal(r.exchangeOutflowUsd, 500);
  // Both are movement between parties; netting them here would lose the gross
  // figures the flow embed needs.
  assert.equal(r.betweenPartiesUsd, 800);
});

test("FurlPay direction is recorded per leg, not netted", () => {
  const r = reconcile([
    transfer({ amountUsd: 2_400, isFurlPay: true, toEntity: "FurlPay", classification: "FURLPAY_TRANSFER" }),
    transfer({ amountUsd: 900, isFurlPay: true, fromEntity: "FurlPay", classification: "FURLPAY_TRANSFER" }),
  ]);
  assert.equal(r.furlpayReceivedUsd, 2_400);
  assert.equal(r.furlpaySentUsd, 900);
});

test("a FurlPay-to-FurlPay transfer counts on both sides", () => {
  // Correct for a per-wallet view, and the reason these are not presented as a
  // net figure anywhere.
  const r = reconcile([
    transfer({
      amountUsd: 500,
      isFurlPay: true,
      fromEntity: "FurlPay",
      toEntity: "FurlPay",
      classification: "FURLPAY_TRANSFER",
    }),
  ]);
  assert.equal(r.furlpayReceivedUsd, 500);
  assert.equal(r.furlpaySentUsd, 500);
});

test("an empty window reconciles to zero rather than throwing", () => {
  const r = reconcile([]);
  assert.equal(r.rawVolumeUsd, 0);
  assert.equal(r.betweenPartiesUsd, 0);
});

/* ------------------------------------------------------------------ */
/* Suppression                                                         */
/* ------------------------------------------------------------------ */

test("CCTP legs are suppressed so a cross-chain transfer posts once", () => {
  // THE DOUBLE-COUNT THIS PREVENTS. A $10M CCTP transfer appears in
  // usdc_transfers twice — a burn on the source chain and a mint on the
  // destination. Posting both would report $20M of whale activity for one $10M
  // movement, and each alert would look completely legitimate on its own.
  assert.ok(suppressionReason(transfer({ classification: "MINT", amountUsd: 1e7 })));
  assert.ok(suppressionReason(transfer({ classification: "BURN", amountUsd: 1e7 })));
  assert.ok(suppressionReason(transfer({ classification: "CCTP_TRANSFER", amountUsd: 1e7 })));
});

test("an internal rebalance is suppressed however large", () => {
  // Binance hot to Binance cold is real movement with no change of owner.
  const r = suppressionReason(
    transfer({ classification: "INTERNAL_REBALANCE", amountUsd: 500_000_000 })
  );
  assert.equal(r, "internal rebalance");
});

test("a suppression reason is always given, never a bare boolean", () => {
  // The reason is what makes a suppressed nine-figure transfer explicable after
  // the fact instead of looking like a missed alert.
  for (const c of ["MINT", "BURN", "CCTP_TRANSFER", "INTERNAL_REBALANCE"] as const) {
    const r = suppressionReason(transfer({ classification: c, amountUsd: 1e8 }));
    assert.ok(typeof r === "string" && r.length > 0, `${c} gave no reason`);
  }
});

test("a genuine large transfer between parties is not suppressed", () => {
  assert.equal(
    suppressionReason(transfer({ classification: "WHALE_TRANSFER", amountUsd: 50_000_000 })),
    null
  );
  assert.equal(
    suppressionReason(transfer({ classification: "EXCHANGE_DEPOSIT", amountUsd: 5_000_000 })),
    null
  );
});

test("a small transfer is suppressed as below threshold", () => {
  assert.equal(suppressionReason(transfer({ amountUsd: 42 })), "below threshold");
});

test("a FurlPay wallet movement is never suppressed for being small", () => {
  // Own-wallet activity bypasses the USD floor on purpose: a $12 movement out of
  // a treasury matters in a way a $12 stranger-to-stranger transfer does not.
  assert.equal(
    suppressionReason(
      transfer({ amountUsd: 12, isFurlPay: true, classification: "FURLPAY_TRANSFER" })
    ),
    null
  );
});

test("a FurlPay wallet is still suppressed when it is a CCTP leg", () => {
  // Order matters: the structural rules run before the threshold bypass, so a
  // FurlPay CCTP burn does not post twice alongside its cross-chain event.
  assert.ok(
    suppressionReason(transfer({ amountUsd: 12, isFurlPay: true, classification: "MINT" }))
  );
});

/* ------------------------------------------------------------------ */
/* Scaling and valuation                                               */
/* ------------------------------------------------------------------ */

test("6-decimal scaling is exact to the cent", () => {
  assert.equal(scaleAmount(1_000_000n, 6), 1);
  assert.equal(scaleAmount(1_234_567n, 6), 1.234567);
  assert.equal(scaleAmount(1n, 6), 0.000001);
  assert.equal(scaleAmount(0n, 6), 0);
});

test("scaling is exact to the cent across the range USDC occupies", () => {
  // The honest bound, measured rather than assumed. A double holds 15-16
  // significant digits, so 6-decimal amounts are exact to the cent up to roughly
  // $90bn — comfortably past USDC's entire supply (~$70bn). Beyond that the last
  // digit rounds however the scaling is written, which is why the function is the
  // straightforward expression and not a bigint split that measured identical.
  assert.equal(scaleAmount(1_000_000n, 6), 1);
  assert.equal(scaleAmount(1_234_567n, 6), 1.234567);
  assert.equal(scaleAmount(999_999_999_999n, 6), 999_999.999999); // ~$1M
  assert.equal(scaleAmount(1_000_000_000_000_000n, 6), 1_000_000_000); // $1bn
  assert.equal(scaleAmount(70_000_000_000_000_000n, 6), 70_000_000_000); // ~total supply

  // A realistic large transfer keeps its whole-dollar figure intact.
  assert.equal(Math.trunc(scaleAmount(12_345_678_901_234_567n, 6)), 12_345_678_901);
});

test("scaling handles decimals other than 6", () => {
  // The registry says every USDC deployment is 6dp and `usdc verify` checks it
  // against the chain — but the scaler takes the value from the asset rather than
  // hardcoding it, so it is worth knowing it works if that ever changes.
  assert.equal(scaleAmount(1_000_000_000_000_000_000n, 18), 1);
  assert.equal(scaleAmount(1_500n, 3), 1.5);
});

test("USDC is valued at a dollar, inside a bounded peg", () => {
  assert.equal(usdValue(1000), 1000);
  assert.equal(usdValue(1000, 1.0), 1000);
  assert.equal(usdValue(1000, 0.99), 990);
});

test("a broken peg yields null rather than a wrong dollar figure", () => {
  // A depeg must not silently restate every figure in the report as though
  // nothing happened.
  assert.equal(usdValue(1000, 0.5), null);
  assert.equal(usdValue(1000, 2), null);
});

test("a zero or negative amount is not a transfer", () => {
  assert.equal(usdValue(0), null);
  assert.equal(usdValue(-5), null);
  assert.equal(usdValue(Number.NaN), null);
  assert.equal(usdValue(Number.POSITIVE_INFINITY), null);
});

/* ------------------------------------------------------------------ */
/* Timestamps                                                          */
/* ------------------------------------------------------------------ */

test("a seconds-valued timestamp is rejected as a unit error", () => {
  // THE BUG THIS EXISTS FOR, found by querying MAX(ts) after a real scan rather
  // than by any test or type error. HeliusProvider already converts the API's
  // seconds to milliseconds; the Solana adapter multiplied by 1000 again, which
  // dated every Solana row to the year 58713. The rows inserted cleanly and then
  // silently fell outside every 24-hour window, so the daily report under-counted
  // Solana with no indication why.
  const now = 1_790_651_427_547; // 2026-09-29

  // Correct: already milliseconds.
  assert.ok(isUsableTimestamp(now - 60_000, now));

  // The actual broken value observed in the database.
  assert.equal(isUsableTimestamp(1_790_650_452_000_000, now), false);

  // The other direction: a raw seconds value passed through unconverted.
  assert.equal(isUsableTimestamp(1_790_651_427, now), false);
});

test("a future timestamp is rejected, with slack for clock skew", () => {
  const now = 1_790_651_427_547;
  // A block cannot be mined after now.
  assert.equal(isUsableTimestamp(now + 2 * 60 * 60 * 1000, now), false);
  // But an RPC node an few minutes ahead of us is ordinary, not an error.
  assert.ok(isUsableTimestamp(now + 5 * 60 * 1000, now));
});

test("a missing or nonsensical timestamp is rejected", () => {
  const now = 1_790_651_427_547;
  assert.equal(isUsableTimestamp(0, now), false);
  assert.equal(isUsableTimestamp(-1, now), false);
  assert.equal(isUsableTimestamp(Number.NaN, now), false);
  assert.equal(isUsableTimestamp(Number.POSITIVE_INFINITY, now), false);
});

/* ------------------------------------------------------------------ */
/* Relayed money                                                       */
/* ------------------------------------------------------------------ */

test("relayed money is deducted from between-party volume", () => {
  // THE DEFECT THIS CLOSES, and it was in the reconciliation's own headline figure.
  // `precedingLeg` stopped the CHANNEL double-counting a hop chain, but the daily
  // report had no equivalent — so a Coinbase Prime -> A -> B -> C relay of $24.4M was
  // still reported as $73.2M of money moving between distinct parties.
  //
  // Measured on the live table before the fix: $8.66bn of $13.47bn in a 24h window,
  // 64%, was relayed money counted as new movement.
  const r = reconcile([
    // The originating withdrawal: real movement, counted.
    transfer({ amountUsd: 24_400_000, classification: "EXCHANGE_WITHDRAWAL" }),
    // Two relay legs of the same money: real transfers, but not new movement.
    transfer({ amountUsd: 24_400_000, passThrough: true, passThroughKind: "hop", predecessorId: 1 }),
    transfer({ amountUsd: 24_400_000, passThrough: true, passThroughKind: "hop", predecessorId: 2 }),
  ]);

  assert.equal(r.rawVolumeUsd, 73_200_000, "raw volume still sees all three legs");
  assert.equal(r.passThroughUsd, 48_800_000);
  assert.equal(r.passThroughCount, 2);
  assert.equal(
    r.betweenPartiesUsd,
    24_400_000,
    "the movement is counted ONCE, at its origin"
  );
});

test("a round trip contributes nothing to between-party volume beyond its first leg", () => {
  const r = reconcile([
    transfer({ amountUsd: 243_777_790 }),
    transfer({ amountUsd: 243_777_790, passThrough: true, passThroughKind: "reversal", predecessorId: 1 }),
  ]);
  assert.equal(r.betweenPartiesUsd, 243_777_790, "not 487M");
  assert.equal(r.passThroughCount, 1);
});

test("a relay leg is not double-deducted when it is also infrastructure", () => {
  // A CCTP leg that is ALSO flagged as relayed money must be removed once, not twice,
  // or between-parties would go negative on a busy bridging day.
  const r = reconcile([
    transfer({ amountUsd: 1_000_000, classification: "CCTP_TRANSFER", passThrough: true, predecessorId: 1 }),
  ]);
  assert.equal(r.rawVolumeUsd, 1_000_000);
  assert.equal(r.betweenPartiesUsd, 0);
  assert.ok(r.betweenPartiesUsd >= 0, "the residual must never go negative");
});

test("an independent transfer of the same size as a relay is still counted", () => {
  // The flag is per-row and resolved at ingestion, so an unrelated transfer that
  // merely shares an amount is unaffected.
  const r = reconcile([
    transfer({ amountUsd: 5_000_000, passThrough: true, predecessorId: 1 }),
    transfer({ amountUsd: 5_000_000 }),
  ]);
  assert.equal(r.betweenPartiesUsd, 5_000_000);
});

test("the printed reconciliation adds up", () => {
  // The report shows this as arithmetic a reader can check, so it has to actually
  // balance — including the relay line.
  const r = reconcile([
    transfer({ amountUsd: 100, classification: "MINT" }),
    transfer({ amountUsd: 200, classification: "BURN" }),
    transfer({ amountUsd: 300, classification: "CCTP_TRANSFER" }),
    transfer({ amountUsd: 400, classification: "INTERNAL_REBALANCE" }),
    transfer({ amountUsd: 500, classification: "BRIDGE_TRANSFER" }),
    transfer({ amountUsd: 600, passThrough: true, predecessorId: 1 }),
    transfer({ amountUsd: 700, classification: "EXCHANGE_DEPOSIT" }),
  ]);

  const lines = reconciliationLines(r);
  const raw = lines.find((l) => l.startsWith("raw observed"))!;
  const out = lines.find((l) => l.startsWith("= between"))!;
  assert.match(raw, /\$0\.00M/, "2,800 formats as $0.00M at this scale");
  assert.ok(out.includes("between distinct parties"));

  assert.equal(r.rawVolumeUsd, 2_800);
  assert.equal(
    r.betweenPartiesUsd,
    2_800 - (100 + 200 + 300 + 400 + 500 + 600),
    "only the exchange deposit is movement between distinct parties"
  );
  assert.equal(r.betweenPartiesUsd, 700);
});
