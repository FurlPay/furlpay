// ---------------------------------------------------------------------------
// Rain's published egress IP addresses.
//
// Every outbound connection Rain makes — API calls and webhooks — originates
// from one of these. For an inbound webhook that authorises spend, that is a
// cheap second factor: an attacker who has somehow obtained the signing secret
// still has to arrive from one of six addresses.
//
// WHAT THIS IS NOT. It is NOT a substitute for signature verification, and this
// module must never be mistaken for one. AGENTS.md rule 3 requires an HMAC over
// the raw body, and source IP alone is spoofable in principle and wrong in
// practice the moment a proxy is involved. This is defence in depth on top of a
// signature, and it FAILS OPEN by default for exactly that reason: an issuer
// that adds an egress IP without telling us must not take card authorisation
// down, whereas a missing signature check must always refuse.
//
// Rain's own documentation says it "periodically adds new egress IP addresses"
// and to contact them to confirm the list is complete. So enforcement is
// opt-in via RAIN_ENFORCE_SOURCE_IP, and off means "log the mismatch, allow the
// request, let the signature decide".
// ---------------------------------------------------------------------------
import { trustedClientIp } from "../clientIp";

/** Production egress addresses. */
export const RAIN_EGRESS_IPS_PRODUCTION: readonly string[] = [
  "34.67.3.60",
  "34.59.253.55",
  "136.115.120.229",
];

/** Sandbox egress addresses. */
export const RAIN_EGRESS_IPS_SANDBOX: readonly string[] = [
  "34.66.230.233",
  "34.46.88.124",
  "34.29.33.187",
];

export function rainEgressIps(): readonly string[] {
  return process.env.FURLPAY_ENV === "production"
    ? RAIN_EGRESS_IPS_PRODUCTION
    : RAIN_EGRESS_IPS_SANDBOX;
}

export type SourceIpVerdict =
  | { readonly recognised: true }
  | { readonly recognised: false; readonly observed: string | null; readonly enforced: boolean };

/**
 * Extract the caller's address from a forwarded-for chain.
 *
 * Same trust model as every other IP decision (lib/clientIp.ts): on Vercel
 * the forwarded headers are platform-set; behind CloudFront only
 * the Nth-from-right forwarded entry is. Still advisory — the signature decides.
 */
export function clientIpFrom(headers: Readonly<Record<string, string | null | undefined>>): string | null {
  const h = new Headers();
  for (const [k, v] of Object.entries(headers)) if (typeof v === "string") h.set(k, v);
  return trustedClientIp({ headers: h });
}

/**
 * Check an inbound webhook's source against Rain's published egress list.
 *
 * Returns a verdict rather than throwing, because the CALLER decides what an
 * unrecognised source means. With RAIN_ENFORCE_SOURCE_IP=1 it should refuse;
 * otherwise it should log and continue to signature verification, which is the
 * control that actually decides.
 */
export function checkRainSourceIp(
  headers: Readonly<Record<string, string | null | undefined>>
): SourceIpVerdict {
  const observed = clientIpFrom(headers);
  if (observed !== null && rainEgressIps().includes(observed)) return { recognised: true };
  return {
    recognised: false,
    observed,
    enforced: process.env.RAIN_ENFORCE_SOURCE_IP === "1",
  };
}

/**
 * Rain's `SessionId` verification public keys, per environment.
 *
 * Published by Rain to verify the authenticity of SessionId data their platform
 * sends. RSA public keys only — there is nothing secret here, which is why they
 * can sit in source rather than in the environment, and why checking them in is
 * an improvement over an env var somebody has to remember to set correctly in
 * two places.
 *
 * Using the wrong environment's key produces a verification failure that looks
 * like tampering, so `rainSessionIdPublicKey()` picks it rather than a caller.
 */
export const RAIN_SESSION_PUBLIC_KEY_SANDBOX = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCAP192809jZyaw62g/eTzJ3P9H
+RmT88sXUYjQ0K8Bx+rJ83f22+9isKx+lo5UuV8tvOlKwvdDS/pVbzpG7D7NO45c
0zkLOXwDHZkou8fuj8xhDO5Tq3GzcrabNLRLVz3dkx0znfzGOhnY4lkOMIdKxlQb
LuVM/dGDC9UpulF+UwIDAQAB
-----END PUBLIC KEY-----`;

export const RAIN_SESSION_PUBLIC_KEY_PRODUCTION = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCeZ9uCoxi2XvOw1VmvVLo88TLk
GE+OO1j3fa8HhYlJZZ7CCIAsaCorrU+ZpD5PUTnmME3DJk+JyY1BB3p8XI+C5uno
QucrbxFbkM1lgR10ewz/LcuhleG0mrXL/bzUZbeJqI6v3c9bXvLPKlsordPanYBG
FZkmBPxc8QEdRgH4awIDAQAB
-----END PUBLIC KEY-----`;

export function rainSessionIdPublicKey(): string {
  return process.env.FURLPAY_ENV === "production"
    ? RAIN_SESSION_PUBLIC_KEY_PRODUCTION
    : RAIN_SESSION_PUBLIC_KEY_SANDBOX;
}
