import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { railsSnapshot } from "@/lib/rails/registry";

export const dynamic = "force-dynamic";

// GET /api/rails — public, agent-discoverable map of every payment rail:
// protocol, chains, fee model, caps, entry endpoints, and live operational
// status (pause + health only; volumes and config stay admin-gated in /api/ops).
//
// The live status comes from the ops store. When that store cannot be read
// (measured on furlpay.com, 6 Oct 2026: Upstash answering 403 "plan limit" to
// every command) this answers a structured, retryable 503 — it does not serve
// the directory with guessed statuses, and it no longer lets the store error
// escape as a bare 500.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "rails", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const { rails, controlsAvailable, reason } = await railsSnapshot();
  if (!controlsAvailable) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "controls_unavailable",
          message: "Rail operational status cannot be read right now. Try again shortly.",
          reason,
        },
      },
      { status: 503, headers: { "Retry-After": "30", "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json(
    { rails, count: rails.length },
    { headers: { "cache-control": "public, max-age=60" } }
  );
}
