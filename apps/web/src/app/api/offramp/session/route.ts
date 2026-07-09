import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { coinbaseOfframpUrl, coinbaseRampBackend, isCoinbaseRampChain } from "@/lib/services/coinbaseRamp";

export const dynamic = "force-dynamic";

// POST /api/offramp/session — mint a Coinbase-hosted SELL (crypto → bank/card/
// PayPal) checkout URL. Offramp has no headless demo equivalent: cashing out
// requires a licensed provider, so without CDP credentials this returns 503.
// Coinbase charges 0% provider fees on USDC offramps.

const OfframpSchema = z.object({
  address: z
    .string()
    .regex(/^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/, "valid wallet address required"),
  chain: z.string().min(1).max(32),
  token: z.string().min(1).max(16).optional(),
  // Money amount: positive with a sane upper bound (per security rules).
  cryptoAmount: z.number().positive().max(1_000_000).optional(),
  redirectUrl: z.string().url().startsWith("https://").max(500).optional(),
});

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "offramp.session", { limit: 10, windowMs: 600_000 });
  if (limited) return limited;

  const body = await validateBody(req, OfframpSchema);
  if (body instanceof NextResponse) return body;

  if (coinbaseRampBackend === "none") {
    return NextResponse.json(
      { error: "Offramp provider not configured", mock: true },
      { status: 503 }
    );
  }
  if (!isCoinbaseRampChain(body.chain)) {
    return NextResponse.json({ error: `chain not supported for offramp: ${body.chain}` }, { status: 400 });
  }

  try {
    const hosted = await coinbaseOfframpUrl({
      address: body.address,
      chain: body.chain,
      asset: body.token ?? "USDC",
      cryptoAmount: body.cryptoAmount,
      redirectUrl: body.redirectUrl,
    });
    return NextResponse.json({ hosted }, { status: 201 });
  } catch (e) {
    console.error("[offramp] coinbase hosted url failed:", (e as Error).message);
    return NextResponse.json({ error: "Offramp session creation failed" }, { status: 502 });
  }
}
