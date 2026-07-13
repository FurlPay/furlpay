import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { fetchMorphoVaults, earnIsLive } from "@/lib/services/morpho";
import { earnSummary } from "@/lib/services/earn";

export const dynamic = "force-dynamic";

const DISCLOSURE =
  "Yields are variable and not guaranteed. Deposits go directly into curated ERC-4626 vaults (Morpho) — a DeFi protocol interaction, not a deposit account or securities offering. Smart-contract and market risk apply. Withdraw anytime.";

// GET /api/earn — FurlPay Earn overview: live Morpho vaults (net APY/TVL), the
// user's positions (valued on-chain in live mode), idle USDC and a summary.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const [vaults, valued] = await Promise.all([fetchMorphoVaults(), earnSummary()]);
  const idleUsdc = auth.account.tokenBalances.find((b) => b.token === "USDC")?.usdValue ?? 0;

  return NextResponse.json({
    live: earnIsLive(),
    vaults,
    positions: valued.positions,
    summary: valued.summary,
    idleUsdc: round(idleUsdc),
    bestApy: vaults.length ? Math.max(...vaults.map((v) => v.netApy)) : 0,
    disclosure: DISCLOSURE,
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
