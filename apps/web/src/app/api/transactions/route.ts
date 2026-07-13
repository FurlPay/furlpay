import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { requireUser } from "@/lib/authz";

// GET /api/transactions?cardId=...&category=... — the caller's own ledger.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const cardId = req.nextUrl.searchParams.get("cardId");
  const category = req.nextUrl.searchParams.get("category");

  let txs = auth.account.transactions;
  if (cardId) txs = txs.filter((t) => t.cardId === cardId);
  if (category) txs = txs.filter((t) => t.category === category);

  return NextResponse.json({ transactions: txs });
}
