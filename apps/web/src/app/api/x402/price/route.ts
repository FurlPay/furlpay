import { NextRequest, NextResponse } from "next/server";
import { findResource } from "@/lib/x402Registry";
import { buildRequirements } from "@/lib/x402";

export const dynamic = "force-dynamic";

// GET /api/x402/price?resource=/api/travel/search&method=GET — quote a
// resource without triggering a 402. Returns the same PaymentRequirements
// the protected endpoint would return, so agents can pre-fund and pre-sign.
export function GET(req: NextRequest) {
  const resource = req.nextUrl.searchParams.get("resource");
  if (!resource) return NextResponse.json({ error: "missing_resource_param" }, { status: 400 });
  const method = req.nextUrl.searchParams.get("method") || "GET";

  const entry = findResource(resource, method);
  if (!entry) return NextResponse.json({ error: "resource_not_registered" }, { status: 404 });

  const requirements = buildRequirements({
    resource: entry.resource,
    method: entry.method,
    priceUsd: entry.priceUsd,
    description: entry.description,
  });
  return NextResponse.json({ priceUsd: entry.priceUsd, requirements });
}
