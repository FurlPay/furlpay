import { NextRequest, NextResponse } from "next/server";
import { getChain, getTransaction } from "@/lib/services/chainRegistry";

export const dynamic = "force-dynamic";

// GET /api/chain/tx/:hash?chain=arbitrum — look up a transaction on a
// supported chain. Defaults to Arbitrum One (the settlement rail).
export async function GET(req: NextRequest, { params }: { params: { hash: string } }) {
  const hash = params.hash;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return NextResponse.json({ error: "invalid_tx_hash" }, { status: 400 });
  }
  const chain = getChain(req.nextUrl.searchParams.get("chain") || "arbitrum");
  if (!chain) return NextResponse.json({ error: "unsupported_chain" }, { status: 400 });

  const result = await getTransaction(chain, hash);
  return NextResponse.json({ chain: chain.id, ...result });
}
