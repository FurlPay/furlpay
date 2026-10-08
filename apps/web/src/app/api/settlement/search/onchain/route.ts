import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { searchInput, searchNetwork } from "@/lib/onchain/network-search";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const headers = { "Cache-Control": "no-store" };
  const limited = await rateLimitOr429(req, "settlement.search.onchain", { limit: 20, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;
  const parsed = searchInput.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid address or transaction hash for this network." }, { status: 400, headers });
  try { return NextResponse.json(await searchNetwork(parsed.data), { headers }); }
  catch { return NextResponse.json({ error: "The network could not be read. Try again shortly." }, { status: 503, headers }); }
}
