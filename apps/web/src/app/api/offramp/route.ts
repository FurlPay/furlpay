import { NextRequest, NextResponse } from "next/server";
import { quoteFx } from "@/lib/services/fx";
import { newTx, recordTransaction } from "@/lib/store";
import { recordMovement } from "@/lib/ledger";
import { requireUser } from "@/lib/authz";
import { OfframpSchema, parse } from "@/lib/schemas";

// POST /api/offramp — quote / execute a stablecoin→fiat off-ramp via Wise
// rails for the SESSION user. body: { fromCurrency, toCurrency, amount, execute? }
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const parsed = parse(OfframpSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;
  const { fromCurrency, toCurrency, amount, execute } = parsed.data;
  const quote = await quoteFx(fromCurrency, toCurrency, amount);

  if (execute) {
    recordTransaction(
      account.user.id,
      newTx({
        category: "ramp",
        direction: "out",
        title: `Off-ramp to ${toCurrency}`,
        subtitle: `Wise · ${quote.rail} · ${quote.feePct}% fee`,
        amountUsd: amount,
        status: "settled",
      })
    );
    const fiat = account.fiatBalances.find((f) => f.currency === toCurrency);
    if (fiat) {
      fiat.amount += quote.amountTo;
    }
    // Double-entry: stablecoin leaves user cash to fiat rails.
    recordMovement("out", amount, `Off-ramp to ${toCurrency} via ${quote.rail}`, account.user.id);
  }

  return NextResponse.json({ quote, executed: !!execute });
}
