import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { listRecords } from "@/lib/settlement/repository";
import { draftHit, filterTransactions, transactionQuery, type SearchHit } from "@/lib/settlement/search";
import { page } from "@/lib/settlement/overview";
export const dynamic = "force-dynamic";
const query = z.object({ q: z.string().trim().min(2).max(120) }).strict();
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const headers = { "Cache-Control": "no-store" };
  const limited = await rateLimitOr429(req, "settlement.search", { limit: 90, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Enter 2–120 characters." }, { status: 400, headers });
  const transactions = page(filterTransactions(auth.account.transactions, transactionQuery.parse(parsed.data)), null, 8);
  const items: SearchHit[] = transactions.items.map((t) => ({ id: t.id, name: t.title, group: "Transactions", detail: `${t.category} · ${t.status} · ${t.subtitle ?? ""}`, href: `?tx=${encodeURIComponent(t.id)}` }));
  const warnings: string[] = [];
  try { items.push(...(await listRecords(auth.account.user.id, parsed.data.q)).slice(0, 12).map(draftHit)); }
  catch { warnings.push("Draft search is unavailable. Transaction results are still shown."); }
  return NextResponse.json({ items, warnings }, { headers });
}
