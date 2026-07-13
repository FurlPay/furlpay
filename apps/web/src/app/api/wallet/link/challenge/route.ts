import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { linkingEnabled, mintChallenge } from "@/lib/walletLink";
import { audit } from "@/lib/audit";

// POST /api/wallet/link/challenge — mint a single-use challenge the device must
// sign to prove control of `address`. Server generates the challenge; the
// client never invents its own. Gated behind FURLPAY_SELF_CUSTODY_STAGE >= 1.
export const dynamic = "force-dynamic";

const Body = z.object({ address: z.string().min(42).max(42) });

export async function POST(req: NextRequest) {
  if (!linkingEnabled()) return NextResponse.json({ error: "not_enabled" }, { status: 404 });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  // Guests are the shared demo identity — never let them link a real wallet.
  if (auth.claims.guest) return NextResponse.json({ error: "guest_forbidden" }, { status: 403 });

  const limited = await rateLimitOr429(req, "wallet.link.challenge", { limit: 10, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;

  const challenge = await mintChallenge(auth.account.user.id, body.address);
  if ("error" in challenge) return NextResponse.json({ error: challenge.error }, { status: challenge.status });

  audit("wallet.link_challenge_issued", auth.account.user.id, { address: challenge.address, nonce: challenge.nonce });
  // Return only the message + window. The nonce lives inside the message.
  return NextResponse.json(
    { message: challenge.message, expiresAt: challenge.expiresAt, purpose: "wallet-link" },
    { headers: { "cache-control": "no-store" } }
  );
}
