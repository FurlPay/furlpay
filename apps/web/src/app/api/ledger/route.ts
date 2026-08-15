import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { ledger } from "@/lib/ledger";

// Reads live in-memory ledger state — must not be statically cached.
export const dynamic = "force-dynamic";

// GET /api/ledger — chart of accounts with derived balances, the double-entry
// trial-balance invariant, and recent journal entries. Proves the books balance.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "ledger", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const accounts = ledger.listAccounts().map((a) => ({
    code: a.code,
    name: a.name,
    type: a.type,
    currency: a.currency,
    balanceCents: ledger.balanceOf(a.id),
  }));

  const trialBalance = ledger.trialBalance();
  const journal = ledger
    .listTransactions()
    .slice(-15)
    .reverse()
    .map((t) => ({ id: t.id, ts: t.ts, memo: t.memo, postings: t.postings }));

  return NextResponse.json({ accounts, trialBalance, journal });
}
