import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { registerDevice, listUserDevices } from "@/lib/integrity/device";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/devices/register — enrol a device's public key.
//
// THE FIRST LINK IN THE CHAIN. A session token says WHO; it says nothing about
// WHERE it is being used, so a token exfiltrated from a compromised phone
// replays from anywhere. This is where a device becomes a thing the server can
// name, and every later control — the signing challenge, the authorization,
// the signature itself — binds to the identity minted here.
//
// WHAT THE CLIENT DOES NOT GET TO DECIDE. Not the device id: it is a hash of
// the public key, computed server-side (`deviceIdForKey`). A self-asserted id
// can be copied to a second device along with the token, and then both devices
// are "the same device", which defeats the entire purpose.
//
// AND NOT THE TRUST. Registration returns a device in status `pending`. It
// signs nothing until attestation has been verified through /api/devices/attest
// — registration is a claim, trust is a conclusion.
// ---------------------------------------------------------------------------

const RegisterSchema = z.object({
  /**
   * SPKI public key, base64. The device proves possession of the matching
   * private key through attestation; this endpoint only records the claim.
   *
   * Not a secret — bounded only because an unbounded string is a free way to
   * fill the store.
   */
  publicKey: z.string().min(32).max(4096),
  platform: z.enum(["ios", "android", "web"]),
  platformVersion: z.string().max(64).optional(),
  appVersion: z.string().max(64).optional(),
  /** Present on a reinstall that is keeping its instance identity. */
  appInstanceId: z.string().regex(/^inst_[0-9a-f]{32}$/).optional(),
});

/** Enrolling many devices is not a normal thing for an account to do quickly. */
const MAX_DEVICES_PER_USER = 10;

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(
    req,
    "devices.register",
    { limit: 10, windowMs: 60 * 60_000 },
    userId
  );
  if (limited) return limited;

  const body = await validateBody(req, RegisterSchema);
  if (body instanceof NextResponse) return body;

  // A cap, because each registered device is another key that could be made to
  // sign. Re-registering an existing key is idempotent and does not count
  // against it — only genuinely new hardware does, which is checked after the
  // registry has had its say.
  const existing = await listUserDevices(userId);
  const alreadyKnown = existing.some(
    (d) => d.status !== "revoked" && d.publicKey === body.publicKey
  );
  if (!alreadyKnown && existing.filter((d) => d.status !== "revoked").length >= MAX_DEVICES_PER_USER) {
    return NextResponse.json(
      {
        error: "device_limit_reached",
        detail: "This account has reached its device limit. Remove a device before adding another.",
      },
      { status: 409 }
    );
  }

  const result = await registerDevice({
    userId,
    publicKey: body.publicKey,
    platform: body.platform,
    platformVersion: body.platformVersion,
    appVersion: body.appVersion,
    appInstanceId: body.appInstanceId,
  });

  if (!result.ok) {
    // `key_bound_to_other_user` and `device_revoked` are both terminal and both
    // reported as the same refusal: distinguishing them would tell a caller
    // whether a given public key is already enrolled elsewhere, which is a
    // membership oracle over other people's devices.
    return NextResponse.json(
      {
        error: "device_registration_refused",
        detail: "This device could not be registered.",
      },
      { status: 403 }
    );
  }

  const device = result.device;
  return NextResponse.json(
    {
      deviceId: device.deviceId,
      appInstanceId: device.appInstanceId,
      status: device.status,
      attestationStatus: device.attestationStatus,
      keyVersion: device.keyVersion,
      // Said plainly so a client cannot mistake enrolment for authorisation.
      // The app must complete attestation before it can request a signature.
      attestationRequired: device.status !== "trusted",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// GET — the caller's own devices, for a "where you're signed in" screen and for
// revoking one. Never another account's: `listUserDevices` is keyed on the
// authenticated id and takes no parameter from the request.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const devices = await listUserDevices(auth.account.user.id);
  return NextResponse.json(
    {
      devices: devices.map((d) => ({
        deviceId: d.deviceId,
        appInstanceId: d.appInstanceId,
        platform: d.platform,
        platformVersion: d.platformVersion,
        appVersion: d.appVersion,
        status: d.status,
        attestationStatus: d.attestationStatus,
        createdAt: d.createdAt,
        lastSeenAt: d.lastSeenAt,
        // publicKey is deliberately omitted. It is not secret, but returning
        // key material in a list endpoint invites it into logs and screenshots
        // for no benefit the UI actually has.
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
