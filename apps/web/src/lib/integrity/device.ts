import { randomUUID, createHash } from "crypto";
import { kvGet, kvSet, kvSetNx } from "@/lib/kv";
import { audit } from "@/lib/audit";
import type { IntegrityPlatform, IntegrityVerdict } from "./types";

// ---------------------------------------------------------------------------
// Device and app-instance registry.
//
// THE GAP THIS CLOSES. The session JWT carries `sub`, `roles`, `jti`,
// `auth_time` — and nothing about WHERE it is being used. A token exfiltrated
// from a compromised device replays from any client anywhere. So the chain
//
//     USER → DEVICE → APP INSTANCE → … → SIGNATURE
//
// was broken at its second link: everything downstream bound to a user, and
// nothing bound to the thing the user was holding.
//
// THE RULE THAT MAKES THIS WORTH HAVING: a device identifier the CLIENT
// chooses is not an identity, it is a suggestion. Anything self-asserted —
// a random string in storage, an advertising id, an Android id, a model name —
// can be copied to a second device along with the token, and then both devices
// are "the same device". So:
//
//   * `deviceId` is minted SERVER-SIDE and is a hash of the public key the
//     device proved possession of. Two devices cannot collide on it without
//     colliding on a keypair.
//   * A device is PENDING until it has proved something. It reaches TRUSTED
//     only after server-side verification, never by claiming to be.
//   * `appInstanceId` is separate from `deviceId` on purpose: reinstalling the
//     app produces a new instance on the same hardware, and that distinction
//     is exactly what catches "restored from a backup onto a new phone".
//
// WHAT IS NOT HERE. The attestation-chain verification itself — parsing an
// Android key-attestation certificate chain and validating it to a Google root.
// That needs the root material and a real device to produce a chain worth
// testing against, so `attestationStatus` stays `attestation_missing` until it
// exists, and the POLICY below already treats that as untrusted rather than
// as a pass. The state machine, the binding and the revocation are complete
// and testable now; the crypto slots into one function.
// ---------------------------------------------------------------------------

export type DeviceStatus =
  /** Registered, nothing proved. May not authorise anything sensitive. */
  | "pending"
  /** Attestation submitted, verification in progress. Still not trusted. */
  | "attesting"
  /** Server verified the device's key. The only status that may sign. */
  | "trusted"
  /** Temporarily barred — risk signal, user report, or an open investigation. */
  | "suspended"
  /** Permanently barred. Terminal: a revoked device is never re-trusted; the
   *  user enrols a new one. */
  | "revoked";

/**
 * What the server established about where the private key lives.
 *
 * NEVER set from a client-supplied boolean. A device claiming
 * `hardwareBacked: true` has claimed nothing — the whole point of key
 * attestation is that the claim arrives as a certificate chain the server
 * validates to a known root.
 */
export type AttestationStatus =
  /** Chain verified to a platform root; key is in hardware. */
  | "hardware_trusted"
  /** Chain verified, but the key is software-backed. Real, and weaker. */
  | "software_only"
  /** A chain was presented and did not validate. Actively suspicious. */
  | "attestation_invalid"
  /** No chain presented, or verification not available on this platform. */
  | "attestation_missing";

export interface DeviceRecord {
  /** Server-minted. Derived from the public key, never client-chosen. */
  readonly deviceId: string;
  readonly userId: string;
  /** Distinguishes a reinstall from the same physical device. */
  readonly appInstanceId: string;
  readonly platform: IntegrityPlatform;
  readonly platformVersion?: string;
  readonly appVersion?: string;
  /** Public key the device proved possession of, SPKI base64. Never a secret. */
  readonly publicKey: string;
  /** Increments on rotation; an old key's authorizations do not survive. */
  readonly keyVersion: number;
  readonly status: DeviceStatus;
  readonly attestationStatus: AttestationStatus;
  /** Most recent platform-integrity verdict seen for this device. */
  readonly lastIntegrityVerdict?: IntegrityVerdict;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly revokedAt?: number;
  readonly revokedReason?: string;
}

const DEVICE_KEY = (id: string) => `device:${id}`;
const USER_DEVICES_KEY = (userId: string) => `device:byuser:${userId}`;
/** Devices are long-lived; the record outlives any session. */
const DEVICE_TTL_SECONDS = 400 * 86_400;

/**
 * Mint a device id from the public key.
 *
 * Deterministic, so re-registering the same key resolves to the same device
 * rather than creating a duplicate — and two different devices cannot share an
 * id without sharing a keypair.
 */
export function deviceIdForKey(publicKey: string): string {
  return "dev_" + createHash("sha256").update(publicKey, "utf8").digest("hex").slice(0, 32);
}

export function newAppInstanceId(): string {
  return "inst_" + randomUUID().replace(/-/g, "");
}

// ── Registration ───────────────────────────────────────────────────────────

export interface RegisterDeviceInput {
  readonly userId: string;
  readonly publicKey: string;
  readonly platform: IntegrityPlatform;
  readonly platformVersion?: string;
  readonly appVersion?: string;
  /** Present on a reinstall that wants to keep its instance identity. */
  readonly appInstanceId?: string;
}

/**
 * Register a device. It starts PENDING — registration proves nothing.
 *
 * Returns the existing record when the same key re-registers, so a client that
 * retries does not fork its own identity. A key already registered to a
 * DIFFERENT user is refused: that is either a collision (impossible in
 * practice) or an attempt to graft a known-good device onto another account.
 */
export async function registerDevice(
  input: RegisterDeviceInput,
  now: number = Date.now()
): Promise<{ ok: true; device: DeviceRecord } | { ok: false; reason: string }> {
  if (!input.publicKey || input.publicKey.length < 32 || input.publicKey.length > 4096) {
    return { ok: false, reason: "public_key_malformed" };
  }

  const deviceId = deviceIdForKey(input.publicKey);
  const existing = await kvGet<DeviceRecord>(DEVICE_KEY(deviceId));

  if (existing) {
    if (existing.userId !== input.userId) {
      // The same keypair presented under a second account. Refuse rather than
      // rebind: rebinding would let an attacker who compromised one account
      // inherit a trusted device record.
      audit("device.registration_refused", input.userId, {
        deviceId,
        reason: "key_bound_to_other_user",
      });
      return { ok: false, reason: "key_bound_to_other_user" };
    }
    if (existing.status === "revoked") {
      // Terminal. A revoked device does not come back by re-registering; the
      // user enrols fresh key material.
      return { ok: false, reason: "device_revoked" };
    }
    const touched: DeviceRecord = { ...existing, lastSeenAt: now };
    await kvSet(DEVICE_KEY(deviceId), touched, DEVICE_TTL_SECONDS);
    return { ok: true, device: touched };
  }

  const device: DeviceRecord = {
    deviceId,
    userId: input.userId,
    appInstanceId: input.appInstanceId ?? newAppInstanceId(),
    platform: input.platform,
    platformVersion: input.platformVersion,
    appVersion: input.appVersion,
    publicKey: input.publicKey,
    keyVersion: 1,
    // PENDING, not trusted. Registration is a claim; trust is a conclusion.
    status: "pending",
    attestationStatus: "attestation_missing",
    createdAt: now,
    lastSeenAt: now,
  };

  await kvSet(DEVICE_KEY(deviceId), device, DEVICE_TTL_SECONDS);
  const list = (await kvGet<string[]>(USER_DEVICES_KEY(input.userId))) ?? [];
  if (!list.includes(deviceId)) {
    await kvSet(USER_DEVICES_KEY(input.userId), [...list, deviceId], DEVICE_TTL_SECONDS);
  }

  audit("device.registered", input.userId, {
    deviceId,
    appInstanceId: device.appInstanceId,
    platform: device.platform,
  });
  return { ok: true, device };
}

export async function getDevice(deviceId: string): Promise<DeviceRecord | null> {
  return kvGet<DeviceRecord>(DEVICE_KEY(deviceId));
}

export async function listUserDevices(userId: string): Promise<DeviceRecord[]> {
  const ids = (await kvGet<string[]>(USER_DEVICES_KEY(userId))) ?? [];
  const records = await Promise.all(ids.map((id) => getDevice(id)));
  return records.filter((d): d is DeviceRecord => d !== null);
}

// ── Attestation ────────────────────────────────────────────────────────────

/**
 * Record the outcome of key attestation.
 *
 * A device becomes TRUSTED only through this function, and only on a status
 * the server itself concluded. `attestation_missing` deliberately does NOT
 * promote: on a platform where we cannot verify, the correct answer is that we
 * have not verified — the signing policy then decides what an unverified
 * device may do, which is a policy question rather than a trust claim.
 */
export async function recordAttestation(
  deviceId: string,
  status: AttestationStatus,
  now: number = Date.now()
): Promise<DeviceRecord | null> {
  const device = await getDevice(deviceId);
  if (!device) return null;
  if (device.status === "revoked") return device;

  const promoted: DeviceStatus =
    status === "hardware_trusted" || status === "software_only" ? "trusted" : device.status;

  const updated: DeviceRecord = {
    ...device,
    attestationStatus: status,
    status: promoted,
    lastSeenAt: now,
  };
  await kvSet(DEVICE_KEY(deviceId), updated, DEVICE_TTL_SECONDS);

  audit(
    status === "attestation_invalid" ? "device.attestation_failed" : "device.attestation_verified",
    device.userId,
    { deviceId, attestationStatus: status, status: promoted }
  );
  return updated;
}

/**
 * Revoke a device. Terminal, and it invalidates its authorizations.
 *
 * The key-version bump is what makes revocation retroactive: every
 * authorization records the key version it was minted under, so bumping it
 * makes all outstanding authorizations for this device fail their binding
 * check without having to enumerate and delete them — which on a KV store
 * would be a scan we cannot do atomically.
 */
export async function revokeDevice(
  deviceId: string,
  reason: string,
  now: number = Date.now()
): Promise<DeviceRecord | null> {
  const device = await getDevice(deviceId);
  if (!device) return null;

  const revoked: DeviceRecord = {
    ...device,
    status: "revoked",
    keyVersion: device.keyVersion + 1,
    revokedAt: now,
    revokedReason: reason,
  };
  await kvSet(DEVICE_KEY(deviceId), revoked, DEVICE_TTL_SECONDS);
  audit("device.revoked", device.userId, { deviceId, reason });
  return revoked;
}

/** Rotate to new key material. Old authorizations stop verifying. */
export async function rotateDeviceKey(
  deviceId: string,
  newPublicKey: string,
  now: number = Date.now()
): Promise<{ ok: true; device: DeviceRecord } | { ok: false; reason: string }> {
  const device = await getDevice(deviceId);
  if (!device) return { ok: false, reason: "device_not_found" };
  if (device.status === "revoked") return { ok: false, reason: "device_revoked" };

  const rotated: DeviceRecord = {
    ...device,
    publicKey: newPublicKey,
    keyVersion: device.keyVersion + 1,
    // Rotation resets trust. New key material has proved nothing yet, and
    // inheriting the old key's trust would make rotation a way to launder an
    // unattested key into a trusted record.
    status: "pending",
    attestationStatus: "attestation_missing",
    lastSeenAt: now,
  };
  await kvSet(DEVICE_KEY(deviceId), rotated, DEVICE_TTL_SECONDS);
  audit("device.key_rotated", device.userId, { deviceId, keyVersion: rotated.keyVersion });
  return { ok: true, device: rotated };
}

// ── Policy ─────────────────────────────────────────────────────────────────

export type DeviceRefusal =
  | "device_not_found"
  | "device_not_owned"
  | "device_revoked"
  | "device_suspended"
  | "device_not_trusted"
  | "app_instance_mismatch"
  | "key_version_mismatch";

export interface DeviceCheck {
  readonly ok: boolean;
  readonly refusals: readonly DeviceRefusal[];
  readonly device?: DeviceRecord;
}

/**
 * May this device authorise or sign right now?
 *
 * Collects every refusal. `device_not_trusted` is separated from
 * `device_revoked` because they mean opposite things operationally: one is a
 * device that has not finished enrolling, the other is one we threw out.
 */
export async function checkDevice(input: {
  deviceId: string;
  userId: string;
  appInstanceId: string;
  /** Version the authorization was minted under, when re-checking one. */
  expectedKeyVersion?: number;
}): Promise<DeviceCheck> {
  const refusals: DeviceRefusal[] = [];
  const device = await getDevice(input.deviceId);

  if (!device) return { ok: false, refusals: ["device_not_found"] };
  if (device.userId !== input.userId) refusals.push("device_not_owned");
  if (device.status === "revoked") refusals.push("device_revoked");
  if (device.status === "suspended") refusals.push("device_suspended");
  if (device.status === "pending" || device.status === "attesting") {
    refusals.push("device_not_trusted");
  }
  if (device.appInstanceId !== input.appInstanceId) refusals.push("app_instance_mismatch");
  if (
    input.expectedKeyVersion !== undefined &&
    device.keyVersion !== input.expectedKeyVersion
  ) {
    // The key rotated or the device was revoked after the authorization was
    // minted. Either way the authorization predates the current key.
    refusals.push("key_version_mismatch");
  }

  return { ok: refusals.length === 0, refusals, device };
}

/**
 * Trust tier for the risk engine.
 *
 * Advisory. Returned as a tier rather than a boolean so policy can be set once,
 * centrally, rather than each caller inventing its own threshold.
 */
export type DeviceTrustTier = "untrusted" | "basic" | "hardware";

export function deviceTrustTier(device: DeviceRecord | undefined): DeviceTrustTier {
  if (!device || device.status !== "trusted") return "untrusted";
  return device.attestationStatus === "hardware_trusted" ? "hardware" : "basic";
}
