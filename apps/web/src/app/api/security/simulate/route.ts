import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { screenTransaction, type TxRequest } from "@furlpay/security";

export const dynamic = "force-dynamic";

// POST /api/security/simulate — pre-sign transaction screening. Simulates the
// effect of an outgoing transfer/approval and runs the ML scam classifier,
// returning an allow/warn/block gate the client enforces BEFORE signing.
// Body: TxRequest ({ from, to, valueUsd, approvalAmount?, recipientAgeDays?, ... }).
//
// ADVISORY ONLY: the signals are asserted by the caller about its own
// transaction, and nothing server-side trusts this verdict to move money.
// The body is still validated (AGENTS rule 1) rather than coerced: a non-numeric
// valueUsd used to become NaN and reach the classifier.
const Body = z.object({
  from: z.string().max(128).optional(),
  to: z.string().min(1).max(128),
  valueUsd: z.number().nonnegative().max(1e12).optional(),
  // Token units; "unlimited" approvals arrive as very large numbers (2^256-1).
  approvalAmount: z.number().nonnegative().optional(),
  token: z.string().max(32).optional(),
  recipientAgeDays: z.number().nonnegative().max(1e6).optional(),
  lookalikeOfKnown: z.boolean().optional(),
  flaggedRecipient: z.boolean().optional(),
  firstInteraction: z.boolean().optional(),
  knownGoodContract: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "security.simulate", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const b = await validateBody(req, Body, { maxBytes: 4 * 1024 });
  if (b instanceof NextResponse) return b;
  const tx: TxRequest = { ...b, from: b.from ?? "", valueUsd: b.valueUsd ?? 0 };
  return NextResponse.json(screenTransaction(tx));
}
