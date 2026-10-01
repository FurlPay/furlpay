import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { appConfig } from "@/lib/appConfig";

// GET /api/app/config — server-driven client configuration (audit P2-11):
// minimum supported app versions, a forced-update flag, and emergency disable
// switches. Public by design (the app reads it before sign-in to decide
// whether it may run at all) and read-only. It authorises nothing: disabling a
// feature here hides it in the client; the server-side gates on the feature's
// own routes are what actually stop it.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "app.config", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  return NextResponse.json(appConfig(), { headers: { "cache-control": "public, max-age=60" } });
}
