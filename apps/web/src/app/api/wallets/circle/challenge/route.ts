import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import {
  CircleApiError,
  CircleWalletsNotConfigured,
  circleWalletsConfigured,
  createUserSession,
  getChallenge,
} from "@/lib/services/circleWallets";

export const dynamic = "force-dynamic";

// GET /api/wallets/circle/challenge?id=<uuid> — the real status of a Circle
// challenge (PENDING / IN_PROGRESS / COMPLETE / FAILED / EXPIRED), read from
// Circle with THIS user's token. A challenge id belonging to someone else
// resolves to Circle's 404 under this user's token → 404 here. An earlier draft
// answered "pending" for any id without asking Circle.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "wallets.circle.challenge", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  if (!circleWalletsConfigured()) {
    return NextResponse.json({ error: "not_available", detail: "Circle wallets are not configured on this deployment." }, { status: 503 });
  }

  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "invalid_challenge_id" }, { status: 400 });

  try {
    const session = await createUserSession(auth.account.user.id);
    const challenge = await getChallenge(session.userToken, id);
    if (!challenge) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ challenge }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof CircleWalletsNotConfigured) {
      return NextResponse.json({ error: "not_available" }, { status: 503 });
    }
    if (e instanceof CircleApiError) {
      console.error(`[wallets/circle/challenge] Circle ${e.status} code=${e.code}:`, e.message);
      return NextResponse.json({ error: "wallet_provider_error", providerCode: e.code }, { status: 502 });
    }
    console.error("[wallets/circle/challenge] failed:", (e as Error).message);
    return NextResponse.json({ error: "wallet_provider_error" }, { status: 502 });
  }
}
