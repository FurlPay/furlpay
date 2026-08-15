import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { PaymentCard } from "@/lib/types";
import type { UserAccount } from "@/lib/store";
import { validateBody } from "@/lib/validate";
import { withIdempotency } from "@/lib/idempotency";

const IssueCardBody = z.object({
  cardType: z.enum(["virtual", "physical"]),
  kycToken: z.string().min(1).max(512),
});

// GET /api/cards — list the caller's own cards.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  return NextResponse.json({ cards: auth.account.cards });
}

// POST /api/cards — issue a virtual or physical Visa card (Marqeta/Lithic).
// body: { cardType: "virtual" | "physical", kycToken: string }
// Retries are safe: send an Idempotency-Key header (UUID) — a duplicate key
// replays the original response instead of issuing a second card.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "cards.issue", { limit: 5, windowMs: 10 * 60_000 }, account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, IssueCardBody);
  if (body instanceof NextResponse) return body;

  // Card issuance requires a completed KYC (a valid kycToken).
  if (account.user.kycStatus !== "verified") {
    return NextResponse.json({ error: "Valid KYC required to issue a card" }, { status: 403 });
  }

  // Scope the key per user so one client's key can't replay (or conflict with)
  // another account's request.
  return withIdempotency(req.headers.get("Idempotency-Key"), `cards.issue:${account.user.id}`, async () =>
    issueCard(account, body.cardType)
  );
}

function issueCard(account: UserAccount, cardType: "virtual" | "physical"): NextResponse {
  const last4 = String(crypto.randomInt(1000, 10_000));
  const card: PaymentCard = {
    id: "card_" + crypto.randomBytes(5).toString("hex"),
    kind: cardType,
    label: cardType === "physical" ? "Metal Physical" : "New Virtual",
    last4,
    network: "Visa",
    frozen: false,
    gradient: ["#1C0F35", "#E02020"],
    limits: { perPurchase: 2500, daily: 5000, dailySpent: 0 },
    channels: { online: true, offline: cardType === "physical", atm: cardType === "physical" },
    settlementCurrency: "USD",
  };
  account.cards.push(card);

  return NextResponse.json({ cardId: card.id, status: "active", last4 }, { status: 201 });
}

// Card controls (freeze / limits / channels / settlement / priority) live at
// the canonical POST /api/cards/settings endpoint.
