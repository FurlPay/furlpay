import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { listRecentDeposits } from "@/lib/services/deposits";

// GET /api/deposits — the session user's recent on-chain deposit events, in
// state-machine order (pending → processing → success). Polled by the web
// DepositToast and the extension service worker.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  return NextResponse.json({ deposits: listRecentDeposits(10) });
}
