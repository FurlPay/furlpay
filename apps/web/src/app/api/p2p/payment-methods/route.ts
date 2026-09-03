import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import {
  listPaymentMethods,
  savePaymentMethod,
  fullPaymentMethod,
  P2P_PAYMENT_METHOD_TYPES,
} from "@/lib/services/p2p";

export const dynamic = "force-dynamic";

const TYPES = P2P_PAYMENT_METHOD_TYPES.map((t) => t.type) as [string, ...string[]];

const SaveMethod = z.object({
  type: z.enum(TYPES),
  label: z.string().trim().min(1).max(60),
  holderName: z.string().trim().min(1).max(120),
  // Account identifiers only — the charset excludes the punctuation an
  // injection payload would need, and the length cap keeps a note out of it.
  account: z.string().trim().min(4).max(64).regex(/^[A-Za-z0-9@.\-_]+$/, "Invalid account identifier"),
  bankCode: z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9]+$/).optional(),
});

// GET /api/p2p/payment-methods — the caller's own rails, unredacted (they are
// the owner). Counterparties see these only through the order detail route.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "p2p.methods.list", { limit: 60, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  return NextResponse.json({ methods: listPaymentMethods(auth.account.user.id).map(fullPaymentMethod) });
}

// POST /api/p2p/payment-methods — add a fiat rail a taker can pay into.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "p2p.methods.save", { limit: 10, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, SaveMethod);
  if (body instanceof NextResponse) return body;

  try {
    const m = savePaymentMethod(auth.account.user.id, {
      type: body.type as (typeof P2P_PAYMENT_METHOD_TYPES)[number]["type"],
      label: body.label,
      holderName: body.holderName,
      account: body.account,
      bankCode: body.bankCode,
    });
    return NextResponse.json({ ok: true, method: fullPaymentMethod(m) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
