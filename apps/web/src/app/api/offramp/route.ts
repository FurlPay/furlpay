import { NextRequest, NextResponse } from "next/server";
import { quoteFx } from "@/lib/services/fx";
import { newTx, recordTransaction } from "@/lib/store";
import { recordMovement } from "@/lib/ledger";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { OfframpSchema, parse } from "@/lib/schemas";

// POST /api/offramp — quote / execute a stablecoin→fiat off-ramp via Wise
// rails for the SESSION user. body: { fromCurrency, toCurrency, amount, execute? }
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  // Per-route limit, matched to wallets.transfer (30/min). AGENTS.md rule 2 asks
  // for a tighter budget than the 150/min middleware baseline on anything
  // money-moving, and this route had none.
  //
  // It matters even where `execute` is refused in production: every call reaches
  // quoteFx, which is an OUTBOUND request to an FX provider. Without a per-route
  // budget an authenticated caller could drive that upstream at the middleware
  // ceiling — a cost and quota amplifier against a third party, on a route whose
  // quote path stays live in production. Keyed per-user by rateLimitOr429, so one
  // account cannot spend everyone else's budget.
  const limited = await rateLimitOr429(req, "offramp", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

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
    // LEDGER FIRST — see the same note in app/api/wallets/transfer/route.ts.
    // recordMovement can throw (LedgerDurabilityError / LedgerError); running it
    // after the fiat credit meant a ledger refusal left the user credited, the
    // transaction marked "settled", and the books with no record of either.
    // Double-entry: stablecoin leaves user cash to fiat rails.
    await recordMovement("out", amount, `Off-ramp to ${toCurrency} via ${quote.rail}`, account.user.id);

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
  }

  return NextResponse.json({ quote, executed: !!execute });
}
