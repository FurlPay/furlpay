import * as Linking from "expo-linking";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import * as Crypto from "expo-crypto";
import { api, API_BASE } from "./api";

// ---------------------------------------------------------------------------
// Federated sign-in (Google, Apple) for the native app.
//
// Both end the same way: a verified identity token goes to the server, which
// resolves-or-creates the account and returns a session JWT in the body (mobile
// clients get the token in the body — see apps/web/src/lib/clientKind.ts).
//
// They differ in how they get there, and the difference is forced on us:
//
//  GOOGLE — a normal OAuth id_token flow. The one trap: an Android OAuth client
//  is a DIFFERENT client id from the web one, so the id_token's `aud` is the
//  Android id. The server therefore accepts a comma-separated GOOGLE_CLIENT_ID
//  list (see apps/web/src/lib/auth/google.ts) — the Android id must be in it or
//  every native token is rejected as wrong-audience.
//
//  APPLE — cannot talk to the app directly. Apple only redirects to https
//  redirect_uris registered in its developer portal; custom schemes like
//  furlpay:// are refused. And with name/email scopes it replies as an HTML form
//  POST, not a query redirect. So the app opens Apple in a Custom Tab pointed at
//  our https callback, which converts the result into a one-time code on a
//  furlpay:// deep link that we exchange here.
// ---------------------------------------------------------------------------

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const APPLE_CLIENT_ID = process.env.EXPO_PUBLIC_APPLE_CLIENT_ID; // Apple Services ID
const WEB_ORIGIN = API_BASE.replace(/\/api$/, "");

/** A provider with no client id configured can't work — don't show a dead button. */
export const googleConfigured = Boolean(GOOGLE_ANDROID_CLIENT_ID || GOOGLE_WEB_CLIENT_ID);
export const appleConfigured = Boolean(APPLE_CLIENT_ID);

/** Trade a one-time web→native handoff code for a session token. */
async function exchangeNativeCode(code: string): Promise<string> {
  const res = await api<{ token: string }>("/auth/native/exchange", {
    method: "POST",
    body: { code },
    anonymous: true,
  });
  if (!res.token) throw new Error("Handoff code was rejected.");
  return res.token;
}

// --- Google -----------------------------------------------------------------

/**
 * Google sign-in. Hook-based because expo-auth-session owns the redirect
 * lifecycle. Returns `signIn()` which resolves the session token, or null when
 * the user backs out of the Google sheet (a cancel is not an error).
 */
export function useGoogleSignIn() {
  const [request, , promptAsync] = Google.useIdTokenAuthRequest({
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    webClientId: GOOGLE_WEB_CLIENT_ID,
  });

  const signIn = async (): Promise<string | null> => {
    if (!googleConfigured) throw new Error("Google sign-in isn't configured for this build.");
    const result = await promptAsync();
    if (result.type !== "success") return null; // dismissed / cancelled
    const idToken = result.params?.id_token;
    if (!idToken) throw new Error("Google didn't return an identity token.");
    const res = await api<{ success: boolean; token?: string }>("/auth/google", {
      method: "POST",
      body: { credential: idToken },
      anonymous: true,
    });
    if (!res.token) throw new Error("Google sign-in wasn't accepted by the server.");
    return res.token;
  };

  return { signIn, ready: Boolean(request) && googleConfigured };
}

// --- Apple ------------------------------------------------------------------

/**
 * Apple sign-in on Android — the Custom Tab round-trip described above.
 * Resolves the session token, or null if the user dismissed the sheet.
 */
export async function signInWithApple(): Promise<string | null> {
  if (!APPLE_CLIENT_ID) throw new Error("Apple sign-in isn't configured for this build.");

  // Apple requires a nonce and echoes `state` back; both are anti-CSRF/replay.
  const state = Crypto.randomUUID();
  const nonce = Crypto.randomUUID();
  const redirectUri = `${WEB_ORIGIN}/api/auth/apple/callback`;

  const url =
    "https://appleid.apple.com/auth/authorize?" +
    new URLSearchParams({
      client_id: APPLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code id_token",
      // form_post is mandatory once name/email scopes are requested — Apple will
      // not return those over a query redirect.
      response_mode: "form_post",
      scope: "name email",
      state,
      nonce,
    }).toString();

  // Returns as soon as the browser hits our furlpay:// scheme, which is exactly
  // what /api/auth/apple/callback redirects to once it has verified the token.
  const result = await WebBrowser.openAuthSessionAsync(url, "furlpay://auth");
  if (result.type !== "success") return null; // dismissed

  const returned = Linking.parse(result.url).queryParams ?? {};
  const err = typeof returned.error === "string" ? returned.error : null;
  if (err) throw new Error(appleErrorMessage(err));
  const handoff = typeof returned.code === "string" ? returned.code : null;
  if (!handoff) throw new Error("Apple sign-in returned no code.");
  return exchangeNativeCode(handoff);
}

function appleErrorMessage(code: string): string {
  if (code === "invalid_apple_token") return "Apple couldn't verify that sign-in.";
  if (code === "missing_id_token") return "Apple didn't return an identity token.";
  return "Apple sign-in failed.";
}
