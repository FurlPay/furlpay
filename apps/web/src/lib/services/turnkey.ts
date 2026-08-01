import { createSign } from "node:crypto";

// ---------------------------------------------------------------------------
// Turnkey client — the remote share of an MPC key.
//
// SERVER ONLY. The Turnkey API key is an organisation-wide signing credential:
// anything holding it can ask for a signature from any wallet in the org,
// subject only to Turnkey's own policies. It must never reach a phone, which is
// why the app talks to /api/mpc/sign and this file talks to Turnkey.
//
// WHY signRawPayload AND NOT signTransaction. Turnkey can build and sign a
// whole transaction itself. We deliberately do not use that: the client
// serializes the transaction, computes the digest, and verifies the returned
// signature recovers to the expected address (see native-app MpcSigner). If
// Turnkey derived its own digest, that verification would be checking Turnkey
// against Turnkey and would prove nothing.
//
// HASH_FUNCTION_NO_OP is what makes that possible — it signs the exact 32 bytes
// supplied, with no further hashing. Passing KECCAK256 here would double-hash
// an already-hashed digest and produce a signature over the wrong thing.
// ---------------------------------------------------------------------------

const TURNKEY_API = process.env.TURNKEY_API_URL ?? "https://api.turnkey.com";
const UPSTREAM_TIMEOUT_MS = 10_000;

export interface TurnkeySignature {
  r: string;
  s: string;
  /** "00"/"01" or "1b"/"1c" depending on the key type. Normalised downstream. */
  v: string;
}

export class TurnkeyError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "TurnkeyError";
    this.status = status;
  }
}

/** True when the server is configured to reach Turnkey at all. */
export function turnkeyConfigured(): boolean {
  return Boolean(
    process.env.TURNKEY_ORGANIZATION_ID &&
      process.env.TURNKEY_API_PUBLIC_KEY &&
      process.env.TURNKEY_API_PRIVATE_KEY
  );
}

/**
 * Signs a 32-byte digest with the Turnkey-held share.
 *
 * `digestHex` must be the FINAL digest — for EIP-1559 that is
 * keccak256(0x02 ‖ rlp([...])), which the client already computed.
 */
export async function signDigest(params: {
  signWith: string;
  digestHex: string;
}): Promise<TurnkeySignature> {
  if (!turnkeyConfigured()) {
    // Fails closed and says why. A misconfigured deployment must not look like
    // a signing failure — those get retried.
    throw new TurnkeyError(503, "Turnkey is not configured on this deployment.");
  }
  const digest = params.digestHex.startsWith("0x") ? params.digestHex.slice(2) : params.digestHex;
  if (!/^[0-9a-fA-F]{64}$/.test(digest)) {
    throw new TurnkeyError(400, "Digest must be 32 bytes of hex.");
  }

  const body = JSON.stringify({
    type: "ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2",
    timestampMs: String(Date.now()),
    organizationId: process.env.TURNKEY_ORGANIZATION_ID,
    parameters: {
      signWith: params.signWith,
      payload: digest,
      encoding: "PAYLOAD_ENCODING_HEXADECIMAL",
      // The whole point — sign these bytes, do not hash them again.
      hashFunction: "HASH_FUNCTION_NO_OP",
    },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(`${TURNKEY_API}/public/v1/submit/sign_raw_payload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Stamp": stamp(body),
      },
      body,
      signal: controller.signal,
      cache: "no-store",
    });

    const json = (await res.json().catch(() => null)) as {
      activity?: {
        status?: string;
        result?: { signRawPayloadResult?: TurnkeySignature };
      };
      message?: string;
    } | null;

    if (!res.ok) {
      throw new TurnkeyError(res.status, json?.message ?? `Turnkey returned ${res.status}.`);
    }

    const status = json?.activity?.status;
    const result = json?.activity?.result?.signRawPayloadResult;

    // A pending activity means Turnkey's own policy requires another approver.
    // That is a legitimate outcome, not an error, and the caller must be able
    // to tell it apart from a refusal.
    if (status && status !== "ACTIVITY_STATUS_COMPLETED") {
      throw new TurnkeyError(
        202,
        `Turnkey did not complete the signature (${status}). It may require another approval.`
      );
    }
    if (!result?.r || !result?.s || result?.v === undefined) {
      throw new TurnkeyError(502, "Turnkey returned no signature.");
    }
    return result;
  } catch (e) {
    if (e instanceof TurnkeyError) throw e;
    const aborted = (e as Error)?.name === "AbortError";
    throw new TurnkeyError(504, aborted ? "Turnkey timed out." : "Could not reach Turnkey.");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turnkey's request authentication: a P-256 signature over the EXACT request
 * body, carried in `X-Stamp`.
 *
 * Byte-exactness matters — the body string signed here must be the same string
 * sent, which is why `body` is built once above and passed through rather than
 * re-serialized. Re-stringifying could reorder keys and invalidate the stamp.
 *
 * Hand-rolled rather than pulling @turnkey/sdk-server for one header. The
 * failure mode is benign: a wrong stamp is a 401, which is loud and immediate,
 * unlike a wrong hash which would be silently wrong.
 */
function stamp(body: string): string {
  const signer = createSign("SHA256");
  signer.update(body);
  signer.end();

  const signature = signer
    .sign({
      key: derPrivateKey(process.env.TURNKEY_API_PRIVATE_KEY!),
      format: "der",
      type: "sec1",
      dsaEncoding: "der",
    })
    .toString("hex");

  return base64url(
    JSON.stringify({
      publicKey: process.env.TURNKEY_API_PUBLIC_KEY,
      scheme: "SIGNATURE_SCHEME_TK_API_P256",
      signature,
    })
  );
}

/**
 * Wraps Turnkey's raw 32-byte hex private key into the SEC1 DER structure
 * node:crypto expects.
 *
 * Turnkey issues the key as bare hex scalar; node wants a structured key. The
 * prefix/suffix below are the fixed SEC1 header for a P-256 key.
 */
function derPrivateKey(hex: string): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new TurnkeyError(500, "TURNKEY_API_PRIVATE_KEY must be 32 bytes of hex.");
  }
  return Buffer.concat([
    Buffer.from("30740201010420", "hex"), // SEC1 ECPrivateKey header
    Buffer.from(clean, "hex"),
    Buffer.from("a00706052b8104000a", "hex"), // OID: prime256v1
  ]);
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}
