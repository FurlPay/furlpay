import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { withIdempotency } from "@/lib/idempotency";
import { createPacket, listPacketsSent, packetView, GIFTING_LIMITS } from "@/lib/services/gifting";
import { debitAsset, InsufficientFunds, p2pSettlementUnavailable } from "@/lib/services/p2pSettlement";
import { newTx, recordTransaction } from "@/lib/store";

export const dynamic = "force-dynamic";

const CreatePacket = z.object({
  token: z.enum(["USDC", "USDT"]),
  totalAmount: z.number().positive().min(GIFTING_LIMITS.minPacketAmount).max(GIFTING_LIMITS.maxPacketAmount),
  slots: z.number().int().min(GIFTING_LIMITS.minSlots).max(GIFTING_LIMITS.maxSlots),
  split: z.enum(["equal", "random"]),
  message: z.string().trim().max(GIFTING_LIMITS.maxMessageLength).optional(),
});

// GET /api/gifts/packets — packets the caller has sent, with how much of each
// has been taken.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "gifts.packets.list", { limit: 60, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const packets = listPacketsSent(userId).slice(0, 100).map((p) => packetView(p, userId));
  return NextResponse.json({ packets, count: packets.length });
}

// POST /api/gifts/packets — fund and open a red packet.
//
// The whole amount is debited now: a packet that can be claimed but is not
// funded is the one failure this design exists to prevent. Idempotent per user
// so a retry cannot fund two packets.
export async function POST(req: NextRequest) {
  const unavailable = p2pSettlementUnavailable();
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "gifts.packets.create", { limit: 15, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const body = await validateBody(req, CreatePacket);
  if (body instanceof NextResponse) return body;

  const idempotencyKey = req.headers.get("Idempotency-Key");
  return withIdempotency(idempotencyKey, "gifts.packets.create", async () => {
    let created;
    try {
      created = createPacket(userId, body);
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
    }

    try {
      debitAsset(userId, created.escrow.token, created.escrow.amount);
    } catch (e) {
      const status = e instanceof InsufficientFunds ? 409 : 500;
      return NextResponse.json({ ok: false, error: "insufficient_balance" }, { status });
    }

    recordTransaction(
      userId,
      newTx({
        category: "transfer",
        direction: "out",
        title: "Red packet sent",
        subtitle: `${created.packet.slots} slot${created.packet.slots === 1 ? "" : "s"} · ${created.packet.split}`,
        amountUsd: created.packet.totalAmount,
        token: created.packet.token,
        chain: "arbitrum",
        status: "escrow",
      }),
    );

    return NextResponse.json(
      { ok: true, packet: packetView(created.packet, userId), code: created.packet.code },
      { status: 201 },
    );
  }, { principal: userId, request: body });
}
