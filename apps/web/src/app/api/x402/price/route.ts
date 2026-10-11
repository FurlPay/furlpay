import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { findResource } from "@/lib/x402Registry";
import { acceptedRequirements } from "@/lib/x402";
import { quoteSecretConfigured, x402NotConfigured } from "@/lib/x402QuoteSecret";

export const dynamic = "force-dynamic";

// GET /api/x402/price?resource=/api/travel/search&method=GET — quote a
// resource without triggering a 402. Returns the same PaymentRequirements
// the protected endpoint would return, so agents can pre-fund and pre-sign.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "x402.price", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const resource = req.nextUrl.searchParams.get("resource");
  if (!resource) return NextResponse.json({ error: "missing_resource_param" }, { status: 400 });
  const method = req.nextUrl.searchParams.get("method") || "GET";

  // Each requirement carries an HMAC binding keyed with X402_QUOTE_SECRET.
  // Without it, production would throw inside acceptedRequirements and answer
  // 500; answer the same structured 503 the quote routes give instead.
  if (!quoteSecretConfigured()) return x402NotConfigured();

  const entry = findResource(resource, method);
  if (!entry) return NextResponse.json({ error: "resource_not_registered" }, { status: 404 });

  const accepts = acceptedRequirements({
    resource: entry.resource,
    method: entry.method,
    priceUsd: entry.priceUsd,
    description: entry.description,
  });
  // `requirements` (first entry, USDC) kept for pre-existing agent clients.
  return NextResponse.json({ priceUsd: entry.priceUsd, requirements: accepts[0], accepts });
}
