import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { optionalUser } from "@/lib/authz";
import { jurisdictionPolicy } from "@furlpay/compliance";
import { Stablecoin } from "@furlpay/types";

// GET /api/compliance/jurisdiction?country=DE&token=USDT
// Resolves the governing regime (KYC region > country > geo-IP) and returns the
// full per-region policy: stablecoin routing, promotions, and settlement rail.
//
// The KYC region is the CALLER's, and only when there is a caller. This used to
// pass the seeded demo account's region ("EEA") for every request — and KYC
// region outranks country, so `?country=US` from anyone came back under MiCA.
// Anonymous callers (this is a public developer API) now resolve on country and
// geo-IP alone; a presented-but-invalid credential is rejected, not downgraded.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "compliance.jurisdiction", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const auth = await optionalUser(req);
  if (auth.kind === "rejected") return auth.res;
  const kycRegion = auth.kind === "user" ? auth.account.user.region : undefined;

  const p = req.nextUrl.searchParams;
  const country = p.get("country") || undefined;
  const token = (p.get("token") as Stablecoin) || undefined;

  // Geo-IP country would come from the edge (e.g. request headers); fall back to
  // the header set by many CDNs, else none.
  const ipCountry = req.headers.get("x-vercel-ip-country") || req.headers.get("cf-ipcountry") || undefined;

  const policy = jurisdictionPolicy({ kycRegion, country, ipCountry: ipCountry || undefined }, token);
  return NextResponse.json({ policy });
}
