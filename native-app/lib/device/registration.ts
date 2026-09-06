import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { secp256k1 } from "@noble/curves/secp256k1";
import * as Crypto from "expo-crypto";
import { api, ApiError } from "@/lib/api";
import { bytesToHex } from "@/lib/evm/rlp";

// ---------------------------------------------------------------------------
// Device enrolment — the first link in USER → DEVICE → APP INSTANCE → SIGNATURE.
//
// WHY THIS EXISTS. The session token says WHO. It says nothing about WHERE it
// is being used, so a token lifted off a compromised phone replays from
// anywhere with no way for the server to tell the difference. Enrolling a
// keypair gives the server something to bind to that a stolen token does not
// carry with it.
//
// WHAT THE SERVER DOES NOT ACCEPT FROM US. The device id. It is a hash of the
// public key, computed server-side, and this file deliberately does not compute
// it locally — a self-asserted id can be copied to a second device along with
// the token, and then both devices are "the same device", which is exactly the
// thing being defended against. We send a key; the server names the device.
//
// WHAT THIS KEY HONESTLY IS, AND IS NOT. It is a secp256k1 key generated in JS
// and held in SecureStore, which on Android is Keystore-encrypted. That
// protects it at rest. It is NOT a StrongBox-attested hardware key, and this
// file must not imply otherwise: nothing here proves to the server that the
// private key is non-extractable, because a proof of that is a hardware
// attestation certificate chain and generating one requires native code that
// does not exist in this app yet.
//
// The server treats the difference as what it is. A device enrolled this way
// stays `pending` and cannot authorise a signature until attestation has been
// verified. That is a real limitation, stated where someone will read it,
// rather than a `hardwareBacked: true` flag that means nothing.
// ---------------------------------------------------------------------------

const PRIVATE_KEY = "furlpay.device.privkey.v1";
const DEVICE_ID = "furlpay.device.id.v1";
const APP_INSTANCE_ID = "furlpay.device.instance.v1";

/**
 * No `requireAuthentication`. This key identifies the installation on ordinary
 * API calls, and gating it behind a biometric would prompt the user on app
 * launch. The WALLET key keeps its biometric gate (lib/wallet.ts) — that is the
 * one that moves money.
 */
const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export interface DeviceIdentity {
  readonly deviceId: string;
  readonly appInstanceId: string;
  /** False until attestation has been verified server-side. */
  readonly trusted: boolean;
  readonly attestationRequired: boolean;
}

export class DeviceNotEnrolled extends Error {
  constructor(message = "This device is not enrolled for signing.") {
    super(message);
    this.name = "DeviceNotEnrolled";
  }
}

/** Uncompressed SPKI-ish public key, hex. Sent to the server; never a secret. */
async function publicKeyHex(): Promise<string> {
  let priv = await SecureStore.getItemAsync(PRIVATE_KEY, OPTS).catch(() => null);
  if (!priv) {
    // 32 bytes from the platform CSPRNG. `Math.random` would make the key
    // predictable from the launch time, which is not a key.
    const bytes = Crypto.getRandomBytes(32);
    priv = bytesToHex(bytes).replace(/^0x/, "");
    // A scalar out of range is invalid for secp256k1; regenerate rather than
    // clamp, because clamping biases the key space.
    if (!secp256k1.utils.isValidPrivateKey(priv)) return publicKeyHex();
    await SecureStore.setItemAsync(PRIVATE_KEY, priv, OPTS);
  }
  const pub = secp256k1.getPublicKey(priv, false);
  return bytesToHex(pub).replace(/^0x/, "");
}

/**
 * Sign arbitrary bytes with the device key.
 *
 * Used to prove possession — of a challenge nonce, of an attestation payload.
 * Exported because possession is proved in more than one place, and each of
 * them must use the SAME key or the proofs are about different devices.
 */
export async function signWithDeviceKey(message: Uint8Array): Promise<string | null> {
  const priv = await SecureStore.getItemAsync(PRIVATE_KEY, OPTS).catch(() => null);
  if (!priv) return null;
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, message);
  const sig = secp256k1.sign(new Uint8Array(digest), priv);
  return sig.toCompactHex();
}

/** Cached identity, if this installation has already enrolled. */
export async function currentIdentity(): Promise<{ deviceId: string; appInstanceId: string } | null> {
  const [deviceId, appInstanceId] = await Promise.all([
    SecureStore.getItemAsync(DEVICE_ID, OPTS).catch(() => null),
    SecureStore.getItemAsync(APP_INSTANCE_ID, OPTS).catch(() => null),
  ]);
  if (!deviceId || !appInstanceId) return null;
  return { deviceId, appInstanceId };
}

/**
 * Enrol this device, or refresh what the server thinks of it.
 *
 * Idempotent by construction: the server derives the device id from the public
 * key, so re-registering the same key resolves to the same record rather than
 * forking this installation's identity.
 *
 * The stored `appInstanceId` is sent back on re-registration so a running
 * install keeps its instance. A REINSTALL has no stored value, gets a new
 * instance id on the same hardware, and that difference is precisely what
 * catches "restored from a backup onto a different phone".
 */
export async function enrolDevice(): Promise<DeviceIdentity> {
  const publicKey = await publicKeyHex();
  const existing = await currentIdentity();

  const response = await api<{
    deviceId: string;
    appInstanceId: string;
    status: string;
    attestationStatus: string;
    keyVersion: number;
    attestationRequired: boolean;
  }>("/devices/register", {
    method: "POST",
    body: {
      publicKey,
      platform: Platform.OS === "ios" ? "ios" : "android",
      platformVersion: String(Platform.Version),
      appVersion: Constants.expoConfig?.version ?? undefined,
      ...(existing?.appInstanceId ? { appInstanceId: existing.appInstanceId } : {}),
    },
  });

  await SecureStore.setItemAsync(DEVICE_ID, response.deviceId, OPTS);
  await SecureStore.setItemAsync(APP_INSTANCE_ID, response.appInstanceId, OPTS);

  return {
    deviceId: response.deviceId,
    appInstanceId: response.appInstanceId,
    trusted: response.status === "trusted",
    attestationRequired: response.attestationRequired,
  };
}

/**
 * The identity a signing flow needs, enrolling if this is the first run.
 *
 * Throws rather than returning null. A caller that is about to move money must
 * not be able to proceed with an absent device identity by forgetting a null
 * check — the type system should make the unenrolled path impossible to ignore.
 */
export async function requireIdentity(): Promise<{ deviceId: string; appInstanceId: string }> {
  const cached = await currentIdentity();
  if (cached) return cached;
  try {
    const enrolled = await enrolDevice();
    return { deviceId: enrolled.deviceId, appInstanceId: enrolled.appInstanceId };
  } catch (e) {
    if (e instanceof ApiError) {
      throw new DeviceNotEnrolled(
        "This device could not be enrolled for signing. Sign in again, or remove an old device."
      );
    }
    throw new DeviceNotEnrolled();
  }
}

/** Forget this installation's identity — sign-out, or a deliberate re-enrol. */
export async function clearIdentity(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(DEVICE_ID, OPTS).catch(() => {}),
    SecureStore.deleteItemAsync(APP_INSTANCE_ID, OPTS).catch(() => {}),
    // The private key is deliberately KEPT. Deleting it would mint a new device
    // on the next sign-in, and a user who signs out and back in has not changed
    // phones — churning device records would make the "where you're signed in"
    // list useless and would discard whatever trust the device had earned.
  ]);
}
