import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { z } from "zod";
import crypto from "crypto";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { requireUser } from "@/lib/authz";
import { cardIssuerOr503 } from "@/lib/cardIssuer";
import { MCC } from "@/lib/travel/data";

// POST /api/travel/cards/create — generate a single-use travel VCN funded from
// the user's stablecoin balance, MCC-locked to travel merchants.
//
// Card issuance is a sensitive, mutating action, so per AGENTS.md this route:
//   • validates its body with Zod, money-bounded (rule 1)
//   • rate-limits (public → rule 2)
//   • uses crypto RNG for card identifiers, never Math.random (rule 6)
// The card itself stays a simulation (`simulated: true`) until the Marqeta
// issuing rail is wired — the PAN is not a usable card number.
//
// GATED. This route used to be the one card route that skipped
// cardIssuerOr503 — and requireUser — so in production an anonymous caller got
// `status: "active"`, `network: "Visa"`, "funded from USDC balance" for a card
// no issuer had issued. It now takes the same gate as every route under
// api/cards: 503 in production until CARD_ISSUING_LIVE can be on.

const MAX_CARD_USD = 25_000;

const Body = z
  .object({
    limitUsd: z.coerce.number().positive().max(MAX_CARD_USD),
    mcc: z.array(z.string().max(8)).max(20).optional(),
  })
  .strip();

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const gated = cardIssuerOr503("Travel virtual card");
  if (gated) return gated;

  const limited = await rateLimitOr429(req, "travel.cards.create", { limit: 10, windowMs: 600_000 }, auth.account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;

  const mcc = body.mcc?.length ? body.mcc : [MCC.LODGING, MCC.AIRLINES];
  // Non-guessable identifiers. last4 is display-only; a real PAN comes from the
  // issuer, but even the simulated one must not be predictable across users.
  const last4 = String(crypto.randomInt(0, 10_000)).padStart(4, "0");
  const expiry = new Date(Date.now() + 30 * 86_400_000);

  return NextResponse.json({
    card: {
      id: "vcn_" + crypto.randomUUID(),
      network: "Visa",
      maskedNumber: `4••• •••• •••• ${last4}`,
      last4,
      expires: `${String(expiry.getMonth() + 1).padStart(2, "0")}/${String(expiry.getFullYear()).slice(2)}`,
      limitUsd: body.limitUsd,
      singleUse: true,
      mccLocks: mcc,
      fundedFrom: "USDC balance",
      status: "active",
      simulated: true,
    },
  });
}
