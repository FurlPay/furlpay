import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { decodeCursor, page } from "@/lib/settlement/overview";
import { filterTransactions, transactionQuery } from "@/lib/settlement/search";
import type { Activity } from "@/lib/settlement/model";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

const query = transactionQuery;

// GET /api/settlement/transactions — the signed-in account's ledger, filtered,
// searched and paginated on the server so the browser never holds the full
// history. Read-only; scoped to the session's own account.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "settlement.transactions", { limit: 120, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid query" }, { status: 400, headers });
  const { limit, cursor } = parsed.data;
  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) return NextResponse.json({ error: "Invalid cursor" }, { status: 400, headers });

  const rows = filterTransactions(auth.account.transactions, parsed.data);
  const result = page(rows, decoded, limit);
  const items: Activity[] = result.items.map((row) => ({
    id: row.id,
    name: row.title,
    detail: row.subtitle || undefined,
    type: row.category,
    direction: row.direction,
    amountUsd: row.amountUsd,
    asset: row.token ?? "USD",
    network: row.chain ?? "account",
    status: row.status,
    timestamp: row.timestamp,
  }));
  return NextResponse.json({ items, nextCursor: result.nextCursor, total: result.total }, { headers });
}
