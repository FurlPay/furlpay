import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { api, getToken } from "./api";
import { recordNotification } from "./db";
import { resolveDeepLink } from "./deepLinks";

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

// The token this device currently has registered WITH THE SERVER. Cleared on
// sign-out so the next account re-registers from scratch rather than assuming
// the previous account's registration still stands.
let registeredToken: string | null = null;

// ---------------------------------------------------------------------------
// TOKEN ROTATION. FCM rotates a device token on app restore, storage clear, and
// its own refresh schedule. Without a listener the server keeps pushing to the
// dead token until a send prunes it (UNREGISTERED) — and the push that gets
// dropped in that window is a 3DS2 approval with a 300s TTL, i.e. exactly the
// one that matters. Rotation therefore has to be handled live, not at next
// launch.
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1_000;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Tokens are credentials for pushing to this device: never log one in full. */
const redact = (token: string) => `${token.slice(0, 6)}…${token.slice(-4)} (len ${token.length})`;

/**
 * Register `token` for the CURRENTLY signed-in user.
 *
 * Account-switch safety: the POST is authorized by whatever session token is in
 * SecureStore right now, and the server files the device under THAT user. So a
 * rotation that fires after Alice signed out and Bob signed in registers to Bob
 * — never to Alice. And when nobody is signed in we do not call at all: an
 * unauthenticated POST would 401 and trip the global unauthorized handler.
 *
 * Deduplicated (an identical token already registered is a no-op) and retried
 * with bounded backoff, because a transient network failure here silently costs
 * the user their approval pushes.
 */
async function registerToken(token: string): Promise<boolean> {
  if (!token) return false;
  if (token === registeredToken) return true; // already registered — no churn
  if (!(await getToken())) return false; // signed out: nothing to attach it to

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await api("/push/devices", {
        method: "POST",
        // The REAL platform, not a hardcoded "android". getDevicePushTokenAsync
        // returns an FCM registration token on Android and a raw APNs device
        // token on iOS; the server derives the transport from this and keeps
        // the two apart, because FCM v1 rejects an APNs token rather than
        // delivering it.
        body: { token, platform: Platform.OS === "ios" ? "ios" : "android" },
      });
      registeredToken = token;
      return true;
    } catch (e) {
      const status = (e as { status?: number }).status;
      // 4xx is a permanent verdict (bad token, revoked session) — retrying it
      // just burns battery. Only transient failures are worth another attempt.
      if (typeof status === "number" && status >= 400 && status < 500) return false;
      if (attempt === MAX_ATTEMPTS) {
        console.warn(`push: registration failed for ${redact(token)} after ${attempt} attempts`);
        return false;
      }
      await delay(BASE_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }
  return false;
}

/**
 * Ask permission (Android 13+ runtime prompt), fetch the FCM device token and
 * register it with the server. Idempotent — safe to call on every sign-in and
 * on resume. Returns false when push isn't available (no Firebase config,
 * permission denied, emulator without Play Services); the app must not treat
 * that as an error.
 */
export async function registerForPush(): Promise<boolean> {
  try {
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return false;

    // Notification channels are an ANDROID concept. The call is a no-op on
    // iOS, but skipping it makes the platform split explicit rather than
    // relying on a vendor no-op that could change — and iOS gets its
    // importance from the payload's interruption level instead.
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: "Transaction approvals",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    // Native FCM token — throws when google-services.json wasn't in the build.
    const { data: token } = await Notifications.getDevicePushTokenAsync();
    if (typeof token !== "string" || !token) return false;

    return await registerToken(token);
  } catch {
    return false; // push is an enhancement, never a blocker
  }
}

/**
 * Subscribe to FCM token rotation. Returns the teardown.
 *
 * Installed alongside the notification listeners for the lifetime of a
 * signed-in session (app/_layout.tsx), so a rotation is pushed to the server
 * the moment it happens instead of waiting for the next cold start.
 */
export function installTokenRotation(): () => void {
  const sub = Notifications.addPushTokenListener((token) => {
    const value = token?.data;
    if (typeof value !== "string" || !value) return;
    // A rotation invalidates whatever we last registered: drop the dedupe
    // memo so the new token is genuinely sent rather than short-circuited.
    if (value !== registeredToken) registeredToken = null;
    void registerToken(value);
  });
  return () => sub.remove();
}

/** Best-effort deregistration — a signed-out device must stop getting pushes.
 *
 *  Falls back to reading the live device token when we have no in-memory record
 *  of what was registered: after an app restart `registeredToken` is null, and
 *  the original implementation simply returned here, leaving the device
 *  registered to an account that had signed out. */
export async function unregisterFromPush(): Promise<void> {
  let token = registeredToken;
  registeredToken = null;

  if (!token) {
    try {
      const { data } = await Notifications.getDevicePushTokenAsync();
      if (typeof data === "string" && data) token = data;
    } catch {
      return; // no push on this build/device — nothing was ever registered
    }
  }
  if (!token) return;

  await api("/push/devices", { method: "DELETE", body: { token } }).catch(() => {});
}

/** Test seam: reset the module's registration memo between cases. */
export function __resetPushStateForTests(): void {
  registeredToken = null;
}

/** Map a server-side push payload onto a real native route. Routes through the
 *  central deep-link resolver so an unknown/stale `data.url` (e.g. a resource
 *  that no longer exists, or a web-only path) lands on a safe screen instead of
 *  Expo Router's "Unmatched Route". */
function routeFor(data: Record<string, unknown>): string {
  if (data.kind === "card-auth-challenge") return "/approvals";
  return resolveDeepLink(typeof data.url === "string" ? data.url : null);
}

/**
 * Reconcile pushes that arrived while the app was BACKGROUNDED or killed into
 * the local inbox.
 *
 * addNotificationReceivedListener only fires in the foreground, so without this
 * a push delivered while the app was away reached the inbox only if the user
 * tapped it. Everything still sitting in the system tray is readable on resume,
 * which closes the gap using an API we already depend on — no durable message
 * queue, no server-side inbox.
 *
 * Deliberately NOT load-bearing: recordNotification() is INSERT OR IGNORE, so
 * re-reading the tray is idempotent, and a notification the user swiped away
 * before opening the app is simply not recovered. That is acceptable because
 * the inbox is cosmetic — the approvals that actually matter are
 * server-authoritative and polled (app/approvals.tsx), so a lost banner can
 * never cost the user an approval.
 */
export async function reconcileInbox(): Promise<number> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    for (const n of presented) store(n);
    return presented.length;
  } catch {
    return 0; // no push support on this build/device
  }
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
