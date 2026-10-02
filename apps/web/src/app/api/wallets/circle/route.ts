import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { audit } from "@/lib/audit";
import {
  CIRCLE_WALLET_CHAINS,
  CircleApiError,
  CircleWalletsNotConfigured,
  availableCircleChains,
  circleEnvironment,
  circleWalletsConfigured,
  createUserSession,
  initializeUserWallets,
  listUserWallets,
  walletBalances,
} from "@/lib/services/circleWallets";

export const dynamic = "force-dynamic";

// /api/wallets/circle — Circle user-controlled (MPC) wallets for the signed-in
// user. Protocol and custody model: lib/services/circleWallets.ts.
//
// GET   the user's Circle wallets with balances (empty until initialized).
// POST  start PIN setup + wallet creation. Returns the challengeId plus the SDK
//       session (appId, userToken, encryptionKey); Circle's SDK on the device
//       completes it. No wallet exists until that challenge is COMPLETE —
//       poll GET /api/wallets/circle/challenge?id=<challengeId>.

const notConfigured = () =>
  NextResponse.json({ error: "not_available", detail: "Circle wallets are not configured on this deployment." }, { status: 503 });

function providerError(e: unknown) {
  if (e instanceof CircleWalletsNotConfigured) return notConfigured();
  if (e instanceof CircleApiError) {
    console.error(`[wallets/circle] Circle ${e.status} code=${e.code}:`, e.message);
    return NextResponse.json({ error: "wallet_provider_error", providerCode: e.code }, { status: e.status === 429 ? 429 : 502 });
  }
  console.error("[wallets/circle] failed:", (e as Error).message);
  return NextResponse.json({ error: "wallet_provider_error" }, { status: 502 });
}

const CreateSchema = z.object({
  blockchains: z.array(z.enum(CIRCLE_WALLET_CHAINS)).min(1).max(5),
  accountType: z.enum(["SCA", "EOA"]).optional(),
});

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "wallets.circle.read", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  if (!circleWalletsConfigured()) return notConfigured();

  try {
    const session = await createUserSession(auth.account.user.id);
    const wallets = await listUserWallets(session.userToken);
    const withBalances = await Promise.all(
      wallets.map(async (w) => ({ ...w, balances: await walletBalances(session.userToken, w.id) }))
    );
    return NextResponse.json(
      { wallets: withBalances, chains: availableCircleChains(), environment: circleEnvironment() },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e) {
    return providerError(e);
  }
}

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "wallets.circle.create", { limit: 5, windowMs: 600_000 });
  if (limited) return limited;
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  if (!circleWalletsConfigured()) return notConfigured();

  const body = await validateBody(req, CreateSchema);
  if (body instanceof NextResponse) return body;
  const allowed = availableCircleChains();
  const wrongNetwork = body.blockchains.filter((c) => !allowed.includes(c));
  if (wrongNetwork.length > 0) {
    return NextResponse.json(
      { error: `Not available with this deployment's Circle key: ${wrongNetwork.join(", ")}`, chains: allowed },
      { status: 400 }
    );
  }

  try {
    const session = await createUserSession(auth.account.user.id);
    const challengeId = await initializeUserWallets(session.userToken, body.blockchains, body.accountType);
    audit("circle.user_initialized", auth.account.user.id, { blockchains: body.blockchains, challengeId });
    return NextResponse.json(
      { challengeId, ...session, status: "challenge_pending" },
      { status: 201, headers: { "cache-control": "no-store" } }
    );
  } catch (e) {
    return providerError(e);
  }
}
