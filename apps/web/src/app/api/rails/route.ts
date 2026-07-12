import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { railsSnapshot } from "@/lib/rails/registry";

export const dynamic = "force-dynamic";

// GET /api/rails — public, agent-discoverable map of every payment rail:
// protocol, chains, fee model, caps, entry endpoints, and live operational
// status (pause + health only; volumes and config stay admin-gated in /api/ops).
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "rails", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const rails = await railsSnapshot();
  return NextResponse.json(
    { rails, count: rails.length },
    { headers: { "cache-control": "public, max-age=60" } }
  );
}
