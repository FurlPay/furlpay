import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { pushConfigured, removeSubscription, saveSubscription, vapidPublicKey } from "@/lib/push";

// Push subscription registration for 3DS2 transaction-approval notifications.
//   GET    — VAPID public key + whether push is configured (client bootstrap).
//   POST   — register/refresh this device's PushSubscription.
//   DELETE — unregister an endpoint (logout / notification opt-out).

const SubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
  device: z.string().max(120).optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  return NextResponse.json({ configured: pushConfigured, publicKey: vapidPublicKey() });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const parsed = SubscriptionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid push subscription" }, { status: 400 });
  }
  const { device, ...sub } = parsed.data;
  await saveSubscription(auth.account.user.id, sub, device);
  return NextResponse.json({ registered: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const { endpoint } = await req.json().catch(() => ({}));
  if (typeof endpoint !== "string" || !endpoint) {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }
  await removeSubscription(auth.account.user.id, endpoint);
  return NextResponse.json({ removed: true });
}
