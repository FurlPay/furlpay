import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { jurisdictionPolicy } from "@furlpay/compliance";
import { Stablecoin } from "@furlpay/types";
import { db } from "@/lib/store";

// GET /api/compliance/jurisdiction?country=DE&token=USDT
// Resolves the governing regime (KYC region > country > geo-IP) and returns the
// full per-region policy: stablecoin routing, promotions, and settlement rail.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "compliance.jurisdiction", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const p = req.nextUrl.searchParams;
  const country = p.get("country") || undefined;
  const token = (p.get("token") as Stablecoin) || undefined;

  // Geo-IP country would come from the edge (e.g. request headers); fall back to
  // the header set by many CDNs, else none.
  const ipCountry = req.headers.get("x-vercel-ip-country") || req.headers.get("cf-ipcountry") || undefined;

  const policy = jurisdictionPolicy(
    { kycRegion: db.user.region, country, ipCountry: ipCountry || undefined },
    token
  );
  return NextResponse.json({ policy });
}
