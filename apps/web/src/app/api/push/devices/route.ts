import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { validateBody } from "@/lib/validate";
import { fcmConfigured, listFcmDevices, removeFcmDevice, saveFcmDevice } from "@/lib/fcm";

// /api/push/devices — native-app (FCM) device-token registry. The web-push
// twin is /api/push/subscribe; this one holds React Native device tokens.
// Registration is idempotent per token, so the app can re-register on every
// launch without churn.

const RegisterSchema = z.object({
  // FCM tokens are opaque; bound only to defend the kv row.
  token: z.string().min(20).max(4096),
  platform: z.literal("android"),
  device: z.string().max(80).optional(),
});

const RemoveSchema = z.object({
  token: z.string().min(20).max(4096),
});

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const body = await validateBody(req, RegisterSchema);
  if (body instanceof NextResponse) return body;

  await saveFcmDevice(auth.account.user.id, body.token, body.device);
  const devices = await listFcmDevices(auth.account.user.id);
  return NextResponse.json({
    registered: true,
    devices: devices.length,
    // Lets the app tell "registered but undeliverable" from "working":
    // tokens are stored either way so a later server config makes them live.
    deliveryConfigured: fcmConfigured(),
  });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const body = await validateBody(req, RemoveSchema);
  if (body instanceof NextResponse) return body;

  await removeFcmDevice(auth.account.user.id, body.token);
  return NextResponse.json({ removed: true });
}
