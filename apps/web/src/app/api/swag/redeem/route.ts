import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { parse } from "@/lib/schemas";
import { getSwag } from "@/lib/swag";
import { sendEmail } from "@/lib/email";
import { rateLimitOr429 } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Public — the swag store checkout records a points REDEMPTION request that the
// team verifies and fulfils via print-on-demand. No payment is taken on-site.
// The request (items + email + shipping address) is emailed to hello@furlpay.com.
const LineSchema = z.object({
  slug: z.string().trim().min(1).max(60),
  qty: z.number().int().positive().max(10),
  size: z.string().trim().max(8).optional(),
});

const RedeemSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  wallet: z.string().trim().max(80).optional(),
  address: z.object({
    line1: z.string().trim().min(3).max(160),
    city: z.string().trim().min(1).max(80),
    postal: z.string().trim().min(1).max(20),
    country: z.string().trim().min(2).max(60),
  }),
  items: z.array(LineSchema).min(1).max(20),
});

interface Order {
  id: string;
  at: string;
  email: string;
  items: { slug: string; qty: number; size?: string }[];
  totalPoints: number;
}
const g = globalThis as unknown as { __swagOrders?: Order[] };
const orders = g.__swagOrders ?? (g.__swagOrders = []);

const SWAG_INBOX = process.env.SWAG_INBOX || "hello@furlpay.com";

export async function POST(req: NextRequest) {
  // Public form that sends an email per submission — throttle spam.
  const limited = await rateLimitOr429(req, "swag.redeem", { limit: 5, windowMs: 60_000 });
  if (limited) return limited;

  const parsed = parse(RedeemSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  // Resolve items against the catalog — reject unknown slugs, total the points.
  const lines: { name: string; qty: number; size?: string; points: number }[] = [];
  for (const it of d.items) {
    const item = getSwag(it.slug);
    if (!item) return NextResponse.json({ ok: false, error: `unknown_item:${it.slug}` }, { status: 400 });
    if (item.sizes && !it.size) {
      return NextResponse.json({ ok: false, error: `size_required:${it.slug}` }, { status: 400 });
    }
    lines.push({ name: item.name, qty: it.qty, size: it.size, points: item.points * it.qty });
  }
  const totalPoints = lines.reduce((n, l) => n + l.points, 0);

  const order: Order = {
    id: `swag_${randomUUID()}`,
    at: new Date().toISOString(),
    email: d.email,
    items: d.items,
    totalPoints,
  };
  orders.unshift(order);
  if (orders.length > 1000) orders.length = 1000;

  const itemsText = lines.map((l) => `- ${l.qty}× ${l.name}${l.size ? ` (${l.size})` : ""} — ${l.points} pts`).join("\n");
  void sendEmail({
    to: SWAG_INBOX,
    replyTo: d.email,
    subject: `Swag redemption: ${d.name} · ${totalPoints} pts · ${d.items.length} item(s)`,
    html: `<p><b>${d.name}</b> &lt;${d.email}&gt;${d.wallet ? ` · ${d.wallet}` : ""}</p><pre>${itemsText}</pre><p><b>Total: ${totalPoints} points</b></p><p>Ship to: ${d.address.line1}, ${d.address.city} ${d.address.postal}, ${d.address.country}</p>`,
    text: `${d.name} <${d.email}> ${d.wallet ?? ""}\n${itemsText}\nTotal ${totalPoints} points\nShip to: ${d.address.line1}, ${d.address.city} ${d.address.postal}, ${d.address.country}`,
  });
  console.log(`[swag] redemption: ${d.name} <${d.email}> · ${d.items.length} items · ${totalPoints} pts → ${SWAG_INBOX}`);

  return NextResponse.json({ ok: true, orderId: order.id, totalPoints, inbox: SWAG_INBOX });
}
