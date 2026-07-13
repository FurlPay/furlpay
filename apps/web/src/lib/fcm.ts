import { createSign } from "crypto";
import { kvGet, kvSet, kvDel } from "@/lib/kv";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// FCM HTTP v1 delivery — the NATIVE-app leg of push. Web/TWA/PWA devices ride
// Web Push (lib/push.ts); the React Native app cannot receive web-push, so it
// registers its FCM device token instead and we deliver through Firebase.
//
// Config: FURLPAY_FCM_SERVICE_ACCOUNT = the Firebase service-account JSON
// (raw or base64). No SDK — the OAuth2 JWT grant is ~20 lines of node crypto,
// and firebase-admin would drag ~40 transitive deps into the money path.
// Tokens persist in kv per user (multi-device: an array).
// ---------------------------------------------------------------------------

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.FURLPAY_FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(text);
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    return parsed as ServiceAccount;
  } catch {
    return null;
  }
}

export const fcmConfigured = (): boolean => serviceAccount() !== null;

// --- OAuth2 access token via the JWT bearer grant ---------------------------

let cachedToken: { value: string; expiresAt: number } | null = null;

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(sa.private_key);
  const assertion = `${header}.${claims}.${b64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`FCM token exchange failed (${res.status})`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

// --- Device-token registry ---------------------------------------------------

const tokensKey = (userId: string) => `push:fcm:${userId}`;

export interface FcmDevice {
  token: string;
  /** Client-supplied label so users can recognize the device. */
  device?: string;
  addedAt: string;
}

export async function listFcmDevices(userId: string): Promise<FcmDevice[]> {
  return (await kvGet<FcmDevice[]>(tokensKey(userId))) ?? [];
}

export async function saveFcmDevice(userId: string, token: string, device?: string): Promise<void> {
  const others = (await listFcmDevices(userId)).filter((d) => d.token !== token);
  others.push({ token, device, addedAt: new Date().toISOString() });
  // A user has a handful of phones, not hundreds — cap defends the kv row.
  await kvSet(tokensKey(userId), others.slice(-10));
}

export async function removeFcmDevice(userId: string, token: string): Promise<void> {
  const remaining = (await listFcmDevices(userId)).filter((d) => d.token !== token);
  if (remaining.length) await kvSet(tokensKey(userId), remaining);
  else await kvDel(tokensKey(userId));
}

// --- Delivery ----------------------------------------------------------------

export interface FcmPayload {
  title: string;
  body: string;
  /** In-app path the notification opens (e.g. /approvals). */
  url?: string;
  data?: Record<string, unknown>;
}

/**
 * Send to every registered native device of a user. Dead tokens (UNREGISTERED
 * / 404) are pruned as we go. Returns the number of devices that accepted.
 * Fails soft: an FCM outage must never break the flow that triggered the push.
 */
export async function sendFcmToUser(userId: string, payload: FcmPayload): Promise<number> {
  const sa = serviceAccount();
  if (!sa) return 0; // native push simply not configured — web-push leg still runs
  const devices = await listFcmDevices(userId);
  if (!devices.length) return 0;

  let token: string;
  try {
    token = await accessToken(sa);
  } catch (e) {
    log.error("FCM auth failed", { error: (e as Error).message });
    return 0;
  }

  // FCM data values must be strings.
  const data: Record<string, string> = { url: payload.url ?? "/" };
  for (const [k, v] of Object.entries(payload.data ?? {})) data[k] = String(v);

  let delivered = 0;
  await Promise.all(
    devices.map(async (d) => {
      try {
        const res = await fetch(
          `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              message: {
                token: d.token,
                notification: { title: payload.title, body: payload.body },
                data,
                android: {
                  priority: "HIGH",
                  // A 3DS approval is useless after the challenge window
                  // closes — don't let FCM queue it for later.
                  ttl: "300s",
                },
              },
            }),
          }
        );
        if (res.ok) {
          delivered += 1;
          return;
        }
        const err = await res.json().catch(() => null);
        const code = err?.error?.details?.find((x: any) => x.errorCode)?.errorCode ?? err?.error?.status;
        if (res.status === 404 || code === "UNREGISTERED" || code === "INVALID_ARGUMENT") {
          await removeFcmDevice(userId, d.token);
        } else {
          log.error("FCM delivery failed", { userId, status: res.status, code });
        }
      } catch (e) {
        log.error("FCM delivery failed", { userId, error: (e as Error).message });
      }
    })
  );
  return delivered;
}
