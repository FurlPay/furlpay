import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";

// GET /api/transactions?cardId=...&category=...
export async function GET(req: NextRequest) {
  const cardId = req.nextUrl.searchParams.get("cardId");
  const category = req.nextUrl.searchParams.get("category");

  let txs = db.transactions;
  if (cardId) txs = txs.filter((t) => t.cardId === cardId);
  if (category) txs = txs.filter((t) => t.category === category);

  return NextResponse.json({ transactions: txs });
}
