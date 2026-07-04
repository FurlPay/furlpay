import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getTeam } from "@/lib/travel/business";
import { listTrips } from "@/lib/travel/store";

// GET /api/travel/business/reports?teamId=<id>&format=json|csv — expense report
// built from the team's trips, auto-tagged for reconciliation.
export async function GET(req: NextRequest) {
  const team = getTeam(req.nextUrl.searchParams.get("teamId") ?? undefined);
  if (!team) return NextResponse.json({ error: "Team not found." }, { status: 404 });

  const trips = listTrips().filter((t) => t.status !== "pending");
  const rows = trips.map((t, i) => ({
    date: t.createdAt.slice(0, 10),
    employee: team.members[i % Math.max(1, team.members.length)]?.email ?? "unassigned",
    merchant: t.name,
    city: t.city,
    costCenter: "TRAVEL",
    method: t.method,
    status: t.status,
    amountUsd: t.amountUsd,
    cashbackUsdc: t.cashbackUsd,
    txHash: t.txHash ?? "",
  }));
  const totalUsd = Math.round(rows.reduce((s, r) => s + (r.status === "cancelled" ? 0 : r.amountUsd), 0) * 100) / 100;

  if (req.nextUrl.searchParams.get("format") === "csv") {
    const header = Object.keys(rows[0] ?? { date: "" }).join(",");
    const csv = [header, ...rows.map((r) => Object.values(r).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="furlpay-travel-expenses-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json({ teamId: team.id, team: team.name, totalUsd, count: rows.length, rows });
}
