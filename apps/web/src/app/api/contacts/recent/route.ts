import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { listPaymentsForUser } from "@/lib/paymentsDb";
import { recentsForChain, summarizeRecentRecipients } from "@/lib/recentRecipients";
import { CHAINS, isContactChain } from "@/lib/contacts";

export const dynamic = "force-dynamic";

/** How far back to look. Larger than the returned list because a handful of
 *  recipients paid repeatedly would otherwise crowd out everyone else. */
const HISTORY_WINDOW = 100;
const MAX_RESULTS = 10;

// GET /api/contacts/recent[?chain=base]
//
// Addresses the SESSION user has actually paid, most recent first, annotated
// with the matching address-book entry when there is one — which is what turns
// this list into an onboarding path for the address book ("you have paid this
// address three times; save it as a contact").
//
// `durable: false` means the payments table is not present on this deployment,
// so there is no history to read. It is NOT the same as "you have paid nobody",
// and the client must say so rather than render an empty state.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(
    req,
    "contacts.recent",
    { limit: 60, windowMs: 60_000 },
    auth.account.user.id
  );
  if (limited) return limited;

  const chain = req.nextUrl.searchParams.get("chain");
  if (chain !== null && !isContactChain(chain)) {
    return NextResponse.json({ error: "invalid_chain", supported: CHAINS }, { status: 400 });
  }

  const rows = await listPaymentsForUser(auth.account.user.id, HISTORY_WINDOW);
  if (rows === null) {
    return NextResponse.json({ recents: [], durable: false });
  }

  // Summarize the whole window first, THEN filter, then truncate — capping to
  // MAX_RESULTS up front would let ten Arbitrum recipients hide the only Solana
  // one from a caller asking for Solana.
  const summarized = summarizeRecentRecipients(auth.account, rows);
  const filtered = chain ? recentsForChain(summarized, chain) : summarized;
  const recents = filtered.slice(0, MAX_RESULTS);

  return NextResponse.json({ recents, durable: true });
}
