import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { decodeCursor, matchesType, page, TX_TYPES } from "@/lib/settlement/overview";
import type { Activity } from "@/lib/settlement/model";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

const query = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
    cursor: z.string().max(400).optional(),
    q: z.string().trim().max(120).optional(),
    type: z.enum(TX_TYPES).default("all"),
    status: z.enum(["any", "settled", "pending", "escrow", "declined"]).default("any"),
  })
  .strict();

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
  const { limit, cursor, q, type, status } = parsed.data;
  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) return NextResponse.json({ error: "Invalid cursor" }, { status: 400, headers });

  const needle = q?.toLowerCase();
  const rows = auth.account.transactions.filter((t) => {
    if (!matchesType(t, type)) return false;
    if (status !== "any" && t.status !== status) return false;
    if (!needle) return true;
    return [t.id, t.title, t.subtitle, t.token, t.chain].some((v) => typeof v === "string" && v.toLowerCase().includes(needle));
  });
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
