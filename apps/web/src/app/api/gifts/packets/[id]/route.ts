import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { getPacket, packetView } from "@/lib/services/gifting";

export const dynamic = "force-dynamic";

// GET /api/gifts/packets/:id — one packet, as the sender or as someone who
// already claimed from it. Anyone else gets 404: the id must not become a way
// to discover a packet you were never sent.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "gifts.packets.get", { limit: 60, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const { id } = await props.params;
  const packet = getPacket(id);
  const involved = packet && (packet.senderId === userId || packet.claims.some((c) => c.userId === userId));
  if (!packet || !involved) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ packet: packetView(packet, userId) });
}
