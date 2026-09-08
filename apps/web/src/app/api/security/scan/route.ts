import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { scanCalldata, simulationProviderStatus } from "@/lib/security/calldataScan";

export const dynamic = "force-dynamic";

// POST /api/security/scan — calldata-level pre-signature scanning.
//
// SIBLING OF /api/security/simulate, NOT A REPLACEMENT. That route screens a
// transaction from ECONOMIC signals (USD value, recipient age, scam lists) and
// is what the send flow calls. This one decodes the actual calldata — which
// function, which spender, whether the approval is unlimited — for transactions
// arriving from a connected dApp over WalletConnect, where the app never had a
// priced intent to screen in the first place. Both feed the same
// `screenTransaction` gate so there is still one verdict, not two.
//
// AUTHENTICATED even though it moves no money: the body is a transaction the
// caller is about to sign, and an open endpoint would be a free oracle for
// scoring other people's transactions.

const ScanSchema = z.object({
  chainId: z.number().int().positive().max(2_147_483_647),
  from: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  // Decimal string of wei, not a number: 1 ETH is 10^18 and JSON has only
  // doubles. 78 digits is uint256's decimal width.
  value: z.string().regex(/^\d{1,78}$/),
  // Capped well below validateBody's 100KB body limit. Real calldata is a few
  // hundred bytes; a multi-megabyte `data` is either a bug or an attempt to
  // burn CPU in the decoder.
  data: z.string().regex(/^0x[0-9a-fA-F]*$/).max(64_000),
  origin: z.string().trim().max(512).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  // Per-user, and tight: when a vendor simulator is configured each call is
  // billed, and a client looping on a confirmation screen must not run up the
  // bill. 30/min is far above what a human signing transactions can produce.
  const limited = await rateLimitOr429(req, "security.scan", { limit: 30, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, ScanSchema);
  if (body instanceof NextResponse) return body;

  const result = await scanCalldata(body);

  // The local decode always produces a real verdict, so this returns 200 even
  // with no vendor configured — but it says so, and the client renders "deep
  // check did not run" beside its own analysis. A fabricated "safe" would be
  // the single most dangerous response in this codebase: the user reads the
  // word about a transaction that nothing simulated.
  const status = simulationProviderStatus();
  return NextResponse.json({
    ...result,
    deepScanConfigured: status.configured,
    ...(status.configured ? {} : { reason: "provider_unconfigured" }),
  });
}
