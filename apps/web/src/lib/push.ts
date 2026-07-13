import webpush, { type PushSubscription as WebPushSubscription } from "web-push";
import { kvGet, kvSet, kvDel } from "@/lib/kv";
import { sendFcmToUser } from "@/lib/fcm";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// Web Push (RFC 8030 + VAPID) delivery. This is the "APNS/FCM" leg of the
// 3DS2 OOB flow: on Android (including the Play-store TWA, which runs Chrome)
// and desktop, pushes arrive through FCM as native notifications; on iOS 16.4+
// they arrive through APNs for the installed PWA. One code path, no
// per-platform SDKs.
//
// Keys: generate once with `npx web-push generate-vapid-keys` and set
//   FURLPAY_VAPID_PUBLIC_KEY / FURLPAY_VAPID_PRIVATE_KEY / FURLPAY_VAPID_SUBJECT
// Subscriptions persist in the kv layer per user (multi-device: an array).
// ---------------------------------------------------------------------------

const PUBLIC_KEY = process.env.FURLPAY_VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.FURLPAY_VAPID_PRIVATE_KEY;
const SUBJECT = process.env.FURLPAY_VAPID_SUBJECT || "mailto:security@furlpay.com";

export const pushConfigured = Boolean(PUBLIC_KEY && PRIVATE_KEY);

export function vapidPublicKey(): string | null {
  return PUBLIC_KEY ?? null;
}

const subsKey = (userId: string) => `push:subs:${userId}`;

export interface StoredPushSubscription extends WebPushSubscription {
  /** Client-supplied label so users can recognize the device. */
  device?: string;
  addedAt: string;
}

export async function listSubscriptions(userId: string): Promise<StoredPushSubscription[]> {
  return (await kvGet<StoredPushSubscription[]>(subsKey(userId))) ?? [];
}

export async function saveSubscription(
  userId: string,
  sub: WebPushSubscription,
  device?: string
): Promise<void> {
  const existing = await listSubscriptions(userId);
  const others = existing.filter((s) => s.endpoint !== sub.endpoint);
  others.push({ ...sub, device, addedAt: new Date().toISOString() });
  await kvSet(subsKey(userId), others);
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  const remaining = (await listSubscriptions(userId)).filter((s) => s.endpoint !== endpoint);
  if (remaining.length) await kvSet(subsKey(userId), remaining);
  else await kvDel(subsKey(userId));
}

export interface PushPayload {
  title: string;
  body: string;
  /** Deep link opened on notification click (e.g. /cards/approve?challenge=…). */
  url?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

/**
 * Send a payload to every registered device of a user — Web Push for
 * browser/PWA subscriptions AND FCM for native-app device tokens (lib/fcm.ts).
 * Expired/revoked subscriptions (404/410 from the push service) are pruned as
 * we go. Returns the number of devices that accepted the push.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  // Native leg first; it is independently configured and must not be skipped
  // just because VAPID keys are absent.
  const native = await sendFcmToUser(userId, {
    title: payload.title,
    body: payload.body,
    url: payload.url,
    data: payload.data,
  });

  if (!pushConfigured) {
    if (!native) log.warn("push not configured — set FURLPAY_VAPID_* env vars", { userId });
    return native;
  }
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY!, PRIVATE_KEY!);

  const subs = await listSubscriptions(userId);
  if (!subs.length) return native;

  const body = JSON.stringify(payload);
  let delivered = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        // High urgency + short TTL: a 3DS approval is useless after the
        // challenge window closes, so don't let push services queue it.
        await webpush.sendNotification(sub, body, { urgency: "high", TTL: 300 });
        delivered += 1;
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await removeSubscription(userId, sub.endpoint);
        } else {
          log.error("push delivery failed", { userId, statusCode: e?.statusCode, error: e?.message });
        }
      }
    })
  );
  return native + delivered;
}
