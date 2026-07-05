import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { createAlert, deleteAlert, listAlerts } from "@/lib/travel/alerts";

// GET /api/travel/alerts — active price alerts.
export async function GET() {
  return NextResponse.json({ alerts: listAlerts(), source: "demo" });
}

// POST /api/travel/alerts — create a flight/hotel price alert.
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const kind = body?.kind === "hotel" ? "hotel" : "flight";
  const to = String(body?.to ?? "").trim();
  const date = String(body?.date ?? "").trim();
  const targetUsd = Number(body?.targetUsd);
  if (!to || !date || !Number.isFinite(targetUsd) || targetUsd <= 0) {
    return NextResponse.json({ error: "to, date and a positive targetUsd are required" }, { status: 400 });
  }
  const alert = createAlert({
    kind,
    from: typeof body?.from === "string" ? body.from.trim() : undefined,
    to,
    date,
    targetUsd,
    autoBook: Boolean(body?.autoBook),
  });
  return NextResponse.json({ alert }, { status: 201 });
}

// DELETE /api/travel/alerts?id=alrt_… — remove an alert.
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!deleteAlert(id)) return NextResponse.json({ error: "Alert not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
