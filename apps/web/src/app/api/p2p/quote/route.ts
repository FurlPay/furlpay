import { NextRequest, NextResponse } from "next/server";
import { p2pUnavailable } from "@/lib/services/p2pSettlement";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { quoteOrder, P2P_LIMITS } from "@/lib/services/p2p";

export const dynamic = "force-dynamic";

const Quote = z
  .object({
    adId: z.string().min(1).max(64),
    amount: z.number().positive().max(P2P_LIMITS.maxAdAmount).optional(),
    fiatAmount: z.number().positive().max(P2P_LIMITS.maxFiatPerOrder).optional(),
  })
  // Supplying both is ambiguous: the two can disagree, and honouring one
  // silently would quote a price the caller did not ask for.
  .refine((v) => (v.amount === undefined) !== (v.fiatAmount === undefined), {
    message: "Provide exactly one of amount or fiatAmount",
  });

// POST /api/p2p/quote — price a trade against an ad without opening it. Read
// only: no escrow moves and nothing is reserved.
export async function POST(req: NextRequest) {
  const unavailable = p2pUnavailable();
  if (unavailable) return unavailable;

  const limited = await rateLimitOr429(req, "p2p.quote", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, Quote);
  if (body instanceof NextResponse) return body;

  try {
    return NextResponse.json({ ok: true, quote: quoteOrder(body.adId, body) });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 400 });
  }
}
