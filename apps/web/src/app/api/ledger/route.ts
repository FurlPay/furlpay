import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { requireRole } from "@/lib/authz";
import { ledger } from "@/lib/ledger";

// Reads live in-memory ledger state — must not be statically cached.
export const dynamic = "force-dynamic";

// GET /api/ledger — the trial balance and recent journal, for operators.
//
// WHAT THIS ROUTE USED TO DO, and why it is now behind an admin role.
//
// It walked `ledger.listAccounts()` and returned every row with
// `balanceCents`, plus the last 15 journal entries including their postings —
// with NO authentication, only a 60/min rate limit.
//
// That was not a chart of accounts. lib/ledger.ts opens a real ledger account
// PER CUSTOMER on their first movement:
//
//   userFiatLiability(userId) -> id   `acct_2000_${userId}`
//                               code `2000:${userId}`
//                               name `Customer fiat liability ${userId}`
//
// so the response grew one row per customer, carrying that customer's user id in
// two fields and their exact balance in a third. A single unauthenticated GET
// enumerated the entire customer list with balances, and the journal postings
// carried the same ids again. The rate limit bounded how FAST that could be
// read, not whether it could be.
//
// TWO FIXES, deliberately independent, because either alone leaves a sharp edge:
//
//   1. requireRole("admin"). This is an internal ops view; it never had a
//      caller in the app (nothing fetches /api/ledger).
//   2. Per-user accounts are EXCLUDED from the payload regardless of who asks.
//      An operator auditing the books needs the platform accounts and the
//      balancing invariant, not a dump of customer ids — and if the auth above
//      ever regresses, there is no customer data here to leak. Their aggregate
//      is still shown, so the trial balance continues to prove what it claims.
//
// The trial-balance invariant is computed over the FULL ledger, not the filtered
// view, so redacting customer rows cannot make unbalanced books look balanced.

/**
 * Per-customer ledger accounts, which must never be enumerated here.
 *
 * Matched on the account id prefix rather than by parsing the code, because the
 * id is what `openMirror` constructs and is the one field guaranteed to carry
 * the user id. See CUSTOMER_FUND_ASSETS / userFiatLiability in lib/ledger.ts.
 */
function isPerCustomerAccount(id: string, code: string): boolean {
  // acct_2000_<userId> (fiat liability), acct_2100_<userId> (stablecoin), etc.
  // The trailing segment is a user id, so anything with one is customer-scoped.
  return /^acct_\d{4}_.+/.test(id) || /^\d{4}:.+/.test(code);
}

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "ledger", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  // Admin only. Roles are read from the user record inside requireRole, so a
  // demotion takes effect immediately rather than at token expiry.
  const auth = await requireRole(req, "admin");
  if (!auth.ok) return auth.res;

  const all = ledger.listAccounts();

  const accounts = all
    .filter((a) => !isPerCustomerAccount(a.id, a.code))
    .map((a) => ({
      code: a.code,
      name: a.name,
      type: a.type,
      currency: a.currency,
      balanceCents: ledger.balanceOf(a.id),
    }));

  // Customer positions, as ONE number rather than a list. Enough to reconcile
  // total customer liability against the escrow that backs it, which is the
  // question an operator actually has, without naming anybody.
  const customerRows = all.filter((a) => isPerCustomerAccount(a.id, a.code));
  const customerAggregate = {
    accountCount: customerRows.length,
    totalBalanceCents: customerRows.reduce((sum, a) => sum + ledger.balanceOf(a.id), 0),
  };

  // Computed over the whole ledger — the filter above is a presentation concern
  // and must not be able to hide an imbalance.
  const trialBalance = ledger.trialBalance();

  // Journal entries are redacted the same way: a posting against a customer
  // account is reported by SHAPE (that it happened, and for how much) without
  // the account id that names the customer.
  const journal = ledger
    .listTransactions()
    .slice(-15)
    .reverse()
    .map((t) => ({
      id: t.id,
      ts: t.ts,
      memo: t.memo,
      postings: t.postings.map((p) => {
        const customer = isPerCustomerAccount(p.accountId, "");
        return customer ? { ...p, accountId: "acct_customer_redacted" } : p;
      }),
    }));

  return NextResponse.json(
    { accounts, customerAggregate, trialBalance, journal },
    { headers: { "Cache-Control": "no-store" } }
  );
}
