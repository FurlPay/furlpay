import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { applyTravelRule } from "@furlpay/compliance";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";

// POST /api/compliance/travel-rule — FATF Travel Rule (Notabene / TRUST).
// body: { amountUsd, originator, beneficiary, provider? }
//
// Public compute endpoint (a VASP checks whether a transfer crosses the Travel
// Rule threshold before it commits). The body previously reached
// applyTravelRule() completely unvalidated — a non-numeric amount or a
// non-object counterparty propagated straight into compliance logic whose
// output is a regulatory determination. Shape it here instead.
// Mirrors TravelRuleInput in @furlpay/compliance: both counterparties need a
// name and an accountId — that pair IS the Travel Rule payload, so accepting a
// partial one would emit an unsendable determination.
const CounterpartySchema = z.object({
  name: z.string().min(1).max(200),
  accountId: z.string().min(1).max(200),
  address: z.string().max(200).optional(),
});

const TravelRuleSchema = z.object({
  amountUsd: z.number().nonnegative().max(1_000_000_000),
  originator: CounterpartySchema,
  beneficiary: CounterpartySchema,
  provider: z.enum(["notabene", "trust"]).optional(),
});

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "compliance.travel-rule", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, TravelRuleSchema);
  if (body instanceof Response) return body as never;

  const payload = applyTravelRule(body);
  return NextResponse.json({ payload });
}
