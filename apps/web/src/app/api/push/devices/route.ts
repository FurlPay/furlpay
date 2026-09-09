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
  // Push tokens are opaque; bounded only to defend the kv row.
  token: z.string().min(20).max(4096),
  // "android" was a LITERAL here, so an iOS build's registration was rejected
  // 400 — which push.ts treats as a permanent verdict and stops retrying.
  // Push was therefore silently dead on iOS the moment the app shipped there.
  platform: z.enum(["android", "ios"]),
  device: z.string().max(80).optional(),
});

/**
 * Which transport a platform's token belongs to.
 *
 * Derived on the SERVER from the declared platform rather than accepted as a
 * client-supplied field: a client that could name its own transport could put
 * an APNs token into the FCM queue, where every send fails as an ordinary
 * delivery error and nobody notices.
 */
function transportFor(platform: "android" | "ios"): "fcm" | "apns" {
  return platform === "ios" ? "apns" : "fcm";
}

const RemoveSchema = z.object({
  token: z.string().min(20).max(4096),
});

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const body = await validateBody(req, RegisterSchema);
  if (body instanceof NextResponse) return body;

  const transport = transportFor(body.platform);
  await saveFcmDevice(auth.account.user.id, body.token, body.device, transport);
  const devices = await listFcmDevices(auth.account.user.id);
  return NextResponse.json({
    registered: true,
    devices: devices.length,
    // Lets the app tell "registered but undeliverable" from "working":
    // tokens are stored either way so a later server config makes them live.
    //
    // For iOS this is HONESTLY false until an APNs transport exists: the token
    // is kept, nothing is lost, and the app is told delivery is not wired
    // rather than being led to believe a push will arrive.
    deliveryConfigured: transport === "fcm" ? fcmConfigured() : false,
    transport,
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
