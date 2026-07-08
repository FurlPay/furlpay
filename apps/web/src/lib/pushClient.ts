// ---------------------------------------------------------------------------
// Client-side Web Push enrollment. Pairs with /api/push/subscribe and the
// push handlers in sw.ts. Call enableTransactionApprovals() from a user
// gesture (button tap) — browsers reject permission prompts outside one.
// ---------------------------------------------------------------------------

import { getJSON, sendJSON } from "@/lib/api";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function pushPermissionState(): Promise<NotificationPermission | "unsupported"> {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * Enroll this device for 3DS2 transaction-approval notifications.
 * Returns "enabled" | "denied" | "unsupported" | "unconfigured".
 */
export async function enableTransactionApprovals(): Promise<
  "enabled" | "denied" | "unsupported" | "unconfigured"
> {
  if (!pushSupported()) return "unsupported";

  const { configured, publicKey } = await getJSON<{ configured: boolean; publicKey: string | null }>(
    "/api/push/subscribe"
  );
  if (!configured || !publicKey) return "unconfigured";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  await sendJSON("/api/push/subscribe", {
    ...subscription.toJSON(),
    device: navigator.userAgent.includes("Android") ? "Android" : navigator.platform || "Web",
  });
  return "enabled";
}

/** Unregister this device (e.g. on logout). */
export async function disableTransactionApprovals(): Promise<void> {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
}
