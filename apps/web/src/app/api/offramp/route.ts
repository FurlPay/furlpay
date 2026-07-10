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

  // Execution below mutates the demo ledger only — there is no Wise payout
  // call behind this route yet. Gate on NODE_ENV (not INTEGRATION_MODE, which
  // is live in prod for the x402 rail but cannot make this route real): in
  // production, quotes stay available and execute refuses rather than
  // recording a fabricated "settled" off-ramp.
  if (execute && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "service_unavailable", detail: "Off-ramp execution is not enabled on this deployment. Quotes remain available." },
      { status: 503 }
    );
  }

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
