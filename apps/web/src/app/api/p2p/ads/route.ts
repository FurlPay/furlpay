import { NextRequest, NextResponse } from "next/server";
import { p2pUnavailable } from "@/lib/services/p2pSettlement";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { createAd, listAds, publicAd, P2P_LIMITS, P2P_PAYMENT_METHOD_TYPES } from "@/lib/services/p2p";
import type { AdFilter, P2PPaymentMethodType, P2PSide } from "@/lib/services/p2p";

export const dynamic = "force-dynamic";

const TYPES = P2P_PAYMENT_METHOD_TYPES.map((t) => t.type) as [string, ...string[]];

// Closed sets, not free strings: an ad naming an asset the escrow cannot hold
// (or a fiat nothing prices) is an order waiting to strand someone's funds.
const ASSETS = ["USDT", "USDC", "ETH", "SOL"] as const;
const FIATS = ["INR", "EUR", "GBP", "USD", "SGD", "AED"] as const;

const CreateAd = z.object({
  side: z.enum(["buy", "sell"]),
  asset: z.enum(ASSETS),
  fiat: z.enum(FIATS),
  price: z.number().positive().max(P2P_LIMITS.maxPrice),
  totalAmount: z.number().positive().max(P2P_LIMITS.maxAdAmount),
  minFiat: z.number().positive().max(P2P_LIMITS.maxFiatPerOrder),
  maxFiat: z.number().positive().max(P2P_LIMITS.maxFiatPerOrder),
  paymentMethodIds: z.array(z.string().min(1).max(64)).min(1).max(10),
  terms: z.string().trim().max(500).optional(),
  paymentWindowMins: z
    .number()
    .int()
    .min(P2P_LIMITS.minPaymentWindowMins)
    .max(P2P_LIMITS.maxPaymentWindowMins)
    .optional(),
});

// GET /api/p2p/ads — browse the order book. Public (a taker compares prices
// before signing up), so it gets its own rate-limit budget and returns only the
// redacted ad shape: maker badge yes, account numbers never.
export async function GET(req: NextRequest) {
  const unavailable = p2pUnavailable();
  if (unavailable) return unavailable;

  const limited = await rateLimitOr429(req, "p2p.ads.list", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const q = req.nextUrl.searchParams;
  const fiatAmountRaw = q.get("fiatAmount");
  const fiatAmount = fiatAmountRaw === null ? undefined : Number(fiatAmountRaw);
  if (fiatAmount !== undefined && (!Number.isFinite(fiatAmount) || fiatAmount <= 0)) {
    return NextResponse.json({ error: "invalid_fiatAmount" }, { status: 400 });
  }

  const side = q.get("side");
  const methodType = q.get("paymentMethodType");
  const filter: AdFilter = {
    side: side === "buy" || side === "sell" ? (side as P2PSide) : undefined,
    asset: q.get("asset") ?? undefined,
    fiat: q.get("fiat") ?? undefined,
    fiatAmount,
    paymentMethodType: methodType && TYPES.includes(methodType) ? (methodType as P2PPaymentMethodType) : undefined,
  };

  const ads = listAds(filter).slice(0, 100).map(publicAd);
  return NextResponse.json({ ads, count: ads.length });
}

// POST /api/p2p/ads — post an offer. The service checks every cited payment
// method belongs to the caller, so an ad can never point buyers at a stranger's
// bank account.
export async function POST(req: NextRequest) {
  const unavailable = p2pUnavailable();
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "p2p.ads.create", { limit: 20, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, CreateAd);
  if (body instanceof NextResponse) return body;

  try {
    const ad = createAd(auth.account.user.id, body);
    return NextResponse.json({ ok: true, ad: publicAd(ad) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
