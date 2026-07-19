import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { requireUser } from "@/lib/authz";

// GET /api/investing/lots[?symbol=AAPL] — open tax lots for the acting user.
// The portfolio response links here for per-lot detail (holding period, cost
// basis, provenance). Scoped to the caller — lots are personal tax records.
//
// Read-only, so no body/Zod; requireUser gates it and the middleware baseline
// covers rate limiting for authenticated GETs.
const LONG_TERM_DAYS = 365;

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const symbol = new URL(req.url).searchParams.get("symbol")?.toUpperCase() || null;
  const now = Date.now();
  const lots = (auth.account.tradeLots ?? [])
    .filter((l) => l.status === "open" && (!symbol || l.symbol === symbol))
    .map((l) => {
      const heldDays = Math.floor((now - Date.parse(l.acquiredAt)) / 86_400_000);
      return {
        id: l.id,
        symbol: l.symbol,
        quantity: l.quantity,
        costBasis: l.costBasis,
        acquiredAt: l.acquiredAt,
        heldDays,
        longTerm: heldDays > LONG_TERM_DAYS,
        // Reconstructed lots are NOT tax fact — surface provenance so the client
        // can flag them (see corporateActions/types.ts).
        provenance: l.provenance ?? "execution",
      };
    })
    .sort((a, b) => Date.parse(a.acquiredAt) - Date.parse(b.acquiredAt));

  return NextResponse.json({ symbol, count: lots.length, lots });
}
