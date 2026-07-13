import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { api } from "./api";
import { recordNotification } from "./db";

// ---------------------------------------------------------------------------
// Native push (FCM) — the delivery leg that makes 3DS2 approvals usable: the
// issuer's webhook gives the user ~5 minutes to approve, which only works if
// the phone buzzes. Registers the device's FCM token with
// POST /api/push/devices; the server fans out via lib/fcm.ts.
//
// Requires a Firebase project: google-services.json at the app root (picked
// up by app.config.js) and FURLPAY_FCM_SERVICE_ACCOUNT on the server. Without
// them every call here fails SOFT — the app runs fine, approvals just stay
// pull-based (the 10s poll on the approvals screen).
// ---------------------------------------------------------------------------

const CHANNEL_ID = "approvals";

// Show alerts even when the app is foregrounded — a 3DS2 challenge while the
// user is inside the app must still be visible.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let registeredToken: string | null = null;

/**
 * Ask permission (Android 13+ runtime prompt), fetch the FCM device token and
 * register it with the server. Idempotent — safe to call on every sign-in.
 * Returns false when push isn't available (no Firebase config, permission
 * denied, emulator without Play Services); the app must not treat that as an
 * error.
 */
export async function registerForPush(): Promise<boolean> {
  try {
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return false;

    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Transaction approvals",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });

    // Native FCM token — throws when google-services.json wasn't in the build.
    const { data: token } = await Notifications.getDevicePushTokenAsync();
    if (typeof token !== "string" || !token) return false;

    await api("/push/devices", {
      method: "POST",
      body: { token, platform: "android" },
    });
    registeredToken = token;
    return true;
  } catch {
    return false; // push is an enhancement, never a blocker
  }
}

/** Best-effort deregistration — a signed-out device must stop getting pushes. */
export async function unregisterFromPush(): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (!token) return;
  await api("/push/devices", { method: "DELETE", body: { token } }).catch(() => {});
}

/** Map a server-side deep link (shared with web push) onto a native route. */
function routeFor(data: Record<string, unknown>): string {
  if (data.kind === "card-auth-challenge") return "/approvals";
  const url = typeof data.url === "string" ? data.url : "/";
  if (url.startsWith("/cards/approve")) return "/approvals";
  return url.startsWith("/") ? url : "/";
}

/** Persist a push into the SQLite inbox so a missed banner isn't gone forever. */
function store(notification: Notifications.Notification): void {
  try {
    const content = notification.request.content;
    const data = (content.data ?? {}) as Record<string, unknown>;
    recordNotification({
      id: notification.request.identifier,
      title: content.title ?? "FurlPay",
      body: content.body ?? "",
      url: typeof data.url === "string" ? data.url : null,
    });
  } catch {
    // Inbox is a convenience — never let it break delivery handling.
  }
}

/**
 * Route notification taps and record every push into the inbox. Handles both
 * the warm case (listeners) and the cold start (the tap launched the app).
 * Returns the listener teardown.
 */
export function installNotificationRouting(): () => void {
  // Fired when a push arrives while the app is foregrounded.
  const received = Notifications.addNotificationReceivedListener(store);

  const responded = Notifications.addNotificationResponseReceivedListener((response) => {
    store(response.notification);
    const data = response.notification.request.content.data ?? {};
    router.push(routeFor(data) as never);
  });

  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (!response) return;
    store(response.notification);
    const data = response.notification.request.content.data ?? {};
    const target = routeFor(data);
    if (target !== "/") router.push(target as never);
  });

  return () => {
    received.remove();
    responded.remove();
  };
}
