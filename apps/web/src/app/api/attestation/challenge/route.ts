import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { issueChallenge } from "@/lib/attestation";

// POST /api/attestation/challenge — a single-use, 5-minute nonce the mobile app
// binds into its Play Integrity / App Attest token for ONE money action
// (lib/attestation, audit P1-9). Bound to the session user and the purpose, so
// a token minted for a wallet link cannot authorise a transfer.
export const dynamic = "force-dynamic";

const Body = z.object({ purpose: z.enum(["transfer.gasless", "wallet.link"]) }).strict();

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "attestation.challenge", { limit: 30, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;
  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;
  return NextResponse.json(await issueChallenge(auth.account.user.id, body.purpose));
}
