import { NextRequest, NextResponse } from "next/server";
import { p2pUnavailable } from "@/lib/services/p2pSettlement";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { openAppeal, addAppealEvidence, cancelAppeal, P2P_APPEAL_REASONS } from "@/lib/services/p2p";
import { orderView } from "@/lib/services/p2pView";

export const dynamic = "force-dynamic";

const OpenAppeal = z.object({
  reason: z.enum(P2P_APPEAL_REASONS),
  detail: z.string().trim().min(1).max(1000),
});

const AddEvidence = z.object({
  // Evidence is a link to an already-uploaded artefact. https only: an
  // attacker-supplied javascript: or data: URL would become a stored XSS the
  // moment an operator clicked it in the dispute console.
  url: z
    .string()
    .trim()
    .max(2000)
    .url()
    .refine((u) => u.startsWith("https://"), "Evidence URL must be https"),
  note: z.string().trim().max(300).optional(),
});

// POST /api/p2p/orders/:id/appeal — open a dispute, or add evidence to the one
// already open. Opening freezes the escrow: neither side can move it until an
// operator resolves the appeal.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const unavailable = p2pUnavailable();
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "p2p.orders.appeal", { limit: 15, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const { id } = await props.params;
  const mode = req.nextUrl.searchParams.get("action") === "evidence" ? "evidence" : "open";

  try {
    if (mode === "evidence") {
      const body = await validateBody(req, AddEvidence);
      if (body instanceof NextResponse) return body;
      const order = addAppealEvidence(id, userId, body);
      return NextResponse.json({ ok: true, order: orderView(order, userId) });
    }

    const body = await validateBody(req, OpenAppeal);
    if (body instanceof NextResponse) return body;
    const order = openAppeal(id, userId, body);
    return NextResponse.json({ ok: true, order: orderView(order, userId) }, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 409 });
  }
}

// DELETE /api/p2p/orders/:id/appeal — withdraw an appeal you opened. The order
// returns to whichever state it was in, and the escrow unfreezes.
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const unavailable = p2pUnavailable();
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "p2p.orders.appeal.cancel", { limit: 15, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const { id } = await props.params;
  try {
    return NextResponse.json({ ok: true, order: orderView(cancelAppeal(id, userId), userId) });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 409 });
  }
}
