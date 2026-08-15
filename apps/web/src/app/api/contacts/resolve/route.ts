import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { resolveName } from "@/lib/nameResolution";
import { CHAINS, findContactByAddress, isContactChain } from "@/lib/contacts";

export const dynamic = "force-dynamic";

// GET /api/contacts/resolve?name=vitalik.eth[&chain=base]
//
// Turns whatever the user typed into the "To" field into a payable address:
// a raw address, an ENS name, or a FurlPay name. When `chain` is supplied the
// answer also says whether the result is payable THERE — an ENS name resolves
// to an EVM address, which is worthless if the user is sending on Solana, and
// finding that out at submit is the failure contacts exist to prevent.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  // Tighter than the other contact reads: this one fans out to an external RPC
  // and to the handle store, so it is the endpoint worth abusing.
  const limited = await rateLimitOr429(
    req,
    "contacts.resolve",
    { limit: 20, windowMs: 60_000 },
    auth.account.user.id
  );
  if (limited) return limited;

  const name = req.nextUrl.searchParams.get("name")?.trim() ?? "";
  if (!name || name.length > 255) {
    return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  }

  const chain = req.nextUrl.searchParams.get("chain");
  if (chain !== null && !isContactChain(chain)) {
    return NextResponse.json({ error: "invalid_chain", supported: CHAINS }, { status: 400 });
  }

  const outcome = await resolveName(name);

  switch (outcome.status) {
    case "invalid":
      return NextResponse.json({ error: "invalid_name", message: outcome.reason }, { status: 400 });

    case "unresolved":
      return NextResponse.json({ resolved: false, kind: outcome.kind }, { status: 404 });

    // 503, not 404. The lookup failed; we do not know that the name is
    // unregistered, and saying so would be fabricating a result.
    case "unavailable":
      return NextResponse.json(
        {
          error: "resolver_unavailable",
          kind: outcome.kind,
          message: "We could not check that name right now. Please try again.",
        },
        { status: 503 }
      );

    case "resolved": {
      const { result } = outcome;
      const wanted = chain;
      const payableOnChain = wanted
        ? result.family === (wanted === "solana" ? "solana" : "evm")
        : true;

      // If they already have this address saved, say whose it is — a name the
      // user chose themselves is stronger confirmation than any resolver.
      const known = wanted && payableOnChain
        ? findContactByAddress(auth.account, result.address, wanted)
        : undefined;

      return NextResponse.json({
        resolved: true,
        kind: result.kind,
        address: result.address,
        family: result.family,
        display: result.display,
        payableOnChain,
        ...(known ? { contact: { id: known.id, name: known.name, avatarColor: known.avatarColor } } : {}),
      });
    }
  }
}
