import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Retiring a client that must not be used any more.
//
// THE GAP THIS CLOSES. FurlPay ships four clients — web, React Native, Wear OS
// and iOS — and had no way to stop any of them. The RN app reports `appVersion`
// during device registration and nothing has ever read it. So the day a
// client-side fix ships (the device-wallet provisioning guard added earlier
// today is exactly this shape: a bug that let a simulated payload reach a
// secure element), every un-upgraded install keeps running the broken code
// indefinitely. Tangem ships a `forceupdate` module for precisely this reason.
//
// WHERE THE CONTROL LIVES, and why it is not in the app.
//
// An in-app "please update" screen is UX, not a control: it is bypassed by
// declining the network call that drives it. The control has to be on the
// SERVER, refusing money-moving requests from a retired build. The app-side
// check exists only so the user is told why, instead of watching requests fail.
//
//   client check  -> tells the user to upgrade      (courtesy, bypassable)
//   server check  -> refuses to move their money    (the actual control)
//
// AND IT MUST NOT BRICK THE APP BY ACCIDENT. A misconfigured floor that refuses
// every client is a self-inflicted outage on a payments app, so:
//   - an UNSET policy blocks nothing; the feature is inert until configured
//   - an UNPARSEABLE client version is allowed through, not refused. Old builds
//     and odd platforms send odd strings, and refusing what we cannot parse
//     turns a parsing bug into a lockout.
//   - only versions strictly BELOW the floor are refused.
//
// Configured as FURLPAY_MIN_CLIENT_VERSIONS, a JSON object of platform ->
// minimum version, e.g. {"ios":"1.4.2","android":"1.4.2"}. Kept in one env var
// rather than one per platform so a coordinated retirement is a single edit.
// ---------------------------------------------------------------------------

export type ClientPlatform = "ios" | "android" | "wearos" | "web";

const PLATFORMS: readonly ClientPlatform[] = ["ios", "android", "wearos", "web"];

export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/**
 * Parse a dotted version. Returns null rather than throwing or defaulting —
 * "I could not read this" and "this is version 0.0.0" must not be the same
 * value, or an unparseable string would be treated as older than everything
 * and locked out.
 */
export function parseVersion(value: string | null | undefined): ParsedVersion | null {
  if (typeof value !== "string") return null;
  // Tolerate a leading v and trailing build metadata ("1.4.2+31", "v1.4.2-rc1").
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(value.trim());
  if (!match) return null;
  const [, major, minor, patch] = match;
  return { major: Number(major), minor: Number(minor), patch: patch === undefined ? 0 : Number(patch) };
}

/** Negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** The configured floor per platform. Empty when unset — the feature is inert. */
export function minimumVersions(): Partial<Record<ClientPlatform, string>> {
  const raw = process.env.FURLPAY_MIN_CLIENT_VERSIONS?.trim();
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A malformed policy must not refuse every client. Inert beats outage.
    return {};
  }
  if (parsed === null || typeof parsed !== "object") return {};
  const out: Partial<Record<ClientPlatform, string>> = {};
  for (const platform of PLATFORMS) {
    const value = (parsed as Record<string, unknown>)[platform];
    if (typeof value === "string" && parseVersion(value)) out[platform] = value;
  }
  return out;
}

export type ClientVerdict =
  | { readonly supported: true }
  | { readonly supported: false; readonly minimum: string; readonly platform: ClientPlatform };

/**
 * Is this client still allowed to move money?
 *
 * Allows through: no policy, no platform, an unrecognised platform, an
 * unparseable version, or a version at or above the floor. Refuses only a
 * version we could read that is strictly below a floor we were told.
 */
export function checkClientVersion(
  platform: string | null | undefined,
  version: string | null | undefined
): ClientVerdict {
  const policy = minimumVersions();
  const key = typeof platform === "string" ? (platform.trim().toLowerCase() as ClientPlatform) : null;
  if (!key || !PLATFORMS.includes(key)) return { supported: true };

  const floorRaw = policy[key];
  if (!floorRaw) return { supported: true };

  const floor = parseVersion(floorRaw);
  const actual = parseVersion(version);
  // Unparseable client version: allow. A parsing bug must not become a lockout.
  if (!floor || !actual) return { supported: true };

  return compareVersions(actual, floor) < 0
    ? { supported: false, minimum: floorRaw, platform: key }
    : { supported: true };
}

/** Headers a FurlPay client sends. Both are set by the mobile API client. */
export const CLIENT_PLATFORM_HEADER = "x-furlpay-platform";
export const CLIENT_VERSION_HEADER = "x-furlpay-version";

/**
 * Route guard: a 426 when the caller is a retired build, null when it may
 * proceed.
 *
 * 426 Upgrade Required rather than 403, because the client can act on it: the
 * status alone tells an app what to show, and the body names the version
 * without an operator having to decode a generic refusal.
 */
export function retiredClientOr426(headers: Headers): NextResponse | null {
  const verdict = checkClientVersion(
    headers.get(CLIENT_PLATFORM_HEADER),
    headers.get(CLIENT_VERSION_HEADER)
  );
  if (verdict.supported) return null;

  return NextResponse.json(
    {
      error: "upgrade_required",
      detail: `This version of the FurlPay app can no longer be used to move money. Update to ${verdict.minimum} or later.`,
      minimumVersion: verdict.minimum,
      platform: verdict.platform,
    },
    { status: 426 }
  );
}
