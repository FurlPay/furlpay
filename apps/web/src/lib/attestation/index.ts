import { randomBytes, createSign } from "crypto";
import { NextResponse } from "next/server";
import { kvGet, kvSet, kvSetNx } from "@/lib/kv";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// Server-side device attestation for MOBILE money actions (audit P1-9).
//
// Until now attestation verdicts were never checked server-side: any scripted
// client that held a session could drive the money routes the app drives. This
// module adds the server half:
//
//   1. CHALLENGE  POST /api/attestation/challenge issues a single-use nonce
//                 bound to the user and a purpose, valid for 5 minutes.
//   2. TOKEN      The app obtains a platform token over that nonce:
//                   Android — Play Integrity (standard request, nonce in requestHash)
//                   iOS     — App Attest assertion
//   3. VERIFY     requireMobileAttestation() on the money route: the nonce is
//                 consumed atomically (replay-proof), the token is verified by
//                 the platform, and the verdict must name OUR app, a genuine
//                 device, this nonce, and a fresh timestamp.
//
// ROLLOUT FLAG  FURLPAY_ATTESTATION_MODE = off | report | enforce  (default off)
//   off      nothing checked (today's behaviour)
//   report   verified and logged, never blocks — to measure false rejects
//   enforce  an absent/invalid/forged token on a mobile money action is 403
// Web traffic is never subject to it: only requests that identify as the
// mobile app (X-Furlpay-Client: mobile-*) are.
//
// WHAT IS NOT DONE HERE, stated rather than faked:
//   - App Attest assertion verification needs the attested public key stored
//     at attestation time (CBOR attestation object, Apple certificate chain).
//     Not implemented: in `enforce` mode iOS money actions are REFUSED
//     (fail closed) until it is. iOS is not shippable yet for other reasons.
//   - Play Integrity decoding needs a Google Cloud service account with the
//     Play Integrity API enabled (PLAY_INTEGRITY_SERVICE_ACCOUNT) and the
//     app's package name; without them `enforce` refuses everything mobile.
// ---------------------------------------------------------------------------

export type AttestationMode = "off" | "report" | "enforce";
export type Platform = "android" | "ios";

export function attestationMode(env: Record<string, string | undefined> = process.env): AttestationMode {
  const m = (env.FURLPAY_ATTESTATION_MODE ?? "off").trim().toLowerCase();
  return m === "enforce" || m === "report" ? m : "off";
}

const NONCE_TTL_SECONDS = 300;
const nonceKey = (n: string) => `attest:nonce:${n}`;
const usedKey = (n: string) => `attest:used:${n}`;

interface NonceRecord {
  userId: string;
  purpose: string;
  issuedAt: number;
}

export async function issueChallenge(userId: string, purpose: string): Promise<{ nonce: string; expiresInSeconds: number }> {
  const nonce = randomBytes(32).toString("base64url");
  await kvSet(nonceKey(nonce), { userId, purpose, issuedAt: Date.now() } satisfies NonceRecord, NONCE_TTL_SECONDS);
  return { nonce, expiresInSeconds: NONCE_TTL_SECONDS };
}

/** Atomically consume a nonce: it must exist, belong to this user and purpose,
 *  and never have been used. A second presentation is refused (replay). */
export async function consumeChallenge(nonce: string, userId: string, purpose: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(nonce)) return { ok: false, reason: "nonce_malformed" };
  const rec = await kvGet<NonceRecord>(nonceKey(nonce));
  if (!rec) return { ok: false, reason: "nonce_unknown_or_expired" };
  if (rec.userId !== userId) return { ok: false, reason: "nonce_wrong_user" };
  if (rec.purpose !== purpose) return { ok: false, reason: "nonce_wrong_purpose" };
  if (Date.now() - rec.issuedAt > NONCE_TTL_SECONDS * 1000) return { ok: false, reason: "nonce_expired" };
  if (!(await kvSetNx(usedKey(nonce), 1, NONCE_TTL_SECONDS))) return { ok: false, reason: "nonce_replayed" };
  return { ok: true };
}

// --- Android: Play Integrity ---------------------------------------------------

export interface PlayIntegrityVerdict {
  requestDetails?: { requestPackageName?: string; nonce?: string; requestHash?: string; timestampMillis?: string };
  appIntegrity?: { appRecognitionVerdict?: string; packageName?: string; certificateSha256Digest?: string[] };
  deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
}

export interface AttestationConfig {
  androidPackage: string;
  /** Play App Signing certificate SHA-256 digests (base64url, as Play reports them). */
  androidCertDigests: string[];
}

export function attestationConfig(env: Record<string, string | undefined> = process.env): AttestationConfig {
  return {
    androidPackage: (env.ANDROID_PACKAGE_NAME ?? "com.furlpay.app").trim(),
    androidCertDigests: (env.FURLPAY_PLAY_CERT_DIGESTS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

/** Pure verdict check — the part that decides. The nonce must be the one we
 *  issued (Play echoes it in requestHash for standard requests, nonce for
 *  classic), the package and signing certificate ours, the app recognised by
 *  Play and the device genuine, and the verdict fresh. */
export function checkPlayVerdict(
  v: PlayIntegrityVerdict,
  expectedNonce: string,
  cfg: AttestationConfig,
  now = Date.now()
): { ok: true } | { ok: false; reason: string } {
  const rd = v.requestDetails ?? {};
  if (rd.requestPackageName !== cfg.androidPackage) return { ok: false, reason: "package_mismatch" };
  if (rd.requestHash !== expectedNonce && rd.nonce !== expectedNonce) return { ok: false, reason: "nonce_mismatch" };
  const ts = Number(rd.timestampMillis);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > NONCE_TTL_SECONDS * 1000) return { ok: false, reason: "verdict_stale" };
  if (v.appIntegrity?.appRecognitionVerdict !== "PLAY_RECOGNIZED") return { ok: false, reason: "app_not_play_recognized" };
  if (v.appIntegrity?.packageName && v.appIntegrity.packageName !== cfg.androidPackage) return { ok: false, reason: "package_mismatch" };
  if (cfg.androidCertDigests.length === 0) return { ok: false, reason: "no_expected_certificate_configured" };
  const digests = v.appIntegrity?.certificateSha256Digest ?? [];
  if (!digests.some((d) => cfg.androidCertDigests.includes(d))) return { ok: false, reason: "certificate_mismatch" };
  if (!(v.deviceIntegrity?.deviceRecognitionVerdict ?? []).includes("MEETS_DEVICE_INTEGRITY")) {
    return { ok: false, reason: "device_not_genuine" };
  }
  return { ok: true };
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
}
function playServiceAccount(): ServiceAccount | null {
  const raw = process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const p = JSON.parse(text);
    return p.client_email && p.private_key ? p : null;
  } catch {
    return null;
  }
}

async function googleAccessToken(sa: ServiceAccount): Promise<string> {
  const b64url = (x: string | Buffer) => Buffer.from(x).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/playintegrity",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const sig = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(sa.private_key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`play integrity token exchange failed (${res.status})`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Ask Google to decrypt and verify the integrity token. Never decoded locally:
 *  Google-managed response encryption is the supported path. */
export async function decodePlayIntegrityToken(token: string, cfg: AttestationConfig): Promise<PlayIntegrityVerdict> {
  const sa = playServiceAccount();
  if (!sa) throw new Error("PLAY_INTEGRITY_SERVICE_ACCOUNT not configured");
  const res = await fetch(
    `https://playintegrity.googleapis.com/v1/${encodeURIComponent(cfg.androidPackage)}:decodeIntegrityToken`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${await googleAccessToken(sa)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ integrity_token: token }),
    }
  );
  if (!res.ok) throw new Error(`decodeIntegrityToken ${res.status}`);
  const body = (await res.json()) as { tokenPayloadExternal?: PlayIntegrityVerdict };
  if (!body.tokenPayloadExternal) throw new Error("decodeIntegrityToken returned no payload");
  return body.tokenPayloadExternal;
}

// --- iOS: App Attest -----------------------------------------------------------

/** Not implemented (see header). Returns a refusal — never a pass. */
export async function verifyAppAttestAssertion(): Promise<{ ok: false; reason: string }> {
  return { ok: false, reason: "app_attest_not_implemented" };
}

// --- Route guard ---------------------------------------------------------------

export type Verifier = {
  decodePlay: (token: string, cfg: AttestationConfig) => Promise<PlayIntegrityVerdict>;
  verifyAppAttest: () => Promise<{ ok: boolean; reason?: string }>;
};
const defaultVerifier: Verifier = { decodePlay: decodePlayIntegrityToken, verifyAppAttest: verifyAppAttestAssertion };

export function isMobileClient(req: { headers: { get(n: string): string | null } }): boolean {
  return (req.headers.get("x-furlpay-client") ?? "").toLowerCase().startsWith("mobile");
}

/**
 * Gate a money action. Returns null to proceed, or a 403 response (enforce).
 *
 * Headers from the app:
 *   x-furlpay-attestation-platform  android | ios
 *   x-furlpay-attestation-nonce     the nonce from /api/attestation/challenge
 *   x-furlpay-attestation-token     the platform token over that nonce
 */
export async function requireMobileAttestation(
  req: { headers: { get(n: string): string | null } },
  userId: string,
  purpose: string,
  verifier: Verifier = defaultVerifier,
  env: Record<string, string | undefined> = process.env
): Promise<NextResponse | null> {
  const mode = attestationMode(env);
  if (mode === "off" || !isMobileClient(req)) return null;

  const outcome = await (async (): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const platform = req.headers.get("x-furlpay-attestation-platform");
    const nonce = req.headers.get("x-furlpay-attestation-nonce") ?? "";
    const token = req.headers.get("x-furlpay-attestation-token") ?? "";
    if (platform !== "android" && platform !== "ios") return { ok: false, reason: "platform_missing" };
    if (!token) return { ok: false, reason: "token_missing" };
    const consumed = await consumeChallenge(nonce, userId, purpose);
    if (!consumed.ok) return consumed;
    try {
      if (platform === "android") {
        const cfg = attestationConfig(env);
        return checkPlayVerdict(await verifier.decodePlay(token, cfg), nonce, cfg);
      }
      const r = await verifier.verifyAppAttest();
      return r.ok ? { ok: true } : { ok: false, reason: r.reason ?? "app_attest_failed" };
    } catch (e) {
      return { ok: false, reason: `verification_error:${(e as Error).message.slice(0, 80)}` };
    }
  })();

  if (outcome.ok) return null;
  log.warn("mobile attestation failed", { userId, purpose, reason: outcome.reason, mode });
  if (mode === "report") return null;
  return NextResponse.json({ error: "attestation_required", reason: outcome.reason }, { status: 403 });
}
