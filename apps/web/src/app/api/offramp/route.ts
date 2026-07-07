import { NextRequest, NextResponse } from "next/server";
import { quoteFx } from "@/lib/services/fx";
import { db, newTx, recordTransaction } from "@/lib/store";
import { recordMovement } from "@/lib/ledger";

// POST /api/offramp — quote / execute a stablecoin→fiat off-ramp via Wise rails.
// body: { fromCurrency, toCurrency, amount, execute? }
export async function POST(req: NextRequest) {
  const { fromCurrency, toCurrency, amount, execute } = await req.json();
  const quote = await quoteFx(fromCurrency, toCurrency, amount);

  if (execute) {
    recordTransaction(
      newTx({
        category: "ramp",
        direction: "out",
        title: `Off-ramp to ${toCurrency}`,
        subtitle: `Wise · ${quote.rail} · ${quote.feePct}% fee`,
        amountUsd: amount,
        status: "settled",
      })
    );
    const fiat = db.fiatBalances.find((f) => f.currency === toCurrency);
    if (fiat) {
      fiat.amount += quote.amountTo;
    }
    // Double-entry: stablecoin leaves user cash to fiat rails.
    recordMovement("out", amount, `Off-ramp to ${toCurrency} via ${quote.rail}`);
  }

  return NextResponse.json({ quote, executed: !!execute });
}
