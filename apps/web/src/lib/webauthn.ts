// ---------------------------------------------------------------------------
// Real FIDO2 / WebAuthn passkey ceremony state (backed by @simplewebauthn/server
// in the route handlers). Challenge + credential stores are in-memory here;
// production persists credentials (id, publicKey, counter) per user in the DB.
// ---------------------------------------------------------------------------

export interface StoredCredential {
  id: string; // base64url credential ID
  publicKey: Uint8Array;
  counter: number;
  transports?: string[];
}

interface WebAuthnState {
  challenges: Map<string, string>; // userId -> current challenge
  credentials: Map<string, StoredCredential[]>; // userId -> credentials
}

const g = globalThis as unknown as { __webauthn?: WebAuthnState };
const state: WebAuthnState =
  g.__webauthn ?? (g.__webauthn = { challenges: new Map(), credentials: new Map() });

export const RP_NAME = "Furlpay";
export const RP_ID = process.env.FURLPAY_RP_ID || "localhost";
export const ORIGIN = process.env.FURLPAY_ORIGIN || "http://localhost:3000";

export function setChallenge(userId: string, challenge: string) {
  state.challenges.set(userId, challenge);
}
export function takeChallenge(userId: string): string | undefined {
  const c = state.challenges.get(userId);
  state.challenges.delete(userId);
  return c;
}

export function getCredentials(userId: string): StoredCredential[] {
  return state.credentials.get(userId) ?? [];
}
export function addCredential(userId: string, cred: StoredCredential) {
  const list = state.credentials.get(userId) ?? [];
  list.push(cred);
  state.credentials.set(userId, list);
}
export function updateCounter(userId: string, credId: string, counter: number) {
  const list = state.credentials.get(userId) ?? [];
  const c = list.find((x) => x.id === credId);
  if (c) c.counter = counter;
}
