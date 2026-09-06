import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { BankingSchema, parse } from "@/lib/schemas";
import { rateLimitOr429 } from "@/lib/rateLimit";

// ---------------------------------------------------------------------------
// Virtual fiat accounts.
//
// WHAT THIS ROUTE USED TO DO, AND WHY IT WAS THE WORST THING IN THE REPO.
// POST returned a fabricated payable destination per currency, from a table
// that named institutions FurlPay has no relationship with:
//
//   USD: routingNumber "026073150"        attributed to Cross River Bank
//   EUR: iban "BE71 0961 ….", swift "TRWIBEB1XXX"   attributed to Wise Europe
//   GBP: sortCode "23-14-70"              attributed to Wise Payments Ltd
//   INR: accountNumber "UPI: ashutosh@furlpay", ifsc "YESB0000001"
//
// Unlike every other money route in this codebase (wallets/transfer, offramp,
// services/payments) it had NO production guard. So a signed-in user in
// production could call it and receive, rendered in the banking UI as their
// own FurlPay account, a bank account number that does not exist — one of them
// a personal UPI handle. Money wired to any of those is money gone, and the
// response asserted a banking relationship that has never existed.
//
// WHAT IT DOES NOW. A virtual account number is a PAYABLE DESTINATION. There
// is exactly one honest way to mint one: a contracted VAN provider issues it
// and tells us the details. Until that contract exists there is nothing to
// return, so POST refuses — in every environment, not just production.
//
// WHY NOT MOCK IT IN DEV, as integrations.ts allows elsewhere. Because the
// mock output here is not a harmless shape: account writes flush through
// storeDb to Postgres, so a "dev-only" fabricated IFSC persists and reappears
// wherever that database is read next. The seam this route needs is a provider
// client, not a fixture. A developer building the banking screen is better
// served by the real empty state than by an IFSC that will still be in the
// database when the environment is promoted.
//
// GET still works: listing the balances a user already has is a read of our
// own ledger and asserts nothing about a bank.
//
// TO IMPLEMENT: add lib/rails/inr.ts (or the provider's equivalent), have it
// call the contracted VAN provider, and replace the 503 below with its
// response. See the P1 checklist item "PA contract with VDA-merchant approval".
// ---------------------------------------------------------------------------

/** GET /api/banking — list the caller's fiat balances. */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  return NextResponse.json({ accounts: auth.account.fiatBalances });
}

/**
 * POST /api/banking — provision a virtual local account.
 *
 * Unimplemented: no VAN provider is contracted. Returns 503 rather than a
 * fabricated account number. The body is still validated first so a caller
 * with a malformed request learns that, rather than being told the feature is
 * unavailable when their request was also wrong.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(
    req,
    "banking.provision",
    { limit: 10, windowMs: 60_000 },
    auth.account.user.id
  );
  if (limited) return limited;

  const parsed = parse(BankingSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;

  return NextResponse.json(
    {
      error: "service_unavailable",
      detail:
        "Virtual account provisioning is not available. FurlPay has no contracted account-issuing partner, " +
        "so there is no account number to issue. Existing balances remain readable via GET /api/banking.",
      currency: parsed.data.currency,
    },
    { status: 503 }
  );
}
